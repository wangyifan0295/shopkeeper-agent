/**
 * 对话问数视图
 * 页头 + 智能跟滚消息流 + 自适应输入区；会话状态由 useChatSession 提供。
 * 用户贴近底部时自动跟滚，向上翻阅历史时不抢滚动条，并提供“回到底部”快捷入口。
 */
import { ArrowDown, Eraser } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Composer } from "../components/Composer";
import { EmptyState } from "../components/EmptyState";
import { MessageBubble } from "../components/MessageBubble";
import { examples } from "../lib/examples";
import type { ChatSession } from "../hooks/useChatSession";

const BOTTOM_THRESHOLD = 80;

type ChatViewProps = {
  chat: ChatSession;
  headerExtra?: ReactNode;
};

export function ChatView({ chat, headerExtra }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance <= BOTTOM_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    setShowScrollBottom(!nearBottom && chat.messages.length > 0);
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    isNearBottomRef.current = true;
    setShowScrollBottom(false);
  };

  useEffect(() => {
    if (chat.messages.length === 0) {
      isNearBottomRef.current = true;
      setShowScrollBottom(false);
      return;
    }
    if (isNearBottomRef.current) {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: chat.isStreaming ? "auto" : "smooth",
      });
    }
  }, [chat.messages, chat.isStreaming]);

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">智能数据分析 Agent</p>
          <p className="label truncate">AG-UI 协议 / LangGraph</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
          {headerExtra}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto overscroll-contain"
        >
          {chat.messages.length === 0 ? (
            <EmptyState
              examples={examples}
              onUseExample={(example) => {
                isNearBottomRef.current = true;
                chat.startQuery(example);
              }}
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

        {showScrollBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="btn btn-quiet absolute bottom-4 right-5 bg-paper-2 shadow-card"
            aria-label="回到底部"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            回到底部
          </button>
        )}
      </div>

      <Composer
        value={chat.draft}
        disabled={!chat.canSubmit}
        isStreaming={chat.isStreaming}
        onChange={chat.setDraft}
        onSubmit={() => {
          isNearBottomRef.current = true;
          chat.startQuery();
        }}
        onStop={chat.stopQuery}
      />
    </main>
  );
}
