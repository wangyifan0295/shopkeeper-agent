/**
 * 数据统计接口封装
 * 对接后端 /api/stats/* 只读聚合接口；开发环境经 Vite 代理转发到 FastAPI
 */
import type {
  DashboardData,
  LordDetail,
  LordStatRow,
  MatchesPage,
  PlayerDetail,
  PlayersPage,
  PlayerSortBy,
  SortOrder,
  StatsOverview,
} from "../types/stats";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
const BASE_URL = `${API_BASE_URL}/api/stats`;

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`请求失败（${response.status}）${message ? `：${message}` : ""}`);
  }
  return (await response.json()) as T;
}

export type PlayersPageParams = {
  search: string;
  minMatches: number;
  sortBy: PlayerSortBy;
  order: SortOrder;
  page: number;
  pageSize: number;
};

/** 拉取选手榜一页：筛选、排序、分页参数全部转成查询串交给服务端 */
export function fetchPlayersPage(params: PlayersPageParams): Promise<PlayersPage> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.minMatches > 0) query.set("min_matches", String(params.minMatches));
  query.set("sort_by", params.sortBy);
  query.set("order", params.order);
  query.set("page", String(params.page));
  query.set("page_size", String(params.pageSize));
  return requestJson(`${BASE_URL}/players?${query.toString()}`);
}

/** 拉取单个选手的总指标和分棋手胜率明细 */
export function fetchPlayerDetail(player: string): Promise<PlayerDetail> {
  return requestJson(`${BASE_URL}/players/${encodeURIComponent(player)}`);
}

/** 拉取棋手榜全量列表（按吃鸡率降序） */
export function fetchLords(): Promise<{ rows: LordStatRow[] }> {
  return requestJson(`${BASE_URL}/lords`);
}

/** 拉取单个棋手的总指标和各选手使用明细 */
export function fetchLordDetail(lord: string): Promise<LordDetail> {
  return requestJson(`${BASE_URL}/lords/${encodeURIComponent(lord)}`);
}

/** 拉取数仓全局概况 */
export function fetchOverview(): Promise<StatsOverview> {
  return requestJson(`${BASE_URL}/overview`);
}

/** 拉取数据大盘聚合数据 */
export function fetchDashboard(): Promise<DashboardData> {
  return requestJson(`${BASE_URL}/dashboard`);
}

export type MatchesPageParams = {
  search: string;
  faction: string;
  lord: string;
  slotHour?: number | null;
  matchDate?: string;
  daysOffset?: number;
  daysLimit?: number;
};

/** 按完整比赛日分批拉取对局记录：保证同一天不跨页拆断 */
export function fetchMatchesPage(params: MatchesPageParams): Promise<MatchesPage> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.faction) query.set("faction", params.faction);
  if (params.lord) query.set("lord", params.lord);
  if (params.slotHour !== null && params.slotHour !== undefined) {
    query.set("slot_hour", String(params.slotHour));
  }
  if (params.matchDate) query.set("match_date", params.matchDate);
  if (params.daysOffset !== undefined) query.set("days_offset", String(params.daysOffset));
  if (params.daysLimit !== undefined) query.set("days_limit", String(params.daysLimit));
  return requestJson(`${BASE_URL}/matches?${query.toString()}`);
}
