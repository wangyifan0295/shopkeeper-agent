"""
王牌对决 6 人胜率预测引擎

针对 400+ 场中小样本 6 人混战（Free-For-All）场景设计，兼顾准确度、防过拟合与可解释性：
1. 底层实力引擎：Weng-Lin (2011) Plackett-Luce 多人排位评级（OpenSkill 同源公式），
   按时间严格升序滚算每位选手的实力均值 mu 与不确定度 sigma。
2. 六维可解释特征（严格赛前滚算，杜绝未来数据泄漏）：
   - player_rating: 选手天梯底力（OpenSkill mu 收缩）
   - recent_form: 近 8 场状态手感（贝叶斯平滑）
   - lord_strength: 棋手版本强度（指数时间衰减 + 贝叶斯平滑）
   - player_lord_synergy: 选手 × 棋手专精加成（残差贝叶斯收缩）
   - lord_ban_fit: 棋手 × 禁用阵营 BP 适配（残差贝叶斯收缩）
   - mirror_count: 同局撞棋手数（同行竞争人数）
3. 权重自动拟合：基于历史完整 1-6 名排列最大化 Plackett-Luce 对数似然 + L2 正则，
   通过时序验证自动挑选正则强度 lambda，避免人工拍脑袋定权重。
4. 精确概率求解：遍历 6! = 720 种名次排列，无随机误差地算出吃鸡率（和=100%）、
   前三率（和=300%）、预期名次（和=21.0）与 1-6 名完整概率分布。
"""

import asyncio
import math
from collections import Counter, deque
from dataclasses import dataclass, field
from itertools import permutations
from typing import Any

import numpy as np

from app.agent.llm import llm
from app.repositories.mysql.dw.dw_predict_repository import DWPredictRepository

# 特征顺序常量，与权重向量 theta 及前端归因展示一一对应
FEATURE_SPECS: list[tuple[str, str]] = [
    ("player_rating", "选手天梯实力"),
    ("recent_form", "近 8 场手感"),
    ("lord_strength", "棋手版本强度"),
    ("player_lord_synergy", "人棋专精熟练度"),
    ("lord_ban_fit", "禁阵营 BP 适配"),
    ("mirror_count", "同局撞棋手竞争"),
]

# Weng-Lin Plackett-Luce 默认超参（与 OpenSkill PlackettLuce 一致）
DEFAULT_MU = 25.0
DEFAULT_SIGMA = 25.0 / 3.0
DEFAULT_BETA = DEFAULT_SIGMA / 2.0
DEFAULT_TAU = DEFAULT_SIGMA / 100.0

# 棋手时间衰减因子：每场约衰减 0.9942（半衰期 ~120 场对局）
LORD_DECAY = 0.9942

# 6 席位全排列（720 种）启动时预生成，单次预测耗时 < 1ms
_PERMS_6 = np.array(list(permutations(range(6))), dtype=np.int8)


def _place_to_score(place: int) -> float:
    """把 1-6 名线性映射到 [+1.0, -1.0]，均值 3.5 对应 0.0"""

    return (3.5 - float(place)) / 2.5


