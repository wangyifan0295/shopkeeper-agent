/**
 * 聊天会话状态 Hook
 * 从 App 组件下沉的问数会话逻辑：消息列表、SSE 事件消费、流式中断控制。
 * 放在 App 层调用，切换到数据页面再切回来时对话不丢失。
 */
import { useRef, useState } from "react";
import type { HttpAgent } from "@ag-ui/client";
import { runAgUiQuery } from "../lib/agUiApi";
import type { AgentEvent, ChatMessage, StepState } from "../types/agent";

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function upsertStep(steps: StepState[] = [], event: Extract<AgentEvent, { type: "progress" }>) {
  const next = steps.filter((item) => item.step !== event.step);
  next.push({
    step: event.step,
    status: event.status,
    updatedAt: Date.now(),
  });
  return next;
}

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // 持有当前 HttpAgent 实例，停止按钮通过它中断请求
  const activeAgentRef = useRef<HttpAgent | null>(null);

  const canSubmit = draft.trim().length > 0 && !isStreaming;

  const startQuery = async (rawQuery = draft) => {
    const query = rawQuery.trim();
    if (!query || isStreaming) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: query,
      createdAt: Date.now(),
    };

    const assistantId = makeId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "正在连接问数智能体...",
      createdAt: Date.now(),
      status: "streaming",
      steps: [],
    };

    setIsStreaming(true);
    setDraft("");
    setMessages((current) => [...current, userMessage, assistantMessage]);

    // 追踪本次回复是否已开始接收正文流，避免多段 text 分片在 result 到达后互相覆盖
    let hasReceivedText = false;

    const onEvent = (event: AgentEvent) => {
      const isFirstTextChunk = event.type === "text" && !hasReceivedText;
      if (event.type === "text") {
        hasReceivedText = true;
      }

      setMessages((current) =>
        current.map((message) => {
          if (message.id !== assistantId) return message;

          if (event.type === "progress") {
            return {
              ...message,
              content:
                !hasReceivedText && event.status === "running"
                  ? `正在执行：${event.step}`
                  : message.content,
              steps: upsertStep(message.steps, event),
            };
          }

          if (event.type === "result") {
            return {
              ...message,
              status: "done",
              // 结果摘要由随后的标准文本消息事件负责，这里保留当前文案
              content: message.content,
              result: event.data,
            };
          }

          if (event.type === "text") {
            // 首段正文替换占位提示，后续分片持续追加
            const base = isFirstTextChunk ? "" : message.content;
            return { ...message, content: base + event.delta };
          }

          if (event.type === "state") {
            // STATE_SNAPSHOT 持续覆盖，气泡底部可展开查看最新状态
            return { ...message, stateSnapshot: event.snapshot };
          }

          return {
            ...message,
            status: "error",
            content: "这次查询没有成功。",
            error: event.message,
          };
        }),
      );
    };

    try {
      await runAgUiQuery(query, {
        onEvent,
        onAgent: (agent) => {
          activeAgentRef.current = agent;
        },
      });
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId && message.status === "streaming"
            ? { ...message, status: "done", content: "流程已结束，后端未返回查询结果。" }
            : message,
        ),
      );
    } catch (error) {
      const isAbort =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError");
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                status: isAbort ? "done" : "error",
                content: isAbort ? "已停止本次查询。" : "无法连接问数接口。",
                error: isAbort ? undefined : error instanceof Error ? error.message : String(error),
              }
            : message,
        ),
      );
    } finally {
      activeAgentRef.current = null;
      setIsStreaming(false);
    }
  };

  const stopQuery = () => {
    // 通过 HttpAgent 自带的 abortRun 中断当前请求
    activeAgentRef.current?.abortRun();
  };

  const clearConversation = () => {
    if (isStreaming) return;
    setMessages([]);
    setDraft("");
  };

  return {
    messages,
    draft,
    setDraft,
    isStreaming,
    canSubmit,
    startQuery,
    stopQuery,
    clearConversation,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
