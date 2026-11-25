"""
数仓统计仓储

面向前端数据页面（选手榜、选手详情、棋手榜）的只读聚合查询。
与 DWMySQLRepository 的分工：那边服务于 SQL 生成闭环（补齐元数据、校验、
执行模型生成的 SQL），这边是预先写死口径的统计 SQL，不经过 LLM，
路由层传参进来直接聚合 fact_match_player 返回 JSON。

指标口径与 conf/meta_config.yaml 里的定义保持一致：
- 吃鸡率（win_rate）= sum(final_place = 1) / count(*)，即问数链路里的"胜率"
- 前三率（top3_rate）= sum(final_place <= 3) / count(*)
- 平均名次（avg_place）= avg(final_place)
"""

from decimal import Decimal

from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

# 选手榜允许的排序字段白名单：接口参数 -> SQL 列别名。
# 只做映射不做字符串拼接透传，排序方向单独枚举，避免 ORDER BY 注入
PLAYER_SORT_COLUMNS = {
    "matches": "matches",
    "win_rate": "win_rate",
    "recent_win_rate": "recent_win_rate",
    "top3_rate": "top3_rate",
    "avg_place": "avg_place",
}

# 选手 / 棋手两条聚合链路共用的同一组指标表达式，保证口径一致
_PLAYER_METRICS = """
    count(*) as matches,
    sum(final_place = 1) as wins,
    round(sum(final_place = 1) / count(*) * 100, 2) as win_rate,
    round(sum(final_place <= 3) / count(*) * 100, 2) as top3_rate,
    round(avg(final_place), 2) as avg_place
"""


def _float_rows(rows) -> list[dict]:
    """把聚合结果行转成字典列表，并把 MySQL 返回的 Decimal 归一成 float"""

    return [
        {key: float(value) if isinstance(value, Decimal) else value for key, value in row.items()}
        for row in rows
    ]