def _plackett_luce_exact_probs(scores: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """基于 6! = 720 种全排列精确求解 Plackett-Luce 名次概率分布

    Returns:
        place_probs: (6, 6) 矩阵，place_probs[i, r] 表示第 i 个席位获得第 r+1 名的概率
        win_probs: (6,) 吃鸡率，之和严格等于 1.0
        top3_probs: (6,) 前三率，之和严格等于 3.0
        expected_places: (6,) 预期名次，之和严格等于 21.0
    """

    shifted = scores - np.max(scores)
    weights = np.exp(np.clip(shifted, -30.0, 0.0))

    # perm_w[p, k] = 第 p 种排列中第 k 个位置所选席位的权重 u_{i_k}
    perm_w = weights[_PERMS_6]  # shape: (720, 6)
    # 后缀和：suffix_sum[p, k] = sum_{j=k..5} perm_w[p, j]
    suffix_sum = np.cumsum(perm_w[:, ::-1], axis=1)[:, ::-1]
    # 每种排列的精确概率
    perm_probs = np.prod(perm_w[:, :5] / suffix_sum[:, :5], axis=1)  # shape: (720,)

    place_probs = np.zeros((6, 6), dtype=np.float64)
    for rank_idx in range(6):
        np.add.at(place_probs[:, rank_idx], _PERMS_6[:, rank_idx], perm_probs)

    # 数值归一化兜底，消除浮点末位误差
    place_probs = np.clip(place_probs, 0.0, 1.0)
    row_sums = place_probs.sum(axis=1, keepdims=True)
    place_probs = np.where(row_sums > 0, place_probs / row_sums, 1.0 / 6.0)

    win_probs = place_probs[:, 0]
    top3_probs = place_probs[:, :3].sum(axis=1)
    ranks = np.arange(1, 7, dtype=np.float64)
    expected_places = place_probs @ ranks
    return place_probs, win_probs, top3_probs, expected_places


@dataclass
class _PlayerTracker:
    mu: float = DEFAULT_MU
    sigma: float = DEFAULT_SIGMA
    matches: int = 0
    wins: int = 0
    top3: int = 0
    score_sum: float = 0.0
    recent_scores: deque[float] = field(default_factory=lambda: deque(maxlen=8))
    recent_places: deque[int] = field(default_factory=lambda: deque(maxlen=8))


@dataclass
class _DecayedTracker:
    weighted_score: float = 0.0
    weight_sum: float = 0.0
    matches: int = 0
    wins: int = 0
    place_sum: float = 0.0


class _RollingState:
    """按时间顺序维护的赛前统计状态，既可用于离线防泄漏特征生成，也可直接用于在线推理"""

    def __init__(self) -> None:
        self.players: dict[str, _PlayerTracker] = {}
        self.lords: dict[str, _DecayedTracker] = {}
        self.player_lords: dict[tuple[str, str], _DecayedTracker] = {}
        self.lord_bans: dict[tuple[str, str], _DecayedTracker] = {}
        self.match_index: int = 0

    def _get_player(self, name: str) -> _PlayerTracker:
        tracker = self.players.get(name)
        if tracker is None:
            tracker = _PlayerTracker()
            self.players[name] = tracker
        return tracker

    def _lord_score(self, lord: str) -> float:
        tracker = self.lords.get(lord)
        if not tracker or tracker.weight_sum <= 0:
            return 0.0
        return tracker.weighted_score / (tracker.weight_sum + 8.0)

    def _player_base_score(self, player: str) -> float:
        tracker = self.players.get(player)
        if not tracker or tracker.matches == 0:
            return 0.0
        return tracker.score_sum / (tracker.matches + 6.0)

    def extract_match_features(
        self,
        entries: list[dict[str, str]],
        banned_faction: str,
    ) -> tuple[np.ndarray, list[dict[str, Any]]]:
        """在当前历史状态下，为一场 6 人对局提取 (6, 6) 特征矩阵与原始上下文"""

        lord_counts = Counter(item["lord"] for item in entries)
        features = np.zeros((6, len(FEATURE_SPECS)), dtype=np.float64)
        metas: list[dict[str, Any]] = []

        for idx, item in enumerate(entries):
            player = item["player"]
            lord = item["lord"]
            p_tracker = self.players.get(player)

            # 1. 选手天梯底力：OpenSkill mu 相对先验 25 的偏移，配合场次平滑防止 1-2 场虚高
            if p_tracker and p_tracker.matches > 0:
                shrink = p_tracker.matches / (p_tracker.matches + 2.0)
                f_rating = ((p_tracker.mu - DEFAULT_MU) / 5.0) * shrink
                recent_len = len(p_tracker.recent_scores)
                f_recent = sum(p_tracker.recent_scores) / (recent_len + 4.0)
                player_matches = p_tracker.matches
                player_mu = p_tracker.mu
                player_sigma = p_tracker.sigma
                player_avg_place = round(3.5 - 2.5 * (p_tracker.score_sum / p_tracker.matches), 2)
                recent_avg_place = (
                    round(sum(p_tracker.recent_places) / recent_len, 2) if recent_len else None
                )
            else:
                f_rating = 0.0
                f_recent = 0.0
                player_matches = 0
                player_mu = DEFAULT_MU
                player_sigma = DEFAULT_SIGMA
                player_avg_place = None
                recent_avg_place = None

            # 2. 棋手版本强度（指数衰减 + 贝叶斯平滑）
            f_lord = self._lord_score(lord)
            l_tracker = self.lords.get(lord)
            lord_matches = l_tracker.matches if l_tracker else 0
            lord_win_rate = (
                round(l_tracker.wins / l_tracker.matches * 100, 1)
                if l_tracker and l_tracker.matches > 0
                else None
            )

            # 3. 人棋专精熟练度：相对选手均分与棋手均分的超额表现，强贝叶斯收缩
            pl_tracker = self.player_lords.get((player, lord))
            if pl_tracker and pl_tracker.matches > 0:
                expected_baseline = 0.5 * self._player_base_score(player) + 0.5 * f_lord
                excess_sum = pl_tracker.weighted_score - pl_tracker.weight_sum * expected_baseline
                f_synergy = excess_sum / (pl_tracker.weight_sum + 6.0)
                pl_matches = pl_tracker.matches
                pl_wins = pl_tracker.wins
                pl_avg_place = round(pl_tracker.place_sum / pl_tracker.matches, 2)
            else:
                f_synergy = 0.0
                pl_matches = 0
                pl_wins = 0
                pl_avg_place = None

            # 4. 棋手 × 禁用阵营 BP 适配：相对该棋手全局表现的超额得分
            if banned_faction:
                lb_tracker = self.lord_bans.get((lord, banned_faction))
                if lb_tracker and lb_tracker.matches > 0:
                    excess_ban = lb_tracker.weighted_score - lb_tracker.weight_sum * f_lord
                    f_ban_fit = excess_ban / (lb_tracker.weight_sum + 8.0)
                    lb_matches = lb_tracker.matches
                else:
                    f_ban_fit = 0.0
                    lb_matches = 0
            else:
                f_ban_fit = 0.0
                lb_matches = 0

            # 5. 同局撞棋手竞争人数（除自己外的同行数）
            mirror_rivals = max(0, lord_counts[lord] - 1)
            f_mirror = float(mirror_rivals)

            features[idx] = [
                f_rating,
                f_recent,
                f_lord,
                f_synergy,
                f_ban_fit,
                f_mirror,
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
                    "mirror_rivals": mirror_rivals,
                }
            )

        return features, metas

    def update_with_match(self, match: dict) -> None:
        """用已结束的一场真实对局更新 OpenSkill 评级与所有衰减统计"""

        self.match_index += 1
        # 指数衰减：每次只对现有棋手累计值乘一次衰减，避免数值溢出（等价于指数权重）
        for tracker in self.lords.values():
            tracker.weighted_score *= LORD_DECAY
            tracker.weight_sum *= LORD_DECAY

        players = match["players"]
        banned_faction = match.get("banned_faction") or ""

        # --- 1) Weng-Lin Plackett-Luce 评级更新 ---
        trackers = [self._get_player(p["player"]) for p in players]
        # 动态漂移：防止老选手 sigma 过小而失去适应新版本的能力
        sigmas = [math.sqrt(t.sigma * t.sigma + DEFAULT_TAU * DEFAULT_TAU) for t in trackers]
        mus = [t.mu for t in trackers]
        places = [int(p["place"]) for p in players]

        c = math.sqrt(sum(s * s + DEFAULT_BETA * DEFAULT_BETA for s in sigmas))
        # 减去均值防 exp 溢出，不影响比值 e_i / A_q
        mean_mu = sum(mus) / 6.0
        exp_vals = [math.exp((m - mean_mu) / c) for m in mus]

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

            trackers[i].mu = mus[i] + omega_i
            trackers[i].sigma = sigmas[i] * math.sqrt(max(1.0 - delta_i, 1e-4))

        # --- 2) 更新选手、棋手、人棋组合与禁阵营统计 ---
        for p, p_tracker in zip(players, trackers):
            place = int(p["place"])
            score = _place_to_score(place)
            lord = p["lord"]
            is_win = 1 if place == 1 else 0
            is_top3 = 1 if place <= 3 else 0

            p_tracker.matches += 1
            p_tracker.wins += is_win
            p_tracker.top3 += is_top3
            p_tracker.score_sum += score
            p_tracker.recent_scores.append(score)
            p_tracker.recent_places.append(place)

            l_tracker = self.lords.get(lord)
            if l_tracker is None:
                l_tracker = _DecayedTracker()
                self.lords[lord] = l_tracker
            l_tracker.weighted_score += score
            l_tracker.weight_sum += 1.0
            l_tracker.matches += 1
            l_tracker.wins += is_win
            l_tracker.place_sum += place

            pl_key = (p["player"], lord)
            pl_tracker = self.player_lords.get(pl_key)
            if pl_tracker is None:
                pl_tracker = _DecayedTracker()
                self.player_lords[pl_key] = pl_tracker
            pl_tracker.weighted_score += score
            pl_tracker.weight_sum += 1.0
            pl_tracker.matches += 1
            pl_tracker.wins += is_win
            pl_tracker.place_sum += place

            if banned_faction:
                lb_key = (lord, banned_faction)
                lb_tracker = self.lord_bans.get(lb_key)
                if lb_tracker is None:
                    lb_tracker = _DecayedTracker()
                    self.lord_bans[lb_key] = lb_tracker
                lb_tracker.weighted_score += score
                lb_tracker.weight_sum += 1.0
                lb_tracker.matches += 1
                lb_tracker.wins += is_win
                lb_tracker.place_sum += place


