"""
胜率预测接口路由

面向前端独立「胜率预测」视图提供三个接口：
- GET  /api/predict/options：返回现役禁用阵营、棋手目录、全量选手快速搜索索引与最近对局
- POST /api/predict/match  ：毫秒级返回 6 人吃鸡率、前三率、预期名次与 6 维归因
- POST /api/predict/explain：按需调用 LLM，基于量化预测结果生成简短赛前点评
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.api.dependencies import get_dw_predict_repository
from app.repositories.mysql.dw.dw_predict_repository import DWPredictRepository
from app.services.winrate_predict_service import winrate_predict_service

predict_router = APIRouter()


class SeatInput(BaseModel):
    seat: int = Field(ge=1, le=6, description="座位号 1-6")
    player: str = Field(min_length=1, max_length=50, description="参赛选手昵称")
    lord: str = Field(min_length=1, max_length=20, description="本局所选棋手")

    @field_validator("player", "lord")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned


class PredictMatchRequest(BaseModel):
    banned_faction: str = Field(default="", max_length=20, description="禁用阵营，留空表示未禁用")
    before_match_id: str | None = Field(
        default=None,
        max_length=32,
        description="可选：复盘历史对局时传入该场编号，自动回退到开赛前快照避免未来数据泄漏",
    )
    seats: list[SeatInput] = Field(min_length=6, max_length=6, description="6 个席位的选手与棋手")

    @field_validator("seats")
    @classmethod
    def validate_unique_players(cls, seats: list[SeatInput]) -> list[SeatInput]:
        names = [item.player for item in seats]
        if len(set(names)) != 6:
            raise ValueError("同一局的 6 位参赛选手不能重复")
        return seats


@predict_router.get("/api/predict/options")
async def get_predict_options_handler(
    predict_repository: Annotated[DWPredictRepository, Depends(get_dw_predict_repository)],
):
    """返回选人所需的阵营、棋手、全量选手轻量索引、最近历史对局与模型摘要"""

    return await winrate_predict_service.get_options(predict_repository)


@predict_router.post("/api/predict/match")
async def predict_match_handler(
    payload: PredictMatchRequest,
    predict_repository: Annotated[DWPredictRepository, Depends(get_dw_predict_repository)],
):
    """预测一场 6 人对局的吃鸡率、前三率、名次分布与归因拆解"""

    return await winrate_predict_service.predict_match(
        repository=predict_repository,
        banned_faction=payload.banned_faction,
        seats=[seat.model_dump() for seat in payload.seats],
        before_match_id=payload.before_match_id,
    )


@predict_router.post("/api/predict/explain")
async def explain_prediction_handler(
    payload: PredictMatchRequest,
    predict_repository: Annotated[DWPredictRepository, Depends(get_dw_predict_repository)],
):
    """按需调用大模型，基于量化预测结果输出赛前点评"""

    try:
        return await winrate_predict_service.explain_prediction(
            repository=predict_repository,
            banned_faction=payload.banned_faction,
            seats=[seat.model_dump() for seat in payload.seats],
            before_match_id=payload.before_match_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 赛前点评生成失败：{exc}") from exc
