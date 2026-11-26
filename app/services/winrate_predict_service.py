"""
王牌对决 6 人胜率预测引擎（v2+ 阶段异构双头 Plackett-Luce）

针对万象大赛中小样本 6 人混战特点，在 v1 基础上完成 4 项核心升级：
1. 阶段异构双头建模：分离「夺冠爆发力（吃鸡头）」与「保分稳定性（排位头）」，
   解决白歌/玉环（高吃鸡但易老六）与马可/香香（稳健保分但难登顶）的混淆问题，
   并遍历 6! = 720 种全排列精确求解，严格保证吃鸡率之和=100%、前三率之和=300%。
2. 棋手校准版 OpenSkill（人棋解耦）：更新选手天梯分时扣除本局棋手强弱与撞车惩罚，
   拿到弱势棋手或撞车打出高名次涨分更多。
3. 禁阵营 BP 强化与同步衰减：修复 v1 禁阵营统计衰减不同步缺陷，拆出「禁阵营吃鸡加成」
   「禁阵营均名适配」与「禁阵营高玩条件选角偏好」三类信号，并加入棋手近 3 天快窗口与选角热度。
4. 组内标准化 + 单调符号约束 + 无泄漏复盘：在标准化空间施加物理方向约束（正向特征 >= 0、
   撞棋手 <= 0），彻底根除反直觉倒扣归因；历史复盘支持按开赛前快照推演，杜绝事后泄漏。
"""

import asyncio
import math
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from itertools import permutations
from typing import Any

import numpy as np

from app.agent.llm import llm
from app.repositories.mysql.dw.dw_predict_repository import DWPredictRepository

# 底层 16 维有序特征索引说明（供双头按各自关注维度掩码取用）
RAW_FEATURE_NAMES: list[str] = [
    "player_rating",      # 0: 棋手校准 OpenSkill 天梯实力
    "player_win_rate",    # 1: 选手平滑吃鸡率
    "player_top3_rate",   # 2: 选手平滑前三率
    "recent_form",        # 3: 选手近 8 场手感
    "lord_win_power",     # 4: 棋手吃鸡爆发力
    "lord_rank_power",    # 5: 棋手均名稳定性
    "lord_top3_power",    # 6: 棋手前三上分率
    "lord_anti_6",        # 7: 棋手防老六能力
    "lord_recent_rank",   # 8: 棋手近 3 天版本均名
    "lord_pick_hot",      # 9: 棋手近 3 天选角热度
    "player_lord_syn",    # 10: 人棋专精协同
    "lord_ban_win",       # 11: 去撞车污染的禁阵营吃鸡加成
    "lord_ban_rank",      # 12: 去撞车污染的禁阵营均名适配
    "lord_ban_pick",      # 13: 禁阵营条件选角偏好
    "mirror_count",       # 14: 同局撞棋手竞争
    "mirror_ban_hot",     # 15: 热门 BP 棋手撞车附加内卷惩罚
]

# 吃鸡头（聚焦夺冠爆发力、选角热度、去撞车 BP 加成与撞车内卷）
WIN_COLS: list[int] = [0, 1, 2, 4, 9, 11, 12, 13, 14, 15]
WIN_LABELS: list[tuple[str, str]] = [
    ("player_rating", "选手天梯实力"),
    ("player_win_rate", "选手吃鸡底蕴"),
    ("player_top3_rate", "选手上分稳定性"),
    ("lord_win_power", "棋手吃鸡爆发力"),
    ("lord_pick_hot", "棋手近期热度"),
    ("lord_ban_win", "禁阵营独享吃鸡加成"),
    ("lord_ban_rank", "禁阵营独享均名适配"),
    ("lord_ban_pick", "禁阵营选角偏好"),
    ("mirror_count", "同局撞棋手竞争"),
    ("mirror_ban_hot", "热门 BP 撞车额外内卷"),
]
WIN_SIGNS = np.array([1, 1, 1, 1, 1, 1, 1, 1, -1, -1], dtype=np.float64)
WIN_STAGE_WEIGHTS = (1.5, 1.0, 0.9, 0.6, 0.4)

# 排位头（聚焦前三率、防老六、近期手感、近 3 天版本均值与去撞车 BP 适配）
RANK_COLS: list[int] = [0, 2, 3, 5, 6, 7, 8, 12, 13, 14, 15]
RANK_LABELS: list[tuple[str, str]] = [
    ("player_rating", "选手天梯实力"),
    ("player_top3_rate", "选手上分稳定性"),
    ("recent_form", "近 8 场手感"),
    ("lord_rank_power", "棋手均名稳定性"),
    ("lord_top3_power", "棋手上分能力"),
    ("lord_anti_6", "棋手防老六能力"),
    ("lord_recent_rank", "棋手近 3 天趋势"),
    ("lord_ban_rank", "禁阵营独享均名适配"),
    ("lord_ban_pick", "禁阵营选角偏好"),
    ("mirror_count", "同局撞棋手竞争"),
    ("mirror_ban_hot", "热门 BP 撞车额外内卷"),
]
RANK_SIGNS = np.array([1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1], dtype=np.float64)
RANK_STAGE_WEIGHTS = (0.8, 1.2, 1.2, 1.0, 0.8)

# 前端每行展示的 6 个直观汇总归因维度（把双头底层因子按语义合并展示）
DISPLAY_GROUPS: list[tuple[str, str, list[int]]] = [
    ("player_rating", "选手天梯实力", [0]),
    ("player_form", "选手胜率与手感", [1, 2, 3]),
    ("lord_offense", "棋手版本爆发力", [4, 9]),
    ("lord_stability", "棋手保分与走势", [5, 6, 7, 8, 10]),
    ("lord_ban_fit", "禁阵营 BP 适配", [11, 12, 13]),
    ("mirror_count", "同局撞棋手竞争", [14, 15]),
]

