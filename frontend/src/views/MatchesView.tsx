/**
 * 对局记录视图
 * 折叠表格 + 左右分栏 2×3 紧凑对阵格展开（左栏前三名 / 右栏后三名）：
 * - 筛选：选手名搜索 + 棋手下拉 + 禁用阵营下拉 + 一键「展开本页 / 收起全部」
 * - 命中筛选选手或棋手时自动在折叠行透出本场名次，展开后高亮对应卡片
 * - 选手名与棋手名均可点击直达各自右侧详情抽屉；表头支持长列表吸顶
 */
import { ChevronDown, ChevronsDown, ChevronsUp, Crown } from "lucide-react";
import { Fragment, KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { SearchInput } from "../components/SearchInput";
import { fetchMatchesPage } from "../lib/statsApi";
import { cn } from "../lib/format";
import type { MatchPlayerRow, MatchRow, MatchesPage } from "../types/stats";

const PAGE_SIZE = 20;
const SKELETON_ROWS = 8;

type MatchesViewProps = {
  /** 选手详情"查看对局"带来的预置选手筛选 */
  presetSearch?: string;
  /** 棋手详情"查看对局"带来的预置棋手筛选 */
  presetLord?: string;
  onSelectPlayer: (player: string) => void;
  onSelectLord: (lord: string) => void;
  headerExtra?: ReactNode;
};

/** 场号展示：match_id 形如 2026-11-17T23-万象大赛，日期列已有，取 T 后的场次段 */
function sessionLabel(matchId: string) {
  return matchId.split("T")[1] ?? matchId;
}

function placeTone(place: number) {
  if (place === 1) return "text-rank-1 font-semibold";
  if (place === 2) return "text-rank-2 font-semibold";
  if (place === 3) return "text-rank-3 font-semibold";
  return "text-muted";
}

export function MatchesView({
  presetSearch,
  presetLord,
  onSelectPlayer,
  onSelectLord,
  headerExtra,
}: MatchesViewProps) {
  const [search, setSearch] = useState(presetSearch ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(presetSearch ?? "");
  const [faction, setFaction] = useState("");
  const [lord, setLord] = useState(presetLord ?? "");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MatchesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // 展开态按场号记录，可同时开多场
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 外部传入的预置搜索（例如从选手/棋手详情跳转或浏览器后退）变化时同步筛选框
  useEffect(() => {
    const next = presetSearch ?? "";
    setSearch(next);
    setDebouncedSearch(next);
  }, [presetSearch]);

  useEffect(() => {
    setLord(presetLord ?? "");
  }, [presetLord]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, faction, lord]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMatchesPage({
      search: debouncedSearch,
      faction,
      lord,
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
  }, [debouncedSearch, faction, lord, page, refreshKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const hasFilter = debouncedSearch !== "" || faction !== "" || lord !== "";
  const searchKeyword = debouncedSearch.toLowerCase();
  const showMatchedColumn = searchKeyword !== "" || lord !== "";
  const colCount = showMatchedColumn ? 5 : 4;

  const pageRows = data?.rows ?? [];
  const allExpanded =
    pageRows.length > 0 && pageRows.every((row) => expanded.has(row.match_id));

  const toggleExpanded = (matchId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  };

  const toggleAllCurrentPage = () => {
    setExpanded((current) => {
      const next = new Set(current);
      if (allExpanded) {
        pageRows.forEach((row) => next.delete(row.match_id));
      } else {
        pageRows.forEach((row) => next.add(row.match_id));
      }
      return next;
    });
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, matchId: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded(matchId);
    }
  };

  const isEntryMatched = (entry: MatchPlayerRow) => {
    const matchPlayer =
      searchKeyword !== "" && entry.player.toLowerCase().includes(searchKeyword);
    const matchLord = lord !== "" && entry.lord === lord;
    return matchPlayer || matchLord;
  };

  const renderPlayerButton = (player: string, className?: string) => (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelectPlayer(player);
      }}
      className={cn(
        "truncate text-left underline-offset-4 transition hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
      title={`查看选手 ${player} 的详情`}
    >
      {player}
    </button>
  );

  const renderLordButton = (lordName: string, className?: string) => (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelectLord(lordName);
      }}
      className={cn(
        "shrink-0 underline-offset-4 transition hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
      title={`查看棋手 ${lordName} 的详情`}
    >
      {lordName}
    </button>
  );

  const renderSlotCard = (entry: MatchPlayerRow) => {
    const isChampion = entry.place === 1;
    const matched = isEntryMatched(entry);

    return (
      <div
        key={`${entry.place}-${entry.player}`}
        className={cn(
          "flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 transition",
          matched
            ? "border-focus bg-paper-3"
            : isChampion
              ? "border-accent bg-paper"
              : "border-rule bg-paper",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "num inline-flex w-9 shrink-0 items-center gap-1 text-sm",
              placeTone(entry.place),
            )}
          >
            {isChampion ? (
              <>
                <Crown className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="吃鸡" />
                <span>1</span>
              </>
            ) : (
              <span className="pl-0.5">{entry.place}</span>
            )}
          </span>
          {renderPlayerButton(
            entry.player,
            cn(
              "text-sm",
              isChampion || matched ? "font-medium text-ink" : "text-ink-2",
            ),
          )}
          {matched && (
            <span className="shrink-0 rounded-pill bg-paper-2 px-1.5 py-0.5 text-[11px] font-medium text-focus">
              命中
            </span>
          )}
        </div>

        {renderLordButton(
          entry.lord,
          cn(
            "rounded-pill px-2 py-0.5 text-xs",
            isChampion ? "bg-paper-2 font-medium text-ink" : "text-muted",
          ),
        )}
      </div>
    );
  };

  const renderExpandedRow = (match: MatchRow) => {
    const topHalf = match.players.filter((item) => item.place <= 3);
    const bottomHalf = match.players.filter((item) => item.place > 3);

    return (
      <tr>
        <td colSpan={colCount} className="border-b border-rule p-0">
          <div className="border-l-2 border-accent bg-paper-2 px-4 py-4 lg:px-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-medium text-ink-2">前三名</span>
                  <span className="text-[11px] text-muted">吃分圈</span>
                </div>
                <div className="space-y-1.5">
                  {topHalf.map(renderSlotCard)}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-medium text-muted">后三名</span>
                  <span className="text-[11px] text-muted">4–6 名</span>
                </div>
                <div className="space-y-1.5">
                  {bottomHalf.map(renderSlotCard)}
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg">对局记录</h1>
          <p className="label hidden sm:block">全部对局，按日期从新到旧</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="label num">
            共 <span className="figure text-base text-ink-2">{data?.total ?? "—"}</span> 场
          </p>
          {headerExtra}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          {/* 筛选条：选手名搜索 + 棋手 + 禁用阵营 + 一键展开/收起 */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="按选手名筛选对局…"
              ariaLabel="按选手名筛选对局"
            />
            <div className="flex items-center gap-2">
              <label htmlFor="filter-lord" className="label shrink-0">
                棋手
              </label>
              <div className="relative">
                <select
                  id="filter-lord"
                  value={lord}
                  onChange={(event) => setLord(event.target.value)}
                  className="input appearance-none pr-8"
                >
                  <option value="">全部棋手</option>
                  {(data?.lords ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="banned-faction" className="label shrink-0">
                禁用阵营
              </label>
              <div className="relative">
                <select
                  id="banned-faction"
                  value={faction}
                  onChange={(event) => setFaction(event.target.value)}
                  className="input appearance-none pr-8"
                >
                  <option value="">全部阵营</option>
                  {(data?.factions ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
              </div>
            </div>
            {pageRows.length > 0 && (
              <button
                type="button"
                onClick={toggleAllCurrentPage}
                className="btn btn-quiet shrink-0"
                title={allExpanded ? "收起当前页所有对局明细" : "展开当前页所有对局明细"}
              >
                {allExpanded ? (
                  <>
                    <ChevronsUp className="h-3.5 w-3.5" aria-hidden="true" />
                    收起全部
                  </>
                ) : (
                  <>
                    <ChevronsDown className="h-3.5 w-3.5" aria-hidden="true" />
                    展开本页
                  </>
                )}
              </button>
            )}
          </div>

          {error ? (
            <ErrorBanner
              message={error}
              onRetry={() => setRefreshKey((key) => key + 1)}
            />
          ) : data === null ? (
            <div className="space-y-4" aria-label="加载中">
              {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-6">
                  <span className="skeleton h-4 w-24" />
                  <span className="skeleton h-4 w-16" />
                  <span className="skeleton h-4 w-40" />
                  <span className="skeleton hidden h-4 w-20 sm:block" />
                </div>
              ))}
            </div>
          ) : (
            <div className={cn("transition", loading && "opacity-60")}>
              <div className="overflow-x-auto lg:overflow-x-visible">
                <table className="data-table">
                  <thead className="sticky top-0 z-10 bg-paper">
                    <tr>
                      <th scope="col">日期</th>
                      <th scope="col">禁用阵营</th>
                      <th scope="col">冠军</th>
                      {showMatchedColumn && <th scope="col">筛选命中</th>}
                      <th scope="col" className="text-right">场号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.length === 0 ? (
                      <tr>
                        <td colSpan={colCount} className="py-16 text-center">
                          <p className="text-sm text-ink-2">没有符合条件的对局</p>
                          {hasFilter ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSearch("");
                                setFaction("");
                                setLord("");
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
                      data.rows.map((match) => {
                        const open = expanded.has(match.match_id);
                        const matchedEntries = showMatchedColumn
                          ? match.players.filter(isEntryMatched)
                          : [];

                        return (
                          <Fragment key={match.match_id}>
                            <tr
                              tabIndex={0}
                              aria-expanded={open}
                              className={cn(
                                "cursor-pointer transition hover:bg-paper-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                                open && "bg-paper-2",
                              )}
                              onClick={() => toggleExpanded(match.match_id)}
                              onKeyDown={(event) => handleRowKeyDown(event, match.match_id)}
                            >
                              <td className="num whitespace-nowrap">{match.match_date}</td>
                              <td className="whitespace-nowrap">
                                {match.banned_faction ? (
                                  <span className="pill-tag">{match.banned_faction}</span>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap">
                                {match.champion_player ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <Crown
                                      className="h-3.5 w-3.5 shrink-0 text-accent"
                                      aria-hidden="true"
                                    />
                                    {renderPlayerButton(
                                      match.champion_player,
                                      "font-medium text-ink",
                                    )}
                                    {match.champion_lord && (
                                      <>
                                        <span className="text-muted">·</span>
                                        {renderLordButton(match.champion_lord, "text-muted")}
                                      </>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              {showMatchedColumn && (
                                <td className="whitespace-nowrap">
                                  {matchedEntries.length > 0 ? (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {matchedEntries.slice(0, 2).map((entry) => (
                                        <span
                                          key={`${match.match_id}-hit-${entry.place}`}
                                          className="pill-tag"
                                        >
                                          <span className={cn("num", placeTone(entry.place))}>
                                            第{entry.place}名
                                          </span>
                                          <span className="text-ink">{entry.player}</span>
                                          <span className="text-muted">{entry.lord}</span>
                                        </span>
                                      ))}
                                      {matchedEntries.length > 2 && (
                                        <span className="text-xs text-muted">
                                          +{matchedEntries.length - 2}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </td>
                              )}
                              <td className="whitespace-nowrap text-right">
                                <span
                                  className="label num"
                                  title={match.match_id}
                                >
                                  {sessionLabel(match.match_id)}
                                </span>
                                <ChevronDown
                                  className={cn(
                                    "ml-2 inline h-4 w-4 text-muted transition-transform",
                                    open && "rotate-180 text-ink",
                                  )}
                                  aria-hidden="true"
                                />
                              </td>
                            </tr>
                            {open && renderExpandedRow(match)}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="num text-sm text-muted">每页 {data.page_size} 场</span>
                <Pagination
                  page={data.page}
                  totalPages={totalPages}
                  disabled={loading}
                  onChange={setPage}
                />
              </div>

              <p className="label mt-6 leading-5">
                点击行或按回车展开六人明细（左栏前三吃分圈、右栏后三名）；选手名与棋手名均可点进对应详情。
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
