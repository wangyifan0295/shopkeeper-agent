/**
 * AG-UI 协议智能体客户端
 * 用官方 @ag-ui/client 的 HttpAgent 消费 /api/agui/query 的标准事件流，
 * 替代 agentApi.ts 里手写的 SSE 解析；
 * 收到的标准事件会被翻译成与旧协议同构的 AgentEvent，供 App 统一消费。
 */
import { HttpAgent, type AgentSubscriber } from "@ag-ui/client";
import type { UserMessage } from "@ag-ui/core";
import type { AgentEvent } from "../types/agent";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

type QueryOptions = {
  onEvent: (event: AgentEvent) => void;
  // 把 agent 实例回传给调用方，用于中断当前运行
  onAgent?: (agent: HttpAgent) => void;
};

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function runAgUiQuery(query: string, options: QueryOptions) {
  // 后端不保存会话状态，每次查询创建独立 agent，threadId 由客户端生成
  const agent = new HttpAgent({ url: `${API_BASE_URL}/api/agui/query` });

  // 订阅标准事件并翻译成应用内部的统一事件
  const subscriber: AgentSubscriber = {
    onStepStartedEvent: ({ event }) =>
      options.onEvent({ type: "progress", step: event.stepName, status: "running" }),
    onStepFinishedEvent: ({ event }) =>
      options.onEvent({ type: "progress", step: event.stepName, status: "success" }),
    onCustomEvent: ({ event }) => {
      // 后端把查询结果表格放在 name="result" 的自定义事件里
      if (event.name === "result") {
        options.onEvent({ type: "result", data: event.value });
      }
    },
    onTextMessageContentEvent: ({ event }) =>
      options.onEvent({ type: "text", delta: event.delta }),
    onStateSnapshotEvent: ({ event }) =>
      options.onEvent({ type: "state", snapshot: event.snapshot }),
    onRunErrorEvent: ({ event }) =>
      options.onEvent({ type: "error", message: event.message }),
  };

  agent.subscribe(subscriber);
  options.onAgent?.(agent);

  // 先把用户问题挂到 agent 消息列表，再触发一次 run
  const userMessage: UserMessage = { id: makeId(), role: "user", content: query };
  agent.addMessage(userMessage);
  await agent.runAgent();
}
