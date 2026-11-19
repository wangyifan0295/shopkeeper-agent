/**
 * 查询结果表格组件
 * 将后端返回的结构化数据归一化为可滚动表格。
 * 只有横向规则，无外框无卡片；表头随滚动吸附
 */
import { Database } from "lucide-react";

function normalizeRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.map((item, index) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { 序号: index + 1, 值: item },
    );
  }

  if (data && typeof data === "object") {
    return [data as Record<string, unknown>];
  }

  return [{ 值: data ?? "" }];
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ResultTable({ data }: { data: unknown }) {
  const rows = normalizeRows(data);
  const columns = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );

  if (columns.length === 0) {
    return null;
  }

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <Database className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          查询结果
        </div>
        <div className="label num">{rows.length} 行</div>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="data-table">
          <thead className="sticky top-0 z-10 bg-paper">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="transition hover:bg-paper-2">
                {columns.map((column) => (
                  <td key={column} className="text-ink-2">
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