def _pl_loss_grad_hess(
    theta: np.ndarray,
    x_ordered: np.ndarray,
    l2_reg: float,
) -> tuple[float, np.ndarray, np.ndarray]:
    """计算整批历史对局的 Plackett-Luce 负对数似然 + L2 正则、梯度与 Hessian

    Args:
        theta: (D,) 特征权重
        x_ordered: (M, 6, D) 每场对局已按真实名次 1..6 排好序的赛前特征
        l2_reg: L2 正则系数
    """

    m_count, _, d_dim = x_ordered.shape
    scores = np.einsum("mnd,d->mn", x_ordered, theta)  # (M, 6)

    loss = 0.0
    grad = np.zeros(d_dim, dtype=np.float64)
    hess = np.zeros((d_dim, d_dim), dtype=np.float64)

    for k in range(5):
        sub_s = scores[:, k:]  # (M, 6-k)
        sub_x = x_ordered[:, k:, :]  # (M, 6-k, D)
        max_s = np.max(sub_s, axis=1, keepdims=True)
        shifted = sub_s - max_s
        exp_s = np.exp(shifted)
        sum_exp = np.sum(exp_s, axis=1, keepdims=True)
        probs = exp_s / sum_exp  # (M, 6-k)

        # 负对数似然：log(sum_exp) - shifted[:, 0]
        loss += float(np.sum(np.log(sum_exp[:, 0]) - shifted[:, 0]))

        # 期望特征 E[x] = sum_j p_j x_j
        exp_x = np.einsum("mn,mnd->md", probs, sub_x)  # (M, D)
        grad += np.sum(exp_x - sub_x[:, 0, :], axis=0)

        # 方差矩阵 sum_m sum_j p_j (x_j - E[x])(x_j - E[x])^T
        diff = sub_x - exp_x[:, None, :]  # (M, 6-k, D)
        hess += np.einsum("mn,mnd,mne->de", probs, diff, diff)

    inv_m = 1.0 / max(m_count, 1)
    loss = loss * inv_m + 0.5 * l2_reg * float(np.dot(theta, theta))
    grad = grad * inv_m + l2_reg * theta
    hess = hess * inv_m + l2_reg * np.eye(d_dim, dtype=np.float64)
    return loss, grad, hess


