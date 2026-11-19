/**
 * 前端应用主组件
 * 多功能工作台外壳：左侧导航 + 主区视图切换（对话 / 选手榜 / 选手详情 / 棋手榜）。
 * 不引入路由库，视图用内部状态管理；聊天会话状态放在 App 层，切页不丢
 */
import { Crown, MessagesSquare, Users } from "lucide-react";
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./views/ChatView";
import { LordsView } from "./views/LordsView";
import { PlayerDetailView } from "./views/PlayerDetailView";
import { PlayersView } from "./views/PlayersView";
import { useChatSession } from "./hooks/useChatSession";
import { cn } from "./lib/format";
import type { AppView, NavView } from "./types/view";

// 窄屏导航条：侧栏在 lg 以下隐藏，这三个入口保证视图始终可达
const NAV_ITEMS: Array<{ view: NavView; label: string; icon: typeof Users }> = [
  { view: "chat", label: "对话", icon: MessagesSquare },
  { view: "players", label: "选手榜", icon: Users },
  { view: "lords", label: "棋手榜", icon: Crown },
];

export default function App() {
  const [view, setView] = useState<AppView>("chat");
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const chat = useChatSession();

  const navigate = (next: NavView) => {
    // 导航只会去三个主视图，选中态随之清空，选手详情必须重新从选手榜点入
    setSelectedPlayer(null);
    setView(next);
  };

  const openPlayerDetail = (player: string) => {
    setSelectedPlayer(player);
    setView("player-detail");
  };

  const activeNav: NavView = view === "player-detail" ? "players" : view;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* 窄屏顶部导航（lg 以下），侧栏隐藏时的视图入口 */}
      <nav
        aria-label="窄屏视图导航"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-rule px-2 py-2 lg:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => navigate(item.view)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 shrink-0 items-center gap-2 rounded-pill px-3 text-sm font-medium transition",
                active ? "bg-paper-2 text-ink" : "text-muted hover:bg-paper-2 hover:text-ink-2",
              )}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 left-2 right-2 h-[2px] rounded-pill bg-accent"
                />
              )}
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <Sidebar view={view} onNavigate={navigate} chat={chat} />

      <div className="flex min-h-0 min-w-0 flex-col">
        {view === "chat" && <ChatView chat={chat} />}
        {view === "players" && <PlayersView onSelectPlayer={openPlayerDetail} />}
        {view === "player-detail" &&
          (selectedPlayer ? (
            <PlayerDetailView player={selectedPlayer} onBack={() => navigate("players")} />
          ) : (
            <PlayersView onSelectPlayer={openPlayerDetail} />
          ))}
        {view === "lords" && <LordsView />}
      </div>
    </div>
  );
}
