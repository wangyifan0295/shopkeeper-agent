/**
 * 聊天消息气泡组件
 * 组合展示用户问题、智能体回复、执行流程、结果表格与提取后的生成 SQL（带一键复制）。
 * 原始 AG-UI 状态快照作为次级折叠项收纳在 SQL 面板内部，避免开发调试 JSON 干扰阅读。
 */
import { Check, Code2, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ResultTable } from "./ResultTable";
import { StepRail } from "./StepRail";
import { cn, formatTime, toClipboardText } from "../lib/format";
import type { ChatMessage } from "../types/agent";

type SnapshotMeta = {
  sql: string | null;
  keywords: string[];
};

function extractSnapshotMeta(snapshot: unknown): SnapshotMeta {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { sql: null, keywords: [] };
  }
  const record = snapshot as Record<string, unknown>;
  const rawSql = typeof record.sql === "string" ? record.sql.trim() : "";
  const rawKeywords = Array.isArray(record.keywords)
    ? record.keywords.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  return {
    sql: rawSql || null,
    keywords: rawKeywords,
  };
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [copiedResult, setCopiedResult] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const resultTimerRef = useRef<number | null>(null);
  const sqlTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resultTimerRef.current !== null) window.clearTimeout(resultTimerRef.current);
      if (sqlTimerRef.current !== null) window.clearTimeout(sqlTimerRef.current);
    };
  }, []);

  const copyResult = async () => {
    const text = message.result ? toClipboardText(message.result) : message.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedResult(true);
      if (resultTimerRef.current !== null) window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = window.setTimeout(() => setCopiedResult(false), 1800);
    } catch {
      // 忽略剪贴板权限受限场景
    }
  };

  const copySql = async (sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedSql(true);
      if (sqlTimerRef.current !== null) window.clearTimeout(sqlTimerRef.current);
      sqlTimerRef.current = window.setTimeout(() => setCopiedSql(false), 1800);
    } catch {
      // 忽略剪贴板权限受限场景
    }
  };

  const snapshotMeta = !isUser ? extractSnapshotMeta(message.stateSnapshot) : { sql: null, keywords: [] };

  return (
    <article className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "group relative",
          isUser ? "well max-w-[760px] px-5 py-4" : "w-full",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
          {!isUser && message.status !== "streaming" && (
            <button
              type="button"
              onClick={copyResult}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-xs transition focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
                copiedResult
                  ? "bg-paper-2 text-success opacity-100"
                  : "text-muted opacity-100 hover:bg-paper-2 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100",
              )}
              title={copiedResult ? "已复制" : "复制结果"}
              aria-label={copiedResult ? "已复制" : "复制结果"}
            >
              {copiedResult ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>已复制</span>
                </>
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {message.error && (
          <div className="mt-3 border-l-2 border-error pl-3 text-sm text-error">
            {message.error}
          </div>
        )}

        {!isUser && <StepRail steps={message.steps} />}
        {!isUser && message.result !== undefined && <ResultTable data={message.result} />}

        {!isUser && (snapshotMeta.sql || message.stateSnapshot !== undefined) && (
          <div className="mt-4 space-y-2 border-t border-rule pt-3">
            {snapshotMeta.sql && (
              <details className="rounded-well border border-rule bg-paper-2 px-3.5 py-2.5">
                <summary className="flex cursor-pointer select-none items-center justify-between gap-2 text-xs font-medium text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Code2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    查看生成 SQL
                  </span>
                  {snapshotMeta.keywords.length > 0 && (
                    <span className="truncate text-xs font-normal text-muted">
                      关键词：{snapshotMeta.keywords.join(" · ")}
                    </span>
                  )}
                </summary>
                <div className="relative mt-2.5 border-t border-rule pt-2.5">
                  <button
                    type="button"
                    onClick={() => copySql(snapshotMeta.sql!)}
                    className={cn(
                      "absolute right-0 top-2 inline-flex items-center gap-1 rounded-pill border border-rule bg-paper px-2.5 py-1 text-xs transition",
                      copiedSql
                        ? "border-success text-success"
                        : "text-muted hover:border-accent hover:text-ink",
                    )}
                    title={copiedSql ? "已复制 SQL" : "复制 SQL"}
                  >
                    {copiedSql ? (
                      <>
                        <Check className="h-3 w-3" aria-hidden="true" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden="true" />
                        复制 SQL
                      </>
                    )}
                  </button>
                  <pre className="overflow-x-auto pr-24 font-mono text-xs leading-6 text-ink-2">
                    {snapshotMeta.sql}
                  </pre>
                </div>
              </details>
            )}

            {message.stateSnapshot !== undefined && (
              <details>
                <summary className="cursor-pointer select-none text-xs text-muted transition hover:text-ink-2">
                  调试状态（STATE_SNAPSHOT）
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-well border border-rule bg-paper-2 p-3 font-mono text-xs leading-5 text-muted">
                  {JSON.stringify(message.stateSnapshot, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      <time className="mt-1.5 px-1 text-xs text-muted">{formatTime(message.createdAt)}</time>
    </article>
  );
}
