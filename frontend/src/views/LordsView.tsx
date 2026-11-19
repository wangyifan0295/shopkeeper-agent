/**
 * 棋手榜视图
 * 全部棋手（dim_lord 维表全量）按吃鸡率降序，一屏展示不筛选不分页。
 * 名次用衬线数字标在名字前，窑温从上往下退
 */
import { useEffect, useState } from "react";
import { WinRate } from "../components/WinRate";
import { fetchLords } from "../lib/statsApi";
import type { LordStatRow } from "../types/stats";

export function LordsView() {
  const [rows, setRows] = useState<LordStatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLords()
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
          setError(null);
        }
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
  }, [refreshKey]);

  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4 lg:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg">棋手榜</h1>
          <p className="label hidden sm:block">全部棋手，按吃鸡率降序</p>
        </div>
        <p className="label num">
          共 <span className="figure text-base text-ink-2">{rows?.length ?? "—"}</span> 位
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          {error ? (
            <div className="flex items-center justify-between gap-4 rounded-well border-l-2 border-error bg-paper-2 px-4 py-3 text-sm text-error">
              <span className="min-w-0 break-all">{error}</span>
              <button
                type="button"
                onClick={() => setRefreshKey((key) => key + 1)}
                className="btn btn-quiet shrink-0 text-error"
              >
                重试
              </button>
            </div>
          ) : rows === null ? (
            <div className="space-y-4" aria-label="加载中">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-6">
                  <span className="skeleton h-4 w-32" />
                  <span className="skeleton h-4 w-10" />
                  <span className="skeleton h-4 w-10" />
                  <span className="skeleton h-4 w-24" />
                  <span className="skeleton hidden h-4 w-10 sm:block" />
                  <span className="skeleton hidden h-4 w-10 sm:block" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="w-10">名次</th>
                    <th scope="col">棋手</th>
                    <th scope="col" className="cell-num">场次</th>
                    <th scope="col" className="cell-num">吃鸡数</th>
                    <th scope="col" className="cell-num">吃鸡率</th>
                    <th scope="col" className="cell-num">前三率</th>
                    <th scope="col" className="cell-num">平均名次</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.lord} className="transition hover:bg-paper-2">
                      <td className="figure text-muted">{index + 1}</td>
                      <td className="font-medium">{row.lord}</td>
                      <td className="cell-num text-ink-2">
                        {row.matches}
                        {row.matches < 5 && (
                          <span
                            className="ml-1.5 text-xs text-muted"
                            title="场次过少，胜率参考意义有限"
                          >
                            小样本
                          </span>
                        )}
                      </td>
                      <td className="cell-num text-ink-2">{row.wins}</td>
                      <td className="cell-num">
                        <WinRate value={row.win_rate} />
                      </td>
                      <td className="cell-num text-ink-2">{row.top3_rate.toFixed(2)}%</td>
                      <td className="cell-num text-ink-2">{row.avg_place.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="label mt-6 leading-5">
            棋手即对局中可选的角色（数据表 dim_lord）；从未被选用的棋手指标记为 0。
          </p>
        </div>
      </div>
    </main>
  );
}
