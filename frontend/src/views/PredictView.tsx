/**
 * 独立胜率预测视图
 * 面向王牌对决 6 人混战赛前模拟：
 * - 上半区：禁用阵营一键高对比切换 + 6 席位选手/棋手快速模糊搜索录入 + 历史对局一键载入复盘
 * - 下半区：3 格核心局势摘要卡 + 通栏高对比排行表 + 左右对称清晰双图 + 按需 AI 赛前点评
 */
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  History,
  RotateCcw,
  ShieldBan,
  Sparkles,
  Swords,
  Target,
  Trophy,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { EChartBox } from "../components/EChartBox";
import { ErrorBanner } from "../components/ErrorBanner";
import { FilterSelect, type SelectOption } from "../components/FilterSelect";
import { type ComboboxOption, SearchableCombobox } from "../components/SearchableCombobox";
import { WinRate } from "../components/WinRate";
import { explainPrediction, fetchPredictOptions, predictMatch } from "../lib/predictApi";
import type { ChartPalette, ECElementEvent, EChartsCoreOption } from "../lib/echarts";
import { cn } from "../lib/format";
import type {
  PredictMatchResponse,
  PredictOptionsResponse,
  PredictSeatInput,
  ReplayMatchOption,
} from "../types/predict";

type PredictViewProps = {
  onSelectPlayer: (player: string) => void;
  onSelectLord: (lord: string) => void;
  headerExtra?: ReactNode;
};

type DistributionMode = "tier" | "exact";

function createEmptySeats(): PredictSeatInput[] {
  return Array.from({ length: 6 }, (_, idx) => ({
    seat: idx + 1,
    player: "",
    lord: "",
  }));
}

/** 截断过长昵称，避免横向图 Y 轴标签挤压画布 */
function shortName(name: string, maxLen = 7): string {
  return name.length > maxLen ? `${name.slice(0, maxLen - 1)}…` : name;
}

/** 轻量渲染 AI 点评文本：支持 **加粗** 与按行分段 */
function renderCommentaryLines(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={idx} className="text-sm leading-7 text-ink-2">
          {parts.map((part, pIdx) => {
            if (part.startsWith("**") && part.endsWith("**")) {
              return (
                <strong key={pIdx} className="font-semibold text-ink">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            return <span key={pIdx}>{part}</span>;
          })}
        </p>
      );
    });
}

