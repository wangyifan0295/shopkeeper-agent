"""
数据统计只读接口路由

为前端数据页面提供固定口径的聚合统计：选手榜（服务端分页 / 筛选 / 排序）、
选手详情（分棋手胜率）、棋手榜（全量）。与 `/api/agui/query` 的动态问数
链路互补：这里不经过 LLM，SQL 预先写好放在仓储层，响应是普通 JSON。

页面展示层把 lord 叫"棋手"，但物理表和接口路径维持 lord 命名，只改文案。
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.dependencies import get_dw_stats_repository
from app.repositories.mysql.dw.dw_stats_repository import DWStatsRepository

# 当前模块只维护数据统计接口
stats_router = APIRouter()


@stats_router.get("/api/stats/players")
async def list_players_handler(
    # 服务依赖：复用 get_dw_session 的请求级 Session 组装统计仓储
    stats_repository: Annotated[DWStatsRepository, Depends(get_dw_stats_repository)],
    # 选手名模糊搜索，空串表示不过滤
    search: Annotated[str, Query(description="选手名模糊搜索")] = "",
    # 场次下限：0 表示全部，前端提供 5 / 10 / 20 档位
    min_matches: Annotated[int, Query(ge=0, description="场次下限")] = 0,
    # 排序字段与方向都收窄成字面量枚举，FastAPI 自动拦截非法取值
    sort_by: Literal["matches", "win_rate", "recent_win_rate", "top3_rate", "avg_place"] = "matches",
    order: Literal["asc", "desc"] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    """分页返回选手榜：筛选、排序、分页全部在服务端完成"""

    return await stats_repository.list_players(
        search=search.strip(),
        min_matches=min_matches,
        sort_by=sort_by,
        order=order,
        page=page,
        page_size=page_size,
    )


@stats_router.get("/api/stats/players/{player_name}")
async def get_player_handler(
    player_name: str,
    stats_repository: Annotated[DWStatsRepository, Depends(get_dw_stats_repository)],
):
    """返回单个选手的总指标和分棋手胜率明细"""

    detail = await stats_repository.get_player(player_name)
    if detail is None:
        raise HTTPException(status_code=404, detail="未找到该选手")
    return detail


@stats_router.get("/api/stats/overview")
async def get_overview_handler(
    stats_repository: Annotated[DWStatsRepository, Depends(get_dw_stats_repository)],
):
    """返回数仓全局概况：总对局数、选手数、棋手数与最新对局日期"""

    return await stats_repository.get_overview()


@stats_router.get("/api/stats/dashboard")
async def get_dashboard_handler(
    stats_repository: Annotated[DWStatsRepository, Depends(get_dw_stats_repository)],
):
    """返回数据大盘聚合数据：概况、禁用阵营分布与火热选手"""

    return await stats_repository.get_dashboard()


@stats_router.get("/api/stats/matches")
async def list_matches_handler(
    stats_repository: Annotated[DWStatsRepository, Depends(get_dw_stats_repository)],
    # 选手名模糊搜索：命中该场六人中任一人即返回整场
    search: Annotated[str, Query(description="选手名模糊搜索")] = "",
    # 禁用阵营精确匹配，空串表示不过滤
    faction: Annotated[str, Query(description="禁用阵营")] = "",
    # 出场棋手精确匹配，空串表示不过滤
    lord: Annotated[str, Query(description="出场棋手")] = "",
    # 对局小时精确匹配（0-23），None 表示不过滤
    slot_hour: Annotated[int | None, Query(ge=0, le=23, description="对局小时（0-23）")] = None,
    # 对局日期精确匹配（YYYY-MM-DD），空串表示不过滤
    match_date: Annotated[str, Query(description="对局日期（YYYY-MM-DD）")] = "",
    # 按完整比赛日分批加载：跳过前 days_offset 个比赛日，取接下来的 days_limit 天
    days_offset: Annotated[int, Query(ge=0)] = 0,
    days_limit: Annotated[int, Query(ge=1, le=30)] = 7,
):
    """按完整比赛日分批返回对局记录：保证同一天不被拆断，并附筛选项真值"""

    return await stats_repository.list_matches(
        search=search.strip(),
        faction=faction.strip(),
        lord=lord.strip(),
        slot_hour=slot_hour,
        match_date=match_date.strip(),
        days_offset=days_offset,
        days_limit=days_limit,
    )


@stats_router.get("/api/stats/lords")
async def list_lords_handler(
    stats_repository: Annotated[DWStatsRepository, Depends(get_dw_stats_repository)],
):
    """返回全部棋手的胜率榜（全量，按吃鸡率降序）"""

    return {"rows": await stats_repository.list_lords()}


@stats_router.get("/api/stats/lords/{lord_name}")
async def get_lord_handler(
    lord_name: str,
    stats_repository: Annotated[DWStatsRepository, Depends(get_dw_stats_repository)],
):
    """返回单个棋手的总指标和各选手使用该棋手的胜率明细"""

    detail = await stats_repository.get_lord(lord_name)
    if detail is None:
        raise HTTPException(status_code=404, detail="未找到该棋手")
    return detail
