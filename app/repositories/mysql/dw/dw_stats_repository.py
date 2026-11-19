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

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# 选手榜允许的排序字段白名单：接口参数 -> SQL 列别名。
# 只做映射不做字符串拼接透传，排序方向单独枚举，避免 ORDER BY 注入
PLAYER_SORT_COLUMNS = {
    "matches": "matches",
    "win_rate": "win_rate",
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
        search_condition = (
            "where instr(player_name, :search) > 0" if search else ""
        )

        sql = f"""
            select player_name as player, {_PLAYER_METRICS}
            from fact_match_player
            {search_condition}
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

        return {
            **summary_rows[0],
            "lord_stats": _float_rows(lord_result.mappings().fetchall()),
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
