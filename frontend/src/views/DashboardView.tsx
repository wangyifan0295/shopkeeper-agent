/**
 * 数据大盘总览视图（开阔赛报旗舰布局）
 * 遵循“少框、大字、宽幅主图”的大盘视觉原则：
 * 1. 顶部无框大号核心战报条（总对局规模 / 近期状态王 / 版本 T0 棋手 / 最高 Ban 率阵营）
 * 2. 中部通栏宽幅大主图：近期火热选手 Top 8（渐变圆角柱 × 生涯折线混合组合图，水平直排不挤字）
 * 3. 底部 7:5 双主图板块：左侧版本强势棋手 Top 10 横向 ECharts 排行图 + 右侧大尺寸禁用阵营环形图
 */
import { ArrowUpRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { EChartBox } from "../components/EChartBox";
import { ErrorBanner } from "../components/ErrorBanner";
import { WIN_RATE_BASELINE } from "../components/WinRate";
import {
  echarts,
  type ChartPalette,
  type ECElementEvent,
  type EChartsCoreOption,
} from "../lib/echarts";
import { cn } from "../lib/format";
import { fetchDashboard, fetchLords } from "../lib/statsApi";
import type { DashboardData } from "../types/stats";

type DashboardViewProps = {
  onSelectPlayer: (player: string) => void;
  onSelectLord: (lord: string) => void;
  onBrowseFactionMatches: (faction: string) => void;
  headerExtra?: ReactNode;
};

type LordRankMode = "win_rate" | "matches";

const FACTION_DOT_CLASSES = [
  "bg-accent",
  "bg-success",
  "bg-focus",
  "bg-rank-1",
  "bg-rank-3",
  "bg-muted",
];

function formatDelta(delta: number) {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

export function DashboardView({
  onSelectPlayer,
  onSelectLord,
  onBrowseFactionMatches,
  headerExtra,
}: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lordMode, setLordMode] = useState<LordRankMode>("win_rate");

  useEffect(() => {
    let cancelled = false;
    fetchDashboard()
      .then(async (result) => {
        let lords = result.lords;
        if (!Array.isArray(lords) || lords.length === 0) {
          try {
            const lordsRes = await fetchLords();
            lords = lordsRes.rows;
          } catch {
            lords = [];
          }
        }
        if (!cancelled) {
          setData({ ...result, lords });
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

  const topPlayer = data?.hot_players[0] ?? null;

  const qualifiedLords = useMemo(() => {
    const all = data?.lords ?? [];
    const enough = all.filter((item) => item.matches >= 5);
    return enough.length > 0 ? enough : all.filter((item) => item.matches > 0);
  }, [data]);

  const topLord = useMemo(() => {
    if (qualifiedLords.length === 0) return null;
    return [...qualifiedLords].sort(
      (a, b) => b.win_rate - a.win_rate || b.matches - a.matches,
    )[0];
  }, [qualifiedLords]);

  const rankedLords = useMemo(() => {
    const sorted = [...qualifiedLords].sort((a, b) => {
      if (lordMode === "win_rate") {
        return b.win_rate - a.win_rate || b.matches - a.matches;
      }
      return b.matches - a.matches || b.win_rate - a.win_rate;
    });
    return sorted.slice(0, 10);
  }, [qualifiedLords, lordMode]);

  const factionStats = useMemo(() => {
    const raw = (data?.banned_factions ?? []).filter((item) => item.matches > 0);
    const total = raw.reduce((sum, item) => sum + item.matches, 0);
    return {
      total,
      items: raw.map((item) => ({
        ...item,
        pct: total > 0 ? (item.matches / total) * 100 : 0,
      })),
    };
  }, [data]);

  const topFaction = factionStats.items[0] ?? null;

  // 1. 通栏宽幅主图：近期火热选手 Top 8（渐变柱 + 生涯折线，全宽舒展、水平直排不旋转）
  const buildHotPlayersOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      const players = data?.hot_players ?? [];
      const barGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: palette.accent },
        { offset: 1, color: palette.accentSoft },
      ]);

      return {
        animationDuration: 460,
        grid: { top: 44, right: 76, bottom: 42, left: 52 },
        tooltip: {
          trigger: "axis",
          confine: true,
          axisPointer: {
            type: "shadow",
            shadowStyle: { color: palette.accentSoft, opacity: 0.35 },
          },
          backgroundColor: palette.paper2,
          borderColor: palette.rule,
          borderWidth: 1,
          padding: [10, 14],
          textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
          formatter: (params: unknown) => {
            const list = Array.isArray(params) ? params : [params];
            const idx = (list[0] as { dataIndex?: number } | undefined)?.dataIndex ?? -1;
            const p = players[idx];
            if (!p) return "";
            const delta = p.recent_win_rate - p.win_rate;
            const deltaColor = delta >= 0 ? palette.success : palette.muted;
            return [
              `<div style="font-weight:600;font-size:13px;margin-bottom:6px;">${p.player}</div>`,
              `<div>近 ${p.recent_matches} 场吃鸡率：<b style="color:${palette.accent};">${p.recent_win_rate.toFixed(2)}%</b></div>`,
              `<div>生涯吃鸡率：<b style="color:${palette.success};">${p.win_rate.toFixed(2)}%</b>（共 ${p.matches} 场）</div>`,
              `<div style="margin-top:5px;font-size:11px;color:${deltaColor};">状态较生涯：<b>${formatDelta(delta)}</b> · 点击柱条查看选手档案</div>`,
            ].join("");
          },
        },
        xAxis: {
          type: "category",
          data: players.map((p) => p.player),
          axisLabel: {
            color: palette.ink,
            fontFamily: palette.fontBody,
            fontSize: 12,
            interval: 0,
            margin: 14,
            formatter: (val: string) => (val.length > 9 ? `${val.slice(0, 8)}…` : val),
          },
          axisLine: { lineStyle: { color: palette.rule } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          max: (value: { max: number }) =>
            Math.min(100, Math.max(35, Math.ceil((value.max + 12) / 10) * 10)),
          axisLabel: {
            color: palette.muted,
            fontFamily: palette.fontMono,
            fontSize: 11,
            formatter: "{value}%",
          },
          splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
        },
        series: [
          {
            name: "近 8 场吃鸡率",
            type: "bar",
            barMaxWidth: 42,
            data: players.map((p) => p.recent_win_rate),
            itemStyle: {
              color: barGradient,
              borderRadius: [8, 8, 2, 2],
            },
            label: {
              show: true,
              position: "top",
              distance: 8,
              color: palette.ink,
              textBorderColor: palette.paper2,
              textBorderWidth: 3,
              fontFamily: palette.fontMono,
              fontSize: 12,
              fontWeight: 500,
              formatter: (params: unknown) => {
                const v = (params as { value?: number })?.value;
                return typeof v === "number" ? `${v.toFixed(1)}%` : "";
              },
            },
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: {
                color: palette.muted,
                type: "dashed",
                width: 1.2,
                opacity: 0.65,
              },
              label: {
                color: palette.muted,
                fontSize: 11,
                fontFamily: palette.fontMono,
                formatter: "基线 16.7%",
                position: "end",
                distance: 8,
              },
              data: [{ yAxis: Number(WIN_RATE_BASELINE.toFixed(2)) }],
            },
          },
          {
            name: "生涯吃鸡率",
            type: "line",
            smooth: 0.35,
            symbol: "circle",
            symbolSize: 9,
            z: 6,
            data: players.map((p) => p.win_rate),
            lineStyle: {
              color: palette.success,
              width: 2.5,
              type: "dashed",
            },
            itemStyle: {
              color: palette.paper2,
              borderColor: palette.success,
              borderWidth: 2.5,
            },
          },
        ],
      };
    },
    [data],
  );

  // 2. 左下主图：版本强势棋手 Top 10 横向渐变排行图
  const buildTopLordsOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      const list = [...rankedLords].reverse();
      const isWinMode = lordMode === "win_rate";
      const mainGradient = new echarts.graphic.LinearGradient(0, 0, 1, 0, [
        { offset: 0, color: palette.accentSoft },
        { offset: 1, color: palette.accent },
      ]);
      const secondaryGradient = new echarts.graphic.LinearGradient(0, 0, 1, 0, [
        { offset: 0, color: palette.successSoft },
        { offset: 1, color: palette.success },
      ]);

      return {
        animationDuration: 420,
        grid: { top: 14, right: 78, bottom: 26, left: 74 },
        tooltip: {
          trigger: "axis",
          confine: true,
          axisPointer: { type: "shadow", shadowStyle: { color: palette.accentSoft, opacity: 0.3 } },
          backgroundColor: palette.paper2,
          borderColor: palette.rule,
          borderWidth: 1,
          padding: [10, 14],
          textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
          formatter: (params: unknown) => {
            const first = Array.isArray(params) ? params[0] : params;
            const idx = (first as { dataIndex?: number } | undefined)?.dataIndex ?? -1;
            const item = list[idx];
            if (!item) return "";
            return [
              `<div style="font-weight:600;font-size:13px;margin-bottom:5px;">${item.lord}</div>`,
              `<div>吃鸡率：<b style="color:${palette.accent};">${item.win_rate.toFixed(2)}%</b>（${item.wins} 鸡）</div>`,
              `<div>前三率：<b style="color:${palette.success};">${item.top3_rate.toFixed(2)}%</b></div>`,
              `<div>总出场：<b>${item.matches}</b> 场 · 均名 ${item.avg_place.toFixed(2)}</div>`,
              `<div style="margin-top:4px;font-size:11px;color:${palette.muted};">点击柱条查看棋手详情</div>`,
            ].join("");
          },
        },
        xAxis: {
          type: "value",
          axisLabel: {
            color: palette.muted,
            fontFamily: palette.fontMono,
            fontSize: 11,
            formatter: isWinMode ? "{value}%" : "{value}",
          },
          splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
        },
        yAxis: {
          type: "category",
          data: list.map((item) => item.lord),
          axisLabel: {
            color: palette.ink,
            fontFamily: palette.fontBody,
            fontSize: 12,
            margin: 12,
          },
          axisLine: { lineStyle: { color: palette.rule } },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barMaxWidth: 18,
            data: list.map((item, idx) => ({
              value: isWinMode ? item.win_rate : item.matches,
              itemStyle: {
                color: idx === list.length - 1 ? mainGradient : secondaryGradient,
                borderRadius: [0, 7, 7, 0],
              },
            })),
            label: {
              show: true,
              position: "right",
              distance: 8,
              color: palette.ink2,
              fontFamily: palette.fontMono,
              fontSize: 11,
              formatter: (params: unknown) => {
                const idx = (params as { dataIndex?: number })?.dataIndex ?? -1;
                const item = list[idx];
                if (!item) return "";
                return isWinMode
                  ? `${item.win_rate.toFixed(1)}% · ${item.matches}场`
                  : `${item.matches}场 · ${item.win_rate.toFixed(1)}%`;
              },
            },
            ...(isWinMode
              ? {
                  markLine: {
                    silent: true,
                    symbol: "none",
                    lineStyle: {
                      color: palette.muted,
                      type: "dashed",
                      width: 1,
                      opacity: 0.6,
                    },
                    label: {
                      color: palette.muted,
                      fontSize: 10,
                      fontFamily: palette.fontMono,
                      formatter: "16.7%",
                      position: "start",
                    },
                    data: [{ xAxis: Number(WIN_RATE_BASELINE.toFixed(2)) }],
                  },
                }
              : {}),
          },
        ],
      };
    },
    [rankedLords, lordMode],
  );

  // 3. 右下主图：大尺寸禁用阵营环形图
  const buildFactionDonutOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      const items = factionStats.items;
      return {
        animationDuration: 460,
        tooltip: {
          trigger: "item",
          confine: true,
          backgroundColor: palette.paper2,
          borderColor: palette.rule,
          borderWidth: 1,
          padding: [10, 14],
          textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
          formatter: (params: unknown) => {
            const p = params as { name?: string; value?: number; percent?: number };
            if (!p?.name) return "";
            return [
              `<div style="font-weight:600;font-size:13px;">禁用：${p.name}</div>`,
              `<div style="margin-top:4px;">出现：<b>${p.value}</b> 场（${p.percent}%）</div>`,
              `<div style="font-size:11px;color:${palette.muted};margin-top:3px;">点击扇区筛选该阵营对局</div>`,
            ].join("");
          },
        },
        series: [
          {
            name: "禁用阵营",
            type: "pie",
            radius: ["56%", "82%"],
            center: ["50%", "50%"],
            padAngle: 2,
            avoidLabelOverlap: true,
            color: palette.series,
            itemStyle: {
              borderRadius: 8,
              borderColor: palette.paper2,
              borderWidth: 2,
            },
            label: { show: false },
            emphasis: {
              scale: true,
              scaleSize: 6,
            },
            data: items.map((item) => ({
              name: item.faction,
              value: item.matches,
            })),
          },
        ],
      };
    },
    [factionStats.items],
  );

  const handleHotPlayerClick = useCallback(
    (params: ECElementEvent) => {
      if (params.name) onSelectPlayer(params.name);
    },
    [onSelectPlayer],
  );

  const handleLordClick = useCallback(
    (params: ECElementEvent) => {
      if (params.name) onSelectLord(params.name);
    },
    [onSelectLord],
  );

  const handleFactionClick = useCallback(
    (params: ECElementEvent) => {
      if (params.name) onBrowseFactionMatches(params.name);
    },
    [onBrowseFactionMatches],
  );

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg">数据大盘</h1>
          <p className="label hidden sm:block">万象大赛赛季总览</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {data?.overview.latest_date && (
            <span className="num hidden text-xs text-muted sm:inline">
              更新至 {data.overview.latest_date}
            </span>
          )}
          {headerExtra}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-[1440px] space-y-8 px-5 py-8 lg:px-10">
          {error ? (
            <ErrorBanner
              message={error}
              onRetry={() => setRefreshKey((key) => key + 1)}
            />
          ) : data === null ? (
            <div className="space-y-8" aria-label="加载中">
              <div className="grid grid-cols-2 gap-6 border-b border-rule pb-8 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="space-y-3">
                    <span className="skeleton block h-3.5 w-20" />
                    <span className="skeleton block h-11 w-32" />
                    <span className="skeleton block h-3 w-28" />
                  </div>
                ))}
              </div>
              <div className="well p-6">
                <span className="skeleton block h-80 w-full" />
              </div>
            </div>
          ) : (
            <>
              {/* 1. 顶部无框大号数据战报横幅（Editorial 大气排版，零套娃小盒子） */}
              <section className="grid grid-cols-2 gap-x-8 gap-y-6 border-b border-rule pb-8 lg:grid-cols-4">
                {/* 项 1：赛季总规模 */}
                <div>
                  <p className="label">已收录对局</p>
                  <p className="figure mt-2 text-4xl leading-none tracking-tight text-ink sm:text-[2.75rem]">
                    {data.overview.matches}
                    <span className="ml-1.5 text-base font-normal text-muted">场</span>
                  </p>
                  <p className="num mt-2.5 text-xs text-muted">
                    {data.overview.players} 位参赛选手 · {data.overview.lords} 位棋手
                  </p>
                </div>

                {/* 项 2：近期状态王（选手） */}
                <div className="border-rule lg:border-l lg:pl-8">
                  <p className="label">近期状态王</p>
                  {topPlayer ? (
                    <button
                      type="button"
                      onClick={() => onSelectPlayer(topPlayer.player)}
                      className="group mt-2 block w-full text-left"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="figure text-4xl leading-none tracking-tight text-accent sm:text-[2.75rem]">
                          {topPlayer.recent_win_rate.toFixed(1)}%
                        </span>
                        <span
                          className={cn(
                            "num text-xs font-medium",
                            topPlayer.recent_win_rate >= topPlayer.win_rate
                              ? "text-success"
                              : "text-muted",
                          )}
                        >
                          {formatDelta(topPlayer.recent_win_rate - topPlayer.win_rate)}
                        </span>
                      </div>
                      <p className="mt-2.5 inline-flex max-w-full items-center gap-1 text-xs text-ink-2 transition group-hover:text-accent">
                        <span className="truncate font-medium">{topPlayer.player}</span>
                        <span className="shrink-0 text-muted">
                          · 近 {topPlayer.recent_matches} 场
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      </p>
                    </button>
                  ) : (
                    <p className="figure mt-2 text-3xl text-muted">—</p>
                  )}
                </div>

                {/* 项 3：版本 T0 棋手 */}
                <div className="border-rule lg:border-l lg:pl-8">
                  <p className="label">版本领跑棋手</p>
                  {topLord ? (
                    <button
                      type="button"
                      onClick={() => onSelectLord(topLord.lord)}
                      className="group mt-2 block w-full text-left"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="figure text-4xl leading-none tracking-tight text-ink sm:text-[2.75rem]">
                          {topLord.win_rate.toFixed(1)}%
                        </span>
                        <span className="num text-xs text-success">
                          前三 {topLord.top3_rate.toFixed(1)}%
                        </span>
                      </div>
                      <p className="mt-2.5 inline-flex max-w-full items-center gap-1 text-xs text-ink-2 transition group-hover:text-accent">
                        <span className="truncate font-medium">{topLord.lord}</span>
                        <span className="shrink-0 text-muted">· {topLord.matches} 场</span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      </p>
                    </button>
                  ) : (
                    <p className="figure mt-2 text-3xl text-muted">—</p>
                  )}
                </div>

                {/* 项 4：最高禁用阵营 */}
                <div className="border-rule lg:border-l lg:pl-8">
                  <p className="label">最常被禁阵营</p>
                  {topFaction ? (
                    <button
                      type="button"
                      onClick={() => onBrowseFactionMatches(topFaction.faction)}
                      className="group mt-2 block w-full text-left"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="figure text-4xl leading-none tracking-tight text-ink sm:text-[2.75rem]">
                          {topFaction.pct.toFixed(1)}%
                        </span>
                        <span className="num text-xs text-muted">{topFaction.matches} 场</span>
                      </div>
                      <p className="mt-2.5 inline-flex max-w-full items-center gap-1 text-xs text-ink-2 transition group-hover:text-accent">
                        <span className="truncate font-medium">{topFaction.faction}</span>
                        <span className="shrink-0 text-muted">· 点击看对局</span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      </p>
                    </button>
                  ) : (
                    <p className="figure mt-2 text-3xl text-muted">—</p>
                  )}
                </div>
              </section>

              {/* 2. 中部通栏宽幅大主图：近期火热选手 Top 8（柱折混合，全宽舒展） */}
              <section className="well p-6">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="font-display text-xl text-ink">近期火热选手 Top 8</h2>
                    <p className="mt-1 text-xs text-muted">
                      渐变柱为近 8 场吃鸡率，虚线点为生涯均值；柱顶高出折线代表近期状态爆发（点击查看选手档案）
                    </p>
                  </div>
                  <div className="flex items-center gap-5 text-xs text-muted">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden="true" />
                      近 8 场吃鸡率
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-0.5 w-4 border-t-2 border-dashed border-success"
                        aria-hidden="true"
                      />
                      生涯吃鸡率
                    </span>
                  </div>
                </div>

                <EChartBox
                  buildOption={buildHotPlayersOption}
                  onItemClick={handleHotPlayerClick}
                  height={340}
                  ariaLabel="近期火热选手 Top 8 柱折混合主图"
                />
              </section>

              {/* 3. 底部双主图板块：版本强势棋手 Top 10（左 7）+ 禁用阵营大环图（右 5） */}
              <div className="grid gap-6 lg:grid-cols-12">
                <section className="well p-6 lg:col-span-7">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-xl text-ink">版本强势棋手 Top 10</h2>
                      <p className="mt-1 text-xs text-muted">
                        出场 ≥ 5 场 · 点击任意棋手横条查看详情
                      </p>
                    </div>
                    <div
                      role="group"
                      aria-label="切换棋手排行维度"
                      className="inline-flex rounded-pill border border-rule bg-paper p-0.5 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => setLordMode("win_rate")}
                        className={cn(
                          "rounded-pill px-3.5 py-1 font-medium transition",
                          lordMode === "win_rate"
                            ? "bg-paper-3 text-ink"
                            : "text-muted hover:text-ink-2",
                        )}
                      >
                        按吃鸡率
                      </button>
                      <button
                        type="button"
                        onClick={() => setLordMode("matches")}
                        className={cn(
                          "rounded-pill px-3.5 py-1 font-medium transition",
                          lordMode === "matches"
                            ? "bg-paper-3 text-ink"
                            : "text-muted hover:text-ink-2",
                        )}
                      >
                        按出场热度
                      </button>
                    </div>
                  </div>

                  <EChartBox
                    buildOption={buildTopLordsOption}
                    onItemClick={handleLordClick}
                    height={360}
                    ariaLabel="版本强势棋手 Top 10 横向排行图"
                  />
                </section>

                <section className="well flex flex-col justify-between p-6 lg:col-span-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <h2 className="font-display text-xl text-ink">禁用阵营生态</h2>
                      <p className="mt-1 text-xs text-muted">点击扇区或图例直达该阵营对局</p>
                    </div>
                    <span className="num text-xs text-muted">{factionStats.total} 场</span>
                  </div>

                  <div className="relative mx-auto my-4 w-full max-w-[260px]">
                    <EChartBox
                      buildOption={buildFactionDonutOption}
                      onItemClick={handleFactionClick}
                      height={230}
                      ariaLabel="禁用阵营占比大环图"
                    />
                    {topFaction && (
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-xs text-muted">最高 Ban 率</span>
                        <span className="mt-0.5 text-lg font-semibold text-ink">
                          {topFaction.faction}
                        </span>
                        <span className="num font-mono text-sm font-semibold text-accent">
                          {topFaction.pct.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 精简两列点击图例（无冗余进度条堆砌） */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-rule pt-4">
                    {factionStats.items.map((item, index) => (
                      <button
                        key={item.faction}
                        type="button"
                        onClick={() => onBrowseFactionMatches(item.faction)}
                        className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-xs transition hover:bg-paper"
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "h-2.5 w-2.5 shrink-0 rounded-pill",
                              FACTION_DOT_CLASSES[index % FACTION_DOT_CLASSES.length],
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate font-medium text-ink-2 group-hover:text-ink">
                            {item.faction}
                          </span>
                        </span>
                        <span className="num shrink-0 text-muted">
                          {item.pct.toFixed(1)}%
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