class DWStatsRepository:
    """负责选手 / 棋手维度的胜率聚合统计"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_players(
        self,
        search: str = "",
        min_matches: int = 0,
        sort_by: str = "matches",
        order: str = "desc",
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """分页查询选手榜：服务端完成筛选、排序和分页，前端只消费结果"""

        # 排序列和方向都来自白名单，直接内插是安全的
        sort_column = PLAYER_SORT_COLUMNS[sort_by]
        direction = "desc" if order == "desc" else "asc"
        offset = (page - 1) * page_size

        # 用 INSTR 做子串匹配而不是 LIKE，选手名里的 % _ 等字符不会被当成通配符
        ranked_search_condition = (
            "where instr(fmp.player_name, :search) > 0" if search else ""
        )
        search_condition = (
            "where instr(player_name, :search) > 0" if search else ""
        )

        # 通过窗口函数为每位选手按对局时间倒序编号，同步聚合生涯指标与最近 8 场吃鸡率
        sql = f"""
            with ranked as (
                select
                    fmp.player_name,
                    fmp.final_place,
                    row_number() over (
                        partition by fmp.player_name
                        order by fm.match_date desc, fm.match_id desc
                    ) as rn
                from fact_match_player fmp
                left join fact_match fm on fm.match_id = fmp.match_id
                {ranked_search_condition}
            )
            select
                player_name as player,
                {_PLAYER_METRICS},
                sum(case when rn <= 8 then 1 else 0 end) as recent_matches,
                round(
                    sum(case when rn <= 8 and final_place = 1 then 1 else 0 end)
                    / sum(case when rn <= 8 then 1 else 0 end) * 100,
                    2
                ) as recent_win_rate
            from ranked
            group by player_name
            having matches >= :min_matches
            order by {sort_column} {direction}, matches desc
            limit :page_size offset :offset
        """
        result = await self.session.execute(
            text(sql),
            {
                "search": search,
                "min_matches": min_matches,
                "page_size": page_size,
                "offset": offset,
            },
        )
        rows = _float_rows(result.mappings().fetchall())

        # 命中总数单独 count：分页器需要知道筛选后的总人数
        count_sql = f"""
            select count(*) as total
            from (
                select player_name
                from fact_match_player
                {search_condition}
                group by player_name
                having count(*) >= :min_matches
            ) as filtered
        """
        count_result = await self.session.execute(
            text(count_sql),
            {"search": search, "min_matches": min_matches},
        )
        total = count_result.scalar() or 0

        return {
            "rows": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def get_player(self, player_name: str) -> dict | None:
        """查询单个选手的总指标和分棋手胜率明细，找不到时返回 None"""

        summary_sql = f"""
            select player_name as player, {_PLAYER_METRICS}
            from fact_match_player
            where player_name = :player_name
            group by player_name
        """
        summary_result = await self.session.execute(
            text(summary_sql),
            {"player_name": player_name},
        )
        summary_rows = _float_rows(summary_result.mappings().fetchall())
        if not summary_rows:
            return None

        # 分棋手胜率：该选手用过的每个棋手一行，按场次从高到低
        lord_sql = """
            select
                lord_name as lord,
                count(*) as matches,
                sum(final_place = 1) as wins,
                round(sum(final_place = 1) / count(*) * 100, 2) as win_rate,
                round(sum(final_place <= 3) / count(*) * 100, 2) as top3_rate
            from fact_match_player
            where player_name = :player_name
            group by lord_name
            order by matches desc
        """
        lord_result = await self.session.execute(
            text(lord_sql),
            {"player_name": player_name},
        )

        # 最近 8 场对局明细（按日期与场号倒序），用于计算近期吃鸡率与名次轨迹
        recent_sql = """
            select
                fm.match_id,
                fm.match_date,
                fmp.final_place as place,
                fmp.lord_name as lord
            from fact_match_player fmp
            left join fact_match fm on fm.match_id = fmp.match_id
            where fmp.player_name = :player_name
            order by fm.match_date desc, fmp.match_id desc
            limit 8
        """
        recent_result = await self.session.execute(
            text(recent_sql),
            {"player_name": player_name},
        )
        recent_records = [
            {
                "match_id": row["match_id"],
                "match_date": str(row["match_date"]) if row["match_date"] is not None else "",
                "place": int(row["place"]),
                "lord": row["lord"],
            }
            for row in recent_result.mappings().fetchall()
        ]
        recent_count = len(recent_records)
        recent_wins = sum(1 for item in recent_records if item["place"] == 1)
        recent_top3 = sum(1 for item in recent_records if item["place"] <= 3)
        recent_win_rate = round(recent_wins / recent_count * 100, 2) if recent_count else 0.0
        recent_top3_rate = round(recent_top3 / recent_count * 100, 2) if recent_count else 0.0
        recent_avg_place = (
            round(sum(item["place"] for item in recent_records) / recent_count, 2)
            if recent_count
            else 0.0
        )

        return {
            **summary_rows[0],
            "recent_matches": recent_count,
            "recent_win_rate": recent_win_rate,
            "recent_8": {
                "matches": recent_count,
                "wins": recent_wins,
                "win_rate": recent_win_rate,
                "top3_rate": recent_top3_rate,
                "avg_place": recent_avg_place,
                "records": recent_records,
            },
            "lord_stats": _float_rows(lord_result.mappings().fetchall()),
        }

    async def list_matches(
        self,
        search: str = "",
        faction: str = "",
        lord: str = "",
        slot_hour: int | None = None,
        match_date: str = "",
        days_offset: int = 0,
        days_limit: int = 7,
    ) -> dict:
        """按完整自然日分批查询对局记录：同一天永不拆断，每场附带六人明细与冠军

        筛选在服务端完成：search 匹配任意参赛选手，faction 匹配禁用阵营，
        lord 匹配出场棋手，slot_hour 匹配对局小时，match_date 精确筛选某一天
        """

        search_condition = (
            "and exists (select 1 from fact_match_player fp"
            " where fp.match_id = fact_match.match_id"
            " and instr(fp.player_name, :search) > 0)" if search else ""
        )
        lord_condition = (
            "and exists (select 1 from fact_match_player fp2"
            " where fp2.match_id = fact_match.match_id"
            " and fp2.lord_name = :lord)" if lord else ""
        )
        faction_condition = "and fact_match.banned_faction = :faction" if faction else ""
        hour_condition = "and fact_match.slot_hour = :slot_hour" if slot_hour is not None else ""
        date_condition = "and fact_match.match_date = :match_date" if match_date else ""

        base_params = {
            "search": search,
            "faction": faction,
            "lord": lord,
            "slot_hour": slot_hour,
            "match_date": match_date,
        }

        # 先按除 match_date 外的条件汇总所有可选日期与每日场次，供日期下拉随时切换
        where_without_date = (
            f"where 1 = 1 {search_condition} {lord_condition} {faction_condition} {hour_condition}"
        )
        all_dates_sql = f"""
            select fact_match.match_date, count(*) as day_matches
            from fact_match
            {where_without_date}
            group by fact_match.match_date
            order by fact_match.match_date desc
        """
        all_dates_result = await self.session.execute(text(all_dates_sql), base_params)
        available_dates = [
            {"date": str(row[0]), "matches": int(row[1] or 0)}
            for row in all_dates_result.fetchall()
        ]

        # 若指定了某一天，则目标日期桶只保留该日，否则直接复用全部命中日期桶
        target_buckets = (
            [item for item in available_dates if item["date"] == match_date]
            if match_date
            else available_dates
        )
        total_days = len(target_buckets)
        total = sum(item["matches"] for item in target_buckets)

        sliced_buckets = target_buckets[days_offset : days_offset + days_limit]
        selected_dates = [item["date"] for item in sliced_buckets]
        loaded_days = len(sliced_buckets)
        next_offset = days_offset + loaded_days
        remaining_days = max(0, total_days - next_offset)
        remaining_matches = sum(item["matches"] for item in target_buckets[next_offset:])

        where = f"{where_without_date} {date_condition}"
        rows: list[dict] = []
        if selected_dates:
            sql = f"""
                select
                    fact_match.match_id,
                    fact_match.match_date,
                    fact_match.slot_hour,
                    fact_match.banned_faction,
                    max(case when fact_match_player.final_place = 1 then fact_match_player.player_name end) as champion_player,
                    max(case when fact_match_player.final_place = 1 then fact_match_player.lord_name end) as champion_lord
                from fact_match
                left join fact_match_player on fact_match_player.match_id = fact_match.match_id
                {where}
                and fact_match.match_date in :selected_dates
                group by fact_match.match_id, fact_match.match_date, fact_match.slot_hour, fact_match.banned_faction
                order by fact_match.match_date desc, fact_match.slot_hour desc, fact_match.match_id desc
            """
            result = await self.session.execute(
                text(sql).bindparams(bindparam("selected_dates", expanding=True)),
                {**base_params, "selected_dates": selected_dates},
            )
            rows = _float_rows(result.mappings().fetchall())

        # 只取本批场次的六人明细，一次 in 查询后在内存里归组
        match_ids = [row["match_id"] for row in rows]
        players: dict[str, list[dict]] = {match_id: [] for match_id in match_ids}
        if match_ids:
            detail_sql = """
                select match_id, final_place, player_name, lord_name
                from fact_match_player
                where match_id in :match_ids
                order by final_place
            """
            detail_result = await self.session.execute(
                text(detail_sql).bindparams(bindparam("match_ids", expanding=True)),
                {"match_ids": match_ids},
            )
            for row in detail_result.mappings().fetchall():
                players[row["match_id"]].append(
                    {
                        "place": int(row["final_place"]),
                        "player": row["player_name"],
                        "lord": row["lord_name"],
                    }
                )

        for row in rows:
            row["players"] = players[row["match_id"]]
            row["match_date"] = str(row["match_date"])
            row["slot_hour"] = int(row["slot_hour"]) if row["slot_hour"] is not None else 0

        # 禁用阵营、棋手与小时下拉的真值来自数据库，目录变化时页面自适应
        faction_result = await self.session.execute(
            text("select faction_name from dim_faction order by faction_name")
        )
        factions = [row[0] for row in faction_result.fetchall()]

        lord_list_result = await self.session.execute(
            text("select lord_name from dim_lord order by lord_name")
        )
        lords = [row[0] for row in lord_list_result.fetchall()]

        hours_result = await self.session.execute(
            text("select distinct slot_hour from fact_match order by slot_hour desc")
        )
        hours = [int(row[0]) for row in hours_result.fetchall() if row[0] is not None]

        return {
            "rows": rows,
            "total": total,
            "total_days": total_days,
            "loaded_days": loaded_days,
            "remaining_days": remaining_days,
            "remaining_matches": remaining_matches,
            "factions": factions,
            "lords": lords,
            "hours": hours,
            "dates": available_dates,
        }

    async def get_overview(self) -> dict:
        """查询数仓全局概况：总对局数、选手数、棋手数与最新对局日期"""

        sql = """
            select
                (select count(*) from fact_match) as matches,
                (select count(distinct player_name) from fact_match_player) as players,
                (select count(*) from dim_lord) as lords,
                (select max(match_date) from fact_match) as latest_date
        """
        result = await self.session.execute(text(sql))
        row = result.mappings().fetchone()
        if not row:
            return {"matches": 0, "players": 0, "lords": 0, "latest_date": None}
        return {
            "matches": int(row["matches"] or 0),
            "players": int(row["players"] or 0),
            "lords": int(row["lords"] or 0),
            "latest_date": str(row["latest_date"]) if row["latest_date"] is not None else None,
        }

    async def get_lord(self, lord_name: str) -> dict | None:
        """查询单个棋手的总指标及各选手使用该棋手的表现明细"""

        summary_sql = """
            select
                dim_lord.lord_name as lord,
                count(fact_match_player.match_id) as matches,
                coalesce(sum(fact_match_player.final_place = 1), 0) as wins,
                coalesce(
                    round(
                        sum(fact_match_player.final_place = 1)
                            / count(fact_match_player.match_id) * 100, 2
                    ), 0
                ) as win_rate,
                coalesce(
                    round(
                        sum(fact_match_player.final_place <= 3)
                            / count(fact_match_player.match_id) * 100, 2
                    ), 0
                ) as top3_rate,
                coalesce(round(avg(fact_match_player.final_place), 2), 0) as avg_place
            from dim_lord
            left join fact_match_player on fact_match_player.lord_name = dim_lord.lord_name
            where dim_lord.lord_name = :lord_name
            group by dim_lord.lord_name
        """
        summary_result = await self.session.execute(
            text(summary_sql),
            {"lord_name": lord_name},
        )
        summary_rows = _float_rows(summary_result.mappings().fetchall())
        if not summary_rows:
            return None

        players_sql = f"""
            select player_name as player, {_PLAYER_METRICS}
            from fact_match_player
            where lord_name = :lord_name
            group by player_name
            order by matches desc, win_rate desc
        """
        players_result = await self.session.execute(
            text(players_sql),
            {"lord_name": lord_name},
        )

        return {
            **summary_rows[0],
            "player_stats": _float_rows(players_result.mappings().fetchall()),
        }

    async def get_dashboard(self) -> dict:
        """查询数据大盘所需的全局聚合数据：概况、禁用阵营分布与火热选手"""

        overview = await self.get_overview()

        faction_sql = """
            select
                dim_faction.faction_name as faction,
                count(fact_match.match_id) as matches
            from dim_faction
            left join fact_match on fact_match.banned_faction = dim_faction.faction_name
            group by dim_faction.faction_name
            order by matches desc, dim_faction.faction_name asc
        """
        faction_result = await self.session.execute(text(faction_sql))
        banned_factions = [
            {
                "faction": row["faction"],
                "matches": int(row["matches"] or 0),
            }
            for row in faction_result.mappings().fetchall()
        ]

        # 近期火热选手 Top 8：总场次 >= 5 的选手按近 8 场吃鸡率降序
        hot_sql = """
            with ranked as (
                select
                    fmp.player_name,
                    fmp.final_place,
                    row_number() over (
                        partition by fmp.player_name
                        order by fm.match_date desc, fm.match_id desc
                    ) as rn
                from fact_match_player fmp
                left join fact_match fm on fm.match_id = fmp.match_id
            )
            select
                player_name as player,
                count(*) as matches,
                round(sum(final_place = 1) / count(*) * 100, 2) as win_rate,
                sum(case when rn <= 8 then 1 else 0 end) as recent_matches,
                round(
                    sum(case when rn <= 8 and final_place = 1 then 1 else 0 end)
                    / sum(case when rn <= 8 then 1 else 0 end) * 100,
                    2
                ) as recent_win_rate
            from ranked
            group by player_name
            having matches >= 5
            order by recent_win_rate desc, win_rate desc, matches desc
            limit 8
        """
        hot_result = await self.session.execute(text(hot_sql))
        hot_players = _float_rows(hot_result.mappings().fetchall())

        return {
            "overview": overview,
            "banned_factions": banned_factions,
            "hot_players": hot_players,
        }

    async def list_lords(self) -> list[dict]:
        """查询全部棋手的胜率榜，按吃鸡率降序返回"""

        # left join dim_lord：从未被选用的棋手也保留在榜单上，指标归零
        # 而不是直接从聚合结果里消失
        sql = """
            select
                dim_lord.lord_name as lord,
                count(fact_match_player.match_id) as matches,
                coalesce(sum(fact_match_player.final_place = 1), 0) as wins,
                coalesce(
                    round(
                        sum(fact_match_player.final_place = 1)
                            / count(fact_match_player.match_id) * 100, 2
                    ), 0
                ) as win_rate,
                coalesce(
                    round(
                        sum(fact_match_player.final_place <= 3)
                            / count(fact_match_player.match_id) * 100, 2
                    ), 0
                ) as top3_rate,
                coalesce(round(avg(fact_match_player.final_place), 2), 0) as avg_place
            from dim_lord
            left join fact_match_player on fact_match_player.lord_name = dim_lord.lord_name
            group by dim_lord.lord_name
            order by win_rate desc, matches desc
        """
        result = await self.session.execute(text(sql))
        return _float_rows(result.mappings().fetchall())