# Weng-Lin Plackett-Luce 超参
DEFAULT_MU = 25.0
DEFAULT_SIGMA = 25.0 / 3.0
DEFAULT_BETA = DEFAULT_SIGMA / 2.0
DEFAULT_TAU = DEFAULT_SIGMA / 80.0

# 衰减系数（全部同步维护，避免参考基准与残差错位）
PLAYER_DECAY = 0.993
LORD_SLOW_DECAY = 0.993
LORD_FAST_DECAY = 0.972
LORD_PICK_DECAY = 0.965
PAIR_DECAY = 0.995
SAMPLE_DECAY = 0.996

# 6 席位全排列（720 种）启动时预生成，单次预测耗时 < 1ms
_PERMS_6 = np.array(list(permutations(range(6))), dtype=np.int8)


def _place_to_score(place: int) -> float:
    """把 1-6 名线性映射到 [+1.0, -1.0]，均值 3.5 对应 0.0"""

    return (3.5 - float(place)) / 2.5


def _stage_plackett_luce_exact_probs(
    s_win: np.ndarray,
    s_rank: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """阶段异构 Plackett-Luce 精确 720 排列概率求解

    - 第 1 阶段（抢第 1 名吃鸡）使用吃鸡战力分 s_win
    - 第 2~5 阶段（排第 2~6 名名次）使用排位战力分 s_rank
    严格保证吃鸡率之和=100%、前三率之和=300%、预期名次之和=21.0。
    """

    stage_scores = [s_win, s_rank, s_rank, s_rank, s_rank]
    stage_u = [np.exp(np.clip(s - np.max(s), -30.0, 0.0)) for s in stage_scores]

    perm_probs = np.ones(720, dtype=np.float64)
    for k in range(5):
        u = stage_u[k]
        u_perm = u[_PERMS_6[:, k:]]  # (720, 6-k)
        perm_probs *= u_perm[:, 0] / np.sum(u_perm, axis=1)

    place_probs = np.zeros((6, 6), dtype=np.float64)
    for rank_idx in range(6):
        np.add.at(place_probs[:, rank_idx], _PERMS_6[:, rank_idx], perm_probs)

    place_probs = np.clip(place_probs, 0.0, 1.0)
    row_sums = place_probs.sum(axis=1, keepdims=True)
    place_probs = np.where(row_sums > 0, place_probs / row_sums, 1.0 / 6.0)

    win_probs = place_probs[:, 0]
    top3_probs = place_probs[:, :3].sum(axis=1)
    expected_places = place_probs @ np.arange(1, 7, dtype=np.float64)
    return place_probs, win_probs, top3_probs, expected_places


@dataclass
class _PlayerStats:
    mu: float = DEFAULT_MU
    sigma: float = DEFAULT_SIGMA
    matches: int = 0
    wins: int = 0
    score_sum: float = 0.0
    decayed_n: float = 0.0
    decayed_win: float = 0.0
    decayed_top3: float = 0.0
    decayed_score: float = 0.0
    recent_scores: deque[float] = field(default_factory=lambda: deque(maxlen=8))
    recent_places: deque[int] = field(default_factory=lambda: deque(maxlen=8))


@dataclass
class _LordSlowStats:
    matches: int = 0
    wins: int = 0
    n: float = 0.0
    win: float = 0.0
    top3: float = 0.0
    score: float = 0.0
    bot1: float = 0.0


@dataclass
class _LordFastStats:
    n: float = 0.0
    win: float = 0.0
    score: float = 0.0
    picks: float = 0.0


@dataclass
class _PairStats:
    matches: int = 0
    wins: int = 0
    place_sum: float = 0.0
    n: float = 0.0
    win_decayed: float = 0.0
    score_decayed: float = 0.0
    res_score: float = 0.0


class _RollingState:
    """按时间顺序维护的赛前统计状态（人棋解耦 + 双尺度衰减 + 去撞车污染禁阵营统计）"""

    def __init__(self) -> None:
        self.players: dict[str, _PlayerStats] = {}
        self.lords_slow: dict[str, _LordSlowStats] = {}
        self.lords_fast: dict[str, _LordFastStats] = {}
        self.fast_total_picks: float = 0.0
        self.slow_total_picks: float = 0.0
        self.ban_totals: dict[str, float] = defaultdict(float)
        self.player_lords: dict[tuple[str, str], _PairStats] = {}
        self.lord_bans: dict[tuple[str, str], _PairStats] = {}
        # 去撞车污染的独享加权 BP 统计（还原“独享禁大河玉环”等真实上限）
        self.solo_lord_n: dict[str, float] = defaultdict(float)
        self.solo_lord_w: dict[str, float] = defaultdict(float)
        self.solo_lord_sc: dict[str, float] = defaultdict(float)
        self.solo_total_picks: float = 0.0
        self.solo_ban_totals: dict[str, float] = defaultdict(float)
        self.solo_ban_n: dict[tuple[str, str], float] = defaultdict(float)
        self.solo_ban_w: dict[tuple[str, str], float] = defaultdict(float)
        self.solo_ban_sc: dict[tuple[str, str], float] = defaultdict(float)

    def _get_player(self, name: str) -> _PlayerStats:
        stats = self.players.get(name)
        if stats is None:
            stats = _PlayerStats()
            self.players[name] = stats
        return stats

    def extract_match_features(
        self,
        entries: list[dict[str, str]],
        banned_faction: str,
    ) -> tuple[np.ndarray, list[dict[str, Any]]]:
        """在当前历史状态下提取 (6, 15) 赛前特征矩阵与展示用上下文"""

        lord_counts = Counter(item["lord"] for item in entries)
        features = np.zeros((6, len(RAW_FEATURE_NAMES)), dtype=np.float64)
        metas: list[dict[str, Any]] = []

        for idx, item in enumerate(entries):
            player = item["player"]
            lord = item["lord"]

            p_st = self.players.get(player)
            if p_st and p_st.matches > 0:
                pn = p_st.decayed_n
                shrink = pn / (pn + 3.0)
                f_rating = ((p_st.mu - DEFAULT_MU - 0.25 * (p_st.sigma - DEFAULT_SIGMA)) / 5.0) * shrink
                f_p_win = (p_st.decayed_win - pn / 6.0) / (pn + 10.0) * 6.0
                f_p_top3 = (p_st.decayed_top3 - pn * 0.5) / (pn + 8.0) * 2.0
                rec_len = len(p_st.recent_scores)
                f_recent = sum(p_st.recent_scores) / (rec_len + 5.0) if rec_len else 0.0

                player_matches = p_st.matches
                player_mu = p_st.mu
                player_sigma = p_st.sigma
                player_avg_place = round(3.5 - 2.5 * (p_st.score_sum / p_st.matches), 2)
                recent_avg_place = (
                    round(sum(p_st.recent_places) / rec_len, 2) if rec_len else None
                )
            else:
                f_rating = 0.0
                f_p_win = 0.0
                f_p_top3 = 0.0
                f_recent = 0.0
                player_matches = 0
                player_mu = DEFAULT_MU
                player_sigma = DEFAULT_SIGMA
                player_avg_place = None
                recent_avg_place = None

            ls = self.lords_slow.get(lord)
            if ls and ls.n > 0:
                lsn = ls.n
                f_l_win = (ls.win - lsn / 6.0) / (lsn + 12.0) * 6.0
                f_l_rank = ls.score / (lsn + 10.0)
                f_l_top3 = (ls.top3 - lsn * 0.5) / (lsn + 10.0) * 2.0
                f_l_anti6 = (lsn / 6.0 - ls.bot1) / (lsn + 12.0) * 6.0
                lord_matches = ls.matches
                lord_win_rate = round(ls.wins / ls.matches * 100, 1)
            else:
                f_l_win = 0.0
                f_l_rank = 0.0
                f_l_top3 = 0.0
                f_l_anti6 = 0.0
                lord_matches = 0
                lord_win_rate = None

            lf = self.lords_fast.get(lord)
            if lf and lf.n > 0:
                f_l_recent_rank = lf.score / (lf.n + 8.0)
                f_l_pick_hot = (lf.picks / max(self.fast_total_picks, 6.0)) - (1.0 / 16.0)
            else:
                f_l_recent_rank = 0.0
                f_l_pick_hot = -1.0 / 16.0

            pl = self.player_lords.get((player, lord))
            if pl and pl.matches > 0:
                f_pl_syn = pl.res_score / (pl.n + 6.0)
                pl_matches = pl.matches
                pl_wins = pl.wins
                pl_avg_place = round(pl.place_sum / pl.matches, 2)
            else:
                f_pl_syn = 0.0
                pl_matches = 0
                pl_wins = 0
                pl_avg_place = None

            mirror_rivals = max(0, lord_counts[lord] - 1)
            f_mirror = math.log1p(mirror_rivals)

            # 禁阵营 × 棋手 BP 适配：使用去撞车独享加权统计，避免多同行内卷掩盖真实上限
            if (
                banned_faction
                and self.solo_lord_n[lord] > 1.0
                and self.solo_ban_totals[banned_faction] > 6.0
            ):
                base_w = (self.solo_lord_w[lord] + 1.0) / (self.solo_lord_n[lord] + 6.0)
                base_sc = self.solo_lord_sc[lord] / (self.solo_lord_n[lord] + 6.0)
                lbn_solo = self.solo_ban_n[(lord, banned_faction)]
                f_ban_win = (
                    (self.solo_ban_w[(lord, banned_faction)] + 6.0 * base_w) / (lbn_solo + 6.0)
                    - base_w
                ) * 6.0
                f_ban_rank = (
                    self.solo_ban_sc[(lord, banned_faction)] + 6.0 * base_sc
                ) / (lbn_solo + 6.0) - base_sc

                p_l_given_b = (lbn_solo + 1.5) / (self.solo_ban_totals[banned_faction] + 30.0)
                p_l = (self.solo_lord_n[lord] + 1.5) / (self.solo_total_picks + 30.0)
                f_ban_pick = math.log(p_l_given_b / p_l)

                bp_heat = max(0.0, f_ban_pick) + max(0.0, f_ban_win)
                f_mirror_ban = f_mirror * bp_heat

                lb = self.lord_bans.get((lord, banned_faction))
                lb_matches = lb.matches if lb else 0
                lb_win_rate = round(lb.wins / lb.matches * 100, 1) if lb and lb.matches else None
                lb_avg_place = round(lb.place_sum / lb.matches, 2) if lb and lb.matches else None
            else:
                f_ban_win = 0.0
                f_ban_rank = 0.0
                f_ban_pick = 0.0
                f_mirror_ban = 0.0
                lb = self.lord_bans.get((lord, banned_faction)) if banned_faction else None
                lb_matches = lb.matches if lb else 0
                lb_win_rate = round(lb.wins / lb.matches * 100, 1) if lb and lb.matches else None
                lb_avg_place = round(lb.place_sum / lb.matches, 2) if lb and lb.matches else None

            features[idx] = [
                f_rating,
                f_p_win,
                f_p_top3,
                f_recent,
                f_l_win,
                f_l_rank,
                f_l_top3,
                f_l_anti6,
                f_l_recent_rank,
                f_l_pick_hot,
                f_pl_syn,
                f_ban_win,
                f_ban_rank,
                f_ban_pick,
                f_mirror,
                f_mirror_ban,
            ]
            metas.append(
                {
                    "is_new_player": player_matches == 0,
                    "player_matches": player_matches,
                    "player_mu": round(player_mu, 2),
                    "player_sigma": round(player_sigma, 2),
                    "player_avg_place": player_avg_place,
                    "recent_avg_place": recent_avg_place,
                    "lord_matches": lord_matches,
                    "lord_win_rate": lord_win_rate,
                    "player_lord_matches": pl_matches,
                    "player_lord_wins": pl_wins,
                    "player_lord_avg_place": pl_avg_place,
                    "lord_ban_matches": lb_matches,
                    "lord_ban_win_rate": lb_win_rate,
                    "lord_ban_avg_place": lb_avg_place,
                    "mirror_rivals": mirror_rivals,
                }
            )

        return features, metas

    def update_with_match(self, match: dict) -> None:
        """用已结束的一场真实对局更新人棋解耦 OpenSkill 与所有同步衰减统计"""

        players = match["players"]
        banned_faction = match.get("banned_faction") or ""
        lord_counts = Counter(p["lord"] for p in players)

        # --- 1) 棋手强度校准版 Weng-Lin Plackett-Luce 更新（人棋解耦） ---
        trackers = [self._get_player(p["player"]) for p in players]
        sigmas = [math.sqrt(t.sigma * t.sigma + DEFAULT_TAU * DEFAULT_TAU) for t in trackers]
        lord_offsets: list[float] = []
        for p in players:
            ls = self.lords_slow.get(p["lord"])
            l_eff = (ls.score / (ls.n + 10.0)) * 3.5 if ls and ls.n > 0 else 0.0
            m_pen = -0.8 * math.log1p(max(0, lord_counts[p["lord"]] - 1))
            lord_offsets.append(l_eff + m_pen)

        mus_base = [t.mu for t in trackers]
        mus_eff = [mus_base[i] + lord_offsets[i] for i in range(6)]
        places = [int(p["place"]) for p in players]

        c = math.sqrt(sum(s * s + DEFAULT_BETA * DEFAULT_BETA for s in sigmas))
        mean_eff = sum(mus_eff) / 6.0
        exp_vals = [math.exp((m - mean_eff) / c) for m in mus_eff]

        for i in range(6):
            r_i = places[i]
            s_i2 = sigmas[i] * sigmas[i]
            gamma_i = sigmas[i] / c
            omega_i = 0.0
            delta_i = 0.0

            for q in range(6):
                r_q = places[q]
                if r_q <= r_i:
                    denom = sum(exp_vals[j] for j in range(6) if places[j] >= r_q)
                    prob = exp_vals[i] / denom
                    indicator = 1.0 if r_q == r_i else 0.0
                    omega_i += (s_i2 / c) * (indicator - prob)
                    delta_i += gamma_i * (s_i2 / (c * c)) * prob * (1.0 - prob)

            trackers[i].mu = mus_base[i] + omega_i
            trackers[i].sigma = sigmas[i] * math.sqrt(max(1.0 - delta_i, 1e-4))

        # --- 2) 同步时间衰减（确保全局基准与禁阵营分项完全同频） ---
        for st in self.players.values():
            st.decayed_n *= PLAYER_DECAY
            st.decayed_win *= PLAYER_DECAY
            st.decayed_top3 *= PLAYER_DECAY
            st.decayed_score *= PLAYER_DECAY

        for ls in self.lords_slow.values():
            ls.n *= LORD_SLOW_DECAY
            ls.win *= LORD_SLOW_DECAY
            ls.top3 *= LORD_SLOW_DECAY
            ls.score *= LORD_SLOW_DECAY
            ls.bot1 *= LORD_SLOW_DECAY
        self.slow_total_picks *= LORD_SLOW_DECAY

        for b_key in list(self.ban_totals.keys()):
            self.ban_totals[b_key] *= LORD_SLOW_DECAY
        for lb in self.lord_bans.values():
            lb.n *= LORD_SLOW_DECAY
            lb.win_decayed *= LORD_SLOW_DECAY
            lb.score_decayed *= LORD_SLOW_DECAY

        for lf in self.lords_fast.values():
            lf.n *= LORD_FAST_DECAY
            lf.win *= LORD_FAST_DECAY
            lf.score *= LORD_FAST_DECAY
            lf.picks *= LORD_PICK_DECAY
        self.fast_total_picks *= LORD_PICK_DECAY

        for k in list(self.solo_lord_n.keys()):
            self.solo_lord_n[k] *= LORD_SLOW_DECAY
            self.solo_lord_w[k] *= LORD_SLOW_DECAY
            self.solo_lord_sc[k] *= LORD_SLOW_DECAY
        self.solo_total_picks *= LORD_SLOW_DECAY
        for k in list(self.solo_ban_totals.keys()):
            self.solo_ban_totals[k] *= LORD_SLOW_DECAY
        for k in list(self.solo_ban_n.keys()):
            self.solo_ban_n[k] *= LORD_SLOW_DECAY
            self.solo_ban_w[k] *= LORD_SLOW_DECAY
            self.solo_ban_sc[k] *= LORD_SLOW_DECAY

        # --- 3) 写入本场实绩 ---
        for p, p_st in zip(players, trackers):
            place = int(p["place"])
            score = _place_to_score(place)
            lord = p["lord"]
            is_win = 1.0 if place == 1 else 0.0
            is_top3 = 1.0 if place <= 3 else 0.0
            is_bot1 = 1.0 if place == 6 else 0.0

            ls_prev = self.lords_slow.get(lord)
            p_base = p_st.decayed_score / (p_st.decayed_n + 8.0) if p_st.decayed_n > 0 else 0.0
            l_base = ls_prev.score / (ls_prev.n + 10.0) if ls_prev and ls_prev.n > 0 else 0.0

            pl_key = (p["player"], lord)
            pl = self.player_lords.get(pl_key)
            if pl is None:
                pl = _PairStats()
                self.player_lords[pl_key] = pl
            pl.n = pl.n * PAIR_DECAY + 1.0
            pl.res_score = pl.res_score * PAIR_DECAY + (score - 0.5 * (p_base + l_base))
            pl.matches += 1
            pl.wins += int(is_win)
            pl.place_sum += place

            if banned_faction:
                self.ban_totals[banned_faction] += 1.0
                lb_key = (lord, banned_faction)
                lb = self.lord_bans.get(lb_key)
                if lb is None:
                    lb = _PairStats()
                    self.lord_bans[lb_key] = lb
                lb.n += 1.0
                lb.win_decayed += is_win
                lb.score_decayed += score
                lb.matches += 1
                lb.wins += int(is_win)
                lb.place_sum += place

            p_st.matches += 1
            p_st.wins += int(is_win)
            p_st.score_sum += score
            p_st.decayed_n += 1.0
            p_st.decayed_win += is_win
            p_st.decayed_top3 += is_top3
            p_st.decayed_score += score
            p_st.recent_scores.append(score)
            p_st.recent_places.append(place)

            ls = self.lords_slow.get(lord)
            if ls is None:
                ls = _LordSlowStats()
                self.lords_slow[lord] = ls
            ls.matches += 1
            ls.wins += int(is_win)
            ls.n += 1.0
            ls.win += is_win
            ls.top3 += is_top3
            ls.score += score
            ls.bot1 += is_bot1
            self.slow_total_picks += 1.0

            lf = self.lords_fast.get(lord)
            if lf is None:
                lf = _LordFastStats()
                self.lords_fast[lord] = lf
            lf.n += 1.0
            lf.win += is_win
            lf.score += score
            lf.picks += 1.0
            self.fast_total_picks += 1.0

            rivals = max(0, lord_counts[lord] - 1)
            solo_w = 1.0 if rivals == 0 else (0.35 if rivals == 1 else 0.15)
            self.solo_lord_n[lord] += solo_w
            self.solo_lord_w[lord] += solo_w * is_win
            self.solo_lord_sc[lord] += solo_w * score
            self.solo_total_picks += solo_w
            if banned_faction:
                self.solo_ban_totals[banned_faction] += solo_w
                self.solo_ban_n[(lord, banned_faction)] += solo_w
                self.solo_ban_w[(lord, banned_faction)] += solo_w * is_win
                self.solo_ban_sc[(lord, banned_faction)] += solo_w * score


def _fit_constrained_pl(
    x_ordered: np.ndarray,
    stage_weights: tuple[float, float, float, float, float],
    l2_reg: float,
    signs: np.ndarray,
    sample_decay: float = SAMPLE_DECAY,
) -> np.ndarray:
    """在组内标准化空间上用活跃集投影牛顿法拟合带单调符号约束的 Plackett-Luce 权重"""

    m_count, _, d_dim = x_ordered.shape
    if m_count == 0:
        return np.where(signs >= 0, 0.2, -0.2)

    x_centered = x_ordered - np.mean(x_ordered, axis=1, keepdims=True)
    scales = np.sqrt(np.mean(x_centered**2, axis=(0, 1)))
    scales = np.where(scales > 1e-6, scales, 1.0)
    z_ord = x_centered / scales[None, None, :]

    if sample_decay < 1.0:
        sw = np.power(sample_decay, np.arange(m_count - 1, -1, -1, dtype=np.float64))
    else:
        sw = np.ones(m_count, dtype=np.float64)
    sw /= np.sum(sw)

    lb = np.where(signs >= 0, 0.0, -np.inf)
    ub = np.where(signs <= 0, 0.0, np.inf)
    w_sum = sum(stage_weights)

    def obj(beta: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
        scores = np.einsum("mnd,d->mn", z_ord, beta)
        loss = 0.0
        grad = np.zeros(d_dim, dtype=np.float64)
        hess = np.zeros((d_dim, d_dim), dtype=np.float64)
        for k in range(5):
            wk = stage_weights[k] / w_sum
            if wk <= 0:
                continue
            sub_s = scores[:, k:]
            sub_z = z_ord[:, k:, :]
            max_s = np.max(sub_s, axis=1, keepdims=True)
            shifted = sub_s - max_s
            exp_s = np.exp(shifted)
            sum_exp = np.sum(exp_s, axis=1, keepdims=True)
            probs = exp_s / sum_exp

            loss += wk * float(np.sum(sw * (np.log(sum_exp[:, 0]) - shifted[:, 0])))
            exp_z = np.einsum("mn,mnd->md", probs, sub_z)
            grad += wk * np.einsum("m,md->d", sw, exp_z - sub_z[:, 0, :])
            diff = sub_z - exp_z[:, None, :]
            hess += wk * np.einsum("m,mn,mnd,mne->de", sw, probs, diff, diff)

        loss += 0.5 * l2_reg * float(np.dot(beta, beta))
        grad += l2_reg * beta
        hess += l2_reg * np.eye(d_dim, dtype=np.float64)
        return loss, grad, hess

    beta = np.zeros(d_dim, dtype=np.float64)
    for _ in range(35):
        loss, grad, hess = obj(beta)
        act_low = (beta <= lb + 1e-10) & (grad > 0)
        act_high = (beta >= ub - 1e-10) & (grad < 0)
        free = ~(act_low | act_high)
        if not np.any(free):
            break
        free_grad = grad[free]
        if float(np.linalg.norm(free_grad)) < 1e-7:
            break

        free_hess = hess[np.ix_(free, free)]
        step = np.zeros(d_dim, dtype=np.float64)
        try:
            step[free] = np.linalg.solve(free_hess, free_grad)
        except np.linalg.LinAlgError:
            step[free] = np.linalg.lstsq(free_hess, free_grad, rcond=None)[0]

        alpha = 1.0
        while alpha > 1e-5:
            cand = np.clip(beta - alpha * step, lb, ub)
            cand_loss, _, _ = obj(cand)
            if cand_loss <= loss - 1e-4 * float(np.dot(grad, beta - cand)):
                beta = cand
                break
            alpha *= 0.5
        else:
            break

    return beta / scales


def _evaluate_dual_head(
    theta_win: np.ndarray,
    theta_rank: np.ndarray,
    x_eval: np.ndarray,
) -> dict[str, float]:
    """在样本外历史对局上评估双头模型（先随机置乱 0..5 索引，消除同分排序偏置）"""

    m_count = x_eval.shape[0]
    if m_count == 0:
        return {
            "eval_matches": 0,
            "win_logloss": round(math.log(6.0), 4),
            "baseline_logloss": round(math.log(6.0), 4),
            "logloss_gain_pct": 0.0,
            "brier_score": round((1.0 / 6.0) * (5.0 / 6.0), 4),
            "top1_hit_rate": 16.7,
            "top2_hit_rate": 33.3,
            "top3_cover_rate": 50.0,
            "top3_accuracy": 50.0,
            "top3_avg_overlap": 1.5,
            "kendall_tau": 0.0,
        }

    rng = np.random.default_rng(20261126)
    logloss_sum = 0.0
    brier_sum = 0.0
    top1_hits = 0
    top2_hits = 0
    top3_cover_hits = 0
    top3_overlap_sum = 0
    tau_sum = 0.0

    for idx in range(m_count):
        s_win = x_eval[idx][:, WIN_COLS] @ theta_win
        s_rank = x_eval[idx][:, RANK_COLS] @ theta_rank
        _, win_p, top3_p, exp_pl = _stage_plackett_luce_exact_probs(s_win, s_rank)

        perm = rng.permutation(6)
        actual_places = perm + 1
        wp = win_p[perm]
        t3p = top3_p[perm]
        ep = exp_pl[perm]

        champ_pos = int(np.where(actual_places == 1)[0][0])
        actual_top3_pos = {int(i) for i in np.where(actual_places <= 3)[0]}

        logloss_sum += -math.log(max(float(wp[champ_pos]), 1e-6))
        target_win = (actual_places == 1).astype(np.float64)
        brier_sum += float(np.mean((wp - target_win) ** 2))

        order_by_win = list(np.argsort(-wp))
        if order_by_win[0] == champ_pos:
            top1_hits += 1
        if champ_pos in order_by_win[:2]:
            top2_hits += 1
        if champ_pos in order_by_win[:3]:
            top3_cover_hits += 1

        pred_top3_pos = {int(i) for i in np.argsort(-t3p)[:3]}
        top3_overlap_sum += len(pred_top3_pos.intersection(actual_top3_pos))

        order_by_rank = list(np.argsort(ep))
        places_in_pred_order = [int(actual_places[i]) for i in order_by_rank]
        concordant = 0
        for a in range(6):
            for b in range(a + 1, 6):
                concordant += 1 if places_in_pred_order[a] < places_in_pred_order[b] else -1
        tau_sum += concordant / 15.0

    baseline_logloss = math.log(6.0)
    win_logloss = logloss_sum / m_count
    gain_pct = (baseline_logloss - win_logloss) / baseline_logloss * 100.0

    return {
        "eval_matches": int(m_count),
        "win_logloss": round(win_logloss, 4),
        "baseline_logloss": round(baseline_logloss, 4),
        "logloss_gain_pct": round(gain_pct, 2),
        "brier_score": round(brier_sum / m_count, 4),
        "top1_hit_rate": round(top1_hits / m_count * 100.0, 1),
        "top2_hit_rate": round(top2_hits / m_count * 100.0, 1),
        "top3_cover_rate": round(top3_cover_hits / m_count * 100.0, 1),
        "top3_accuracy": round(top3_overlap_sum / (3.0 * m_count) * 100.0, 1),
        "top3_avg_overlap": round(top3_overlap_sum / m_count, 2),
        "kendall_tau": round(tau_sum / m_count, 3),
    }


@dataclass
class _TrainedModelSnapshot:
    signature: tuple[int, str]
    total_matches: int
    ordered_matches: list[dict]
    match_index_by_id: dict[str, int]
    x_all: np.ndarray
    theta_win: np.ndarray
    theta_rank: np.ndarray
    best_l2_win: float
    best_l2_rank: float
    rolling_state: _RollingState
    backtest: dict[str, float]


class WinRatePredictService:
    """进程级缓存的胜率预测服务：数仓有新对局时自动增量重训"""

    def __init__(self) -> None:
        self._snapshot: _TrainedModelSnapshot | None = None
        self._lock = asyncio.Lock()

    async def _ensure_model(self, repository: DWPredictRepository) -> _TrainedModelSnapshot:
        signature = await repository.get_data_signature()
        if self._snapshot is not None and self._snapshot.signature == signature:
            return self._snapshot

        async with self._lock:
            signature = await repository.get_data_signature()
            if self._snapshot is not None and self._snapshot.signature == signature:
                return self._snapshot

            matches = await repository.fetch_ordered_matches()
            snapshot = self._train_from_matches(matches, signature)
            self._snapshot = snapshot
            return snapshot

    def _fit_dual_heads(
        self,
        x_hist: np.ndarray,
        l2_win: float,
        l2_rank: float,
    ) -> tuple[np.ndarray, np.ndarray]:
        theta_win = _fit_constrained_pl(
            x_hist[:, :, WIN_COLS],
            WIN_STAGE_WEIGHTS,
            l2_win,
            WIN_SIGNS,
            sample_decay=SAMPLE_DECAY,
        )
        theta_rank = _fit_constrained_pl(
            x_hist[:, :, RANK_COLS],
            RANK_STAGE_WEIGHTS,
            l2_rank,
            RANK_SIGNS,
            sample_decay=SAMPLE_DECAY,
        )
        return theta_win, theta_rank

    def _train_from_matches(
        self,
        matches: list[dict],
        signature: tuple[int, str],
    ) -> _TrainedModelSnapshot:
        """严格按时间顺序滚算 15 维特征 -> 时序切分调参回测 -> 全量拟合双头权重"""

        rolling = _RollingState()
        ordered_feature_rows: list[np.ndarray] = []
        match_index_by_id: dict[str, int] = {}

        for idx, match in enumerate(matches):
            match_index_by_id[match["match_id"]] = idx
            sorted_players = sorted(match["players"], key=lambda p: p["place"])
            entries = [{"player": p["player"], "lord": p["lord"]} for p in sorted_players]
            feats, _ = rolling.extract_match_features(entries, match.get("banned_faction") or "")
            ordered_feature_rows.append(feats)
            rolling.update_with_match(match)

        total = len(ordered_feature_rows)
        if total < 40:
            theta_win = np.array(
                [0.15, 0.1, 0.08, 0.35, 0.25, 0.2, 0.12, 0.08, -0.2, -0.15],
                dtype=np.float64,
            )
            theta_rank = np.array(
                [0.15, 0.12, 0.1, 0.3, 0.15, 0.12, 0.15, 0.15, 0.08, -0.15, -0.1],
                dtype=np.float64,
            )
            x_empty = np.zeros((0, 6, len(RAW_FEATURE_NAMES)))
            return _TrainedModelSnapshot(
                signature=signature,
                total_matches=total,
                ordered_matches=matches,
                match_index_by_id=match_index_by_id,
                x_all=np.stack(ordered_feature_rows, axis=0) if total else x_empty,
                theta_win=theta_win,
                theta_rank=theta_rank,
                best_l2_win=0.5,
                best_l2_rank=0.8,
                rolling_state=rolling,
                backtest=_evaluate_dual_head(theta_win, theta_rank, x_empty),
            )

        x_all = np.stack(ordered_feature_rows, axis=0)
        warmup = max(25, int(total * 0.12))
        eval_size = min(100, max(25, int(total * 0.25)))
        split_idx = max(warmup + 15, total - eval_size)

        x_train = x_all[warmup:split_idx]
        x_eval = x_all[split_idx:]

        best_l2_win = 0.5
        best_l2_rank = 0.8
        best_logloss = float("inf")
        best_backtest: dict[str, float] = {}

        for cand_w, cand_r in ((0.35, 0.6), (0.5, 0.8), (0.8, 1.1), (1.2, 1.5)):
            cand_tw, cand_tr = self._fit_dual_heads(x_train, cand_w, cand_r)
            metrics = _evaluate_dual_head(cand_tw, cand_tr, x_eval)
            if metrics["win_logloss"] < best_logloss:
                best_logloss = metrics["win_logloss"]
                best_l2_win = cand_w
                best_l2_rank = cand_r
                best_backtest = metrics

        final_tw, final_tr = self._fit_dual_heads(x_all[warmup:], best_l2_win, best_l2_rank)

        return _TrainedModelSnapshot(
            signature=signature,
            total_matches=total,
            ordered_matches=matches,
            match_index_by_id=match_index_by_id,
            x_all=x_all,
            theta_win=final_tw,
            theta_rank=final_tr,
            best_l2_win=best_l2_win,
            best_l2_rank=best_l2_rank,
            rolling_state=rolling,
            backtest=best_backtest,
        )

    def _build_model_summary(self, snapshot: _TrainedModelSnapshot) -> dict[str, Any]:
        win_weights = [
            {
                "key": key,
                "label": label,
                "weight": round(float(snapshot.theta_win[idx]), 4),
            }
            for idx, (key, label) in enumerate(WIN_LABELS)
        ]
        rank_weights = [
            {
                "key": key,
                "label": label,
                "weight": round(float(snapshot.theta_rank[idx]), 4),
            }
            for idx, (key, label) in enumerate(RANK_LABELS)
        ]
        return {
            "total_matches": snapshot.total_matches,
            "best_l2": snapshot.best_l2_win,
            "best_l2_rank": snapshot.best_l2_rank,
            "backtest": snapshot.backtest,
            "feature_weights": win_weights,
            "rank_weights": rank_weights,
        }

    def _resolve_pre_match_context(
        self,
        snapshot: _TrainedModelSnapshot,
        before_match_id: str | None,
    ) -> tuple[_RollingState, np.ndarray, np.ndarray, bool]:
        """当复盘历史场次时，回退至该场开赛前历史快照与赛前拟合权重，实现 0 泄漏复盘"""

        if not before_match_id:
            return snapshot.rolling_state, snapshot.theta_win, snapshot.theta_rank, False

        match_idx = snapshot.match_index_by_id.get(before_match_id)
        if match_idx is None:
            return snapshot.rolling_state, snapshot.theta_win, snapshot.theta_rank, False

        pre_rolling = _RollingState()
        for prev_match in snapshot.ordered_matches[:match_idx]:
            pre_rolling.update_with_match(prev_match)

        warmup = max(25, int(snapshot.total_matches * 0.12))
        if match_idx > warmup + 12:
            tw, tr = self._fit_dual_heads(
                snapshot.x_all[warmup:match_idx],
                snapshot.best_l2_win,
                snapshot.best_l2_rank,
            )
        else:
            tw, tr = snapshot.theta_win, snapshot.theta_rank

        return pre_rolling, tw, tr, True

    async def get_options(self, repository: DWPredictRepository) -> dict:
        """返回前端选人字典及当前双头模型摘要"""

        options = await repository.fetch_select_options()
        snapshot = await self._ensure_model(repository)
        options["model_summary"] = self._build_model_summary(snapshot)
        return options

    async def predict_match(
        self,
        repository: DWPredictRepository,
        banned_faction: str,
        seats: list[dict[str, Any]],
        before_match_id: str | None = None,
    ) -> dict:
        """毫秒级预测一场 6 人对局的吃鸡率、前三率、名次分布与 6 维语义归因"""

        snapshot = await self._ensure_model(repository)
        rolling_state, theta_win, theta_rank, replay_leak_free = self._resolve_pre_match_context(
            snapshot,
            before_match_id,
        )

        entries = [
            {
                "player": str(item["player"]).strip(),
                "lord": str(item["lord"]).strip(),
            }
            for item in seats
        ]
        feats, metas = rolling_state.extract_match_features(entries, banned_faction.strip())

        s_win = feats[:, WIN_COLS] @ theta_win
        s_rank = feats[:, RANK_COLS] @ theta_rank
        place_probs, win_probs, top3_probs, expected_places = _stage_plackett_luce_exact_probs(
            s_win,
            s_rank,
        )

        # 把双头贡献映射到 15 维全空间后，按 6 个语义维度汇总，确保前端归因与最终概率单调一致
        centered = feats - np.mean(feats, axis=0, keepdims=True)
        w_full_win = np.zeros(len(RAW_FEATURE_NAMES), dtype=np.float64)
        w_full_rank = np.zeros(len(RAW_FEATURE_NAMES), dtype=np.float64)
        w_full_win[WIN_COLS] = theta_win
        w_full_rank[RANK_COLS] = theta_rank
        # 吃鸡竞争力占 60% 权重、保分排位占 40% 权重形成综合可解释归因
        combined_weights = 0.6 * w_full_win + 0.4 * w_full_rank
        contribs_15 = centered * combined_weights[None, :]

        lord_counter = Counter(item["lord"] for item in entries)
        mirror_groups = [
            {"lord": lord, "count": cnt}
            for lord, cnt in lord_counter.items()
            if cnt >= 2
        ]

        seat_results: list[dict[str, Any]] = []
        for idx, item in enumerate(seats):
            seat_no = int(item.get("seat") or (idx + 1))
            meta = metas[idx]
            factors = [
                {
                    "key": g_key,
                    "label": g_label,
                    "impact": round(float(np.sum(contribs_15[idx, g_cols])), 3),
                    "raw_feature": round(float(np.mean(feats[idx, g_cols])), 3),
                }
                for g_key, g_label, g_cols in DISPLAY_GROUPS
            ]
            seat_results.append(
                {
                    "seat": seat_no,
                    "player": entries[idx]["player"],
                    "lord": entries[idx]["lord"],
                    "power_score": round(float(s_win[idx] - np.mean(s_win)), 3),
                    "win_prob": round(float(win_probs[idx] * 100.0), 2),
                    "top3_prob": round(float(top3_probs[idx] * 100.0), 2),
                    "expected_place": round(float(expected_places[idx]), 2),
                    "place_probs": [round(float(p * 100.0), 1) for p in place_probs[idx]],
                    "factors": factors,
                    "context": meta,
                }
            )

        ranked_seats = sorted(
            seat_results,
            key=lambda row: (-row["win_prob"], row["expected_place"], row["seat"]),
        )
        for rank_pos, row in enumerate(ranked_seats, start=1):
            row["predicted_rank"] = rank_pos

        return {
            "banned_faction": banned_faction.strip(),
            "replay_leak_free": replay_leak_free,
            "mirror_groups": mirror_groups,
            "seats": ranked_seats,
            "model_summary": self._build_model_summary(snapshot),
        }

    async def explain_prediction(
        self,
        repository: DWPredictRepository,
        banned_faction: str,
        seats: list[dict[str, Any]],
        before_match_id: str | None = None,
    ) -> dict:
        """基于双头模型算出的真实概率与归因明细，调用现有 LLM 生成简短中文赛前点评"""

        prediction = await self.predict_match(
            repository,
            banned_faction,
            seats,
            before_match_id=before_match_id,
        )
        ban_text = prediction["banned_faction"] or "未禁用阵营"
        mirror_text = (
            "、".join(f"{g['lord']}×{g['count']}" for g in prediction["mirror_groups"])
            if prediction["mirror_groups"]
            else "无撞棋手"
        )

        lines: list[str] = [
            f"本局禁用阵营：{ban_text}",
            f"同局撞棋手情况：{mirror_text}",
            f"模型训练样本：{prediction['model_summary']['total_matches']} 场历史对局",
            "6 位选手的量化预测结果（按预测吃鸡率降序）：",
        ]
        for row in prediction["seats"]:
            ctx = row["context"]
            top_factors = sorted(row["factors"], key=lambda f: abs(f["impact"]), reverse=True)[:3]
            factor_desc = "，".join(
                f"{f['label']}({f['impact']:+.2f})" for f in top_factors if abs(f["impact"]) >= 0.01
            ) or "各项接近平均"
            ban_desc = (
                f"，{ban_text}下该棋手{ctx['lord_ban_matches']}场吃鸡{ctx['lord_ban_win_rate']}%"
                if prediction["banned_faction"] and ctx["lord_ban_matches"] > 0
                else ""
            )
            sample_desc = (
                "库外新选手(默认先验)"
                if ctx["is_new_player"]
                else (
                    f"历史{ctx['player_matches']}场, 均名次{ctx['player_avg_place']}, "
                    f"近8场均名次{ctx['recent_avg_place']}, "
                    f"用{row['lord']}{ctx['player_lord_matches']}场{ctx['player_lord_wins']}鸡{ban_desc}"
                )
            )
            lines.append(
                f"- 预测第{row['predicted_rank']}：{row['seat']}号位 {row['player']}（{row['lord']}）"
                f"｜吃鸡率 {row['win_prob']}% / 前三率 {row['top3_prob']}% / 预期第{row['expected_place']}名"
                f"｜主要归因：{factor_desc}｜数据底色：{sample_desc}"
            )

        prompt = (
            "你是王牌对决（6人自走棋赛事）的专业赛前解说员。"
            "请严格依据下面模型算出的真实概率与归因数据，用简体中文写一段简洁有洞察力的赛前点评。\n"
            "要求：\n"
            "1. 绝不编造输入里没有的数字或历史战绩；\n"
            "2. 分 3 个简短小节输出，每节不超过 2 句话，总字数控制在 220 字以内：\n"
            "   - **夺冠热门**：点出头号热门及核心优势来源（如棋手吃鸡爆发力或禁用阵营红利）；\n"
            "   - **关键变数**：聚焦第二梯队竞争、同局撞棋手或禁用阵营影响；\n"
            "   - **风险与黑马**：提示小样本/新选手不确定性或偏弱席位的保分压力。\n"
            "3. 语气克制专业，直接输出正文，不要寒暄。\n\n"
            + "\n".join(lines)
        )

        response = await llm.ainvoke(prompt)
        content = response.content if isinstance(response.content, str) else str(response.content)
        return {
            "commentary": content.strip(),
            "prediction": prediction,
        }


# 应用内单例，复用进程级模型缓存
winrate_predict_service = WinRatePredictService()
