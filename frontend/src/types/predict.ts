/**
 * 胜率预测模块前端类型定义
 * 对应 /api/predict/options、/api/predict/match、/api/predict/explain 响应结构
 */

export type PredictFactionOption = {
  name: string;
  is_enabled: boolean;
};

export type PredictLordOption = {
  name: string;
  is_enabled: boolean;
  matches: number;
  win_rate: number;
  avg_place: number;
};

export type PredictPlayerOption = {
  name: string;
  matches: number;
  win_rate: number;
  avg_place: number;
  recent_win_rate: number;
};

export type ReplayMatchSeat = {
  seat: number;
  player: string;
  lord: string;
  place: number;
};

export type ReplayMatchOption = {
  match_id: string;
  match_date: string;
  slot_hour: number;
  banned_faction: string;
  players: ReplayMatchSeat[];
};

export type ModelBacktestMetrics = {
  eval_matches: number;
  win_logloss: number;
  baseline_logloss: number;
  logloss_gain_pct: number;
  brier_score: number;
  top1_hit_rate: number;
  top2_hit_rate: number;
  top3_avg_overlap: number;
};

export type FeatureWeightItem = {
  key: string;
  label: string;
  weight: number;
};

export type ModelSummary = {
  total_matches: number;
  best_l2: number;
  backtest: ModelBacktestMetrics;
  feature_weights: FeatureWeightItem[];
};

export type PredictOptionsResponse = {
  factions: PredictFactionOption[];
  lords: PredictLordOption[];
  players: PredictPlayerOption[];
  recent_matches: ReplayMatchOption[];
  model_summary: ModelSummary;
};

export type PredictSeatInput = {
  seat: number;
  player: string;
  lord: string;
};

export type PredictFactor = {
  key: string;
  label: string;
  impact: number;
  raw_feature: number;
};

export type PredictSeatContext = {
  is_new_player: boolean;
  player_matches: number;
  player_mu: number;
  player_sigma: number;
  player_avg_place: number | null;
  recent_avg_place: number | null;
  lord_matches: number;
  lord_win_rate: number | null;
  player_lord_matches: number;
  player_lord_wins: number;
  player_lord_avg_place: number | null;
  lord_ban_matches: number;
  mirror_rivals: number;
};

export type PredictSeatResult = {
  seat: number;
  predicted_rank: number;
  player: string;
  lord: string;
  power_score: number;
  win_prob: number;
  top3_prob: number;
  expected_place: number;
  place_probs: number[];
  factors: PredictFactor[];
  context: PredictSeatContext;
};

export type MirrorGroup = {
  lord: string;
  count: number;
};

export type PredictMatchResponse = {
  banned_faction: string;
  mirror_groups: MirrorGroup[];
  seats: PredictSeatResult[];
  model_summary: ModelSummary;
};

export type PredictExplainResponse = {
  commentary: string;
  prediction: PredictMatchResponse;
};
