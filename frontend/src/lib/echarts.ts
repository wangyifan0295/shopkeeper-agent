/**
 * ECharts 按需引入与主题色彩解析工具
 * 仅注册本项目所需的柱状图、折线图、散点图、饼图与基础组件，控制打包体积；
 * 同时将 CSS OKLCH 令牌精确解析为 Canvas 可直接使用的 rgba(...) 颜色。
 */
import * as echarts from "echarts/core";
import {
  BarChart,
  LineChart,
  PieChart,
} from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  SVGRenderer,
]);

export { echarts };
export type { EChartsCoreOption, ECElementEvent } from "echarts/core";

export type ChartPalette = {
  paper: string;
  paper2: string;
  paper3: string;
  ink: string;
  ink2: string;
  muted: string;
  rule: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  focus: string;
  error: string;
  rank1: string;
  rank2: string;
  rank3: string;
  series: string[];
  fontBody: string;
  fontMono: string;
};

let colorCanvasCtx: CanvasRenderingContext2D | null = null;

function toRgba(cssColor: string, alphaOverride?: number): string {
  const value = cssColor.trim();
  if (!value) return "rgba(136, 136, 136, 1)";

  if (typeof document === "undefined") return value;
  if (!colorCanvasCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorCanvasCtx = canvas.getContext("2d", { willReadFrequently: true });
  }
  const ctx = colorCanvasCtx;
  if (!ctx) return value;

  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000000";
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  const alpha = alphaOverride !== undefined ? alphaOverride : Number((a / 255).toFixed(3));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 读取当前生效主题的 CSS 变量并归一化为 Canvas 安全色板 */
export function readChartPalette(): ChartPalette {
  const styles = getComputedStyle(document.documentElement);
  const getVar = (name: string) => styles.getPropertyValue(name).trim();

  const accent = toRgba(getVar("--color-accent"));
  const success = toRgba(getVar("--color-success"));
  const focus = toRgba(getVar("--color-focus"));
  const rank1 = toRgba(getVar("--color-rank-1"));
  const rank3 = toRgba(getVar("--color-rank-3"));
  const ink2 = toRgba(getVar("--color-ink-2"));

  return {
    paper: toRgba(getVar("--color-paper")),
    paper2: toRgba(getVar("--color-paper-2")),
    paper3: toRgba(getVar("--color-paper-3")),
    ink: toRgba(getVar("--color-ink")),
    ink2,
    muted: toRgba(getVar("--color-muted")),
    rule: toRgba(getVar("--color-rule")),
    accent,
    accentInk: toRgba(getVar("--color-accent-ink")),
    accentSoft: toRgba(getVar("--color-accent"), 0.16),
    success,
    successSoft: toRgba(getVar("--color-success"), 0.16),
    focus,
    error: toRgba(getVar("--color-error")),
    rank1,
    rank2: toRgba(getVar("--color-rank-2")),
    rank3,
    series: [accent, success, focus, rank1, rank3, ink2],
    fontBody: getVar("--font-body") || "sans-serif",
    fontMono: getVar("--font-outlier") || "monospace",
  };
}
