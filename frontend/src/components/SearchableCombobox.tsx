/**
 * 可搜索自动补全下拉组件
 * 面向胜率预测页的快速录人/录棋手场景：
 * - 聚焦直接展示按出场热排序的常客列表，键入关键字 0 延迟前端模糊过滤
 * - 支持键盘上下键切换、回车选中、Esc 关闭
 * - 支持禁用其他席位已选值（防重复选手）以及允许输入库外新名字（按默认先验预测）
 */
import { Check, ChevronDown, UserPlus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/format";

export type ComboboxOption = {
  value: string;
  label: string;
  meta?: string;
};

type SearchableComboboxProps = {
  value: string;
  options: ComboboxOption[];
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  disabledValues?: Set<string>;
  allowCustom?: boolean;
  customHint?: string;
  maxVisible?: number;
  className?: string;
};

export function SearchableCombobox({
  value,
  options,
  placeholder,
  ariaLabel,
  onChange,
  disabledValues,
  allowCustom = false,
  customHint = "新选手 · 默认先验",
  maxVisible = 40,
  className,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 外部重置或一键载入历史对局时同步输入框文案
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        // 失焦时若不允许自由输入，恢复为已选值
        if (!allowCustom) {
          setQuery(value);
        } else {
          const trimmed = query.trim();
          if (trimmed && (!disabledValues || !disabledValues.has(trimmed))) {
            onChange(trimmed);
          } else if (!trimmed) {
            onChange("");
          } else {
            setQuery(value);
          }
        }
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, allowCustom, value, query, disabledValues, onChange]);

  const trimmedQuery = query.trim();

  const filtered = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    // 刚打开且输入框内容就是当前选中值时，展示全量热门列表方便切换
    const effectiveQ = open && trimmedQuery === value ? "" : q;
    const matched = effectiveQ
      ? options.filter((opt) => opt.label.toLowerCase().includes(effectiveQ))
      : options;
    return matched.slice(0, maxVisible);
  }, [options, trimmedQuery, open, value, maxVisible]);

  const exactOptionExists = useMemo(
    () => options.some((opt) => opt.value === trimmedQuery),
    [options, trimmedQuery],
  );

  const canUseCustom =
    allowCustom &&
    trimmedQuery.length > 0 &&
    !exactOptionExists &&
    !(disabledValues && disabledValues.has(trimmedQuery));

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQuery, open]);

  const commitValue = (nextValue: string) => {
    onChange(nextValue);
    setQuery(nextValue);
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setQuery(value);
      inputRef.current?.blur();
      return;
    }

    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }

    const enabledOptions = filtered.filter(
      (opt) => !(disabledValues && disabledValues.has(opt.value) && opt.value !== value),
    );
    const totalSelectable = enabledOptions.length + (canUseCustom ? 1 : 0);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (totalSelectable > 0) {
        setActiveIndex((prev) => (prev + 1) % totalSelectable);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (totalSelectable > 0) {
        setActiveIndex((prev) => (prev - 1 + totalSelectable) % totalSelectable);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (canUseCustom && activeIndex === 0) {
        commitValue(trimmedQuery);
        return;
      }
      const offset = canUseCustom ? activeIndex - 1 : activeIndex;
      const target = enabledOptions[offset];
      if (target) {
        commitValue(target.value);
      } else if (canUseCustom) {
        commitValue(trimmedQuery);
      }
    }
  };

  return (
    <div ref={containerRef} className={cn("relative min-w-0", className)}>
      <div
        className={cn(
          "flex h-10 items-center rounded-well border bg-paper-2 transition",
          open
            ? "border-accent shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-focus)_30%,transparent)]"
            : value
              ? "border-rule hover:border-muted"
              : "border-rule hover:border-muted",
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setOpen(true);
            if (!next.trim()) {
              onChange("");
            }
          }}
          onKeyDown={handleKeyDown}
          className="h-full w-full min-w-0 bg-transparent pl-3 pr-1 text-sm font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted"
        />

        {value ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            aria-label={`清空${ariaLabel}`}
            className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-muted transition hover:bg-paper-2 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setOpen((prev) => !prev);
              inputRef.current?.focus();
            }}
            aria-label={`展开${ariaLabel}`}
            className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-muted"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180 text-ink")}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-[320] mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-well border border-rule bg-paper-2 p-1 shadow-card"
        >
          {canUseCustom && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitValue(trimmedQuery)}
              className={cn(
                "mb-0.5 flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition",
                activeIndex === 0 ? "bg-paper-3 text-ink" : "text-ink-2 hover:bg-paper-3",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-accent">
                <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                使用「{trimmedQuery}」
              </span>
              <span className="shrink-0 text-[11px] text-muted">{customHint}</span>
            </button>
          )}

          {filtered.length === 0 && !canUseCustom ? (
            <p className="px-2.5 py-4 text-center text-xs text-muted">没有匹配项</p>
          ) : (
            (() => {
              let selectableCursor = canUseCustom ? 1 : 0;
              return filtered.map((opt) => {
                const isSelected = opt.value === value;
                const isDisabled = Boolean(
                  disabledValues && disabledValues.has(opt.value) && !isSelected,
                );
                const myIdx = isDisabled ? -1 : selectableCursor++;
                const isHighlighted = myIdx === activeIndex;

                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={isDisabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!isDisabled) commitValue(opt.value);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition",
                      isDisabled
                        ? "cursor-not-allowed opacity-45"
                        : isHighlighted || isSelected
                          ? "bg-paper-3 text-ink"
                          : "text-ink-2 hover:bg-paper-3 hover:text-ink",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <span className={cn("truncate", isSelected && "font-semibold text-ink")}>
                        {opt.label}
                      </span>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                      )}
                    </span>
                    <span className="num shrink-0 text-xs text-ink-2">
                      {isDisabled ? "已入座" : (opt.meta ?? "")}
                    </span>
                  </button>
                );
              });
            })()
          )}
        </div>
      )}
    </div>
  );
}
