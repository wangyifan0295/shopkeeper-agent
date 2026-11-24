/**
 * 主题风格下拉切换组件
 * 固定置于页面右上角：收起态为双色圆点 + 当前主题名 + 下拉箭头，
 * 点击展开 4 套配色（余烬 / 弈局 / 战术 / 手账），支持点击外部与 Esc 关闭。
 */
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { THEMES, type ThemeId } from "../hooks/useTheme";
import { cn } from "../lib/format";

type ThemeSwitcherProps = {
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
  className?: string;
};

export function ThemeSwitcher({ theme, onChange, className }: ThemeSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const current = THEMES.find((item) => item.id === theme) ?? THEMES[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative shrink-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`切换颜色主题，当前为${current.label}`}
        title={`当前主题：${current.label}（点击切换）`}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-well border border-rule bg-paper-2 px-2.5 text-xs font-medium text-ink transition hover:bg-paper-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          open && "border-accent bg-paper-3",
        )}
      >
        <span
          aria-hidden="true"
          className="relative h-3.5 w-3.5 shrink-0 overflow-hidden rounded-pill border border-rule"
          style={{ background: current.swatchBg }}
        >
          <span
            className="absolute bottom-0 right-0 h-2 w-2 rounded-tl-full"
            style={{ background: current.swatchAccent }}
          />
        </span>
        <span>{current.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted transition-transform",
            open && "rotate-180 text-ink",
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="颜色主题列表"
          className="absolute right-0 top-full z-[300] mt-2 w-56 rounded-well border border-rule bg-paper-2 p-1.5 shadow-card"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-xs text-muted">切换颜色主题</p>
          <div className="space-y-0.5">
            {THEMES.map((item) => {
              const active = item.id === theme;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition",
                    active
                      ? "bg-paper-3 text-ink"
                      : "text-ink-2 hover:bg-paper-3 hover:text-ink",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="relative h-4 w-4 shrink-0 overflow-hidden rounded-pill border border-rule"
                    style={{ background: item.swatchBg }}
                  >
                    <span
                      className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-tl-full"
                      style={{ background: item.swatchAccent }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium leading-tight">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted">
                      {item.description}
                    </span>
                  </span>
                  {active && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
