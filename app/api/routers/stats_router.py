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
    sort_by: Literal["matches", "win_rate", "top3_rate", "avg_place"] = "matches",
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


@stats_router.get("/api/stats/lords")
async def list_lords_handler(
    stats_repository: Annotated[DWStatsRepository, Depends(get_dw_stats_repository)],
):
    """返回全部棋手的胜率榜（全量，按吃鸡率降序）"""

    return {"rows": await stats_repository.list_lords()}
