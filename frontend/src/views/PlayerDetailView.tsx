/**
 * 选手详情右侧抽屉组件
 * 以浮层抽屉覆盖在当前列表右侧，不卸载背后选手榜/对局记录的页码、筛选与展开态：
 * - 档案概览卡：吃鸡率/前三率/平均名次基线对照 + 三段式名次构成条 + 最近 8 场状态与名次轨迹
 * - 分棋手胜率表：支持场次/吃鸡率/前三率排序与选用占比微条
 * - 支持点击遮罩、关闭按钮或按 Esc 关闭
 */
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Crown,
  Sparkles,
  Swords,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EChartBox } from "../components/EChartBox";
import { ErrorBanner } from "../components/ErrorBanner";
import { WIN_RATE_BASELINE, WinRate } from "../components/WinRate";
import { fetchPlayerDetail } from "../lib/statsApi";
import type { ChartPalette, EChartsCoreOption } from "../lib/echarts";
import { cn } from "../lib/format";
import type { PlayerDetail, SortOrder } from "../types/stats";

const TOP3_BASELINE = 50;
const AVG_PLACE_BASELINE = 3.5;

type LordSortBy = "matches" | "win_rate" | "top3_rate";

const LORD_SORT_COLUMNS: Array<{ key: LordSortBy; label: string; defaultOrder: SortOrder }> = [
  { key: "matches", label: "场次", defaultOrder: "desc" },
  { key: "win_rate", label: "吃鸡率", defaultOrder: "desc" },
  { key: "top3_rate", label: "前三率", defaultOrder: "desc" },
];

type PlayerDetailDrawerProps = {
  player: string;
  onClose: () => void;
  onSelectLord: (lord: string) => void;
  onBrowseMatches: (player: string) => void;
};

