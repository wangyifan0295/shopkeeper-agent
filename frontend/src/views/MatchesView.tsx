/**
 * 对局记录视图
 * 表格列表 + 行内展开：折叠行是日期/禁用阵营/冠军/场号，点行展开六人明细
 * （名次升序，冠军行 paper-2 井底 + 余烬色小皇冠）。可同时展开多场。
 * 筛选：选手名搜索（命中六人中任一人）+ 禁用阵营下拉（真值来自接口）
 */
import { ChevronDown, Crown, Search } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Pagination } from "../components/Pagination";
import { fetchMatchesPage } from "../lib/statsApi";
import { cn } from "../lib/format";
import type { MatchRow, MatchesPage } from "../types/stats";

const PAGE_SIZE = 20;
const SKELETON_ROWS = 8;

type MatchesViewProps = {
  /** 选手详情"查看对局"带来的预置筛选 */
  presetSearch?: string;
  onSelectPlayer: (player: string) => void;
};

/** 场号展示：match_id 形如 2026-11-17T23-万象大赛，日期列已有，取 T 后的场次段 */
function sessionLabel(matchId: string) {
  return matchId.split("T")[1] ?? matchId;
}

export function MatchesView({ presetSearch, onSelectPlayer }: MatchesViewProps) {
  const [search, setSearch] = useState(presetSearch ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(presetSearch ?? "");
  const [faction, setFaction] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MatchesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // 展开态按场号记录，可同时开多场
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, faction]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMatchesPage({
      search: debouncedSearch,
      faction,
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
  }, [debouncedSearch, faction, page, refreshKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const hasFilter = debouncedSearch !== "" || faction !== "";

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

  const renderPlayerCell = (player: string) => (
    <button
      type="button"
      onClick={(event) => {
        // 行点击负责展开，选手名点击只跳详情
        event.stopPropagation();
        onSelectPlayer(player);
      }}
      className="underline-offset-4 transition hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
      title={`查看 ${player} 的详情`}
    >
      {player}
    </button>
  );

  const renderExpandedRow = (match: MatchRow) => (
    <tr>
      <td colSpan={4} className="border-b border-rule p-0">
        <div className="bg-paper-2/60 px-4 py-4 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="w-16">名次</th>
                  <th scope="col">选手</th>
                  <th scope="col">棋手</th>
                </tr>
              </thead>
              <tbody>
                {match.players.map((player) => (
                  <tr
                    key={`${match.match_id}-${player.place}`}
                    className={cn(player.place === 1 && "bg-paper-2")}
                  >
                    <td className="w-16">
                      {player.place === 1 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Crown className="h-3.5 w-3.5 text-accent" aria-label="吃鸡" />
                          <span className="num">1</span>
                        </span>
                      ) : (
                        <span className="num text-muted">{player.place}</span>
                      )}
                    </td>
                    <td>{renderPlayerCell(player.player)}</td>
                    <td className="text-ink-2">{player.lord}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg">对局记录</h1>
          <p className="label hidden sm:block">全部对局，按日期从新到旧</p>
        </div>
        <p className="label num">
          共 <span className="figure text-base text-ink-2">{data?.total ?? "—"}</span> 场
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          {/* 筛选条：选手名搜索 + 禁用阵营 */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="按选手名筛选对局…"
                aria-label="按选手名筛选对局"
                className="input w-full pl-9"
              />
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
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">日期</th>
                      <th scope="col">禁用阵营</th>
                      <th scope="col">冠军</th>
                      <th scope="col" className="text-right">场号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-16 text-center">
                          <p className="text-sm text-ink-2">没有符合条件的对局</p>
                          {hasFilter ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSearch("");
                                setFaction("");
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
                        return (
                          <Fragment key={match.match_id}>
                            <tr
                              className={cn(
                                "cursor-pointer transition hover:bg-paper-2",
                                open && "bg-paper-2/60",
                              )}
                              onClick={() => toggleExpanded(match.match_id)}
                            >
                              <td className="num whitespace-nowrap">{match.match_date}</td>
                              <td className="whitespace-nowrap text-ink-2">
                                {match.banned_faction || "—"}
                              </td>
                              <td className="whitespace-nowrap">
                                {match.champion_player ? (
                                  <>
                                    {renderPlayerCell(match.champion_player)}
                                    <span className="ml-2 text-muted">{match.champion_lord}</span>
                                  </>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              <td className="text-right">
                                <span
                                  className="label num"
                                  title={match.match_id}
                                >
                                  {sessionLabel(match.match_id)}
                                </span>
                                <ChevronDown
                                  className={cn(
                                    "ml-2 inline h-4 w-4 text-muted transition-transform",
                                    open && "rotate-180",
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
                点击行展开该场六人明细，可同时展开多场对比；冠军行带皇冠标记，选手名可点进详情。
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
