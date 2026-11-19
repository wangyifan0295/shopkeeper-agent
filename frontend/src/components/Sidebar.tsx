/**
 * 侧栏导航组件
 * 工作台自己的外壳：衬线字标 + 视图导航（对话 / 选手榜 / 棋手榜）
 * + 对话专属面板（新会话、样例）。选中态 = 余烬色 3px 左侧填充条 + 吸烟井底
 */
import {
  Crown,
  MessagesSquare,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/format";
import { examples } from "../lib/examples";
import type { ChatSession } from "../hooks/useChatSession";
import type { AppView, NavView } from "../types/view";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "Vite /api proxy";

const NAV_ITEMS: Array<{ view: NavView; label: string; icon: LucideIcon }> = [
  { view: "chat", label: "对话", icon: MessagesSquare },
  { view: "players", label: "选手榜", icon: Users },
  { view: "lords", label: "棋手榜", icon: Crown },
];

type SidebarProps = {
  view: AppView;
  onNavigate: (view: NavView) => void;
  chat: ChatSession;
};

export function Sidebar({ view, onNavigate, chat }: SidebarProps) {
  // 选手详情属于选手榜分支，停留在选手榜导航项上高亮
  const isActive = (item: NavView) =>
    view === item || (view === "player-detail" && item === "players");

  return (
    <aside className="hidden min-h-0 flex-col border-r border-rule lg:flex">
      <div className="px-5 pb-5 pt-6">
        <h1 className="font-display text-lg text-ink">万象棋数据工作台</h1>
        <p className="label mt-1 font-mono">shopkeeper-agent</p>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-2">
        <nav aria-label="视图导航" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.view);
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => onNavigate(item.view)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-10 w-full items-center gap-3 rounded-well px-3 text-sm font-medium transition",
                  active
                    ? "bg-paper-2 text-ink"
                    : "text-muted hover:bg-paper-2 hover:text-ink-2",
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-2 left-0 top-2 w-[3px] rounded-pill bg-accent"
                  />
                )}
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {view === "chat" && (
          <section className="space-y-3 px-1">
            <button
              type="button"
              onClick={chat.clearConversation}
              disabled={chat.isStreaming}
              className="btn btn-primary w-full"
            >
              新会话
            </button>

            <div>
              <p className="label px-3 pb-2">试试这些</p>
              <div className="space-y-1.5">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={chat.isStreaming}
                    onClick={() => chat.startQuery(example)}
                    className="w-full rounded-well px-3 py-2.5 text-left text-sm leading-6 text-ink-2 transition hover:bg-paper-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="space-y-1.5 border-t border-rule px-5 py-4 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="label">API</span>
          <span className="truncate font-mono text-muted">{API_BASE_URL}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="label">完成</span>
          <span className="num text-muted">{chat.completedCount}</span>
        </div>
      </div>
    </aside>
  );
}
