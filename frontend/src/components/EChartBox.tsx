/**
 * 自适应主题联动 ECharts 容器组件
 * - 通过 MutationObserver 监听 html[data-theme] 变化，切换 4 套配色时图表实时重绘
 * - 通过 ResizeObserver 自动响应窗口、侧栏与抽屉尺寸变化
 * - 支持传入 option 工厂函数（注入当前主题色板）及点击/导出回调
 */
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import {
  echarts,
  readChartPalette,
  type ChartPalette,
  type ECElementEvent,
  type EChartsCoreOption,
} from "../lib/echarts";
import { cn } from "../lib/format";

export type EChartBoxHandle = {
  getDataURL: () => string | null;
};

type EChartBoxProps = {
  buildOption: (palette: ChartPalette) => EChartsCoreOption;
  onItemClick?: (params: ECElementEvent) => void;
  className?: string;
  height?: number;
  ariaLabel?: string;
};

export const EChartBox = forwardRef<EChartBoxHandle, EChartBoxProps>(function EChartBox(
  { buildOption, onItemClick, className, height = 280, ariaLabel },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickHandlerRef = useRef(onItemClick);
  const buildOptionRef = useRef(buildOption);

  clickHandlerRef.current = onItemClick;
  buildOptionRef.current = buildOption;

  const [palette, setPalette] = useState<ChartPalette>(() => readChartPalette());

  useImperativeHandle(ref, () => ({
    getDataURL: () => {
      const chart = chartRef.current;
      if (!chart) return null;
      return chart.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: palette.paper,
      });
    },
  }));

  // 监听 html[data-theme] 变更，动态刷新画布色板
  useEffect(() => {
    const refreshPalette = () => setPalette(readChartPalette());
    refreshPalette();

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === "data-theme")) {
        // 等一帧确保 CSS 变量已重算完成
        requestAnimationFrame(refreshPalette);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // 初始化实例与 ResizeObserver（强制至少 2x DPR 渲染，确保图表文字锐利不发糊）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const instance = echarts.init(el, undefined, {
      renderer: "canvas",
      devicePixelRatio: dpr,
    });
    chartRef.current = instance;

    instance.on("click", (params) => {
      clickHandlerRef.current?.(params as ECElementEvent);
    });

    const resizeObserver = new ResizeObserver(() => {
      instance.resize();
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

  // 数据或主题色板变化时更新配置（notMerge 确保图表类型切换时不残留旧系列）
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(buildOptionRef.current(palette), { notMerge: true });
  }, [palette, buildOption]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      style={{ height }}
      className={cn("w-full", className)}
    />
  );
});
