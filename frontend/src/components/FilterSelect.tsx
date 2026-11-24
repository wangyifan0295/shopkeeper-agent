/**
 * 自定义筛选下拉组件
 * 替代原生 <select>，保持与四套工作台主题及右上角主题下拉一致的浮层质感：
 * - 激活筛选时显示强调边框与快捷清除按钮
 * - 支持选项较多时在浮层顶部内联搜索（searchable）
 * - 支持点击外部与 Esc 关闭
 */
import { Check, ChevronDown, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/format";

export type SelectOption = {
  value: string;
  label: string;
};

type FilterSelectProps = {
  value: string;
  options: SelectOption[];
  placeholder: string;
  labelPrefix?: string;
  icon?: ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  className?: string;
};

export function FilterSelect({
  value,
  options,
  placeholder,
  labelPrefix,
  icon,
  searchable = false,
  searchPlaceholder = "筛选选项…",
  ariaLabel,
  onChange,
  className,
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const hasSelection = value !== "";

  useEffect(() => {
    if (!open) {
      setKeyword("");
      return;
    }

    if (searchable) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }

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
  }, [open, searchable]);

  const visibleOptions = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [options, keyword]);

  return (
    <div ref={containerRef} className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "inline-flex h-9 items-center rounded-well border bg-paper-2 transition",
          open
            ? "border-accent bg-paper-3"
            : hasSelection
              ? "border-accent hover:bg-paper-3"
              : "border-rule hover:bg-paper-3",
        )}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            "flex h-full items-center gap-2 pl-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            hasSelection ? "pr-1.5 text-ink" : "pr-2.5 text-ink-2",
          )}
        >
          {icon && <span className="shrink-0 text-muted">{icon}</span>}
          {labelPrefix && <span className="text-xs text-muted">{labelPrefix}</span>}
          <span className={cn("max-w-32 truncate", hasSelection ? "font-medium text-ink" : "text-muted")}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {!hasSelection && (
            <ChevronDown
              className={cn(
                "ml-0.5 h-3.5 w-3.5 shrink-0 text-muted transition-transform",
                open && "rotate-180 text-ink",
              )}
              aria-hidden="true"
            />
          )}
        </button>

        {hasSelection && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="mr-1.5 flex h-6 w-6 items-center justify-center rounded-pill text-muted transition hover:bg-paper hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            title={`清除${labelPrefix ?? "筛选"}`}
            aria-label={`清除${labelPrefix ?? "筛选"}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-[300] mt-2 min-w-52 max-w-64 rounded-well border border-rule bg-paper-2 p-1.5 shadow-card sm:left-auto sm:right-0"
        >
          {searchable && (
            <div className="relative mb-1.5 border-b border-rule pb-1.5">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-8 w-full rounded-xl bg-paper pl-8 pr-2.5 text-xs text-ink outline-none ring-1 ring-inset ring-rule placeholder:text-muted focus:ring-focus"
              />
            </div>
          )}

          <div className="max-h-60 space-y-0.5 overflow-y-auto overscroll-contain">
            {!keyword.trim() && (
              <button
                type="button"
                role="option"
                aria-selected={value === ""}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition",
                  value === ""
                    ? "bg-paper-3 font-medium text-ink"
                    : "text-muted hover:bg-paper-3 hover:text-ink",
                )}
              >
                <span>{placeholder}</span>
                {value === "" && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                )}
              </button>
            )}

            {visibleOptions.length === 0 ? (
              <p className="px-2.5 py-4 text-center text-xs text-muted">没有匹配选项</p>
            ) : (
              visibleOptions.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition",
                      active
                        ? "bg-paper-3 font-medium text-ink"
                        : "text-ink-2 hover:bg-paper-3 hover:text-ink",
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {active && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
