"""
王牌对决对局数据导入脚本

把攻略站 data-store 里的 ace-duel-store.json 导入 dw 数仓
流程是 重建表结构 -> 刷新维表 -> 灌入对局事实表 幂等可重复执行
数据源里的维表目录 主公和阵营 可能随攻略站编辑页变化
所以维表内容也以 JSON 为唯一真相 每次导入前整体刷新
"""

import argparse
import asyncio
import json
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import text

from app.clients.mysql_client_manager import dw_mysql_client_manager

# DDL 文件默认位置 项目内 docker/mysql/dw.sql
DEFAULT_DDL_PATH = Path(__file__).resolve().parents[2] / "docker" / "mysql" / "dw.sql"

# 这些语句只服务于 MySQL 容器首次初始化 脚本已直连 dw 库 无需重复执行
SKIP_STATEMENT_PREFIXES = ("SET NAMES", "CREATE DATABASE", "GRANT", "USE")

# startedAt 是 UTC 时间 本地对局时间按东八区换算
UTC_OFFSET = timedelta(hours=8)


def load_source(source_path: Path) -> dict:
    """读取并基本校验数据源结构"""
    with open(source_path, encoding="utf-8") as f:
        data = json.load(f)
    for key in ("matches", "lords", "factions"):
        if key not in data:
            raise ValueError(f"数据源缺少 {key} 字段 不是有效的 ace-duel-store.json")
    return data


def build_ddl_statements(ddl_path: Path) -> list[str]:
    """切分 DDL 文件并过滤掉容器初始化专用语句"""
    content = ddl_path.read_text(encoding="utf-8")
    statements = [s.strip() for s in content.split(";") if s.strip()]
    return [
        s
        for s in statements
        if not s.upper().startswith(SKIP_STATEMENT_PREFIXES)
    ]


def build_dimension_rows(data: dict) -> tuple[list[dict], list[dict]]:
    """从 JSON 目录生成维表行 阵营带启用状态 主公目录默认全部启用"""
    faction_rows = [
        {"faction_name": f["name"], "is_enabled": 0 if f.get("disabled") else 1}
        for f in data["factions"]
    ]
    lord_rows = [{"lord_name": name, "is_enabled": 1} for name in data["lords"]]
    return faction_rows, lord_rows


def build_fact_rows(data: dict) -> tuple[list[dict], list[dict]]:
    """把对局记录展开成事实表行 并做完整性校验"""
    lord_catalog = set(data["lords"])
    faction_catalog = {f["name"] for f in data["factions"]}

    match_rows = []
    player_rows = []
    seen_match_ids = set()

    for match in data["matches"]:
        match_id = str(match["id"])
        if match_id in seen_match_ids:
            raise ValueError(f"对局编号重复: {match_id}")
        seen_match_ids.add(match_id)

        # startedAt 形如 2026-10-19T09:00:00.000Z 转成东八区后取日期和小时
        started_at = datetime.fromisoformat(match["startedAt"].replace("Z", "+00:00"))
        local_started = started_at + UTC_OFFSET
        match_date = local_started.date()
        slot_hour = local_started.hour

        bans = match.get("bans") or []
        if len(bans) > 1:
            raise ValueError(f"对局 {match_id} 有多个禁用阵营 {bans} 与单列设计不符")
        banned_faction = bans[0] if bans else None
        if banned_faction and banned_faction not in faction_catalog:
            raise ValueError(f"对局 {match_id} 禁用了未知阵营: {banned_faction}")

        match_rows.append(
            {
                "match_id": match_id,
                "match_date": match_date,
                "slot_hour": slot_hour,
                "banned_faction": banned_faction,
            }
        )

        players = match["players"]
        if len(players) != 6:
            raise ValueError(f"对局 {match_id} 玩家数不是 6: {len(players)}")
        seats = [p["seat"] for p in players]
        places = [p["place"] for p in players]
        if sorted(seats) != list(range(1, 7)) or sorted(places) != list(range(1, 7)):
            raise ValueError(f"对局 {match_id} 座位或名次不是 1-6 的完整排列")

        for player in players:
            if player["lord"] not in lord_catalog:
                raise ValueError(
                    f"对局 {match_id} 出现目录外主公: {player['lord']}"
                )
            player_rows.append(
                {
                    "match_id": match_id,
                    "seat": player["seat"],
                    "player_name": player["name"],
                    "lord_name": player["lord"],
                    "final_place": player["place"],
                }
            )

    return match_rows, player_rows