def _fit_plackett_luce(x_ordered: np.ndarray, l2_reg: float) -> np.ndarray:
    """阻尼牛顿法求解严格凸的 L2 正则 Plackett-Luce 权重"""

    d_dim = x_ordered.shape[2]
    if x_ordered.shape[0] == 0:
        return np.array([0.8, 0.3, 0.5, 0.25, 0.15, -0.1], dtype=np.float64)

    theta = np.zeros(d_dim, dtype=np.float64)
    for _ in range(25):
        loss, grad, hess = _pl_loss_grad_hess(theta, x_ordered, l2_reg)
        if float(np.linalg.norm(grad)) < 1e-7:
            break
        try:
            step = np.linalg.solve(hess, grad)
        except np.linalg.LinAlgError:
            step = np.linalg.lstsq(hess, grad, rcond=None)[0]

        # Armijo 回溯线搜索保证目标严格下降
        alpha = 1.0
        dot_gs = float(np.dot(grad, step))
        while alpha > 1e-4:
            cand = theta - alpha * step
            cand_loss, _, _ = _pl_loss_grad_hess(cand, x_ordered, l2_reg)
            if cand_loss <= loss - 1e-4 * alpha * dot_gs:
                theta = cand
                break
            alpha *= 0.5
        else:
            break
    return theta