export function PlayerDetailDrawer({
  player,
  onClose,
  onSelectLord,
  onBrowseMatches,
}: PlayerDetailDrawerProps) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortBy, setSortBy] = useState<LordSortBy>("matches");
  const [order, setOrder] = useState<SortOrder>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setError(null);
    setSortBy("matches");
    setOrder("desc");

    fetchPlayerDetail(player)
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
  }, [player, refreshKey]);

  // 按 Esc 快捷关闭抽屉
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const toggleSort = (column: LordSortBy, defaultOrder: SortOrder) => {
    if (sortBy === column) {
      setOrder((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(column);
      setOrder(defaultOrder);
    }
  };

  const sortedLords = useMemo(() => {
    if (!detail) return [];
    return [...detail.lord_stats].sort((a, b) => {
      const diff = a[sortBy] - b[sortBy];
      if (diff !== 0) return order === "desc" ? -diff : diff;
      return b.matches - a.matches;
    });
  }, [detail, sortBy, order]);

  const topLord = detail?.lord_stats[0];
  // 招牌高胜棋手：至少使用 3 场且胜率最高；若与最常用棋手相同则不重复展示
  const bestWinLord = useMemo(() => {
    if (!detail) return null;
    const qualified = detail.lord_stats.filter((item) => item.matches >= 3 && item.win_rate > 0);
    if (qualified.length === 0) return null;
    const best = [...qualified].sort(
      (a, b) => b.win_rate - a.win_rate || b.matches - a.matches,
    )[0];
    if (!best || best.lord === topLord?.lord) return null;
    return best;
  }, [detail, topLord]);

  // 名次构成三段占比：吃鸡 / 2-3 名吃分 / 4-6 名
  const winPct = detail ? Math.max(0, Math.min(100, detail.win_rate)) : 0;
  const top23Pct = detail ? Math.max(0, Math.min(100 - winPct, detail.top3_rate - winPct)) : 0;
  const bottomPct = Math.max(0, 100 - winPct - top23Pct);

  const winDelta = detail ? detail.win_rate - WIN_RATE_BASELINE : 0;
  const top3Delta = detail ? detail.top3_rate - TOP3_BASELINE : 0;
  const placeDelta = detail ? AVG_PLACE_BASELINE - detail.avg_place : 0;

  const activeSortLabel = LORD_SORT_COLUMNS.find((col) => col.key === sortBy)?.label ?? "场次";
  const sortDirectionLabel = order === "desc" ? "从高到低" : "从低到高";

  const buildRecentOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      // 接口返回按时间倒序（最新在前），走势图改为从早到新（左→右）
      const chronological = [...(detail?.recent_8?.records ?? [])].reverse();
      return {
        animationDuration: 320,
        grid: { top: 18, right: 62, bottom: 28, left: 32 },
        tooltip: {
          trigger: "axis",
          confine: true,
          backgroundColor: palette.paper2,
          borderColor: palette.rule,
          borderWidth: 1,
          textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
          formatter: (params: unknown) => {
            const first = Array.isArray(params) ? params[0] : params;
            const idx = (first as { dataIndex?: number } | undefined)?.dataIndex ?? -1;
            const rec = chronological[idx];
            if (!rec) return "";
            return [
              `<div style="font-weight:600;">第 ${rec.place} 名 · ${rec.lord}</div>`,
              `<div style="color:${palette.ink2};font-size:12px;">${rec.match_date}</div>`,
            ].join("");
          },
        },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: chronological.map((rec) =>
            rec.match_date ? rec.match_date.slice(5) : rec.lord,
          ),
          axisLabel: {
            color: palette.ink2,
            fontFamily: palette.fontMono,
            fontSize: 12,
            hideOverlap: true,
            margin: 10,
          },
          axisLine: { lineStyle: { color: palette.rule } },
        },
        yAxis: {
          type: "value",
          inverse: true,
          min: 1,
          max: 6,
          interval: 1,
          axisLabel: {
            color: palette.ink2,
            fontFamily: palette.fontMono,
            fontSize: 12,
            formatter: "{value}",
          },
          splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
        },
        series: [
          {
            type: "line",
            smooth: 0.2,
            symbol: "circle",
            symbolSize: 8,
            data: chronological.map((rec) => ({
              value: rec.place,
              itemStyle: {
                color:
                  rec.place === 1
                    ? palette.accent
                    : rec.place <= 3
                      ? palette.success
                      : palette.muted,
                borderColor: palette.paper2,
                borderWidth: 1.5,
              },
            })),
            lineStyle: { color: palette.ink2, width: 2 },
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: {
                color: palette.muted,
                type: "dashed",
                width: 1,
                opacity: 0.7,
              },
              label: {
                color: palette.ink2,
                fontFamily: palette.fontMono,
                fontSize: 12,
                formatter: "均线3.5",
                position: "end",
                distance: 6,
              },
              data: [{ yAxis: AVG_PLACE_BASELINE }],
            },
          },
        ],
      };
    },
    [detail],
  );

  const renderSortHeader = (column: (typeof LORD_SORT_COLUMNS)[number]) => {
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
        aria-label={`${player} 的选手详情`}
        onClick={(event) => event.stopPropagation()}
        className="drawer-panel flex h-dvh w-full max-w-[620px] flex-col border-l border-rule bg-paper text-ink shadow-card"
      >
        {/* 抽屉顶栏 */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-rule bg-sidebar px-5">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg text-ink">{player}</h2>
            {detail && (
              <p className="num truncate text-xs text-muted">
                共 {detail.matches} 场 · {detail.wins} 鸡 · {detail.lord_stats.length} 位棋手
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onBrowseMatches(player)}
              className="btn btn-quiet h-8 min-h-0 px-3 text-xs"
              title={`筛选 ${player} 参加的对局`}
            >
              <Swords className="h-3.5 w-3.5" aria-hidden="true" />
              查看对局
            </button>
            <button
              type="button"
              onClick={onClose}
              className="icon-btn"
              title="关闭（Esc）"
              aria-label="关闭选手详情"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* 抽屉独立滚动正文 */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6">
          {error ? (
            <ErrorBanner
              message={error.includes("404") ? "未找到该选手，可能数据已更新。" : error}
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
                    <span className="skeleton h-4 w-24" />
                    <span className="skeleton h-4 w-16" />
                    <span className="skeleton h-4 w-14" />
                    <span className="skeleton h-4 w-14" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-7">
              {/* 选手亮点标签：常用棋手 / 招牌高胜棋手（可点击穿透到棋手详情） */}
              {(topLord || bestWinLord) && (
                <div className="flex flex-wrap items-center gap-2">
                  {topLord && topLord.matches > 0 && (
                    <button
                      type="button"
                      onClick={() => onSelectLord(topLord.lord)}
                      className="pill-tag transition hover:border-accent hover:text-ink"
                      title={`点击查看棋手 ${topLord.lord} 的详情`}
                    >
                      <Crown className="h-3 w-3 text-accent" aria-hidden="true" />
                      常用：{topLord.lord}
                      <span className="num text-muted">
                        {topLord.matches} 场 ({topLord.win_rate.toFixed(1)}%)
                      </span>
                    </button>
                  )}
                  {bestWinLord && (
                    <button
                      type="button"
                      onClick={() => onSelectLord(bestWinLord.lord)}
                      className="pill-tag transition hover:border-accent hover:text-ink"
                      title={`点击查看棋手 ${bestWinLord.lord} 的详情`}
                    >
                      <Sparkles className="h-3 w-3 text-success" aria-hidden="true" />
                      高胜：{bestWinLord.lord}
                      <span className="num text-success">
                        {bestWinLord.win_rate.toFixed(1)}%
                      </span>
                      <span className="num text-muted">({bestWinLord.matches} 场)</span>
                    </button>
                  )}
                </div>
              )}

              {/* 档案概览井：三核心指标基线对照 + 名次构成条 */}
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
                      {detail.avg_place.toFixed(2)}
                    </dd>
                    <p
                      className={cn(
                        "num mt-1 text-xs",
                        placeDelta >= 0 ? "text-success" : "text-muted",
                      )}
                    >
                      {placeDelta >= 0
                        ? `优于均线 ${placeDelta.toFixed(2)}`
                        : `弱于均线 ${Math.abs(placeDelta).toFixed(2)}`}
                    </p>
                  </div>
                </dl>

                {/* 名次构成三段条：吃鸡 / 2–3 名吃分 / 4–6 名 */}
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
              </section>

              {/* 最近 8 场状态：近 8 场吃鸡率 + 倒置 Y 轴名次走势折线图 */}
              {detail.recent_8 && detail.recent_8.matches > 0 && (
                <section className="well space-y-4 p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-medium text-ink">
                        最近 {detail.recent_8.matches} 场走势
                      </h3>
                      <span
                        className={cn(
                          "num text-xs",
                          detail.recent_8.win_rate >= detail.win_rate
                            ? "text-success"
                            : "text-muted",
                        )}
                      >
                        {detail.recent_8.win_rate >= detail.win_rate
                          ? `较生涯 +${(detail.recent_8.win_rate - detail.win_rate).toFixed(1)}%`
                          : `较生涯 ${(detail.recent_8.win_rate - detail.win_rate).toFixed(1)}%`}
                      </span>
                    </div>
                    <span className="num text-xs text-muted">
                      {detail.recent_8.wins} 鸡 · 前三率 {detail.recent_8.top3_rate.toFixed(1)}% · 均名{" "}
                      {detail.recent_8.avg_place.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="label text-xs">近 {detail.recent_8.matches} 场吃鸡率</p>
                      <p className="mt-1">
                        <WinRate
                          value={detail.recent_8.win_rate}
                          className="text-2xl"
                        />
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-pill bg-accent" aria-hidden="true" />
                        第 1 名
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-pill bg-success" aria-hidden="true" />
                        2–3 名
                      </span>
                      <span>从早到新（上方为第 1 名）</span>
                    </div>
                  </div>

                  <EChartBox
                    buildOption={buildRecentOption}
                    height={165}
                    ariaLabel={`${player} 最近 ${detail.recent_8.matches} 场名次走势图`}
                  />
                </section>
              )}

              {/* 分棋手胜率明细：支持排序 + 选用占比 */}
              <section>
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-base text-ink">分棋手胜率</h3>
                  <p className="label num text-xs">
                    {detail.lord_stats.length} 位棋手 · 按{activeSortLabel}
                    {sortDirectionLabel}
                  </p>
                </div>

                <div className="well overflow-x-auto px-2 py-1">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">棋手</th>
                        <th scope="col" className="cell-num">
                          {renderSortHeader(LORD_SORT_COLUMNS[0])}
                        </th>
                        <th scope="col" className="cell-num">吃鸡</th>
                        <th scope="col" className="cell-num">
                          {renderSortHeader(LORD_SORT_COLUMNS[1])}
                        </th>
                        <th scope="col" className="cell-num">
                          {renderSortHeader(LORD_SORT_COLUMNS[2])}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLords.map((row) => {
                        const share = detail.matches > 0 ? (row.matches / detail.matches) * 100 : 0;
                        return (
                          <tr key={row.lord} className="transition hover:bg-paper-3">
                            <td className="whitespace-nowrap font-medium text-ink">
                              <button
                                type="button"
                                onClick={() => onSelectLord(row.lord)}
                                className="underline-offset-4 transition hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                                title={`查看棋手 ${row.lord} 的详情`}
                              >
                                {row.lord}
                              </button>
                            </td>
                            <td className="cell-num text-ink">
                              <div className="inline-flex flex-col items-center gap-1">
                                <span>
                                  {row.matches}
                                  <span className="ml-1 text-xs font-normal text-muted">
                                    ({share.toFixed(0)}%)
                                  </span>
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="block h-1 w-14 overflow-hidden rounded-pill bg-paper-3"
                                >
                                  <span
                                    className="block h-full rounded-pill bg-accent"
                                    style={{ width: `${Math.min(100, share)}%` }}
                                  />
                                </span>
                              </div>
                            </td>
                            <td className="cell-num text-ink">{row.wins}</td>
                            <td className="cell-num">
                              <WinRate value={row.win_rate} />
                            </td>
                            <td className="cell-num text-ink-2">{row.top3_rate.toFixed(2)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <p className="label text-xs leading-5">
                6 人局基准：吃鸡率 16.7% / 前三率 50.0% / 平均名次 3.50。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
