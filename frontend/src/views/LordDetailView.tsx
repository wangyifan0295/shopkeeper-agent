/**
 * 棋手详情右侧抽屉组件
 * 展示单个棋手的总体表现（吃鸡率/前三率/平均名次基线对照 + 名次构成条）
 * 与「擅长选手排行」：点击任意选手名可直接穿透切换至选手详情抽屉，
 * 点击「查看对局」自动收起抽屉并带棋手筛选跳往对局记录。
 */
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Swords,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { WIN_RATE_BASELINE, WinRate } from "../components/WinRate";
import { fetchLordDetail } from "../lib/statsApi";
import { cn } from "../lib/format";
import type { LordDetail, SortOrder } from "../types/stats";

const TOP3_BASELINE = 50;
const AVG_PLACE_BASELINE = 3.5;

type LordPlayerSortBy = "matches" | "win_rate" | "top3_rate" | "avg_place";

const PLAYER_SORT_COLUMNS: Array<{
  key: LordPlayerSortBy;
  label: string;
  defaultOrder: SortOrder;
}> = [
  { key: "matches", label: "场次", defaultOrder: "desc" },
  { key: "win_rate", label: "吃鸡率", defaultOrder: "desc" },
  { key: "top3_rate", label: "前三率", defaultOrder: "desc" },
  { key: "avg_place", label: "平均名次", defaultOrder: "asc" },
];

type LordDetailDrawerProps = {
  lord: string;
  onClose: () => void;
  onSelectPlayer: (player: string) => void;
  onBrowseMatches: (lord: string) => void;
};