async def import_data(source_path: Path, ddl_path: Path):
    """重建表结构 刷新维表 灌入事实数据"""
    data = load_source(source_path)
    faction_rows, lord_rows = build_dimension_rows(data)
    match_rows, player_rows = build_fact_rows(data)

    dw_mysql_client_manager.init()
    try:
        async with dw_mysql_client_manager.engine.begin() as conn:
            # 表结构整体重建 维表数据随后由 JSON 刷新 覆盖 DDL 里的静态种子
            for statement in build_ddl_statements(ddl_path):
                await conn.execute(text(statement))

            await conn.execute(text("TRUNCATE TABLE dim_faction"))
            await conn.execute(text("TRUNCATE TABLE dim_lord"))
            await conn.execute(
                text(
                    "INSERT INTO dim_faction (faction_name, is_enabled) "
                    "VALUES (:faction_name, :is_enabled)"
                ),
                faction_rows,
            )
            await conn.execute(
                text(
                    "INSERT INTO dim_lord (lord_name, is_enabled) "
                    "VALUES (:lord_name, :is_enabled)"
                ),
                lord_rows,
            )
            await conn.execute(
                text(
                    "INSERT INTO fact_match (match_id, match_date, slot_hour, banned_faction) "
                    "VALUES (:match_id, :match_date, :slot_hour, :banned_faction)"
                ),
                match_rows,
            )
            await conn.execute(
                text(
                    "INSERT INTO fact_match_player "
                    "(match_id, seat, player_name, lord_name, final_place) "
                    "VALUES (:match_id, :seat, :player_name, :lord_name, :final_place)"
                ),
                player_rows,
            )
    finally:
        await dw_mysql_client_manager.close()

    print(
        f"导入完成: 对局 {len(match_rows)} 场 玩家明细 {len(player_rows)} 行 "
        f"阵营 {len(faction_rows)} 个 主公 {len(lord_rows)} 名"
    )


async def import_incremental(source_path: Path, ddl_path: Path):
    """增量模式 不动表结构 只补新场次并修正已有座位的名字

    用于逐批核对流程: 已入库场次保留 只插入库里没有的对局;
    若账本事后修正了已入库场次的名字 按座位定向 UPDATE 同步
    """
    data = load_source(source_path)
    faction_rows, lord_rows = build_dimension_rows(data)
    match_rows, player_rows = build_fact_rows(data)
    match_index = {m["match_id"]: m for m in match_rows}
    player_index = {(p["match_id"], p["seat"]): p for p in player_rows}

    dw_mysql_client_manager.init()
    try:
        async with dw_mysql_client_manager.engine.begin() as conn:
            # 表不存在时才建(首次或换库) 已有表原样保留
            # 注意 DDL 语句可能带注释前缀 判 DROP 必须看剥掉注释后的内容 否则会误删表
            for statement in build_ddl_statements(ddl_path):
                stripped = "\n".join(
                    line for line in statement.splitlines() if not line.strip().startswith("--")
                ).strip()
                if not stripped or stripped.upper().startswith("DROP"):
                    continue
                if stripped.upper().startswith("INSERT"):
                    continue  # DDL 静态种子不重放 维表由下方 INSERT IGNORE 补
                try:
                    await conn.execute(text(stripped))
                except Exception:
                    continue

            # 维表只补缺 不清空
            await conn.execute(
                text(
                    "INSERT IGNORE INTO dim_faction (faction_name, is_enabled) "
                    "VALUES (:faction_name, :is_enabled)"
                ),
                faction_rows,
            )
            await conn.execute(
                text(
                    "INSERT IGNORE INTO dim_lord (lord_name, is_enabled) "
                    "VALUES (:lord_name, :is_enabled)"
                ),
                lord_rows,
            )

            existing = {
                row[0]
                for row in (await conn.execute(text("SELECT match_id FROM fact_match"))).fetchall()
            }

            new_matches = [m for m in match_rows if m["match_id"] not in existing]
            if new_matches:
                await conn.execute(
                    text(
                        "INSERT INTO fact_match (match_id, match_date, slot_hour, banned_faction) "
                        "VALUES (:match_id, :match_date, :slot_hour, :banned_faction)"
                    ),
                    new_matches,
                )
                await conn.execute(
                    text(
                        "INSERT INTO fact_match_player "
                        "(match_id, seat, player_name, lord_name, final_place) "
                        "VALUES (:match_id, :seat, :player_name, :lord_name, :final_place)"
                    ),
                    [player_index[(m["match_id"], s)] for m in new_matches for s in range(1, 7)],
                )

            # 已入库场次 定向同步名字(账本事后修正的场景)
            updated = 0
            db_rows = (
                await conn.execute(text("SELECT match_id, seat, player_name FROM fact_match_player"))
            ).fetchall()
            for match_id, seat, db_name in db_rows:
                if match_id in existing and (match_id, seat) in player_index:
                    store_name = player_index[(match_id, seat)]["player_name"]
                    if store_name != db_name:
                        await conn.execute(
                            text(
                                "UPDATE fact_match_player SET player_name = :name "
                                "WHERE match_id = :match_id AND seat = :seat"
                            ),
                            {"name": store_name, "match_id": match_id, "seat": seat},
                        )
                        updated += 1
    finally:
        await dw_mysql_client_manager.close()

    print(
        f"增量导入完成: 新增对局 {len(new_matches)} 场(共 {len(existing) + len(new_matches)} 场) "
        f"修正已有座位名字 {updated} 处"
    )


def main():
    parser = argparse.ArgumentParser(description="导入王牌对决对局数据到 dw 数仓")
    parser.add_argument("source", type=Path, help="ace-duel-store.json 路径")
    parser.add_argument(
        "--ddl",
        type=Path,
        default=DEFAULT_DDL_PATH,
        help="建表 DDL 路径 默认 docker/mysql/dw.sql",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="增量模式 不重建表 只补新场次并修正名字",
    )
    args = parser.parse_args()
    if args.incremental:
        asyncio.run(import_incremental(args.source, args.ddl))
    else:
        asyncio.run(import_data(args.source, args.ddl))


if __name__ == "__main__":
    main()
