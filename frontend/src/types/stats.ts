/**
 * 数据统计类型定义
 * 与后端 /api/stats/* 只读聚合接口的返回结构一一对应
 * 页面文案层把 lord 叫"棋手"，字段名维持物理层命名
 */

/** 选手榜行：一名选手的全量聚合指标 */
export type PlayerStatRow = {
  player: string;
  matches: number;
  wins: number;
  win_rate: number;
  top3_rate: number;
  avg_place: number;
};

/** 棋手榜行：一名棋手（lord）的全量聚合指标 */
export type LordStatRow = {
  lord: string;
  matches: number;
  wins: number;
  win_rate: number;
  top3_rate: number;
  avg_place: number;
};

/** 选手榜分页响应：筛选排序分页都在服务端完成 */
export type PlayersPage = {
  rows: PlayerStatRow[];
  total: number;
  page: number;
  page_size: number;
};

/** 分棋手胜率行：选手详情里该选手用过的每个棋手 */
export type PlayerLordStatRow = {
  lord: string;
  matches: number;
  wins: number;
  win_rate: number;
  top3_rate: number;
};

/** 选手详情：总指标 + 分棋手明细 */
export type PlayerDetail = PlayerStatRow & {
  lord_stats: PlayerLordStatRow[];
};

/** 选手榜允许的排序字段，与后端 Literal 枚举一致 */
export type PlayerSortBy = "matches" | "win_rate" | "top3_rate" | "avg_place";

export type SortOrder = "asc" | "desc";