export function PredictView({ onSelectPlayer, onSelectLord, headerExtra }: PredictViewProps) {
  const [options, setOptions] = useState<PredictOptionsResponse | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [bannedFaction, setBannedFaction] = useState("");
  const [seats, setSeats] = useState<PredictSeatInput[]>(createEmptySeats);
  const [replayMatchId, setReplayMatchId] = useState("");
  const [actualPlaces, setActualPlaces] = useState<Record<string, number> | null>(null);

  const [predicting, setPredicting] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictMatchResponse | null>(null);

  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [commentary, setCommentary] = useState<string | null>(null);

  const [distMode, setDistMode] = useState<DistributionMode>("tier");
  const [showModelDetails, setShowModelDetails] = useState(false);

  const loadOptions = useCallback(() => {
    setLoadingOptions(true);
    setOptionsError(null);
    fetchPredictOptions()
      .then((data) => {
        setOptions(data);
      })
      .catch((err) => {
        setOptionsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoadingOptions(false);
      });
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const enabledFactions = useMemo(
    () => (options?.factions ?? []).filter((f) => f.is_enabled),
    [options],
  );

  const playerOptions = useMemo<ComboboxOption[]>(
    () =>
      (options?.players ?? []).map((p) => ({
        value: p.name,
        label: p.name,
        meta: `${p.matches}场 · 均${p.avg_place.toFixed(1)}`,
      })),
    [options],
  );

  const lordOptions = useMemo<ComboboxOption[]>(
    () =>
      (options?.lords ?? [])
        .filter((l) => l.is_enabled)
        .map((l) => ({
          value: l.name,
          label: l.name,
          meta: l.matches > 0 ? `${l.matches}场 · ${l.win_rate.toFixed(0)}%鸡` : "暂无场次",
        })),
    [options],
  );

  const replayOptions = useMemo<SelectOption[]>(
    () =>
      (options?.recent_matches ?? []).map((m) => {
        const champion = m.players.find((p) => p.place === 1);
        const banLabel = m.banned_faction ? `禁${m.banned_faction}` : "无禁";
        return {
          value: m.match_id,
          label: `${m.match_date} ${String(m.slot_hour).padStart(2, "0")}时 · ${banLabel}${champion ? ` · 冠:${champion.player}` : ""}`,
        };
      }),
    [options],
  );

  const selectedPlayersSet = useMemo(
    () => new Set(seats.map((s) => s.player.trim()).filter(Boolean)),
    [seats],
  );

  const lordCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of seats) {
      const lord = s.lord.trim();
      if (lord) counts.set(lord, (counts.get(lord) ?? 0) + 1);
    }
    return counts;
  }, [seats]);

  const readySeatsCount = useMemo(
    () => seats.filter((s) => s.player.trim() && s.lord.trim()).length,
    [seats],
  );

  const hasDuplicatePlayers = useMemo(() => {
    const filled = seats.map((s) => s.player.trim()).filter(Boolean);
    return new Set(filled).size !== filled.length;
  }, [seats]);

  const canSubmit = readySeatsCount === 6 && !hasDuplicatePlayers && !predicting;

  const updateSeat = (index: number, patch: Partial<PredictSeatInput>) => {
    setSeats((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
    setReplayMatchId("");
    setActualPlaces(null);
    setCommentary(null);
    setExplainError(null);
  };

  const runPredict = useCallback(
    async (
      targetFaction: string,
      targetSeats: PredictSeatInput[],
      keepActualPlaces: Record<string, number> | null = null,
    ) => {
      setPredicting(true);
      setPredictError(null);
      setCommentary(null);
      setExplainError(null);
      try {
        const res = await predictMatch({
          banned_faction: targetFaction,
          seats: targetSeats,
        });
        setResult(res);
        setActualPlaces(keepActualPlaces);
      } catch (err) {
        setPredictError(err instanceof Error ? err.message : String(err));
      } finally {
        setPredicting(false);
      }
    },
    [],
  );

  const handleLoadReplayMatch = (matchId: string) => {
    setReplayMatchId(matchId);
    if (!matchId) {
      setActualPlaces(null);
      return;
    }
    const found: ReplayMatchOption | undefined = options?.recent_matches.find(
      (m) => m.match_id === matchId,
    );
    if (!found) return;

    const nextSeats: PredictSeatInput[] = found.players.map((p) => ({
      seat: p.seat,
      player: p.player,
      lord: p.lord,
    }));
    const placesMap: Record<string, number> = {};
    for (const p of found.players) {
      placesMap[p.player] = p.place;
    }

    setBannedFaction(found.banned_faction);
    setSeats(nextSeats);
    void runPredict(found.banned_faction, nextSeats, placesMap);
  };

  const handleReset = () => {
    setBannedFaction("");
    setSeats(createEmptySeats());
    setReplayMatchId("");
    setActualPlaces(null);
    setResult(null);
    setPredictError(null);
    setCommentary(null);
    setExplainError(null);
  };

  const handleExplain = async () => {
    if (!canSubmit || explaining) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const res = await explainPrediction({
        banned_faction: bannedFaction,
        seats,
      });
      setCommentary(res.commentary);
      setResult(res.prediction);
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : String(err));
    } finally {
      setExplaining(false);
    }
  };

  /** 左图：横向双条对比（全 12px 清晰字号 + 高对比色，按预测排名自上而下排布） */
  const buildRatesChartOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      const rows = [...(result?.seats ?? [])].reverse();
      const maxRate = Math.max(
        60,
        Math.ceil(Math.max(...rows.map((r) => r.top3_prob), 50) / 10) * 10 + 12,
      );

      return {
        animationDuration: 360,
        grid: { top: 38, right: 56, bottom: 26, left: 92 },
        legend: {
          top: 2,
          right: 4,
          textStyle: { color: palette.ink, fontSize: 12, fontWeight: 500 },
          itemWidth: 12,
          itemHeight: 10,
          itemGap: 16,
        },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          backgroundColor: palette.paper2,
          borderColor: palette.rule,
          borderWidth: 1,
          textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 13 },
          formatter: (params: unknown) => {
            const list = Array.isArray(params) ? params : [params];
            const first = list[0] as { dataIndex?: number } | undefined;
            const seatRow = first?.dataIndex !== undefined ? rows[first.dataIndex] : undefined;
            if (!seatRow) return "";
            return [
              `<div style="font-weight:600;margin-bottom:4px;">#${seatRow.predicted_rank} ${seatRow.player}（${seatRow.lord}）</div>`,
              `<div>吃鸡率：<b>${seatRow.win_prob.toFixed(1)}%</b></div>`,
              `<div>前三率：<b>${seatRow.top3_prob.toFixed(1)}%</b></div>`,
              `<div>预期名次：<b>第 ${seatRow.expected_place.toFixed(2)} 名</b></div>`,
            ].join("");
          },
        },
        xAxis: {
          type: "value",
          max: Math.min(100, maxRate),
          axisLabel: {
            color: palette.ink2,
            fontFamily: palette.fontMono,
            fontSize: 12,
            formatter: "{value}%",
          },
          splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
        },
        yAxis: {
          type: "category",
          data: rows.map((r) => r.player),
          axisLabel: {
            color: palette.ink,
            fontFamily: palette.fontBody,
            fontSize: 13,
            fontWeight: 500,
            formatter: (val: string) => shortName(val, 7),
          },
          axisLine: { lineStyle: { color: palette.rule } },
          axisTick: { show: false },
        },
        series: [
          {
            name: "吃鸡率",
            type: "bar",
            barMaxWidth: 13,
            barGap: "30%",
            data: rows.map((r) => Number(r.win_prob.toFixed(1))),
            itemStyle: { color: palette.accent, borderRadius: [0, 6, 6, 0] },
            label: {
              show: true,
              position: "right",
              color: palette.ink,
              fontFamily: palette.fontMono,
              fontSize: 12,
              fontWeight: 600,
              formatter: "{c}%",
            },
          },
          {
            name: "前三率",
            type: "bar",
            barMaxWidth: 13,
            data: rows.map((r) => Number(r.top3_prob.toFixed(1))),
            itemStyle: { color: palette.success, borderRadius: [0, 6, 6, 0] },
            label: {
              show: true,
              position: "right",
              color: palette.ink2,
              fontFamily: palette.fontMono,
              fontSize: 12,
              fontWeight: 500,
              formatter: "{c}%",
            },
          },
        ],
      };
    },
    [result],
  );

  /** 右图：名次区间概率构成（三段高对比语义色 + 清晰 12px 内部数字） */
  const buildDistributionChartOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      const rows = [...(result?.seats ?? [])].reverse();

      const series =
        distMode === "tier"
          ? [
              {
                name: "夺冠 (第1)",
                type: "bar",
                stack: "tier",
                barMaxWidth: 22,
                data: rows.map((r) => Number((r.place_probs[0] ?? 0).toFixed(1))),
                itemStyle: { color: palette.accent, borderRadius: [5, 0, 0, 5] },
                label: {
                  show: true,
                  position: "inside",
                  color: palette.accentInk,
                  fontFamily: palette.fontMono,
                  fontSize: 12,
                  fontWeight: 700,
                  formatter: (p: { value?: unknown }) => {
                    const v = Number(p.value ?? 0);
                    return v >= 14 ? `${v.toFixed(0)}%` : "";
                  },
                },
              },
              {
                name: "上分 (第2-3)",
                type: "bar",
                stack: "tier",
                barMaxWidth: 22,
                data: rows.map((r) =>
                  Number(((r.place_probs[1] ?? 0) + (r.place_probs[2] ?? 0)).toFixed(1)),
                ),
                itemStyle: { color: palette.success },
                label: {
                  show: true,
                  position: "inside",
                  color: palette.accentInk,
                  fontFamily: palette.fontMono,
                  fontSize: 12,
                  fontWeight: 700,
                  formatter: (p: { value?: unknown }) => {
                    const v = Number(p.value ?? 0);
                    return v >= 14 ? `${v.toFixed(0)}%` : "";
                  },
                },
              },
              {
                name: "下半区 (第4-6)",
                type: "bar",
                stack: "tier",
                barMaxWidth: 22,
                data: rows.map((r) =>
                  Number(
                    (
                      (r.place_probs[3] ?? 0) +
                      (r.place_probs[4] ?? 0) +
                      (r.place_probs[5] ?? 0)
                    ).toFixed(1),
                  ),
                ),
                itemStyle: { color: palette.paper3, borderRadius: [0, 5, 5, 0] },
                label: {
                  show: true,
                  position: "inside",
                  color: palette.ink,
                  fontFamily: palette.fontMono,
                  fontSize: 12,
                  fontWeight: 500,
                  formatter: (p: { value?: unknown }) => {
                    const v = Number(p.value ?? 0);
                    return v >= 16 ? `${v.toFixed(0)}%` : "";
                  },
                },
              },
            ]
          : [
              { name: "第1名", color: palette.accent },
              { name: "第2名", color: palette.success },
              { name: "第3名", color: palette.focus },
              { name: "第4名", color: palette.ink2 },
              { name: "第5名", color: palette.muted },
              { name: "第6名", color: palette.paper3 },
            ].map((meta, rankIdx) => ({
              name: meta.name,
              type: "bar",
              stack: "exact",
              barMaxWidth: 22,
              data: rows.map((r) => Number((r.place_probs[rankIdx] ?? 0).toFixed(1))),
              itemStyle: {
                color: meta.color,
                borderRadius:
                  rankIdx === 0 ? [5, 0, 0, 5] : rankIdx === 5 ? [0, 5, 5, 0] : [0, 0, 0, 0],
              },
            }));

      return {
        animationDuration: 360,
        grid: { top: 38, right: 20, bottom: 26, left: 92 },
        legend: {
          top: 2,
          right: 4,
          textStyle: { color: palette.ink, fontSize: 12, fontWeight: 500 },
          itemWidth: 12,
          itemHeight: 10,
          itemGap: 14,
        },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          backgroundColor: palette.paper2,
          borderColor: palette.rule,
          borderWidth: 1,
          textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 13 },
          formatter: (params: unknown) => {
            const list = Array.isArray(params) ? params : [params];
            const first = list[0] as { dataIndex?: number } | undefined;
            const seatRow = first?.dataIndex !== undefined ? rows[first.dataIndex] : undefined;
            if (!seatRow) return "";
            const p = seatRow.place_probs;
            return [
              `<div style="font-weight:600;margin-bottom:4px;">${seatRow.player}（${seatRow.lord}）</div>`,
              `<div>第1名：<b>${p[0]}%</b> ｜ 第2名：${p[1]}% ｜ 第3名：${p[2]}%</div>`,
              `<div>第4名：${p[3]}% ｜ 第5名：${p[4]}% ｜ 第6名：${p[5]}%</div>`,
            ].join("");
          },
        },
        xAxis: {
          type: "value",
          max: 100,
          axisLabel: {
            color: palette.ink2,
            fontFamily: palette.fontMono,
            fontSize: 12,
            formatter: "{value}%",
          },
          splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
        },
        yAxis: {
          type: "category",
          data: rows.map((r) => r.player),
          axisLabel: {
            color: palette.ink,
            fontFamily: palette.fontBody,
            fontSize: 13,
            fontWeight: 500,
            formatter: (val: string) => shortName(val, 7),
          },
          axisLine: { lineStyle: { color: palette.rule } },
          axisTick: { show: false },
        },
        series,
      };
    },
    [result, distMode],
  );

  const handleChartClick = useCallback(
    (params: ECElementEvent) => {
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) return;
      const seatRow = result?.seats.find((s) => s.player === name);
      if (seatRow && !seatRow.context.is_new_player) {
        onSelectPlayer(name);
      }
    },
    [result, onSelectPlayer],
  );

  const modelSummary = result?.model_summary ?? options?.model_summary ?? null;
  const topCandidate = result?.seats[0] ?? null;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg text-ink">AI 胜率预测</h1>
          <p className="label hidden sm:block">
            本地 OpenSkill + Plackett-Luce 模型推演 · 毫秒级预测 6 人吃鸡率与前三率
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {modelSummary && (
            <div className="hidden items-center gap-2 rounded-pill border border-rule bg-paper-2 px-3 py-1 text-xs text-ink-2 md:flex">
              <Target className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span>
                基于 <strong className="num text-ink">{modelSummary.total_matches}</strong> 场拟合
              </span>
              <span className="text-muted">·</span>
              <span>
                回测前2命中{" "}
                <strong className="num text-ink">
                  {modelSummary.backtest.top2_hit_rate.toFixed(1)}%
                </strong>
              </span>
            </div>
          )}
          {headerExtra}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
          {optionsError && (
            <ErrorBanner message={`加载选人数据失败：${optionsError}`} onRetry={loadOptions} />
          )}

          {/* 上半区：赛前 BP 与 6 席位录入 */}
          <section className="well p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                  <ShieldBan className="h-4 w-4 text-muted" aria-hidden="true" />
                  禁用阵营
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setBannedFaction("");
                    setReplayMatchId("");
                    setActualPlaces(null);
                    setCommentary(null);
                  }}
                  className={cn(
                    "rounded-pill border px-3.5 py-1.5 text-xs font-medium transition",
                    bannedFaction === ""
                      ? "border-accent bg-accent font-semibold text-accent-ink"
                      : "border-rule bg-paper text-ink-2 hover:bg-paper-3 hover:text-ink",
                  )}
                >
                  无禁用
                </button>
                {enabledFactions.map((faction) => {
                  const active = bannedFaction === faction.name;
                  return (
                    <button
                      key={faction.name}
                      type="button"
                      onClick={() => {
                        setBannedFaction(faction.name);
                        setReplayMatchId("");
                        setActualPlaces(null);
                        setCommentary(null);
                      }}
                      className={cn(
                        "rounded-pill border px-3.5 py-1.5 text-xs font-medium transition",
                        active
                          ? "border-accent bg-accent font-semibold text-accent-ink"
                          : "border-rule bg-paper text-ink-2 hover:bg-paper-3 hover:text-ink",
                      )}
                    >
                      {faction.name}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {replayOptions.length > 0 && (
                  <FilterSelect
                    value={replayMatchId}
                    options={replayOptions}
                    placeholder="导入历史对局复盘"
                    icon={<History className="h-3.5 w-3.5" aria-hidden="true" />}
                    searchable
                    searchPlaceholder="按日期/冠军搜索历史局…"
                    ariaLabel="导入历史对局复盘"
                    onChange={handleLoadReplayMatch}
                  />
                )}
                <button
                  type="button"
                  onClick={handleReset}
                  className="btn btn-quiet h-9 px-3.5 text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  清空
                </button>
              </div>
            </div>

            {loadingOptions ? (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="skeleton h-20 w-full" />
                ))}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
                {seats.map((seatItem, idx) => {
                  const mirrorCount = seatItem.lord ? (lordCountMap.get(seatItem.lord) ?? 0) : 0;
                  const isKnownPlayer = Boolean(
                    seatItem.player &&
                      options?.players.some((p) => p.name === seatItem.player.trim()),
                  );
                  return (
                    <div
                      key={seatItem.seat}
                      className="flex flex-col gap-2.5 rounded-well border border-rule bg-paper p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="num inline-flex h-6 w-6 items-center justify-center rounded-pill bg-paper-3 text-xs font-semibold text-ink">
                            {seatItem.seat}
                          </span>
                          <span className="text-xs font-medium text-ink-2">
                            {seatItem.seat} 号位
                          </span>
                          {seatItem.player && !isKnownPlayer && (
                            <span className="pill-tag">新选手 · 默认先验</span>
                          )}
                        </div>
                        {mirrorCount >= 2 && (
                          <span className="chip-accent">撞棋手 ×{mirrorCount}</span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <SearchableCombobox
                          value={seatItem.player}
                          options={playerOptions}
                          placeholder="搜索或输入选手名…"
                          ariaLabel={`${seatItem.seat}号位选手`}
                          disabledValues={selectedPlayersSet}
                          allowCustom
                          onChange={(val) => updateSeat(idx, { player: val })}
                        />
                        <SearchableCombobox
                          value={seatItem.lord}
                          options={lordOptions}
                          placeholder="选择棋手…"
                          ariaLabel={`${seatItem.seat}号位棋手`}
                          onChange={(val) => updateSeat(idx, { lord: val })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
              <div className="text-sm text-ink-2">
                {hasDuplicatePlayers ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-error">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    存在重复选手，请确保 6 个席位为不同选手
                  </span>
                ) : readySeatsCount === 6 ? (
                  <span>
                    已就绪 <strong className="num font-semibold text-ink">6 / 6</strong>{" "}
                    席位 · 本地数学模型毫秒级出结果
                  </span>
                ) : (
                  <span>
                    已录入 <strong className="num font-semibold text-ink">{readySeatsCount} / 6</strong>{" "}
                    席位（支持打字秒搜库内选手，同局允许重复选棋手）
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void runPredict(bannedFaction, seats, actualPlaces)}
                className="btn btn-primary px-6"
              >
                <Target className="h-4 w-4" aria-hidden="true" />
                {predicting ? "正在推演…" : "开始预测胜率"}
              </button>
            </div>
          </section>

          {predictError && <ErrorBanner message={predictError} />}

          {/* 下半区：3 格洞察摘要卡 + 通栏高对比排行表 + 左右对称双图 + 模型透明回测 */}
          {result && (
            <section className="space-y-6">
              {/* 1. 三格局势摘要卡 */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="well-accent flex items-center gap-3.5 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-well bg-accent text-accent-ink">
                    <Trophy className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink-2">
                      头号夺冠热门{actualPlaces ? " · 复盘模式" : ""}
                    </p>
                    {topCandidate && (
                      <>
                        <p className="mt-0.5 truncate text-base font-semibold text-ink">
                          {topCandidate.player}
                          <span className="ml-1.5 text-sm font-normal text-ink-2">
                            ({topCandidate.lord})
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-ink-2">
                          吃鸡{" "}
                          <strong className="num text-accent">
                            {topCandidate.win_prob.toFixed(1)}%
                          </strong>{" "}
                          · 前三{" "}
                          <strong className="num text-ink">
                            {topCandidate.top3_prob.toFixed(1)}%
                          </strong>{" "}
                          · 均名{" "}
                          <strong className="num text-ink">
                            {topCandidate.expected_place.toFixed(2)}
                          </strong>
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <div className="well flex items-center gap-3.5 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-well bg-paper-3 text-ink">
                    <Swords className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink-2">本局环境与同行冲突</p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">
                      {result.banned_faction ? `禁用阵营：${result.banned_faction}` : "本局无禁用阵营"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {result.mirror_groups.length > 0 ? (
                        result.mirror_groups.map((g) => (
                          <span key={g.lord} className="chip-accent">
                            撞棋手：{g.lord} ×{g.count}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-ink-2">6 家棋手互不重复，无同行内卷</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="well flex flex-col justify-between gap-2.5 p-4">
                  <div>
                    <p className="text-xs font-medium text-ink-2">大模型赛前解说（按需触发）</p>
                    <p className="mt-0.5 text-xs text-muted">
                      基于模型量化归因生成 3 段局势看点与黑马提示
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={explaining || !canSubmit}
                    onClick={() => void handleExplain()}
                    className="btn btn-quiet w-full justify-center text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    {explaining
                      ? "AI 点评生成中…"
                      : commentary
                        ? "重新生成 AI 赛前点评"
                        : "生成 AI 赛前点评"}
                  </button>
                </div>
              </div>

              {explainError && <ErrorBanner message={explainError} />}

              {commentary && (
                <div className="well-accent p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
                      AI 赛前点评
                    </div>
                    <button
                      type="button"
                      onClick={() => setCommentary(null)}
                      className="text-xs font-medium text-ink-2 hover:text-ink"
                    >
                      收起
                    </button>
                  </div>
                  <div className="space-y-2">{renderCommentaryLines(commentary)}</div>
                </div>
              )}

              {/* 2. 通栏 6 人量化排行表（高对比排版） */}
              <div className="well overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3.5">
                  <h2 className="font-display text-base text-ink">6 人胜率预测排行</h2>
                  <span className="text-xs text-ink-2">
                    点击选手或棋手可查看历史详情 · 吃鸡率之和 100% / 前三率之和 300%
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-16 text-center">预测</th>
                        <th>选手 / 棋手</th>
                        <th className="text-center">吃鸡率</th>
                        <th className="text-center">前三率</th>
                        <th className="text-center">预期名次</th>
                        <th>核心归因（相对同桌均值）</th>
                        {actualPlaces && <th className="text-center">实际赛果</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {result.seats.map((row) => {
                        const actualPlace = actualPlaces?.[row.player];
                        const significantFactors = [...row.factors]
                          .filter((f) => Math.abs(f.impact) >= 0.025)
                          .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
                          .slice(0, 3);

                        return (
                          <tr
                            key={`${row.seat}-${row.player}`}
                            className="transition hover:bg-paper-3"
                          >
                            <td className="cell-num">
                              <span
                                className={cn(
                                  "num inline-flex h-7 w-7 items-center justify-center rounded-pill text-xs font-bold",
                                  row.predicted_rank === 1
                                    ? "bg-accent text-accent-ink"
                                    : row.predicted_rank <= 3
                                      ? "bg-paper-3 text-ink"
                                      : "border border-rule bg-paper text-ink-2",
                                )}
                              >
                                {row.predicted_rank}
                              </span>
                            </td>

                            <td>
                              <div className="flex flex-wrap items-center gap-2">
                                {row.context.is_new_player ? (
                                  <span className="text-sm font-semibold text-ink">
                                    {row.player}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => onSelectPlayer(row.player)}
                                    className="text-sm font-semibold text-ink underline-offset-2 hover:text-accent hover:underline"
                                  >
                                    {row.player}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onSelectLord(row.lord)}
                                  className="pill-tag font-medium text-ink hover:border-accent"
                                >
                                  {row.lord}
                                </button>
                                <span className="text-xs text-ink-2">{row.seat}号位</span>
                                {row.context.is_new_player && (
                                  <span className="pill-tag">新选手</span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-ink-2">
                                {row.context.is_new_player
                                  ? "库中暂无历史对局，按默认实力先验估算"
                                  : `天梯 ${row.context.player_mu.toFixed(1)} · 历史 ${row.context.player_matches} 场（均第 ${row.context.player_avg_place ?? "-"} 名）${
                                      row.context.player_lord_matches > 0
                                        ? ` · 用${row.lord} ${row.context.player_lord_matches} 场 ${row.context.player_lord_wins} 鸡`
                                        : ""
                                    }`}
                              </p>
                            </td>

                            <td className="cell-num">
                              <WinRate value={row.win_prob} className="font-semibold" />
                            </td>

                            <td className="cell-num">
                              <span className="figure text-sm font-medium text-ink">
                                {row.top3_prob.toFixed(1)}%
                              </span>
                            </td>

                            <td className="cell-num">
                              <span className="figure text-sm text-ink-2">
                                第 {row.expected_place.toFixed(2)} 名
                              </span>
                            </td>

                            <td>
                              {significantFactors.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {significantFactors.map((factor) => {
                                    const positive = factor.impact > 0;
                                    return (
                                      <span
                                        key={factor.key}
                                        className={cn(
                                          "num",
                                          positive ? "chip-positive" : "chip-negative",
                                        )}
                                      >
                                        {factor.label} {positive ? "+" : ""}
                                        {factor.impact.toFixed(2)}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-xs text-ink-2">各项接近本局均值</span>
                              )}
                            </td>

                            {actualPlaces && (
                              <td className="cell-num">
                                {actualPlace !== undefined ? (
                                  <span
                                    className={cn(
                                      "num",
                                      actualPlace === 1
                                        ? "chip-accent"
                                        : actualPlace <= 3
                                          ? "chip-positive"
                                          : "pill-tag",
                                    )}
                                  >
                                    第 {actualPlace} 名
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. 左右对称双图（与数据大盘风格完全统一） */}
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="well space-y-3 p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="font-display text-base text-ink">吃鸡率与前三率对比</h2>
                    <span className="text-xs text-ink-2">按预测名次排序 · 点击看选手档案</span>
                  </div>
                  <EChartBox
                    buildOption={buildRatesChartOption}
                    onItemClick={handleChartClick}
                    height={320}
                    ariaLabel="6 人吃鸡率与前三率横向对比图"
                  />
                </section>

                <section className="well space-y-3 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-base text-ink">名次区间概率构成</h2>
                    <div className="inline-flex rounded-pill border border-rule bg-paper p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setDistMode("tier")}
                        className={cn(
                          "rounded-pill px-3 py-1 font-medium transition",
                          distMode === "tier"
                            ? "bg-accent text-accent-ink"
                            : "text-ink-2 hover:text-ink",
                        )}
                      >
                        三段概览
                      </button>
                      <button
                        type="button"
                        onClick={() => setDistMode("exact")}
                        className={cn(
                          "rounded-pill px-3 py-1 font-medium transition",
                          distMode === "exact"
                            ? "bg-accent text-accent-ink"
                            : "text-ink-2 hover:text-ink",
                        )}
                      >
                        1~6名明细
                      </button>
                    </div>
                  </div>
                  <EChartBox
                    buildOption={buildDistributionChartOption}
                    onItemClick={handleChartClick}
                    height={320}
                    ariaLabel="6 人名次区间概率分布图"
                  />
                </section>
              </div>

              {/* 4. 底部模型透明与离线回测面板 */}
              {modelSummary && (
                <div className="well overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowModelDetails((prev) => !prev)}
                    className="flex w-full items-center justify-between px-5 py-3.5 text-left text-xs text-ink-2 transition hover:bg-paper-3"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-ink">模型透明与历史回测报告</strong>
                      <span className="text-ink-2">
                        最近 {modelSummary.backtest.eval_matches} 场样本外回测：吃鸡 LogLoss{" "}
                        <strong className="num text-ink">
                          {modelSummary.backtest.win_logloss}
                        </strong>
                        （随机基线 {modelSummary.backtest.baseline_logloss}，提升{" "}
                        <strong className="num text-success">
                          {modelSummary.backtest.logloss_gain_pct >= 0 ? "+" : ""}
                          {modelSummary.backtest.logloss_gain_pct}%
                        </strong>
                        ）
                      </span>
                    </span>
                    {showModelDetails ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
                    )}
                  </button>

                  {showModelDetails && (
                    <div className="space-y-4 border-t border-rule px-5 py-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-well border border-rule bg-paper p-3.5">
                          <div className="text-xs text-ink-2">样本外回测场次</div>
                          <div className="figure mt-1 text-lg text-ink">
                            {modelSummary.backtest.eval_matches} 场
                          </div>
                        </div>
                        <div className="rounded-well border border-rule bg-paper p-3.5">
                          <div className="text-xs text-ink-2">头号热门吃鸡命中</div>
                          <div className="figure mt-1 text-lg text-ink">
                            {modelSummary.backtest.top1_hit_rate.toFixed(1)}%
                          </div>
                          <div className="mt-0.5 text-xs text-muted">随机基线 16.7%</div>
                        </div>
                        <div className="rounded-well border border-rule bg-paper p-3.5">
                          <div className="text-xs text-ink-2">前二热门覆盖冠军</div>
                          <div className="figure mt-1 text-lg text-ink">
                            {modelSummary.backtest.top2_hit_rate.toFixed(1)}%
                          </div>
                          <div className="mt-0.5 text-xs text-muted">随机基线 33.3%</div>
                        </div>
                        <div className="rounded-well border border-rule bg-paper p-3.5">
                          <div className="text-xs text-ink-2">预测前三平均命中</div>
                          <div className="figure mt-1 text-lg text-ink">
                            {modelSummary.backtest.top3_avg_overlap.toFixed(2)} / 3
                          </div>
                          <div className="mt-0.5 text-xs text-muted">随机基线 1.50 / 3</div>
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-medium text-ink-2">
                          历史对局自动拟合出的 6 维特征权重（L2={modelSummary.best_l2}）
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {modelSummary.feature_weights.map((item) => (
                            <span key={item.key} className="pill-tag num text-ink">
                              {item.label}：{item.weight >= 0 ? "+" : ""}
                              {item.weight.toFixed(3)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
