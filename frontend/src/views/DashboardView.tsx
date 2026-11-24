/**
 * 数据大盘总览视图
 * 顶部 4 项核心指标 + 直观好懂的双栏交互图表：
 * 1. 禁用阵营分布（横向条形图，点击直接跳往对局记录并按阵营筛选）
 * 2. 近期火热选手 Top 8（生涯 vs 近 8 场吃鸡率对比，点击柱条弹出选手详情抽屉）
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { EChartBox } from "../components/EChartBox";
import { ErrorBanner } from "../components/ErrorBanner";
import { fetchDashboard } from "../lib/statsApi";
import type { ChartPalette, ECElementEvent, EChartsCoreOption } from "../lib/echarts";
import type { DashboardData } from "../types/stats";

type DashboardViewProps = {
  onSelectPlayer: (player: string) => void;
  onBrowseFactionMatches: (faction: string) => void;
  headerExtra?: ReactNode;
};

export function DashboardView({
  onSelectPlayer,
  onBrowseFactionMatches,
  headerExtra,
}: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchDashboard()
      .then((result) => {
        if (!cancelled) {
          setData(result);
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

  const buildFactionOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      const items = [...(data?.banned_factions ?? [])].reverse();
      return {
        animationDuration: 360,
        grid: { top: 12, right: 32, bottom: 24, left: 72 },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          backgroundColor: palette.paper2,
          borderColor: palette.rule,
          borderWidth: 1,
          textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
          formatter: (params: unknown) => {
            const first = Array.isArray(params) ? params[0] : params;
            const item = first as { name?: string; value?: number } | undefined;
            if (!item) return "";
            return `<div style="font-weight:600;">禁用：${item.name}</div><div>出现：<b>${item.value}</b> 场（点击筛选对局）</div>`;
          },
        },
        xAxis: {
          type: "value",
          minInterval: 1,
          axisLabel: { color: palette.muted, fontFamily: palette.fontMono, fontSize: 11 },
          splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
        },
        yAxis: {
          type: "category",
          data: items.map((item) => item.faction),
          axisLabel: { color: palette.ink2, fontFamily: palette.fontBody, fontSize: 12 },
          axisLine: { lineStyle: { color: palette.rule } },
        },
        series: [
          {
            type: "bar",
            barMaxWidth: 20,
            data: items.map((item) => item.matches),
            itemStyle: {
              color: palette.focus,
              borderRadius: [0, 6, 6, 0],
            },
            label: {
              show: true,
              position: "right",
              color: palette.muted,
              fontFamily: palette.fontMono,
              fontSize: 11,
            },
          },
        ],
      };
    },
    [data],
  );

  const buildHotPlayersOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      const players = data?.hot_players ?? [];
      return {
        animationDuration: 360,
        grid: { top: 34, right: 16, bottom: 44, left: 42 },
        legend: {
          top: 0,
          right: 4,
          textStyle: { color: palette.ink2, fontSize: 11 },
          itemWidth: 10,
          itemHeight: 10,
        },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          backgroundColor: palette.paper2,
          borderColor: palette.rule,
          borderWidth: 1,
          textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
        },
        xAxis: {
          type: "category",
          data: players.map((p) => p.player),
          axisLabel: {
            color: palette.ink2,
            fontFamily: palette.fontBody,
            fontSize: 11,
            interval: 0,
            rotate: players.length > 5 ? 20 : 0,
            formatter: (val: string) => (val.length > 8 ? `${val.slice(0, 7)}…` : val),
          },
          axisLine: { lineStyle: { color: palette.rule } },
        },
        yAxis: {
          type: "value",
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
            name: "近8场吃鸡率",
            type: "bar",
            barMaxWidth: 16,
            data: players.map((p) => p.recent_win_rate),
            itemStyle: { color: palette.accent, borderRadius: [4, 4, 0, 0] },
          },
          {
            name: "生涯吃鸡率",
            type: "bar",
            barMaxWidth: 16,
            data: players.map((p) => p.win_rate),
            itemStyle: { color: palette.success, borderRadius: [4, 4, 0, 0] },
          },
        ],
      };
    },
    [data],
  );

  const handleFactionClick = useCallback(
    (params: ECElementEvent) => {
      if (params.name) {
        onBrowseFactionMatches(params.name);
      }
    },
    [onBrowseFactionMatches],
  );

  const handleHotPlayerClick = useCallback(
    (params: ECElementEvent) => {
      if (params.name) {
        onSelectPlayer(params.name);
      }
    },
    [onSelectPlayer],
  );

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg">数据大盘</h1>
          <p className="label hidden sm:block">万象大赛核心概况与排行看板</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {headerExtra}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 lg:px-8">
          {error ? (
            <ErrorBanner
              message={error}
              onRetry={() => setRefreshKey((key) => key + 1)}
            />
          ) : data === null ? (
            <div className="space-y-6" aria-label="加载中">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="well space-y-2.5 p-4">
                    <span className="skeleton block h-3 w-16" />
                    <span className="skeleton block h-7 w-20" />
                  </div>
                ))}
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div key={index} className="well space-y-4 p-5">
                    <span className="skeleton block h-4 w-32" />
                    <span className="skeleton block h-72 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* 顶部 4 项轻量核心指标 */}
              <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="well px-5 py-4">
                  <dt className="label">收录对局</dt>
                  <dd className="figure mt-1.5 text-2xl text-ink">
                    {data.overview.matches} <span className="text-sm font-normal text-muted">场</span>
                  </dd>
                </div>
                <div className="well px-5 py-4">
                  <dt className="label">参赛选手</dt>
                  <dd className="figure mt-1.5 text-2xl text-ink">
                    {data.overview.players} <span className="text-sm font-normal text-muted">位</span>
                  </dd>
                </div>
                <div className="well px-5 py-4">
                  <dt className="label">可选棋手</dt>
                  <dd className="figure mt-1.5 text-2xl text-ink">
                    {data.overview.lords} <span className="text-sm font-normal text-muted">位</span>
                  </dd>
                </div>
                <div className="well px-5 py-4">
                  <dt className="label">最近更新</dt>
                  <dd className="num mt-1.5 text-xl font-medium text-accent">
                    {data.overview.latest_date ?? "—"}
                  </dd>
                </div>
              </dl>

              {/* 双栏直观图表 */}
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="well space-y-3 p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="font-display text-base text-ink">禁用阵营分布</h2>
                    <span className="text-xs text-muted">点击柱条筛选该阵营对局</span>
                  </div>
                  <EChartBox
                    buildOption={buildFactionOption}
                    onItemClick={handleFactionClick}
                    height={320}
                    ariaLabel="禁用阵营分布柱状图"
                  />
                </section>

                <section className="well space-y-3 p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="font-display text-base text-ink">近期火热选手 Top 8</h2>
                    <span className="text-xs text-muted">总场次 ≥ 5 · 点击柱条看档案</span>
                  </div>
                  <EChartBox
                    buildOption={buildHotPlayersOption}
                    onItemClick={handleHotPlayerClick}
                    height={320}
                    ariaLabel="近期火热选手对比柱状图"
                  />
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
