"""
一次性迁移 给 fact_match 补 slot_hour 小时字段并回填

小时原本只编码在 match_id 的 T 后面（如 2026-11-23T23-万象大赛 里的 23）
这里拆成独立列方便按时段统计 幂等可重复执行
"""

import asyncio

from sqlalchemy import text

from app.clients.mysql_client_manager import dw_mysql_client_manager


async def main() -> None:
    dw_mysql_client_manager.init()
    async with dw_mysql_client_manager.engine.connect() as conn:
        has_column = (
            await conn.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = 'dw' AND table_name = 'fact_match' "
                    "AND column_name = 'slot_hour'"
                )
            )
        ).scalar()
        if not has_column:
            await conn.execute(
                text(
                    "ALTER TABLE fact_match ADD COLUMN slot_hour TINYINT NULL "
                    "COMMENT '对局小时（本地时区 0-23），取自对局开始时间，与 match_id 中 T 后的小时一致' "
                    "AFTER match_date"
                )
            )
            print("已新增 slot_hour 列")
        else:
            print("slot_hour 列已存在 跳过建列")

        result = await conn.execute(
            text(
                "UPDATE fact_match SET slot_hour = CAST("
                "SUBSTRING_INDEX(SUBSTRING_INDEX(match_id, 'T', -1), '-', 1) AS UNSIGNED) "
                "WHERE slot_hour IS NULL"
            )
        )
        print(f"回填 {result.rowcount} 行")

        await conn.commit()

        bad = (
            await conn.execute(
                text(
                    "SELECT COUNT(*) FROM fact_match "
                    "WHERE slot_hour IS NULL OR slot_hour NOT BETWEEN 0 AND 23"
                )
            )
        ).scalar()
        print(f"异常行（NULL 或超出 0-23）：{bad}")
        rows = (
            await conn.execute(text("SELECT match_id, slot_hour FROM fact_match ORDER BY match_id LIMIT 3"))
        ).fetchall()
        for match_id, slot_hour in rows:
            print(f"抽样：{match_id} -> slot_hour={slot_hour}")


if __name__ == "__main__":
    asyncio.run(main())
