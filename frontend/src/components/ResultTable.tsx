/**
 * 查询结果表格组件
 * 将后端返回的结构化数据归一化为可滚动表格：
 * - 自动检测纯数值列，应用等宽居中对齐
 * - 支持一键导出带 UTF-8 BOM 的 CSV（兼容 Excel 直接打开）
 */
import { Database, Download } from "lucide-react";
import { cn } from "../lib/format";

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

const NUMERIC_TEXT_RE = /^[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?$/;

function isNumericColumn(rows: Array<Record<string, unknown>>, column: string): boolean {
  let seen = 0;
  for (const row of rows) {
    const val = row[column];
    if (val === null || val === undefined || val === "") continue;
    seen += 1;
    if (typeof val === "number") continue;
    if (typeof val === "string" && NUMERIC_TEXT_RE.test(val.trim())) continue;
    return false;
  }
  return seen > 0;
}

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function downloadCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(","));
  const csv = `\uFEFF${[header, ...body].join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `query-result-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

  const numericColumns = new Set(columns.filter((col) => isNumericColumn(rows, col)));

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-3 pb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <Database className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          查询结果
        </div>
        <div className="flex items-center gap-3">
          <span className="label num">{rows.length} 行</span>
          <button
            type="button"
            onClick={() => downloadCsv(columns, rows)}
            className="inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs text-muted transition hover:bg-paper-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            title="导出为 CSV 文件"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            导出 CSV
          </button>
        </div>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="data-table">
          <thead className="sticky top-0 z-10 bg-paper">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={cn(numericColumns.has(column) && "cell-num")}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="transition hover:bg-paper-2">
                {columns.map((column) => (
                  <td
                    key={column}
                    className={cn(
                      "text-ink-2",
                      numericColumns.has(column) && "cell-num",
                    )}
                  >
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
