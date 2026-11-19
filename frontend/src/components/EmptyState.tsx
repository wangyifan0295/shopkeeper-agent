/**
 * 对话空状态组件
 * 一句窑语开场：衬线大标题、一句话、四条可点的示例问题。
 * 没有徽章、没有图标瓦片，让标题和问题自己说话
 */
type EmptyStateProps = {
  examples: string[];
  onUseExample: (example: string) => void;
  disabled?: boolean;
};

export function EmptyState({ examples, onUseExample, disabled = false }: EmptyStateProps) {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-7 px-6 py-12">
      <div>
        <h2 className="font-display text-3xl">万象棋问数</h2>
        <p className="mt-3 text-base leading-relaxed text-ink-2">
          万象大赛的历史对局都在这里。问一句，或者去侧栏翻榜单。
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onUseExample(example)}
            disabled={disabled}
            className="rounded-well border border-rule px-4 py-3.5 text-left text-sm leading-6 text-ink-2 transition hover:bg-paper-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
