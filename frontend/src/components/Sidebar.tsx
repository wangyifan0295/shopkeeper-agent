/**
 * 侧栏导航组件
 * 工作台外壳：衬线字标 + 视图导航（对话 / 选手榜 / 棋手榜 / 对局记录）
 * + 对话专属新会话按钮 + 底部极简数仓概况区。
 */
import {
  Crown,
  MessagesSquare,
  Swords,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/format";
import type { ChatSession } from "../hooks/useChatSession";
import type { StatsOverview } from "../types/stats";
import type { AppView, NavView } from "../types/view";

const NAV_ITEMS: Array<{ view: NavView; label: string; icon: LucideIcon }> = [
  { view: "chat", label: "对话", icon: MessagesSquare },
  { view: "players", label: "选手榜", icon: Users },
  { view: "lords", label: "棋手榜", icon: Crown },
  { view: "matches", label: "对局记录", icon: Swords },
];

type SidebarProps = {
  view: AppView;
  onNavigate: (view: NavView) => void;
  chat: ChatSession;
  overview: StatsOverview | null;
};

export function Sidebar({ view, onNavigate, chat, overview }: SidebarProps) {
  const isActive = (item: NavView) => view === item;

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
          <section className="px-1">
            <button
              type="button"
              onClick={chat.clearConversation}
              disabled={chat.isStreaming}
              className="btn btn-primary w-full"
            >
              新会话
            </button>
          </section>
        )}
      </div>

      {overview && (
        <div className="border-t border-rule px-5 py-4">
          <p className="label mb-2.5 text-xs">数仓概况</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            <div>
              <dt className="text-muted">收录对局</dt>
              <dd className="figure mt-0.5 text-sm text-ink">{overview.matches} 场</dd>
            </div>
            <div>
              <dt className="text-muted">参赛选手</dt>
              <dd className="figure mt-0.5 text-sm text-ink">{overview.players} 位</dd>
            </div>
            <div>
              <dt className="text-muted">可用棋手</dt>
              <dd className="figure mt-0.5 text-sm text-ink">{overview.lords} 位</dd>
            </div>
            <div>
              <dt className="text-muted">最近更新</dt>
              <dd className="num mt-0.5 truncate text-sm text-ink-2">
                {overview.latest_date ?? "—"}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </aside>
  );
}
