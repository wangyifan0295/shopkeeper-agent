/**
 * 查询结果表格与智能图表组件
 * 将后端返回的结构化数据归一化为可滚动表格，并在满足可视化条件时支持一键切换 ECharts 图表：
 * - 自动识别维度列与数值列（支持纯数字、千分位及百分比字符串）
 * - 日期/时间维度默认推荐折线面积图，分类维度默认推荐柱状图，并支持切换柱状 / 折线 / 饼图
 * - 支持一键导出 CSV（UTF-8 BOM）与保存图表为 PNG
 */
import {
  BarChart3,
  ChevronDown,
  Database,
  Download,
  ImageDown,
  LineChart,
  PieChart,
  Table2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { EChartBox, type EChartBoxHandle } from "./EChartBox";
import type { ChartPalette, EChartsCoreOption } from "../lib/echarts";
import { cn } from "../lib/format";

type ChartKind = "bar" | "line" | "pie";

function normalizeRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.map((item, index) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { 序号: index + 1, 值: item },
    );
  }

  if (data && typeof data === "object") {
    return [data as Record<string, unknown>];
  }

  return [{ 值: data ?? "" }];
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const NUMERIC_TEXT_RE = /^[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?$/;
const DATE_KEY_RE = /date|day|time|日期|时间|天|月|年/i;
const DATE_VAL_RE = /^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/;

function isNumericColumn(rows: Array<Record<string, unknown>>, column: string): boolean {
  let seen = 0;
  for (const row of rows) {
    const val = row[column];
    if (val === null || val === undefined || val === "") continue;
    seen += 1;
    if (typeof val === "number" && Number.isFinite(val)) continue;
    if (typeof val === "string" && NUMERIC_TEXT_RE.test(val.trim())) continue;
    return false;
  }
  return seen > 0;
}

function parseNumericValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "").replace(/%$/, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function downloadCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(","));
  const csv = `\uFEFF${[header, ...body].join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `query-result-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ResultTable({ data }: { data: unknown }) {
  const rows = useMemo(() => normalizeRows(data), [data]);
  const columns = useMemo(
    () =>
      Array.from(
        rows.reduce((keys, row) => {
          Object.keys(row).forEach((key) => keys.add(key));
          return keys;
        }, new Set<string>()),
      ),
    [rows],
  );

  const numericColumnList = useMemo(
    () => columns.filter((col) => isNumericColumn(rows, col)),
    [rows, columns],
  );
  const numericSet = useMemo(() => new Set(numericColumnList), [numericColumnList]);
  const dimensionColumns = useMemo(
    () => columns.filter((col) => !numericSet.has(col)),
    [columns, numericSet],
  );

  const labelColumn = dimensionColumns[0] ?? null;
  const metricCandidates = useMemo(() => {
    const preferred = numericColumnList.filter((col) => col !== "序号");
    return preferred.length > 0 ? preferred : numericColumnList;
  }, [numericColumnList]);

  const canVisualize =
    rows.length >= 2 && labelColumn !== null && metricCandidates.length > 0;

  const defaultChartKind: ChartKind = useMemo(() => {
    if (!labelColumn) return "bar";
    const sample = String(rows[0]?.[labelColumn] ?? "");
    if (DATE_KEY_RE.test(labelColumn) || DATE_VAL_RE.test(sample)) {
      return "line";
    }
    return "bar";
  }, [labelColumn, rows]);

  const [mode, setMode] = useState<"table" | "chart">("table");
  const [chartKind, setChartKind] = useState<ChartKind | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const chartBoxRef = useRef<EChartBoxHandle | null>(null);

  const activeKind = chartKind ?? defaultChartKind;
  const activeMetric =
    selectedMetric && metricCandidates.includes(selectedMetric)
      ? selectedMetric
      : metricCandidates[0] ?? "";

  const isPercentMetric = useMemo(() => {
    if (!activeMetric) return false;
    return rows.some((row) => String(row[activeMetric] ?? "").trim().endsWith("%"));
  }, [rows, activeMetric]);

  const chartRows = useMemo(() => rows.slice(0, 30), [rows]);

  const buildOption = useCallback(
    (palette: ChartPalette): EChartsCoreOption => {
      const labels = chartRows.map((row) => formatCell(labelColumn ? row[labelColumn] : ""));
      const values = chartRows.map((row) => parseNumericValue(row[activeMetric]));

      if (activeKind === "pie") {
        return {
          animationDuration: 340,
          tooltip: {
            trigger: "item",
            backgroundColor: palette.paper2,
            borderColor: palette.rule,
            borderWidth: 1,
            textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
            formatter: "{b}: <b>{c}</b> ({d}%)",
          },
          legend: {
            type: "scroll",
            bottom: 0,
            textStyle: { color: palette.ink2, fontSize: 11 },
          },
          series: [
            {
              name: activeMetric,
              type: "pie",
              radius: ["40%", "68%"],
              center: ["50%", "44%"],
              color: palette.series,
              itemStyle: {
                borderColor: palette.paper,
                borderWidth: 2,
              },
              label: {
                color: palette.ink2,
                fontSize: 11,
                formatter: "{b}",
              },
              data: labels.map((name, idx) => ({
                name,
                value: values[idx],
              })),
            },
          ],
        };
      }

      if (activeKind === "line") {
        return {
          animationDuration: 340,
          grid: { top: 24, right: 20, bottom: 42, left: 48 },
          tooltip: {
            trigger: "axis",
            backgroundColor: palette.paper2,
            borderColor: palette.rule,
            borderWidth: 1,
            textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
          },
          xAxis: {
            type: "category",
            boundaryGap: false,
            data: labels,
            axisLabel: {
              color: palette.muted,
              fontFamily: palette.fontBody,
              fontSize: 11,
              rotate: labels.length > 8 ? 22 : 0,
            },
            axisLine: { lineStyle: { color: palette.rule } },
          },
          yAxis: {
            type: "value",
            axisLabel: {
              color: palette.muted,
              fontFamily: palette.fontMono,
              fontSize: 11,
              formatter: isPercentMetric ? "{value}%" : "{value}",
            },
            splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
          },
          series: [
            {
              name: activeMetric,
              type: "line",
              smooth: true,
              symbol: "circle",
              symbolSize: 6,
              data: values,
              lineStyle: { color: palette.accent, width: 2.5 },
              itemStyle: { color: palette.accent, borderColor: palette.paper, borderWidth: 1.5 },
              areaStyle: { color: palette.accentSoft },
            },
          ],
        };
      }

      // 默认柱状图：维度超过 6 条且非日期时使用横向条形，标签更易读
      const horizontal = chartRows.length > 6 && !DATE_KEY_RE.test(labelColumn ?? "");
      if (horizontal) {
        const reversedLabels = [...labels].reverse();
        const reversedValues = [...values].reverse();
        return {
          animationDuration: 340,
          grid: { top: 12, right: 36, bottom: 26, left: 88 },
          tooltip: {
            trigger: "axis",
            axisPointer: { type: "shadow" },
            backgroundColor: palette.paper2,
            borderColor: palette.rule,
            borderWidth: 1,
            textStyle: { color: palette.ink, fontFamily: palette.fontBody, fontSize: 12 },
          },
          xAxis: {
            type: "value",
            axisLabel: {
              color: palette.muted,
              fontFamily: palette.fontMono,
              fontSize: 11,
              formatter: isPercentMetric ? "{value}%" : "{value}",
            },
            splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
          },
          yAxis: {
            type: "category",
            data: reversedLabels,
            axisLabel: {
              color: palette.ink2,
              fontFamily: palette.fontBody,
              fontSize: 11,
              formatter: (val: string) => (val.length > 10 ? `${val.slice(0, 9)}…` : val),
            },
            axisLine: { lineStyle: { color: palette.rule } },
          },
          series: [
            {
              name: activeMetric,
              type: "bar",
              barMaxWidth: 18,
              data: reversedValues,
              itemStyle: { color: palette.accent, borderRadius: [0, 5, 5, 0] },
            },
          ],
        };
      }

      return {
        animationDuration: 340,
        grid: { top: 24, right: 18, bottom: 42, left: 48 },
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
          data: labels,
          axisLabel: {
            color: palette.ink2,
            fontFamily: palette.fontBody,
            fontSize: 11,
            interval: 0,
            rotate: labels.length > 5 ? 20 : 0,
          },
          axisLine: { lineStyle: { color: palette.rule } },
        },
        yAxis: {
          type: "value",
          axisLabel: {
            color: palette.muted,
            fontFamily: palette.fontMono,
            fontSize: 11,
            formatter: isPercentMetric ? "{value}%" : "{value}",
          },
          splitLine: { lineStyle: { color: palette.rule, type: "dashed" } },
        },
        series: [
          {
            name: activeMetric,
            type: "bar",
            barMaxWidth: 26,
            data: values,
            itemStyle: { color: palette.accent, borderRadius: [5, 5, 0, 0] },
          },
        ],
      };
    },
    [chartRows, labelColumn, activeMetric, activeKind, isPercentMetric],
  );

  const exportChartPng = () => {
    const url = chartBoxRef.current?.getDataURL();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `query-chart-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (columns.length === 0) {
    return null;
  }

  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <Database className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          查询结果
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label num mr-1">{rows.length} 行</span>

          {canVisualize && (
            <div
              role="group"
              aria-label="切换表格或图表"
              className="inline-flex items-center rounded-pill border border-rule bg-paper-2 p-0.5"
            >
              <button
                type="button"
                onClick={() => setMode("table")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs transition",
                  mode === "table" ? "bg-paper-3 font-medium text-ink" : "text-muted hover:text-ink-2",
                )}
              >
                <Table2 className="h-3 w-3" aria-hidden="true" />
                表格
              </button>
              <button
                type="button"
                onClick={() => setMode("chart")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs transition",
                  mode === "chart" ? "bg-paper-3 font-medium text-ink" : "text-muted hover:text-ink-2",
                )}
              >
                <BarChart3 className="h-3 w-3" aria-hidden="true" />
                图表
              </button>
            </div>
          )}

          {mode === "chart" && canVisualize ? (
            <button
              type="button"
              onClick={exportChartPng}
              className="inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs text-muted transition hover:bg-paper-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              title="保存图表为 PNG 图片"
            >
              <ImageDown className="h-3 w-3" aria-hidden="true" />
              保存 PNG
            </button>
          ) : (
            <button
              type="button"
              onClick={() => downloadCsv(columns, rows)}
              className="inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs text-muted transition hover:bg-paper-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              title="导出为 CSV 文件"
            >
              <Download className="h-3 w-3" aria-hidden="true" />
              导出 CSV
            </button>
          )}
        </div>
      </div>

      {mode === "chart" && canVisualize ? (
        <div className="well space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {(
                [
                  { kind: "bar", label: "柱状图", icon: BarChart3 },
                  { kind: "line", label: "折线图", icon: LineChart },
                  { kind: "pie", label: "饼图", icon: PieChart },
                ] as const
              ).map(({ kind, label, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setChartKind(kind)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs transition",
                    activeKind === kind
                      ? "bg-paper-3 font-medium text-accent"
                      : "text-muted hover:bg-paper-3/60 hover:text-ink-2",
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            {metricCandidates.length > 1 && (
              <div className="relative">
                <select
                  aria-label="选择图表指标"
                  value={activeMetric}
                  onChange={(event) => setSelectedMetric(event.target.value)}
                  className="input h-7 min-h-0 appearance-none pr-7 text-xs"
                >
                  {metricCandidates.map((col) => (
                    <option key={col} value={col}>
                      指标：{col}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
              </div>
            )}
          </div>

          <EChartBox
            ref={chartBoxRef}
            buildOption={buildOption}
            height={activeKind === "bar" && chartRows.length > 8 ? 320 : 270}
            ariaLabel={`查询结果${activeMetric}图表`}
          />

          {rows.length > 30 && (
            <p className="text-[11px] text-muted">
              图表仅展示前 30 条记录，完整 {rows.length} 行请切换「表格」或导出 CSV 查看。
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-[360px] overflow-auto">
          <table className="data-table">
            <thead className="sticky top-0 z-10 bg-paper">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className={cn(numericSet.has(column) && "cell-num")}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="transition hover:bg-paper-2">
                  {columns.map((column) => (
                    <td
                      key={column}
                      className={cn(
                        "text-ink-2",
                        numericSet.has(column) && "cell-num",
                      )}
                    >
                      {formatCell(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
