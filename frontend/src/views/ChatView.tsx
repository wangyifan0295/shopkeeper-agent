/**
 * 对话问数视图
 * 原聊天主区：页头 + 消息流 + 输入区；会话状态由 useChatSession 提供。
 * 用户消息用吸烟井，助手消息直接落在地面上，由表格与流程条自己撑结构
 */
import { Eraser } from "lucide-react";
import { useEffect, useRef } from "react";
import { Composer } from "../components/Composer";
import { EmptyState } from "../components/EmptyState";
import { MessageBubble } from "../components/MessageBubble";
import { examples } from "../lib/examples";
import type { ChatSession } from "../hooks/useChatSession";

export function ChatView({ chat }: { chat: ChatSession }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat.messages]);

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">智能数据分析 Agent</p>
          <p className="label truncate">AG-UI 协议 / LangGraph</p>
        </div>
        <button
          type="button"
          onClick={chat.clearConversation}
          disabled={chat.messages.length === 0 || chat.isStreaming}
          className="icon-btn"
          title="清空"
          aria-label="清空"
        >
          <Eraser className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {chat.messages.length === 0 ? (
          <EmptyState
            examples={examples}
            onUseExample={(example) => chat.startQuery(example)}
            disabled={chat.isStreaming}
          />
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 lg:px-8">
            {chat.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      <Composer
        value={chat.draft}
        disabled={!chat.canSubmit}
        isStreaming={chat.isStreaming}
        onChange={chat.setDraft}
        onSubmit={() => chat.startQuery()}
        onStop={chat.stopQuery}
      />
    </main>
  );
}
