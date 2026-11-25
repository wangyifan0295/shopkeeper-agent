"""
胜率预测数仓只读仓储

为胜率预测引擎和前端选人页面提供数据读取：
1. 获取对局版本签名（总场次 + 最新场号），供内存模型缓存做 O(1) 增量失效检测
2. 按时间严格升序读取完整 6 人历史对局明细，供 OpenSkill 滚算与 Plackett-Luce 拟合
3. 读取现役禁用阵营、现役棋手统计、全量选手轻量索引以及最近对局（供一键复盘）
"""

from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _to_float(value: object) -> float:
    if isinstance(value, Decimal):
        return float(value)
    return float(value or 0.0)


class DWPredictRepository:
    """胜率预测模块专用的数仓只读查询"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_data_signature(self) -> tuple[int, str]:
        """返回 (历史对局总数, 最新对局编号)，用于检测是否导入了新对局"""

        sql = """
            select
                count(*) as total_matches,
                coalesce(max(match_id), '') as latest_match_id
            from fact_match
        """
        result = await self.session.execute(text(sql))
        row = result.mappings().fetchone()
        if not row:
            return (0, "")
        return (int(row["total_matches"] or 0), str(row["latest_match_id"] or ""))

    async def fetch_ordered_matches(self) -> list[dict]:
        """按时间严格升序读取全部完整 6 人历史对局，防未来数据泄漏"""

        sql = """
            select
                fm.match_id,
                fm.match_date,
                fm.slot_hour,
                fm.banned_faction,
                fmp.seat,
                fmp.player_name,
                fmp.lord_name,
                fmp.final_place
            from fact_match fm
            inner join fact_match_player fmp on fmp.match_id = fm.match_id
            order by fm.match_date asc, fm.slot_hour asc, fm.match_id asc, fmp.seat asc
        """
        result = await self.session.execute(text(sql))

        matches_map: dict[str, dict] = {}
        ordered_ids: list[str] = []
        for row in result.mappings().fetchall():
            match_id = str(row["match_id"])
            if match_id not in matches_map:
                ordered_ids.append(match_id)
                matches_map[match_id] = {
                    "match_id": match_id,
                    "match_date": str(row["match_date"]) if row["match_date"] is not None else "",
                    "slot_hour": int(row["slot_hour"]) if row["slot_hour"] is not None else 0,
                    "banned_faction": row["banned_faction"] or "",
                    "players": [],
                }
            matches_map[match_id]["players"].append(
                {
                    "seat": int(row["seat"]),
                    "player": str(row["player_name"]),
                    "lord": str(row["lord_name"]),
                    "place": int(row["final_place"]),
                }
            )

        # 仅保留 6 人且名次为 1-6 完整排列的有效历史局
        valid_matches: list[dict] = []
        for match_id in ordered_ids:
            match = matches_map[match_id]
            players = match["players"]
            if len(players) != 6:
                continue
            places = sorted(p["place"] for p in players)
            if places != [1, 2, 3, 4, 5, 6]:
                continue
            valid_matches.append(match)
        return valid_matches

    async def fetch_select_options(self, recent_limit: int = 25) -> dict:
        """读取前端快速选人所需的阵营、棋手、选手轻量索引与最近历史对局"""

        faction_sql = """
            select faction_name, is_enabled
            from dim_faction
            order by is_enabled desc, faction_name asc
        """
        faction_rows = (await self.session.execute(text(faction_sql))).mappings().fetchall()
        factions = [
            {
                "name": str(row["faction_name"]),
                "is_enabled": bool(row["is_enabled"]),
            }
            for row in faction_rows
        ]

        lord_sql = """
            select
                dl.lord_name,
                dl.is_enabled,
                count(fmp.match_id) as matches,
                coalesce(round(sum(fmp.final_place = 1) / nullif(count(fmp.match_id), 0) * 100, 1), 0) as win_rate,
                coalesce(round(avg(fmp.final_place), 2), 0) as avg_place
            from dim_lord dl
            left join fact_match_player fmp on fmp.lord_name = dl.lord_name
            group by dl.lord_name, dl.is_enabled
            order by dl.is_enabled desc, matches desc, dl.lord_name asc
        """
        lord_rows = (await self.session.execute(text(lord_sql))).mappings().fetchall()
        lords = [
            {
                "name": str(row["lord_name"]),
                "is_enabled": bool(row["is_enabled"]),
                "matches": int(row["matches"] or 0),
                "win_rate": _to_float(row["win_rate"]),
                "avg_place": _to_float(row["avg_place"]),
            }
            for row in lord_rows
        ]

        # 全量选手轻量索引，按出场次数降序方便前端常客置顶、0 延迟模糊匹配
        player_sql = """
            with ranked as (
                select
                    fmp.player_name,
                    fmp.final_place,
                    row_number() over (
                        partition by fmp.player_name
                        order by fm.match_date desc, fm.slot_hour desc, fm.match_id desc
                    ) as rn
                from fact_match_player fmp
                left join fact_match fm on fm.match_id = fmp.match_id
            )
            select
                player_name as name,
                count(*) as matches,
                round(sum(final_place = 1) / count(*) * 100, 1) as win_rate,
                round(avg(final_place), 2) as avg_place,
                round(
                    sum(case when rn <= 8 and final_place = 1 then 1 else 0 end)
                    / sum(case when rn <= 8 then 1 else 0 end) * 100,
                    1
                ) as recent_win_rate
            from ranked
            group by player_name
            order by matches desc, win_rate desc, player_name asc
        """
        player_rows = (await self.session.execute(text(player_sql))).mappings().fetchall()
        players = [
            {
                "name": str(row["name"]),
                "matches": int(row["matches"] or 0),
                "win_rate": _to_float(row["win_rate"]),
                "avg_place": _to_float(row["avg_place"]),
                "recent_win_rate": _to_float(row["recent_win_rate"]),
            }
            for row in player_rows
        ]

        recent_matches_sql = """
            select match_id, match_date, slot_hour, banned_faction
            from fact_match
            order by match_date desc, slot_hour desc, match_id desc
            limit :limit
        """
        recent_headers = (
            await self.session.execute(text(recent_matches_sql), {"limit": recent_limit})
        ).mappings().fetchall()

        recent_matches: list[dict] = []
        if recent_headers:
            ids = [str(row["match_id"]) for row in recent_headers]
            placeholders = ", ".join(f":id_{idx}" for idx in range(len(ids)))
            params = {f"id_{idx}": match_id for idx, match_id in enumerate(ids)}
            detail_sql = f"""
                select match_id, seat, player_name, lord_name, final_place
                from fact_match_player
                where match_id in ({placeholders})
                order by seat asc
            """
            detail_rows = (
                await self.session.execute(text(detail_sql), params)
            ).mappings().fetchall()

            players_by_match: dict[str, list[dict]] = {mid: [] for mid in ids}
            for row in detail_rows:
                players_by_match[str(row["match_id"])].append(
                    {
                        "seat": int(row["seat"]),
                        "player": str(row["player_name"]),
                        "lord": str(row["lord_name"]),
                        "place": int(row["final_place"]),
                    }
                )

            for header in recent_headers:
                mid = str(header["match_id"])
                seats = players_by_match.get(mid, [])
                if len(seats) != 6:
                    continue
                recent_matches.append(
                    {
                        "match_id": mid,
                        "match_date": str(header["match_date"]),
                        "slot_hour": int(header["slot_hour"] or 0),
                        "banned_faction": str(header["banned_faction"] or ""),
                        "players": seats,
                    }
                )

        return {
            "factions": factions,
            "lords": lords,
            "players": players,
            "recent_matches": recent_matches,
        }
