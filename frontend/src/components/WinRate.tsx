/**
 * 胜率数字组件
 * 统一渲染吃鸡率：等宽表格数字保留两位小数，围绕 6 人局基线（16.7%）做克制分档着色：
 * - >= 25%：强调色高亮（显著领先）
 * - >= 16.67%：主文字色（达标/高于基线）
 * - < 16.67%：次级柔和色（低于基线）
 */
import { cn } from "../lib/format";

export const WIN_RATE_BASELINE = 100 / 6;

type WinRateProps = {
  value: number;
  className?: string;
};

export function WinRate({ value, className }: WinRateProps) {
  const tone =
    value >= 25
      ? "text-accent"
      : value >= WIN_RATE_BASELINE
        ? "text-ink"
        : "text-muted";

  return (
    <span className={cn("figure text-base", tone, className)}>
      {value.toFixed(2)}%
    </span>
  );
}