def _evaluate_matches(theta: np.ndarray, x_ordered: np.ndarray) -> dict[str, float]:
    """在样本外历史对局上计算概率校准与排序命中指标"""

    m_count = x_ordered.shape[0]
    if m_count == 0:
        return {
            "eval_matches": 0,
            "win_logloss": round(math.log(6.0), 4),
            "baseline_logloss": round(math.log(6.0), 4),
            "logloss_gain_pct": 0.0,
            "brier_score": round((1.0 / 6.0) * (5.0 / 6.0), 4),
            "top1_hit_rate": 16.7,
            "top2_hit_rate": 33.3,
            "top3_avg_overlap": 1.5,
        }

    logloss_sum = 0.0
    brier_sum = 0.0
    top1_hits = 0
    top2_hits = 0
    top3_overlap_sum = 0

    for idx in range(m_count):
        # x_ordered[idx, 0] 是真实第 1 名，x_ordered[idx, 0..2] 是真实前 3 名
        scores = x_ordered[idx] @ theta
        _, win_probs, top3_probs, _ = _plackett_luce_exact_probs(scores)

        p_winner = float(np.clip(win_probs[0], 1e-6, 1.0))
        logloss_sum += -math.log(p_winner)

        target_win = np.array([1.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        brier_sum += float(np.mean((win_probs - target_win) ** 2))

        order_by_win = np.argsort(-win_probs)
        if int(order_by_win[0]) == 0:
            top1_hits += 1
        if 0 in order_by_win[:2]:
            top2_hits += 1

        pred_top3 = set(int(i) for i in np.argsort(-top3_probs)[:3])
        top3_overlap_sum += len(pred_top3.intersection({0, 1, 2}))

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
        "top3_avg_overlap": round(top3_overlap_sum / m_count, 2),
    }


@dataclass
class _TrainedModelSnapshot:
    signature: tuple[int, str]
    total_matches: int
    theta: np.ndarray
    best_l2: float
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
            # 双重检查，避免并发首个请求重复重训
            signature = await repository.get_data_signature()
            if self._snapshot is not None and self._snapshot.signature == signature:
                return self._snapshot

            matches = await repository.fetch_ordered_matches()
            snapshot = self._train_from_matches(matches, signature)
            self._snapshot = snapshot
            return snapshot

    def _train_from_matches(
        self,
        matches: list[dict],
        signature: tuple[int, str],
    ) -> _TrainedModelSnapshot:
        """严格按时间顺序滚算特征 -> 时序切分调参回测 -> 全量拟合最终权重"""

        rolling = _RollingState()
        ordered_feature_rows: list[np.ndarray] = []

        for match in matches:
            # 按真实名次 1..6 排好序，再提取赛前特征（完全不使用本局赛果）
            sorted_players = sorted(match["players"], key=lambda p: p["place"])
            entries = [{"player": p["player"], "lord": p["lord"]} for p in sorted_players]
            feats, _ = rolling.extract_match_features(entries, match.get("banned_faction") or "")
            ordered_feature_rows.append(feats)
            rolling.update_with_match(match)

        total = len(ordered_feature_rows)
        if total < 30:
            theta = np.array([0.8, 0.3, 0.5, 0.2, 0.1, -0.08], dtype=np.float64)
            return _TrainedModelSnapshot(
                signature=signature,
                total_matches=total,
                theta=theta,
                best_l2=0.2,
                rolling_state=rolling,
                backtest=_evaluate_matches(theta, np.zeros((0, 6, len(FEATURE_SPECS)))),
            )

        x_all = np.stack(ordered_feature_rows, axis=0)  # (M, 6, D)
        # 前 15% 仅作 OpenSkill 与历史统计预热，不纳入似然拟合
        warmup = max(20, int(total * 0.15))
        eval_size = max(20, int(total * 0.20))
        split_idx = max(warmup + 10, total - eval_size)

        x_train = x_all[warmup:split_idx]
        x_eval = x_all[split_idx:]

        # 在时序验证集上挑选最优 L2 正则，防止小样本过拟合
        best_l2 = 0.25
        best_logloss = float("inf")
        best_backtest: dict[str, float] = {}
        for cand_l2 in (0.05, 0.12, 0.25, 0.5, 1.0, 2.0):
            cand_theta = _fit_plackett_luce(x_train, cand_l2)
            metrics = _evaluate_matches(cand_theta, x_eval)
            if metrics["win_logloss"] < best_logloss:
                best_logloss = metrics["win_logloss"]
                best_l2 = cand_l2
                best_backtest = metrics

        # 用最优正则在全部预热后数据上拟合最终线上权重
        final_theta = _fit_plackett_luce(x_all[warmup:], best_l2)

        return _TrainedModelSnapshot(
            signature=signature,
            total_matches=total,
            theta=final_theta,
            best_l2=best_l2,
            rolling_state=rolling,
            backtest=best_backtest,
        )

    async def get_options(self, repository: DWPredictRepository) -> dict:
        """返回前端选人字典及当前模型摘要"""

        options = await repository.fetch_select_options()
        snapshot = await self._ensure_model(repository)
        options["model_summary"] = {
            "total_matches": snapshot.total_matches,
            "best_l2": snapshot.best_l2,
            "backtest": snapshot.backtest,
            "feature_weights": [
                {
                    "key": key,
                    "label": label,
                    "weight": round(float(snapshot.theta[idx]), 4),
                }
                for idx, (key, label) in enumerate(FEATURE_SPECS)
            ],
        }
        return options

    async def predict_match(
        self,
        repository: DWPredictRepository,
        banned_faction: str,
        seats: list[dict[str, Any]],
    ) -> dict:
        """毫秒级预测一场 6 人对局的吃鸡率、前三率、名次分布与 6 维归因"""

        snapshot = await self._ensure_model(repository)
        entries = [
            {
                "player": str(item["player"]).strip(),
                "lord": str(item["lord"]).strip(),
            }
            for item in seats
        ]
        feats, metas = snapshot.rolling_state.extract_match_features(entries, banned_faction.strip())

        raw_scores = feats @ snapshot.theta
        place_probs, win_probs, top3_probs, expected_places = _plackett_luce_exact_probs(raw_scores)

        # 相对本局 6 人均值的净优势拆解（正数=高于本局平均，负数=低于本局平均）
        centered_feats = feats - np.mean(feats, axis=0, keepdims=True)
        contribs = centered_feats * snapshot.theta[None, :]  # (6, D)

        # 统计同局撞棋手信息
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
                    "key": key,
                    "label": label,
                    "impact": round(float(contribs[idx, f_idx]), 3),
                    "raw_feature": round(float(feats[idx, f_idx]), 3),
                }
                for f_idx, (key, label) in enumerate(FEATURE_SPECS)
            ]
            seat_results.append(
                {
                    "seat": seat_no,
                    "player": entries[idx]["player"],
                    "lord": entries[idx]["lord"],
                    "power_score": round(float(raw_scores[idx] - np.mean(raw_scores)), 3),
                    "win_prob": round(float(win_probs[idx] * 100.0), 2),
                    "top3_prob": round(float(top3_probs[idx] * 100.0), 2),
                    "expected_place": round(float(expected_places[idx]), 2),
                    "place_probs": [round(float(p * 100.0), 1) for p in place_probs[idx]],
                    "factors": factors,
                    "context": meta,
                }
            )

        # 同时提供按吃鸡率降序排好的名次序（不破坏原座位信息）
        ranked_seats = sorted(
            seat_results,
            key=lambda row: (-row["win_prob"], row["expected_place"], row["seat"]),
        )
        for rank_pos, row in enumerate(ranked_seats, start=1):
            row["predicted_rank"] = rank_pos

        return {
            "banned_faction": banned_faction.strip(),
            "mirror_groups": mirror_groups,
            "seats": ranked_seats,
            "model_summary": {
                "total_matches": snapshot.total_matches,
                "best_l2": snapshot.best_l2,
                "backtest": snapshot.backtest,
                "feature_weights": [
                    {
                        "key": key,
                        "label": label,
                        "weight": round(float(snapshot.theta[idx]), 4),
                    }
                    for idx, (key, label) in enumerate(FEATURE_SPECS)
                ],
            },
        }

    async def explain_prediction(
        self,
        repository: DWPredictRepository,
        banned_faction: str,
        seats: list[dict[str, Any]],
    ) -> dict:
        """基于模型算出的真实概率与归因明细，调用现有 LLM 生成简短中文赛前点评"""

        prediction = await self.predict_match(repository, banned_faction, seats)
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
            sample_desc = (
                "库外新选手(默认先验)"
                if ctx["is_new_player"]
                else (
                    f"历史{ctx['player_matches']}场, 均名次{ctx['player_avg_place']}, "
                    f"近8场均名次{ctx['recent_avg_place']}, "
                    f"用{row['lord']}{ctx['player_lord_matches']}场{ctx['player_lord_wins']}鸡"
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
            "   - **夺冠热门**：点出头号热门及核心优势来源；\n"
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
