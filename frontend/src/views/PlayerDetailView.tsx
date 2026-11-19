/**
 * 选手详情视图
 * 总指标一行（竖向细线分隔的对比数字行）+ 分棋手胜率表。
 * 吃鸡率是主角：更大的衬线数字，下压它的热坡条
 */
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { WinRate } from "../components/WinRate";
import { fetchPlayerDetail } from "../lib/statsApi";
import { cn } from "../lib/format";
import type { PlayerDetail } from "../types/stats";

type PlayerDetailViewProps = {
  player: string;
  onBack: () => void;
};

export function PlayerDetailView({ player, onBack }: PlayerDetailViewProps) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setError(null);
    fetchPlayerDetail(player)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [player]);

  const metrics = detail
    ? [
        { label: "场次", value: String(detail.matches), highlight: false },
        { label: "吃鸡数", value: String(detail.wins), highlight: false },
        { label: "吃鸡率", value: `${detail.win_rate.toFixed(2)}%`, highlight: true, heat: detail.win_rate },
        { label: "前三率", value: `${detail.top3_rate.toFixed(2)}%`, highlight: false },
        { label: "平均名次", value: detail.avg_place.toFixed(2), highlight: false },
      ]
    : [];

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-rule px-4 lg:px-6">
        <button type="button" onClick={onBack} className="btn btn-quiet shrink-0">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          返回选手榜
        </button>
        <h1 className="min-w-0 truncate font-display text-lg">{player}</h1>
        <p className="label hidden shrink-0 sm:block">选手详情</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 lg:px-8">
          {error ? (
            <div className="rounded-well border-l-2 border-error bg-paper-2 px-4 py-3 text-sm text-error">
              {error.includes("404") ? "未找到该选手，可能数据已更新。" : error}
            </div>
          ) : loading || detail === null ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-5" aria-label="加载中">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="space-y-3">
                  <span className="skeleton block h-3 w-14" />
                  <span className="skeleton block h-8 w-20" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* 总指标行：对比数字用竖向细线分隔，不吃间距内边距 */}
              <dl className="grid grid-cols-2 gap-y-8 md:grid-cols-5">
                {metrics.map((metric, index) => (
                  <div
                    key={metric.label}
                    className={cn(
                      "border-rule",
                      // 竖向细线只画每行第一个之外的左边界；移动端两列布局按奇偶重置
                      index % 2 !== 0 && "border-l pl-6",
                      index === 0 ? "md:border-l-0 md:pl-0" : "md:border-l md:pl-6",
                    )}
                  >
                    <dt className="label">{metric.label}</dt>
                    <dd
                      className={cn(
                        "figure mt-2",
                        metric.highlight ? "text-figure" : "text-3xl",
                      )}
                    >
                      {metric.value}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* 分棋手胜率：该选手用过的每个棋手一行，按场次降序 */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display text-base">分棋手胜率</h2>
                  <p className="label num">{detail.lord_stats.length} 个棋手，按场次降序</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">棋手</th>
                        <th scope="col" className="cell-num">场次</th>
                        <th scope="col" className="cell-num">吃鸡数</th>
                        <th scope="col" className="cell-num">吃鸡率</th>
                        <th scope="col" className="cell-num">前三率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lord_stats.map((row) => (
                        <tr key={row.lord} className="transition hover:bg-paper-2">
                          <td className="font-medium">{row.lord}</td>
                          <td className="cell-num text-ink-2">{row.matches}</td>
                          <td className="cell-num text-ink-2">{row.wins}</td>
                          <td className="cell-num">
                            <WinRate value={row.win_rate} />
                          </td>
                          <td className="cell-num text-ink-2">{row.top3_rate.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <p className="label leading-5">场次过少的棋手胜率参考意义有限。</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
