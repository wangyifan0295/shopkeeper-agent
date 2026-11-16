"""
AG-UI 协议问数查询服务

负责把 API 层传入的自然语言问题转换成一次 LangGraph 工作流执行：
创建初始 State、组装 Runtime Context、消费 graph.astream 的流式输出，
并把执行过程逐段翻译成 AG-UI 标准事件（RUN/STEP/STATE/TEXT_MESSAGE/CUSTOM），
让任何 AG-UI 兼容客户端（官方 HttpAgent、CopilotKit、事件检查器等）无需改动即可消费。
"""

import json
import uuid
from dataclasses import asdict, is_dataclass

from ag_ui.core import (
    CustomEvent,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    StepFinishedEvent,
    StepStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.encoder import EventEncoder
from langchain_huggingface import HuggingFaceEndpointEmbeddings

from app.agent.context import DataAgentContext
from app.agent.graph import graph
from app.agent.state import DataAgentState
from app.repositories.es.value_es_repository import ValueESRepository
from app.repositories.mysql.dw.dw_mysql_repository import DWMySQLRepository
from app.repositories.mysql.meta.meta_mysql_repository import MetaMySQLRepository
from app.repositories.qdrant.column_qdrant_repository import ColumnQdrantRepository
from app.repositories.qdrant.metric_qdrant_repository import MetricQdrantRepository


def _json_default(obj):
    """JSON 序列化兜底：实体 dataclass 递归展开成字典，其余对象转字符串"""

    if is_dataclass(obj):
        return asdict(obj)
    return str(obj)


def _to_json_safe(value):
    """把运行时对象转成纯 JSON 结构，保证事件负载可以直接进协议事件"""

    return json.loads(json.dumps(value, ensure_ascii=False, default=_json_default))


def _extract_query(agui_input: RunAgentInput) -> str:
    """从标准 RunAgentInput 中取出最后一条用户消息作为自然语言问题"""

    for message in reversed(agui_input.messages):
        if message.role == "user":
            content = message.content
            if isinstance(content, str):
                return content
            # 多段内容时只拼接纯文本部分，忽略图片等富媒体输入
            return "".join(part.text for part in content if getattr(part, "text", None))
    raise ValueError("RunAgentInput.messages 中找不到用户消息")


def _summarize_result(data) -> str:
    """生成一句话结果摘要，用标准文本消息事件发给通用聊天客户端"""

    if isinstance(data, list):
        return f"查询完成，共 {len(data)} 行结果。" if data else "查询完成，结果为空。"
    if isinstance(data, dict):
        return "查询完成，已返回结构化结果。"
    return "查询完成。"


class AGuiQueryService:
    """以 AG-UI 标准事件流式输出问数工作流的查询服务"""

    def __init__(
        self,
        meta_mysql_repository: MetaMySQLRepository,
        embedding_client: HuggingFaceEndpointEmbeddings,
        dw_mysql_repository: DWMySQLRepository,
        column_qdrant_repository: ColumnQdrantRepository,
        metric_qdrant_repository: MetricQdrantRepository,
        value_es_repository: ValueESRepository,
    ):
        # MySQL 仓储分别负责元数据补全和真实数仓环境信息读取
        self.meta_mysql_repository = meta_mysql_repository
        self.dw_mysql_repository = dw_mysql_repository

        # 召回链路依赖的向量检索、Embedding 和全文检索能力由依赖层注入
        self.embedding_client = embedding_client
        self.column_qdrant_repository = column_qdrant_repository
        self.metric_qdrant_repository = metric_qdrant_repository
        self.value_es_repository = value_es_repository

    def _build_context(self) -> DataAgentContext:
        """组装一次图执行的运行时上下文"""

        # Context 保存本次图执行需要复用的外部依赖，节点通过 runtime.context 读取
        return DataAgentContext(
            column_qdrant_repository=self.column_qdrant_repository,
            embedding_client=self.embedding_client,
            metric_qdrant_repository=self.metric_qdrant_repository,
            value_es_repository=self.value_es_repository,
            meta_mysql_repository=self.meta_mysql_repository,
            dw_mysql_repository=self.dw_mysql_repository,
        )

    async def query(self, agui_input: RunAgentInput):
        """执行一次问数工作流，并把执行过程逐段翻译成 AG-UI 标准 SSE 事件"""

        encoder = EventEncoder()
        query = _extract_query(agui_input)

        # threadId 和 runId 由客户端生成并随输入携带，事件中要回传同一对标识
        yield encoder.encode(
            RunStartedEvent(thread_id=agui_input.thread_id, run_id=agui_input.run_id)
        )

        # State 只放会被图节点读写和合并的业务数据，外部工具对象不塞进 State
        state = DataAgentState(query=query)
        context = self._build_context()

        try:
            # custom 流承载节点手写的进度事件，values 流承载每个超步后的累积状态
            async for mode, chunk in graph.astream(
                input=state, context=context, stream_mode=["custom", "values"]
            ):
                if mode == "custom":
                    # chunk 是节点里 writer(...) 写出的私有事件字典，在这里翻译成标准事件
                    async for sse in self._translate_chunk(encoder, chunk):
                        yield sse
                else:
                    # values 模式输出整张图的累积状态，作为 STATE_SNAPSHOT 推给前端做状态同步
                    yield encoder.encode(
                        StateSnapshotEvent(snapshot=_to_json_safe(chunk))
                    )
        except Exception as e:
            # SSE 响应头已经发出，无法再改 HTTP 状态码，只能编码成 RUN_ERROR 事件
            yield encoder.encode(RunErrorEvent(message=str(e)))
            return

        yield encoder.encode(
            RunFinishedEvent(thread_id=agui_input.thread_id, run_id=agui_input.run_id)
        )

    async def _translate_chunk(self, encoder: EventEncoder, chunk: dict):
        """把节点私有事件翻译成 AG-UI 标准事件"""

        chunk_type = chunk.get("type")

        if chunk_type == "progress":
            step = chunk.get("step", "")
            if chunk.get("status") == "running":
                # 步骤开始：前端可用 STEP_STARTED 驱动步骤条的 loading 态
                yield encoder.encode(StepStartedEvent(step_name=step))
            else:
                # success 和 error 都意味着该步骤执行完毕，失败详情由随后的 RUN_ERROR 统一表达
                yield encoder.encode(StepFinishedEvent(step_name=step))

        elif chunk_type == "result":
            data = _to_json_safe(chunk.get("data"))
            # 结果表格走 CUSTOM 事件，前端按 name="result" 识别并渲染成表格
            yield encoder.encode(CustomEvent(name="result", value=data))

            # 再补一条标准文本消息三元组，保证只认标准消息事件的通用 AG-UI 客户端也能看到结果摘要
            message_id = f"msg_{uuid.uuid4().hex[:12]}"
            yield encoder.encode(
                TextMessageStartEvent(message_id=message_id, role="assistant")
            )
            yield encoder.encode(
                TextMessageContentEvent(
                    message_id=message_id, delta=_summarize_result(data)
                )
            )
            yield encoder.encode(TextMessageEndEvent(message_id=message_id))