export function LordDetailDrawer({
  lord,
  onClose,
  onSelectPlayer,
  onBrowseMatches,
}: LordDetailDrawerProps) {
  const [detail, setDetail] = useState<LordDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortBy, setSortBy] = useState<LordPlayerSortBy>("matches");
  const [order, setOrder] = useState<SortOrder>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setError(null);
    setSortBy("matches");
    setOrder("desc");

    fetchLordDetail(lord)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lord, refreshKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const toggleSort = (column: LordPlayerSortBy, defaultOrder: SortOrder) => {
    if (sortBy === column) {
      setOrder((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(column);
      setOrder(defaultOrder);
    }
  };

  const sortedPlayers = useMemo(() => {
    if (!detail) return [];
    return [...detail.player_stats].sort((a, b) => {
      const diff = a[sortBy] - b[sortBy];
      if (diff !== 0) return order === "desc" ? -diff : diff;
      return b.matches - a.matches;
    });
  }, [detail, sortBy, order]);

  const winPct = detail ? Math.max(0, Math.min(100, detail.win_rate)) : 0;
  const top23Pct = detail ? Math.max(0, Math.min(100 - winPct, detail.top3_rate - winPct)) : 0;
  const bottomPct = Math.max(0, 100 - winPct - top23Pct);

  const winDelta = detail ? detail.win_rate - WIN_RATE_BASELINE : 0;
  const top3Delta = detail ? detail.top3_rate - TOP3_BASELINE : 0;
  const placeDelta = detail ? AVG_PLACE_BASELINE - detail.avg_place : 0;

  const activeSortLabel = PLAYER_SORT_COLUMNS.find((col) => col.key === sortBy)?.label ?? "场次";
  const sortDirectionLabel = order === "desc" ? "从高到低" : "从低到高";

  const renderSortHeader = (column: (typeof PLAYER_SORT_COLUMNS)[number]) => {
    const active = sortBy === column.key;
    return (
      <button
        type="button"
        onClick={() => toggleSort(column.key, column.defaultOrder)}
        className={cn(
          "inline-flex items-center gap-1 transition hover:text-ink-2",
          active ? "text-ink" : "text-muted",
        )}
        title={`按${column.label}排序`}
      >
        {column.label}
        {active ? (
          order === "desc" ? (
            <ArrowDown className="h-3 w-3 text-accent" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-3 w-3 text-accent" aria-hidden="true" />
          )
        ) : (
          <ArrowLeftRight className="h-3 w-3 opacity-50" aria-hidden="true" />
        )}
      </button>
    );
  };

  return (
    <div
      className="drawer-backdrop fixed inset-0 z-[400] flex justify-end bg-black/45 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${lord} 的棋手详情`}
        onClick={(event) => event.stopPropagation()}
        className="drawer-panel flex h-dvh w-full max-w-[620px] flex-col border-l border-rule bg-paper text-ink shadow-card"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-rule bg-sidebar px-5">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg text-ink">{lord}</h2>
            {detail && (
              <p className="num truncate text-xs text-muted">
                棋手档案 · 共 {detail.matches} 场 · {detail.wins} 鸡 · {detail.player_stats.length} 位选手选用
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onBrowseMatches(lord)}
              className="btn btn-quiet h-8 min-h-0 px-3 text-xs"
              title={`查看 ${lord} 出场的对局`}
            >
              <Swords className="h-3.5 w-3.5" aria-hidden="true" />
              查看对局
            </button>
            <button
              type="button"
              onClick={onClose}
              className="icon-btn"
              title="关闭（Esc）"
              aria-label="关闭棋手详情"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6">
          {error ? (
            <ErrorBanner
              message={error.includes("404") ? "未找到该棋手，可能数据已更新。" : error}
              onRetry={() => setRefreshKey((key) => key + 1)}
            />
          ) : loading || detail === null ? (
            <div className="space-y-6" aria-label="加载中">
              <div className="well space-y-5 p-5">
                <div className="grid grid-cols-3 gap-4">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="space-y-2.5">
                      <span className="skeleton block h-3 w-12" />
                      <span className="skeleton block h-8 w-20" />
                      <span className="skeleton block h-3 w-16" />
                    </div>
                  ))}
                </div>
                <span className="skeleton block h-2.5 w-full rounded-pill" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="flex items-center justify-between gap-4">
                    <span className="skeleton h-4 w-28" />
                    <span className="skeleton h-4 w-12" />
                    <span className="skeleton h-4 w-14" />
                    <span className="skeleton h-4 w-14" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-7">
              {/* 棋手概览井 */}
              <section className="well space-y-5 p-5">
                <dl className="grid grid-cols-3 gap-4">
                  <div>
                    <dt className="label">吃鸡率</dt>
                    <dd
                      className={cn(
                        "figure mt-1.5 text-2xl sm:text-3xl",
                        detail.win_rate >= 25 ? "text-accent" : "text-ink",
                      )}
                    >
                      {detail.win_rate.toFixed(2)}%
                    </dd>
                    <p
                      className={cn(
                        "num mt-1 text-xs",
                        winDelta >= 0 ? "text-success" : "text-muted",
                      )}
                    >
                      {winDelta >= 0
                        ? `高于基线 +${winDelta.toFixed(1)}%`
                        : `低于基线 ${winDelta.toFixed(1)}%`}
                    </p>
                  </div>

                  <div className="border-l border-rule pl-4">
                    <dt className="label">前三率</dt>
                    <dd className="figure mt-1.5 text-2xl text-ink sm:text-3xl">
                      {detail.top3_rate.toFixed(2)}%
                    </dd>
                    <p
                      className={cn(
                        "num mt-1 text-xs",
                        top3Delta >= 0 ? "text-success" : "text-muted",
                      )}
                    >
                      {top3Delta >= 0
                        ? `高于均线 +${top3Delta.toFixed(1)}%`
                        : `低于均线 ${top3Delta.toFixed(1)}%`}
                    </p>
                  </div>

                  <div className="border-l border-rule pl-4">
                    <dt className="label">平均名次</dt>
                    <dd className="figure mt-1.5 text-2xl text-ink sm:text-3xl">
                      {detail.matches > 0 ? detail.avg_place.toFixed(2) : "—"}
                    </dd>
                    <p
                      className={cn(
                        "num mt-1 text-xs",
                        detail.matches > 0 && placeDelta >= 0 ? "text-success" : "text-muted",
                      )}
                    >
                      {detail.matches === 0
                        ? "暂无出场"
                        : placeDelta >= 0
                          ? `优于均线 ${placeDelta.toFixed(2)}`
                          : `弱于均线 ${Math.abs(placeDelta).toFixed(2)}`}
                    </p>
                  </div>
                </dl>

                {detail.matches > 0 && (
                  <div className="space-y-2 border-t border-rule pt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink-2">名次构成</span>
                      <span className="num text-muted">
                        {detail.matches} 场 · {detail.wins} 次吃鸡
                      </span>
                    </div>
                    <div
                      className="flex h-2 w-full overflow-hidden rounded-pill bg-paper-3"
                      aria-label={`吃鸡 ${winPct.toFixed(1)}%，2至3名 ${top23Pct.toFixed(1)}%，4至6名 ${bottomPct.toFixed(1)}%`}
                    >
                      {winPct > 0 && (
                        <div
                          className="h-full bg-accent transition-all"
                          style={{ width: `${winPct}%` }}
                          title={`第 1 名吃鸡：${winPct.toFixed(1)}%`}
                        />
                      )}
                      {top23Pct > 0 && (
                        <div
                          className="h-full bg-success transition-all"
                          style={{ width: `${top23Pct}%` }}
                          title={`2–3 名吃分：${top23Pct.toFixed(1)}%`}
                        />
                      )}
                      {bottomPct > 0 && (
                        <div
                          className="h-full bg-paper-3 transition-all"
                          style={{ width: `${bottomPct}%` }}
                          title={`4–6 名：${bottomPct.toFixed(1)}%`}
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-pill bg-accent" aria-hidden="true" />
                        吃鸡 <span className="num text-ink-2">{winPct.toFixed(1)}%</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-pill bg-success" aria-hidden="true" />
                        2–3 名 <span className="num text-ink-2">{top23Pct.toFixed(1)}%</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-pill border border-rule bg-paper-3" aria-hidden="true" />
                        4–6 名 <span className="num text-ink-2">{bottomPct.toFixed(1)}%</span>
                      </span>
                    </div>
                  </div>
                )}
              </section>

              {/* 擅长选手排行 */}
              <section>
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-base text-ink">选手使用表现</h3>
                  <p className="label num text-xs">
                    {detail.player_stats.length} 位选手 · 按{activeSortLabel}
                    {sortDirectionLabel}
                  </p>
                </div>

                {sortedPlayers.length === 0 ? (
                  <p className="well px-4 py-8 text-center text-sm text-muted">
                    暂无选手使用过该棋手的记录
                  </p>
                ) : (
                  <div className="well overflow-x-auto px-2 py-1">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">选手</th>
                          <th scope="col" className="cell-num">
                            {renderSortHeader(PLAYER_SORT_COLUMNS[0])}
                          </th>
                          <th scope="col" className="cell-num">吃鸡</th>
                          <th scope="col" className="cell-num">
                            {renderSortHeader(PLAYER_SORT_COLUMNS[1])}
                          </th>
                          <th scope="col" className="cell-num">
                            {renderSortHeader(PLAYER_SORT_COLUMNS[2])}
                          </th>
                          <th scope="col" className="cell-num">
                            {renderSortHeader(PLAYER_SORT_COLUMNS[3])}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPlayers.map((row) => (
                          <tr key={row.player} className="transition hover:bg-paper-3">
                            <td className="whitespace-nowrap font-medium text-ink">
                              <button
                                type="button"
                                onClick={() => onSelectPlayer(row.player)}
                                className="underline-offset-4 transition hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                                title={`切换到 ${row.player} 的详情`}
                              >
                                {row.player}
                              </button>
                            </td>
                            <td className="cell-num text-ink">{row.matches}</td>
                            <td className="cell-num text-ink">{row.wins}</td>
                            <td className="cell-num">
                              <WinRate value={row.win_rate} />
                            </td>
                            <td className="cell-num text-ink-2">{row.top3_rate.toFixed(2)}%</td>
                            <td className="cell-num text-ink-2">{row.avg_place.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="label text-xs leading-5">
                点击任意选手名可直接切换查看该选手档案；点右上角「查看对局」筛选该棋手全部场次。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
