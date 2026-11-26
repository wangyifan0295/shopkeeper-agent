/**
 * 自适应主题联动 ECharts 容器组件
 * - 采用 SVGRenderer 矢量渲染图表与标签，彻底消除 Windows 非整数缩放下的 Canvas 插值模糊
 * - 通过 MutationObserver 监听 html[data-theme] 变化，切换 5 套配色时图表实时重绘
 * - 通过 ResizeObserver 自动响应窗口、侧栏与抽屉尺寸变化
 * - 支持离屏 2x Canvas 转换 SVG Data URL 以无损导出高清 PNG
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
  downloadPng: (filename?: string) => void;
};

type EChartBoxProps = {
  buildOption: (palette: ChartPalette) => EChartsCoreOption;
  onItemClick?: (params: ECElementEvent) => void;
  className?: string;
  height?: number;
  ariaLabel?: string;
};

function triggerDownload(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

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
        backgroundColor: palette.paper2,
      });
    },
    downloadPng: (filename = `query-chart-${Date.now()}.png`) => {
      const chart = chartRef.current;
      if (!chart) return;
      const svgDataUrl = chart.getDataURL({
        backgroundColor: palette.paper2,
      });
      if (!svgDataUrl) return;
      if (svgDataUrl.startsWith("data:image/png")) {
        triggerDownload(svgDataUrl, filename);
        return;
      }

      const width = Math.max(1, chart.getWidth());
      const chartHeight = Math.max(1, chart.getHeight());
      const scale = 2;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = chartHeight * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          triggerDownload(svgDataUrl, filename.replace(/\.png$/i, ".svg"));
          return;
        }
        ctx.fillStyle = palette.paper2;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        triggerDownload(canvas.toDataURL("image/png"), filename);
      };
      img.onerror = () => {
        triggerDownload(svgDataUrl, filename.replace(/\.png$/i, ".svg"));
      };
      img.src = svgDataUrl;
    },
  }));

  // 监听 html[data-theme] 变更，动态刷新画布色板
  useEffect(() => {
    const refreshPalette = () => setPalette(readChartPalette());
    refreshPalette();

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === "data-theme")) {
        requestAnimationFrame(refreshPalette);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // 初始化 SVG 矢量渲染实例与 ResizeObserver，任意系统缩放比例下文字与数字均刀锋级锐利
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const instance = echarts.init(el, undefined, {
      renderer: "svg",
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
