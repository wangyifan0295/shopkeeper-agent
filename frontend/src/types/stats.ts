/**
 * 数据统计类型定义
 * 与后端 /api/stats/* 只读聚合接口的返回结构一一对应
 * 页面文案层把 lord 叫"棋手"，字段名维持物理层命名
 */

/** 选手榜行：一名选手的全量聚合指标 + 近 8 场吃鸡率 */
export type PlayerStatRow = {
  player: string;
  matches: number;
  wins: number;
  win_rate: number;
  top3_rate: number;
  avg_place: number;
  recent_matches?: number;
  recent_win_rate?: number;
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

/** 选手单场近期记录 */
export type PlayerRecentRecord = {
  match_id: string;
  match_date: string;
  place: number;
  lord: string;
};

/** 选手最近 8 场统计摘要 */
export type PlayerRecentStats = {
  matches: number;
  wins: number;
  win_rate: number;
  top3_rate: number;
  avg_place: number;
  records: PlayerRecentRecord[];
};

/** 选手详情：总指标 + 近 8 场状态 + 分棋手明细 */
export type PlayerDetail = PlayerStatRow & {
  recent_8?: PlayerRecentStats;
  lord_stats: PlayerLordStatRow[];
};

/** 选手榜允许的排序字段，与后端 Literal 枚举一致 */
export type PlayerSortBy = "matches" | "win_rate" | "recent_win_rate" | "top3_rate" | "avg_place";

export type SortOrder = "asc" | "desc";

/** 对局六人明细行：按名次升序 */
export type MatchPlayerRow = {
  place: number;
  player: string;
  lord: string;
};

/** 对局记录行：一场对局 + 小时档位 + 冠军信息 + 六人明细 */
export type MatchRow = {
  match_id: string;
  match_date: string;
  slot_hour: number;
  banned_faction: string;
  champion_player: string | null;
  champion_lord: string | null;
  players: MatchPlayerRow[];
};

/** 日期筛选下拉项：日期与当日场次 */
export type MatchDateOption = {
  date: string;
  matches: number;
};

/** 对局记录按天分批响应：同一天永不被拆断，附全部筛选项真值 */
export type MatchesPage = {
  rows: MatchRow[];
  total: number;
  total_days: number;
  loaded_days: number;
  remaining_days: number;
  remaining_matches: number;
  factions: string[];
  lords: string[];
  hours: number[];
  dates: MatchDateOption[];
};

/** 单个棋手下，某位选手的使用表现 */
export type LordPlayerStatRow = PlayerStatRow;

/** 棋手详情：总指标 + 擅长选手明细 */
export type LordDetail = LordStatRow & {
  player_stats: LordPlayerStatRow[];
};

/** 数仓全局概况 */
export type StatsOverview = {
  matches: number;
  players: number;
  lords: number;
  latest_date: string | null;
};

/** 禁用阵营分布项 */
export type BannedFactionStat = {
  faction: string;
  matches: number;
};

/** 大盘火热选手对比行 */
export type HotPlayerStat = {
  player: string;
  matches: number;
  win_rate: number;
  recent_matches: number;
  recent_win_rate: number;
};

/** 数据大盘全量响应 */
export type DashboardData = {
  overview: StatsOverview;
  banned_factions: BannedFactionStat[];
  hot_players: HotPlayerStat[];
};
