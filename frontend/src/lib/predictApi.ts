/**
 * 胜率预测接口封装
 * 对接后端 /api/predict/* 路由：选项字典、毫秒级模型预测与按需 AI 赛前点评
 */
import type {
  PredictExplainResponse,
  PredictMatchResponse,
  PredictOptionsResponse,
  PredictSeatInput,
} from "../types/predict";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
const BASE_URL = `${API_BASE_URL}/api/predict`;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { detail?: unknown };
      if (typeof data.detail === "string") {
        detail = data.detail;
      } else if (Array.isArray(data.detail)) {
        detail = data.detail
          .map((item) =>
            typeof item === "object" && item && "msg" in item
              ? String((item as { msg: unknown }).msg)
              : String(item),
          )
          .join("；");
      }
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(`请求失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
  return (await response.json()) as T;
}

/** 拉取禁用阵营、棋手目录、全量选手快速搜索索引及最近历史对局 */
export function fetchPredictOptions(): Promise<PredictOptionsResponse> {
  return requestJson(`${BASE_URL}/options`);
}

/** 提交 6 人阵容与禁用阵营，毫秒级计算吃鸡率、前三率与 6 维归因 */
export function predictMatch(payload: {
  banned_faction: string;
  seats: PredictSeatInput[];
}): Promise<PredictMatchResponse> {
  return requestJson(`${BASE_URL}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** 按需调用大模型，基于量化预测结果生成简短赛前点评 */
export function explainPrediction(payload: {
  banned_faction: string;
  seats: PredictSeatInput[];
}): Promise<PredictExplainResponse> {
  return requestJson(`${BASE_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
