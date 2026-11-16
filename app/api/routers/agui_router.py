"""
AG-UI 协议问数接口路由

负责定义 `/api/agui/query` 接口：请求体是 AG-UI 标准的 RunAgentInput，
响应是 AG-UI 标准事件组成的 SSE 流。
与旧版 `/api/query` 并行共存，便于两套协议对照学习和逐步迁移。
路由层只处理请求体、依赖声明和响应类型，不直接执行图节点。
"""

from typing import Annotated

from ag_ui.core import RunAgentInput
from fastapi import APIRouter, Depends
from starlette.responses import StreamingResponse

from app.api.dependencies import get_agui_query_service
from app.services.agui_query_service import AGuiQueryService

# 当前模块只维护 AG-UI 协议相关接口
agui_router = APIRouter()


@agui_router.post("/api/agui/query")
async def agui_query_handler(
    # 请求体参数：FastAPI 会把前端 JSON 自动解析成 AG-UI 标准输入模型 RunAgentInput
    agui_input: RunAgentInput,
    # 服务依赖：复用 get_query_service 的依赖链，包装出 AG-UI 协议服务
    agui_query_service: Annotated[AGuiQueryService, Depends(get_agui_query_service)],
):
    """接收 AG-UI RunAgentInput，按 AG-UI 标准事件流式返回工作流执行过程"""

    return StreamingResponse(
        # AGuiQueryService.query 返回异步生成器，逐段产出编码好的标准 SSE 事件
        agui_query_service.query(agui_input),
        media_type="text/event-stream",
    )
