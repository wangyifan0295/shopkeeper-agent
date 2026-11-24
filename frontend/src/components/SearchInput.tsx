/**
 * 通用搜索输入框组件
 * 统一左侧搜索图标与右侧一键清除按钮，供选手榜、棋手榜与对局记录复用
 */
import { Search, X } from "lucide-react";
import { useRef } from "react";
import { cn } from "../lib/format";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
};

export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const clear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <div className={cn("relative min-w-60 flex-1", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn("input w-full pl-9", value ? "pr-9" : "pr-3")}
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-pill text-muted transition hover:bg-paper-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          title="清空搜索"
          aria-label="清空搜索"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
