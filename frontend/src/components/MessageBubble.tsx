/**
 * 聊天消息气泡组件
 * 组合展示用户问题、智能体回复、执行流程和结果表格。
 * 用户消息是吸烟井靠右；助手消息落在地面上，让表格与流程条自己撑结构
 */
import { Copy } from "lucide-react";
import { ResultTable } from "./ResultTable";
import { StepRail } from "./StepRail";
import { cn, formatTime, toClipboardText } from "../lib/format";
import type { ChatMessage } from "../types/agent";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  const copy = async () => {
    const text = message.result ? toClipboardText(message.result) : message.content;
    await navigator.clipboard.writeText(text);
  };

  return (
    <article className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "group relative",
          isUser ? "well max-w-[760px] px-5 py-4" : "w-full",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
          {!isUser && message.status !== "streaming" && (
            <button
              type="button"
              onClick={copy}
              className="icon-btn opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
              title="复制"
              aria-label="复制"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {message.error && (
          <div className="mt-3 border-l-2 border-error pl-3 text-sm text-error">
            {message.error}
          </div>
        )}

        {!isUser && <StepRail steps={message.steps} />}
        {!isUser && message.result !== undefined && <ResultTable data={message.result} />}

        {!isUser && message.stateSnapshot !== undefined && (
          <details className="mt-4 border-t border-rule pt-3">
            <summary className="label cursor-pointer select-none">AG-UI 状态快照（STATE_SNAPSHOT）</summary>
            <pre className="mt-2 max-h-64 overflow-auto font-mono text-xs leading-5 text-muted">
              {JSON.stringify(message.stateSnapshot, null, 2)}
            </pre>
          </details>
        )}
      </div>

      <time className="mt-1.5 px-1 text-xs text-muted">{formatTime(message.createdAt)}</time>
    </article>
  );
}
