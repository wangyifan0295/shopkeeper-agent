/**
 * 选手榜视图
 * 服务端分页 + 筛选（姓名搜索 / 场次下限）+ 可点击列头排序。
 * 表格只有横向规则；吃鸡率列是衬线数字加热坡条。加载态给骨架行
 */
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
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
  { key: "top3_rate", label: "前三率", defaultOrder: "desc" },
  { key: "avg_place", label: "平均名次", defaultOrder: "asc" },
];

type PlayersViewProps = {
  onSelectPlayer: (player: string) => void;
};

export function PlayersView({ onSelectPlayer }: PlayersViewProps) {
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
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
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
          <p className="label hidden sm:block">全部选手，按场次从高到低</p>
        </div>
        <p className="label num">
          共 <span className="figure text-base text-ink-2">{data?.total ?? "—"}</span> 位
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          {/* 筛选条：姓名搜索 + 场次下限 */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索选手名…"
                aria-label="搜索选手名"
                className="input w-full pl-9"
              />
            </div>
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
            <div className="flex items-center justify-between gap-4 rounded-well border-l-2 border-error bg-paper-2 px-4 py-3 text-sm text-error">
              <span className="min-w-0 break-all">{error}</span>
              <button
                type="button"
                onClick={() => setRefreshKey((key) => key + 1)}
                className="btn btn-quiet shrink-0 text-error"
              >
                重试
              </button>
            </div>
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
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
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
                        <td colSpan={6} className="py-16 text-center">
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
                              className="underline-offset-4 transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus hover:underline"
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
                          <td className="cell-num text-ink-2">{row.top3_rate.toFixed(2)}%</td>
                          <td className="cell-num text-ink-2">{row.avg_place.toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* 分页器：total 由服务端返回，翻页重新请求 */}
              <div className="mt-4 flex items-center justify-between text-sm text-muted">
                <div className="flex items-center gap-3">
                  <span className="num">
                    第 {data.page} / {totalPages} 页
                  </span>
                  <span aria-hidden="true" className="h-3 w-px bg-rule" />
                  <span className="num">每页 {data.page_size} 条</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={data.page <= 1 || loading}
                    className="icon-btn"
                    title="上一页"
                    aria-label="上一页"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={data.page >= totalPages || loading}
                    className="icon-btn"
                    title="下一页"
                    aria-label="下一页"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
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
