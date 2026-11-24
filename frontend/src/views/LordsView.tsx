/**
 * 棋手榜视图
 * 全量展示 dim_lord 维表棋手，支持前端快速搜索与 4 列点击排序（场次 / 吃鸡率 / 前三率 / 平均名次）。
 * 前三名名次使用克制的金/银/铜微标强调。
 */
import { ArrowDown, ArrowLeftRight, ArrowUp } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { SearchInput } from "../components/SearchInput";
import { WinRate } from "../components/WinRate";
import { fetchLords } from "../lib/statsApi";
import { cn } from "../lib/format";
import type { LordStatRow, SortOrder } from "../types/stats";

type LordSortBy = "matches" | "win_rate" | "top3_rate" | "avg_place";

const SORTABLE_COLUMNS: Array<{ key: LordSortBy; label: string; defaultOrder: SortOrder }> = [
  { key: "matches", label: "场次", defaultOrder: "desc" },
  { key: "win_rate", label: "吃鸡率", defaultOrder: "desc" },
  { key: "top3_rate", label: "前三率", defaultOrder: "desc" },
  { key: "avg_place", label: "平均名次", defaultOrder: "asc" },
];

function rankClass(rank: number) {
  if (rank === 1) return "text-rank-1 font-semibold";
  if (rank === 2) return "text-rank-2 font-semibold";
  if (rank === 3) return "text-rank-3 font-semibold";
  return "text-muted";
}

type LordsViewProps = {
  onSelectLord: (lord: string) => void;
  headerExtra?: ReactNode;
};

export function LordsView({ onSelectLord, headerExtra }: LordsViewProps) {
  const [rows, setRows] = useState<LordStatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<LordSortBy>("win_rate");
  const [order, setOrder] = useState<SortOrder>("desc");

  useEffect(() => {
    let cancelled = false;
    fetchLords()
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const toggleSort = (column: LordSortBy, defaultOrder: SortOrder) => {
    if (sortBy === column) {
      setOrder((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(column);
      setOrder(defaultOrder);
    }
  };

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    const keyword = search.trim().toLowerCase();
    const filtered = keyword
      ? rows.filter((row) => row.lord.toLowerCase().includes(keyword))
      : rows;

    const sorted = [...filtered].sort((a, b) => {
      // 按平均名次升序时，0 场次棋手（avg_place=0）始终沉底
      if (sortBy === "avg_place") {
        if (a.matches === 0 && b.matches > 0) return 1;
        if (b.matches === 0 && a.matches > 0) return -1;
      }
      const diff = a[sortBy] - b[sortBy];
      if (diff !== 0) return order === "desc" ? -diff : diff;
      return b.matches - a.matches;
    });

    return sorted;
  }, [rows, search, sortBy, order]);

  const activeSortLabel = SORTABLE_COLUMNS.find((col) => col.key === sortBy)?.label ?? "吃鸡率";
  const sortDirectionLabel = order === "desc" ? "从高到低" : "从低到高";

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
          <h1 className="font-display text-lg">棋手榜</h1>
          <p className="label hidden sm:block">
            按{activeSortLabel}
            {sortDirectionLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="label num">
            共 <span className="figure text-base text-ink-2">{rows ? visibleRows.length : "—"}</span> 位
          </p>
          {headerExtra}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          <div className="mb-6 flex items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="搜索棋手名…"
              ariaLabel="搜索棋手名"
              className="max-w-md"
            />
          </div>

          {error ? (
            <ErrorBanner
              message={error}
              onRetry={() => setRefreshKey((key) => key + 1)}
            />
          ) : rows === null ? (
            <div className="space-y-4" aria-label="加载中">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-6">
                  <span className="skeleton h-4 w-32" />
                  <span className="skeleton h-4 w-10" />
                  <span className="skeleton h-4 w-10" />
                  <span className="skeleton h-4 w-24" />
                  <span className="skeleton hidden h-4 w-10 sm:block" />
                  <span className="skeleton hidden h-4 w-10 sm:block" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto lg:overflow-x-visible">
              <table className="data-table">
                <thead className="sticky top-0 z-10 bg-paper">
                  <tr>
                    <th scope="col" className="w-12">名次</th>
                    <th scope="col">棋手</th>
                    <th scope="col" className="cell-num">
                      {renderSortHeader(SORTABLE_COLUMNS[0])}
                    </th>
                    <th scope="col" className="cell-num">吃鸡数</th>
                    {SORTABLE_COLUMNS.slice(1).map((column) => (
                      <th key={column.key} scope="col" className="cell-num">
                        {renderSortHeader(column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-16 text-center">
                        <p className="text-sm text-ink-2">没有匹配的棋手</p>
                        {search.trim() && (
                          <button
                            type="button"
                            onClick={() => setSearch("")}
                            className="btn btn-quiet mt-4"
                          >
                            清除搜索
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row, index) => {
                      const rank = index + 1;
                      return (
                        <tr key={row.lord} className="transition hover:bg-paper-2">
                          <td className={cn("figure", rankClass(rank))}>{rank}</td>
                          <td className="font-medium">
                            <button
                              type="button"
                              onClick={() => onSelectLord(row.lord)}
                              className="underline-offset-4 transition hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                              title={`查看 ${row.lord} 的详情`}
                            >
                              {row.lord}
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          <p className="label mt-6 leading-5">
            棋手即对局中可选的角色（数据表 dim_lord）；点击棋手名可查看擅长选手与全部出场对局。
          </p>
        </div>
      </div>
    </main>
  );
}
