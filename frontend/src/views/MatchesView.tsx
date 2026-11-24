/**
 * 对局记录视图
 * 按日期分组（可折叠整天）+ 当天内按 slot_hour 小时时间轴直排（每整点一场）：
 * - 筛选：选手名搜索 + 棋手下拉 + 禁用阵营下拉 + 时段下拉 + 一键折叠日期/展开本页明细
 * - 单场行左侧展示整点时间（如 23:00），点击行展开左右分栏 2×3 紧凑对阵格（前三/后三）
 * - 命中筛选选手或棋手时直接在折叠行透出本场名次，展开后高亮对应卡片
 */
import {
  Ban,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Clock,
  Crown,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { FilterSelect } from "../components/FilterSelect";
import { Pagination } from "../components/Pagination";
import { SearchInput } from "../components/SearchInput";
import { fetchMatchesPage } from "../lib/statsApi";
import { cn } from "../lib/format";
import type { MatchPlayerRow, MatchRow, MatchesPage } from "../types/stats";

const PAGE_SIZE = 20;
const SKELETON_GROUPS = 3;

type MatchesViewProps = {
  /** 选手详情"查看对局"带来的预置选手筛选 */
  presetSearch?: string;
  /** 棋手详情"查看对局"带来的预置棋手筛选 */
  presetLord?: string;
  /** 数据大盘"禁用阵营分布"点击带来的预置禁用阵营筛选 */
  presetFaction?: string;
  onSelectPlayer: (player: string) => void;
  onSelectLord: (lord: string) => void;
  headerExtra?: ReactNode;
};

type DateGroup = {
  date: string;
  weekday: string;
  matches: MatchRow[];
};

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatWeekday(dateStr: string) {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(parsed);
}

/** 从 match_id（如 2026-11-23T23-万象大赛）中提取日期/小时之外的模式段 */
function modeLabel(matchId: string) {
  const afterT = matchId.split("T")[1];
  if (!afterT) return matchId;
  const dashIdx = afterT.indexOf("-");
  return dashIdx >= 0 ? afterT.slice(dashIdx + 1) : afterT;
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
  presetFaction,
  onSelectPlayer,
  onSelectLord,
  headerExtra,
}: MatchesViewProps) {
  const [search, setSearch] = useState(presetSearch ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(presetSearch ?? "");
  const [faction, setFaction] = useState(presetFaction ?? "");
  const [lord, setLord] = useState(presetLord ?? "");
  const [slotHour, setSlotHour] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MatchesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // 展开态按场号记录，可同时开多场
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 收起态按日期记录，默认全部日期展开
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    const next = presetSearch ?? "";
    setSearch(next);
    setDebouncedSearch(next);
  }, [presetSearch]);

  useEffect(() => {
    setLord(presetLord ?? "");
  }, [presetLord]);

  useEffect(() => {
    setFaction(presetFaction ?? "");
  }, [presetFaction]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, faction, lord, slotHour]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMatchesPage({
      search: debouncedSearch,
      faction,
      lord,
      slotHour,
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
  }, [debouncedSearch, faction, lord, slotHour, page, refreshKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const hasFilter =
    debouncedSearch !== "" || faction !== "" || lord !== "" || slotHour !== null;
  const searchKeyword = debouncedSearch.toLowerCase();
  const showMatchedBadge = searchKeyword !== "" || lord !== "";

  const pageRows = data?.rows ?? [];

  const dateGroups = useMemo<DateGroup[]>(() => {
    const map = new Map<string, MatchRow[]>();
    for (const row of pageRows) {
      const list = map.get(row.match_date);
      if (list) {
        list.push(row);
      } else {
        map.set(row.match_date, [row]);
      }
    }
    return Array.from(map.entries()).map(([date, matches]) => ({
      date,
      weekday: formatWeekday(date),
      matches: [...matches].sort((a, b) => b.slot_hour - a.slot_hour),
    }));
  }, [pageRows]);

  const allExpanded =
    pageRows.length > 0 && pageRows.every((row) => expanded.has(row.match_id));
  const allDatesCollapsed =
    dateGroups.length > 0 && dateGroups.every((group) => collapsedDates.has(group.date));

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

  const toggleDateGroup = (date: string) => {
    setCollapsedDates((current) => {
      const next = new Set(current);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const toggleAllDates = () => {
    setCollapsedDates((current) => {
      const next = new Set(current);
      if (allDatesCollapsed) {
        dateGroups.forEach((group) => next.delete(group.date));
      } else {
        dateGroups.forEach((group) => next.add(group.date));
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

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, matchId: string) => {
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
              ? "border-accent bg-paper-2"
              : "border-rule bg-paper",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "num inline-flex w-8 shrink-0 items-center gap-1 text-sm",
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
            isChampion ? "bg-paper font-medium text-ink" : "text-muted",
          ),
        )}
      </div>
    );
  };

  const renderTimelineMatch = (match: MatchRow, isLast: boolean) => {
    const open = expanded.has(match.match_id);
    const matchedEntries = showMatchedBadge ? match.players.filter(isEntryMatched) : [];
    const topHalf = match.players.filter((item) => item.place <= 3);
    const bottomHalf = match.players.filter((item) => item.place > 3);

    return (
      <div key={match.match_id} className={cn("relative flex gap-3 sm:gap-4", !isLast && "pb-3")}>
        {/* 左侧小时刻度 */}
        <div className="flex w-12 shrink-0 flex-col items-end pt-3 sm:w-14">
          <span className="num font-mono text-xs font-semibold text-accent">
            {formatHour(match.slot_hour)}
          </span>
        </div>

        {/* 时间轴节点与连接竖线 */}
        <div className="relative flex flex-col items-center pt-4">
          <span
            aria-hidden="true"
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-pill border-2 transition",
              open
                ? "border-accent bg-accent"
                : "border-accent bg-paper",
            )}
          />
          {!isLast && <span aria-hidden="true" className="mt-1 w-px flex-1 bg-rule" />}
        </div>

        {/* 右侧单场行与展开区 */}
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden rounded-well border transition",
            open ? "border-accent bg-paper" : "border-rule bg-paper hover:bg-paper-3",
          )}
        >
          <div
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => toggleExpanded(match.match_id)}
            onKeyDown={(event) => handleRowKeyDown(event, match.match_id)}
            className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              {match.banned_faction ? (
                <span className="pill-tag">禁 {match.banned_faction}</span>
              ) : (
                <span className="pill-tag text-muted">无禁用</span>
              )}

              {match.champion_player ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                  {renderPlayerButton(match.champion_player, "font-medium text-ink")}
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

              {matchedEntries.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {matchedEntries.slice(0, 2).map((entry) => (
                    <span key={`${match.match_id}-hit-${entry.place}`} className="pill-tag">
                      <span className={cn("num", placeTone(entry.place))}>
                        第{entry.place}名
                      </span>
                      <span className="text-ink">{entry.player}</span>
                      <span className="text-muted">{entry.lord}</span>
                    </span>
                  ))}
                  {matchedEntries.length > 2 && (
                    <span className="text-xs text-muted">+{matchedEntries.length - 2}</span>
                  )}
                </div>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">
              <span title={match.match_id}>{modeLabel(match.match_id)}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  open && "rotate-180 text-ink",
                )}
                aria-hidden="true"
              />
            </div>
          </div>

          {open && (
            <div className="border-t border-rule border-l-2 border-l-accent bg-paper-2 px-4 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-medium text-ink-2">前三名</span>
                    <span className="text-[11px] text-muted">吃分圈</span>
                  </div>
                  <div className="space-y-1.5">{topHalf.map(renderSlotCard)}</div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-medium text-muted">后三名</span>
                    <span className="text-[11px] text-muted">4–6 名</span>
                  </div>
                  <div className="space-y-1.5">{bottomHalf.map(renderSlotCard)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg">对局记录</h1>
          <p className="label hidden sm:block">按日期分组 · 小时时间轴倒序</p>
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
          {/* 筛选条：选手名搜索 + 棋手 + 禁用阵营 + 时段 + 折叠/展开控制 */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="按选手名筛选对局…"
              ariaLabel="按选手名筛选对局"
            />
            <FilterSelect
              value={lord}
              onChange={setLord}
              options={(data?.lords ?? []).map((name) => ({ value: name, label: name }))}
              placeholder="全部棋手"
              labelPrefix="棋手"
              icon={<Crown className="h-3.5 w-3.5" aria-hidden="true" />}
              searchable
              searchPlaceholder="搜索棋手名…"
              ariaLabel="按棋手筛选对局"
            />
            <FilterSelect
              value={faction}
              onChange={setFaction}
              options={(data?.factions ?? []).map((name) => ({ value: name, label: name }))}
              placeholder="全部阵营"
              labelPrefix="禁用"
              icon={<Ban className="h-3.5 w-3.5" aria-hidden="true" />}
              ariaLabel="按禁用阵营筛选对局"
            />
            <FilterSelect
              value={slotHour === null ? "" : String(slotHour)}
              onChange={(val) => setSlotHour(val === "" ? null : Number(val))}
              options={(data?.hours ?? []).map((h) => ({
                value: String(h),
                label: formatHour(h),
              }))}
              placeholder="全部时段"
              labelPrefix="时段"
              icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}
              ariaLabel="按对局时段筛选"
            />
            {pageRows.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAllDates}
                  className="btn btn-quiet shrink-0"
                  title={allDatesCollapsed ? "展开本页所有日期分组" : "收起本页所有日期分组"}
                >
                  {allDatesCollapsed ? "展开日期" : "收起日期"}
                </button>
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
              </div>
            )}
          </div>

          {error ? (
            <ErrorBanner
              message={error}
              onRetry={() => setRefreshKey((key) => key + 1)}
            />
          ) : data === null ? (
            <div className="space-y-4" aria-label="加载中">
              {Array.from({ length: SKELETON_GROUPS }).map((_, index) => (
                <div key={index} className="well space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <span className="skeleton h-4 w-36" />
                    <span className="skeleton h-4 w-20" />
                  </div>
                  <div className="space-y-2 border-t border-rule pt-3">
                    <span className="skeleton block h-10 w-full" />
                    <span className="skeleton block h-10 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={cn("transition", loading && "opacity-60")}>
              {dateGroups.length === 0 ? (
                <div className="well py-16 text-center">
                  <p className="text-sm text-ink-2">没有符合条件的对局</p>
                  {hasFilter ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setFaction("");
                        setLord("");
                        setSlotHour(null);
                      }}
                      className="btn btn-quiet mt-4"
                    >
                      清除筛选
                    </button>
                  ) : (
                    <p className="label mt-2">数仓里还没有对局数据</p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {dateGroups.map((group) => {
                    const collapsed = collapsedDates.has(group.date);
                    const minHour = group.matches[group.matches.length - 1].slot_hour;
                    const maxHour = group.matches[0].slot_hour;
                    const hourSpan =
                      minHour === maxHour
                        ? formatHour(maxHour)
                        : `${formatHour(minHour)} – ${formatHour(maxHour)}`;

                    return (
                      <section
                        key={group.date}
                        className="overflow-hidden rounded-well border border-rule bg-paper-2"
                      >
                        <button
                          type="button"
                          onClick={() => toggleDateGroup(group.date)}
                          aria-expanded={!collapsed}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-paper-3"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            {collapsed ? (
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                            )}
                            <span className="num font-mono text-sm font-semibold text-ink">
                              {group.date}
                            </span>
                            {group.weekday && (
                              <span className="text-xs text-muted">{group.weekday}</span>
                            )}
                            <span className="pill-tag num">{group.matches.length} 场</span>
                          </div>
                          <span className="num shrink-0 font-mono text-xs text-muted">
                            {hourSpan}
                          </span>
                        </button>

                        {!collapsed && (
                          <div className="border-t border-rule px-3 py-4 sm:px-4">
                            {group.matches.map((match, idx) =>
                              renderTimelineMatch(match, idx === group.matches.length - 1),
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <span className="num text-sm text-muted">每页 {data.page_size} 场</span>
                <Pagination
                  page={data.page}
                  totalPages={totalPages}
                  disabled={loading}
                  onChange={setPage}
                />
              </div>

              <p className="label mt-6 leading-5">
                按日期聚合并沿小时时间轴排列；点击日期头可整天折叠，点击单场展开六人明细（选手名与棋手名均可点进详情）。
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
