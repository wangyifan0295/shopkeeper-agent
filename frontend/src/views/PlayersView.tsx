/**
 * 选手榜视图
 * 服务端分页 + 筛选（姓名搜索含一键清除 / 场次下限）+ 可点击列头排序。
 * 页头副标题随当前排序维度与方向实时联动。
 */
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { SearchInput } from "../components/SearchInput";
import { WinRate } from "../components/WinRate";
import { fetchPlayersPage } from "../lib/statsApi";
import { cn } from "../lib/format";
import type { PlayersPage, PlayerSortBy, SortOrder } from "../types/stats";

const PAGE_SIZE = 20;
const SKELETON_ROWS = 8;

const MIN_MATCHES_OPTIONS = [
  { value: 0, label: "全部场次" },
  { value: 5, label: "≥ 5 场" },
  { value: 10, label: "≥ 10 场" },
  { value: 20, label: "≥ 20 场" },
];

/** 可排序列：平均名次越低越好，首次点击默认升序，其余默认降序 */
const SORTABLE_COLUMNS: Array<{ key: PlayerSortBy; label: string; defaultOrder: SortOrder }> = [
  { key: "matches", label: "场次", defaultOrder: "desc" },
  { key: "win_rate", label: "吃鸡率", defaultOrder: "desc" },
  { key: "recent_win_rate", label: "近8场吃鸡率", defaultOrder: "desc" },
  { key: "top3_rate", label: "前三率", defaultOrder: "desc" },
  { key: "avg_place", label: "平均名次", defaultOrder: "asc" },
];

type PlayersViewProps = {
  onSelectPlayer: (player: string) => void;
  headerExtra?: ReactNode;
};

export function PlayersView({ onSelectPlayer, headerExtra }: PlayersViewProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [minMatches, setMinMatches] = useState(0);
  const [sortBy, setSortBy] = useState<PlayerSortBy>("matches");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PlayersPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 重试按钮用的刷新开关，并进请求依赖里
  const [refreshKey, setRefreshKey] = useState(0);

  // 搜索防抖：停止输入 300ms 后才触发请求
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // 筛选或排序变化时回到第 1 页，避免停留在越界页码
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, minMatches, sortBy, order]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPlayersPage({
      search: debouncedSearch,
      minMatches,
      sortBy,
      order,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
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
  }, [debouncedSearch, minMatches, sortBy, order, page, refreshKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const hasFilter = debouncedSearch !== "" || minMatches > 0;
  const activeSortLabel = SORTABLE_COLUMNS.find((col) => col.key === sortBy)?.label ?? "场次";
  const sortDirectionLabel = order === "desc" ? "从高到低" : "从低到高";

  const toggleSort = (column: PlayerSortBy, defaultOrder: SortOrder) => {
    if (sortBy === column) {
      setOrder((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(column);
      setOrder(defaultOrder);
    }
  };

  const renderSortHeader = (column: (typeof SORTABLE_COLUMNS)[number]) => {
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
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg">选手榜</h1>
          <p className="label hidden sm:block">
            按{activeSortLabel}
            {sortDirectionLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="label num">
            共 <span className="figure text-base text-ink-2">{data?.total ?? "—"}</span> 位
          </p>
          {headerExtra}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          {/* 筛选条：姓名搜索 + 场次下限 */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="搜索选手名…"
              ariaLabel="搜索选手名"
            />
            <div className="flex items-center gap-2">
              <label htmlFor="min-matches" className="label shrink-0">
                场次下限
              </label>
              <div className="relative">
                <select
                  id="min-matches"
                  value={minMatches}
                  onChange={(event) => setMinMatches(Number(event.target.value))}
                  className="input appearance-none pr-8"
                >
                  {MIN_MATCHES_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          {error ? (
            <ErrorBanner
              message={error}
              onRetry={() => setRefreshKey((key) => key + 1)}
            />
          ) : data === null ? (
            // 初次加载：给出表格形状的骨架行
            <div className="space-y-4" aria-label="加载中">
              {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-6">
                  <span className="skeleton h-4 w-28" />
                  <span className="skeleton h-4 w-10" />
                  <span className="skeleton h-4 w-10" />
                  <span className="skeleton h-4 w-24" />
                  <span className="skeleton hidden h-4 w-10 sm:block" />
                  <span className="skeleton hidden h-4 w-10 sm:block" />
                </div>
              ))}
            </div>
          ) : (
            <div className={cn("transition", loading && "opacity-60")}>
              <div className="overflow-x-auto lg:overflow-x-visible">
                <table className="data-table">
                  <thead className="sticky top-0 z-10 bg-paper">
                    <tr>
                      <th scope="col">选手</th>
                      {SORTABLE_COLUMNS.slice(0, 1).map((column) => (
                        <th key={column.key} scope="col" className="cell-num">
                          {renderSortHeader(column)}
                        </th>
                      ))}
                      <th scope="col" className="cell-num">吃鸡数</th>
                      {SORTABLE_COLUMNS.slice(1).map((column) => (
                        <th key={column.key} scope="col" className="cell-num">
                          {renderSortHeader(column)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center">
                          <p className="text-sm text-ink-2">没有符合条件的选手</p>
                          {hasFilter ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSearch("");
                                setMinMatches(0);
                              }}
                              className="btn btn-quiet mt-4"
                            >
                              清除筛选
                            </button>
                          ) : (
                            <p className="label mt-2">数仓里还没有对局数据</p>
                          )}
                        </td>
                      </tr>
                    ) : (
                      data.rows.map((row) => (
                        <tr key={row.player} className="transition hover:bg-paper-2">
                          <td className="font-medium">
                            <button
                              type="button"
                              onClick={() => onSelectPlayer(row.player)}
                              className="underline-offset-4 transition hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                              title={`查看 ${row.player} 的详情`}
                            >
                              {row.player}
                            </button>
                          </td>
                          <td className="cell-num text-ink-2">{row.matches}</td>
                          <td className="cell-num text-ink-2">{row.wins}</td>
                          <td className="cell-num">
                            <WinRate value={row.win_rate} />
                          </td>
                          <td
                            className="cell-num"
                            title={
                              row.recent_matches !== undefined
                                ? `最近 ${row.recent_matches} 场吃鸡率`
                                : undefined
                            }
                          >
                            {row.recent_win_rate !== undefined ? (
                              <WinRate value={row.recent_win_rate} />
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="cell-num text-ink-2">{row.top3_rate.toFixed(2)}%</td>
                          <td className="cell-num text-ink-2">{row.avg_place.toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* 分页器：total 由服务端返回，翻页重新请求；跳页输入框直达任意页 */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="num text-sm text-muted">每页 {data.page_size} 条</span>
                <Pagination
                  page={data.page}
                  totalPages={totalPages}
                  disabled={loading}
                  onChange={setPage}
                />
              </div>

              <p className="label mt-6 leading-5">
                吃鸡率是拿到第一名的场次占比，一局 6 人，基线约 16.7%。点击选手名看分棋手胜率。
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
