/**
 * 胜率数字组件
 * 统一渲染吃鸡率：正文面等宽表格数字，保留两位小数
 */
export function WinRate({ value }: { value: number }) {
  return <span className="figure text-base text-ink">{value.toFixed(2)}%</span>;
}
