/**
 * 前端应用主组件
 * 多功能工作台外壳：左侧导航 + 主区 5 个常驻视图（对话 / 数据大盘 / 选手榜 / 棋手榜 / 对局记录）
 * + 互斥右侧抽屉（选手详情 / 棋手详情，支持互相穿透且不卸载背后列表状态）。
 * 使用轻量 URL Hash 同步视图、筛选与抽屉参数，支持刷新保持与浏览器前进/后退。
 */
import { BarChart3, Crown, MessagesSquare, Swords, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { ChatView } from "./views/ChatView";
import { DashboardView } from "./views/DashboardView";
import { LordDetailDrawer } from "./views/LordDetailView";
import { LordsView } from "./views/LordsView";
import { MatchesView } from "./views/MatchesView";
import { PlayerDetailDrawer } from "./views/PlayerDetailView";
import { PlayersView } from "./views/PlayersView";
import { useChatSession } from "./hooks/useChatSession";
import { useTheme } from "./hooks/useTheme";
import { cn } from "./lib/format";
import { fetchOverview } from "./lib/statsApi";
import type { StatsOverview } from "./types/stats";
import type { NavView } from "./types/view";

// 窄屏导航条：与桌面端侧栏保持一致的 5 个核心视图入口
const NAV_ITEMS: Array<{ view: NavView; label: string; icon: typeof Users }> = [
  { view: "chat", label: "对话", icon: MessagesSquare },
  { view: "dashboard", label: "大盘", icon: BarChart3 },
  { view: "players", label: "选手榜", icon: Users },
  { view: "lords", label: "棋手榜", icon: Crown },
  { view: "matches", label: "对局", icon: Swords },
];

type DrawerTarget =
  | { kind: "player"; name: string }
  | { kind: "lord"; name: string };

type RouteState = {
  view: NavView;
  drawer: DrawerTarget | null;
  matchesPresetPlayer: string | null;
  matchesPresetLord: string | null;
  matchesPresetFaction: string | null;
};

function parseHash(rawHash: string): RouteState {
  const cleaned = rawHash.replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = cleaned.split("?");
  const params = new URLSearchParams(queryPart);
  const detailPlayer = params.get("detail")?.trim() || null;
  const detailLord = params.get("lordDetail")?.trim() || null;
  const drawer: DrawerTarget | null = detailPlayer
    ? { kind: "player", name: detailPlayer }
    : detailLord
      ? { kind: "lord", name: detailLord }
      : null;

  if (pathPart === "dashboard") {
    return {
      view: "dashboard",
      drawer,
      matchesPresetPlayer: null,
      matchesPresetLord: null,
      matchesPresetFaction: null,
    };
  }
  if (pathPart === "players") {
    return {
      view: "players",
      drawer,
      matchesPresetPlayer: null,
      matchesPresetLord: null,
      matchesPresetFaction: null,
    };
  }
  if (pathPart === "lords") {
    return {
      view: "lords",
      drawer,
      matchesPresetPlayer: null,
      matchesPresetLord: null,
      matchesPresetFaction: null,
    };
  }
  if (pathPart === "matches") {
    return {
      view: "matches",
      drawer,
      matchesPresetPlayer: params.get("player")?.trim() || null,
      matchesPresetLord: params.get("lord")?.trim() || null,
      matchesPresetFaction: params.get("faction")?.trim() || null,
    };
  }
  // 兼容旧的 #player/<name> 链接：留在选手榜并自动打开右侧详情抽屉
  if (pathPart.startsWith("player/")) {
    const encoded = pathPart.slice("player/".length);
    try {
      const player = decodeURIComponent(encoded).trim();
      if (player) {
        return {
          view: "players",
          drawer: { kind: "player", name: player },
          matchesPresetPlayer: null,
          matchesPresetLord: null,
          matchesPresetFaction: null,
        };
      }
    } catch {
      // 非法编码回退到选手榜
    }
    return {
      view: "players",
      drawer: null,
      matchesPresetPlayer: null,
      matchesPresetLord: null,
      matchesPresetFaction: null,
    };
  }
  return {
    view: "chat",
    drawer,
    matchesPresetPlayer: null,
    matchesPresetLord: null,
    matchesPresetFaction: null,
  };
}

function buildHash(state: RouteState): string {
  const params = new URLSearchParams();
  if (state.view === "matches") {
    if (state.matchesPresetPlayer) params.set("player", state.matchesPresetPlayer);
    if (state.matchesPresetLord) params.set("lord", state.matchesPresetLord);
    if (state.matchesPresetFaction) params.set("faction", state.matchesPresetFaction);
  }
  if (state.drawer?.kind === "player") {
    params.set("detail", state.drawer.name);
  } else if (state.drawer?.kind === "lord") {
    params.set("lordDetail", state.drawer.name);
  }
  const query = params.toString();
  return query ? `#${state.view}?${query}` : `#${state.view}`;
}

export default function App() {
  const initialRoute = parseHash(window.location.hash);
  const [view, setView] = useState<NavView>(initialRoute.view);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(initialRoute.drawer);
  const [matchesPresetPlayer, setMatchesPresetPlayer] = useState<string | null>(
    initialRoute.matchesPresetPlayer,
  );
  const [matchesPresetLord, setMatchesPresetLord] = useState<string | null>(
    initialRoute.matchesPresetLord,
  );
  const [matchesPresetFaction, setMatchesPresetFaction] = useState<string | null>(
    initialRoute.matchesPresetFaction,
  );
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const chat = useChatSession();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    fetchOverview()
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch(() => {
        // 概况区属于辅助信息，接口不可达时静默保持空态
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyRoute = useCallback((next: RouteState, pushHash = true) => {
    setView(next.view);
    setDrawer(next.drawer);
    setMatchesPresetPlayer(next.matchesPresetPlayer);
    setMatchesPresetLord(next.matchesPresetLord);
    setMatchesPresetFaction(next.matchesPresetFaction);
    if (pushHash) {
      const targetHash = buildHash(next);
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHash(window.location.hash);
      applyRoute(next, false);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [applyRoute]);

  const navigate = (next: NavView) => {
    applyRoute({
      view: next,
      drawer: null,
      matchesPresetPlayer: null,
      matchesPresetLord: null,
      matchesPresetFaction: null,
    });
  };

  const openPlayerDetail = (player: string) => {
    applyRoute({
      view,
      drawer: { kind: "player", name: player },
      matchesPresetPlayer,
      matchesPresetLord,
      matchesPresetFaction,
    });
  };

  const openLordDetail = (lord: string) => {
    applyRoute({
      view,
      drawer: { kind: "lord", name: lord },
      matchesPresetPlayer,
      matchesPresetLord,
      matchesPresetFaction,
    });
  };

  const closeDrawer = () => {
    applyRoute({
      view,
      drawer: null,
      matchesPresetPlayer,
      matchesPresetLord,
      matchesPresetFaction,
    });
  };

  const openMatchesForPlayer = (player: string) => {
    applyRoute({
      view: "matches",
      drawer: null,
      matchesPresetPlayer: player,
      matchesPresetLord: null,
      matchesPresetFaction: null,
    });
  };

  const openMatchesForLord = (lord: string) => {
    applyRoute({
      view: "matches",
      drawer: null,
      matchesPresetPlayer: null,
      matchesPresetLord: lord,
      matchesPresetFaction: null,
    });
  };

  const openMatchesForFaction = (faction: string) => {
    applyRoute({
      view: "matches",
      drawer: null,
      matchesPresetPlayer: null,
      matchesPresetLord: null,
      matchesPresetFaction: faction,
    });
  };

  const desktopThemeSwitcher = (
    <ThemeSwitcher theme={theme} onChange={setTheme} className="hidden lg:block" />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* 窄屏顶部导航（lg 以下），5 个视图入口 + 右上角主题下拉 */}
      <nav
        aria-label="窄屏视图导航"
        className="flex shrink-0 items-center gap-1 border-b border-rule px-2 py-2 lg:hidden"
      >
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = view === item.view;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => navigate(item.view)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-sm font-medium transition",
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
        </div>
        <div className="ml-auto shrink-0 pl-2">
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </nav>

      <Sidebar view={view} onNavigate={navigate} chat={chat} overview={overview} />

      <div className="theme-atmosphere flex min-h-0 min-w-0 flex-col">
        {view === "chat" && <ChatView chat={chat} headerExtra={desktopThemeSwitcher} />}
        {view === "dashboard" && (
          <DashboardView
            onSelectPlayer={openPlayerDetail}
            onSelectLord={openLordDetail}
            onBrowseFactionMatches={openMatchesForFaction}
            headerExtra={desktopThemeSwitcher}
          />
        )}
        {view === "players" && (
          <PlayersView onSelectPlayer={openPlayerDetail} headerExtra={desktopThemeSwitcher} />
        )}
        {view === "lords" && (
          <LordsView onSelectLord={openLordDetail} headerExtra={desktopThemeSwitcher} />
        )}
        {view === "matches" && (
          <MatchesView
            presetSearch={matchesPresetPlayer ?? undefined}
            presetLord={matchesPresetLord ?? undefined}
            presetFaction={matchesPresetFaction ?? undefined}
            onSelectPlayer={openPlayerDetail}
            onSelectLord={openLordDetail}
            headerExtra={desktopThemeSwitcher}
          />
        )}
      </div>

      {drawer?.kind === "player" && (
        <PlayerDetailDrawer
          player={drawer.name}
          onClose={closeDrawer}
          onSelectLord={openLordDetail}
          onBrowseMatches={openMatchesForPlayer}
        />
      )}

      {drawer?.kind === "lord" && (
        <LordDetailDrawer
          lord={drawer.name}
          onClose={closeDrawer}
          onSelectPlayer={openPlayerDetail}
          onBrowseMatches={openMatchesForLord}
        />
      )}
    </div>
  );
}
