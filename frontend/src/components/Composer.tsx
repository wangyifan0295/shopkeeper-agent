/**
 * 聊天输入区组件
 * 处理问题输入、自适应高度、发送和停止当前流式请求。
 * 兼容中文输入法组合态（IME），避免选词回车误触发发送。
 */
import { ArrowUp, Square } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef } from "react";
import { cn } from "../lib/format";

const MAX_TEXTAREA_HEIGHT = 144;

type ComposerProps = {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
};

export function Composer({
  value,
  disabled,
  isStreaming,
  onChange,
  onSubmit,
  onStop,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!disabled) onSubmit();
    }
  };

  return (
    <form onSubmit={submit} className="border-t border-rule px-4 py-4">
      <div className="composer-well well mx-auto flex max-w-5xl items-end gap-2 p-2 transition">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="问一个万象棋对局数据问题…（Shift + Enter 换行）"
          aria-label="问数输入框"
          className="max-h-36 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2 text-[15px] leading-6 text-ink outline-none placeholder:text-muted"
        />
        <button
          type={isStreaming ? "button" : "submit"}
          onClick={isStreaming ? onStop : undefined}
          disabled={!isStreaming && disabled}
          className={cn(
            "btn shrink-0",
            isStreaming
              ? "btn-quiet w-auto px-3 text-error"
              : "btn-primary h-9 w-9 p-0",
          )}
          title={isStreaming ? "停止" : "发送"}
          aria-label={isStreaming ? "停止" : "发送"}
        >
          {isStreaming ? (
            <>
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              停止
            </>
          ) : (
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );
}
