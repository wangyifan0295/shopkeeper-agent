/**
 * 通用错误提示条组件
 * 左红边强调 + 可选重试操作，供各统计视图复用
 */
type ErrorBannerProps = {
  message: string;
  onRetry?: () => void;
};

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-well border-l-2 border-error bg-paper-2 px-4 py-3 text-sm text-error"
    >
      <span className="min-w-0 break-all">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-quiet shrink-0 text-error"
        >
          重试
        </button>
      )}
    </div>
  );
}
