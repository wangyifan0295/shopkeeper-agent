/**
 * 共享分页器组件
 * 页码 + 指定页跳转输入框 + 前后翻页，选手榜与对局记录共用同一套行为
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

type PaginationProps = {
  page: number;
  totalPages: number;
  disabled?: boolean;
  onChange: (page: number) => void;
};

export function Pagination({ page, totalPages, disabled = false, onChange }: PaginationProps) {
  const [draft, setDraft] = useState(String(page));

  // 外部翻页（按钮/筛选重置）时同步输入框
  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  const jump = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(page));
      return;
    }
    const target = Math.max(1, Math.min(totalPages, parsed));
    if (target !== page) {
      onChange(target);
    } else {
      setDraft(String(target));
    }
  };

  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <span className="num">
        第 {page} / {totalPages} 页
      </span>
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={jump}
          onKeyDown={(event) => {
            if (event.key === "Enter") jump();
          }}
          inputMode="numeric"
          aria-label="跳转到指定页"
          className="input h-8 w-14 min-h-0 px-2 text-center"
        />
        <button
          type="button"
          onClick={jump}
          disabled={disabled}
          className="btn btn-quiet h-8 min-h-0 px-3"
        >
          跳页
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1 || disabled}
        className="icon-btn"
        title="上一页"
        aria-label="上一页"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages || disabled}
        className="icon-btn"
        title="下一页"
        aria-label="下一页"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
