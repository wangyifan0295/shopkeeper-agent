"""
对局玩家名字人工核对辅助

配合 fetch_foxminer_matches.py 的产物工作
- render: 按 10 场一批渲染 当时名->入库名 的核对清单(带棋手与曾用名标记)
- apply:  把人工核对产生的改名决定应用到 store 生成最终入库文件

核对决定的账本 confirm-decisions.json 由对话侧维护 本脚本只读
"""

import argparse
import json
import sys
from pathlib import Path

BATCH_SIZE = 10


def load_renames(folder: Path) -> dict[str, str]:
    """用户核对产生的全局改名 没有则空"""
    path = folder / "canonical-renames.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get("renames", {})


def load_store(folder: Path) -> tuple[list[dict], dict[str, list[dict]]]:
    """返回 按时间排序的(原始对局 归一后对局) 对齐列表 和 名字->拥有者索引"""
    raw_archive = json.loads((folder / "matches-raw.json").read_text(encoding="utf-8"))
    store = json.loads((folder / "ace-store-from-foxminer.json").read_text(encoding="utf-8"))

    raw_by_id = {payload["match"]["match_key"]: payload for payload in raw_archive["items"]}
    pairs = []
    for match in sorted(store["matches"], key=lambda m: str(m["id"])):
        pairs.append((raw_by_id[str(match["id"])], match))

    players = json.loads((folder / "players.json").read_text(encoding="utf-8"))["items"]
    name_index: dict[str, list[dict]] = {}
    for player in players:
        for name in [player["name"], *player.get("old_names", [])]:
            name_index.setdefault(name, []).append(player)
    return pairs, name_index


def player_tags(raw_name: str, norm_name: str, name_index: dict[str, list[dict]]) -> str:
    """玩家显示: 当时名->入库名 加特殊情况标记"""
    owners = name_index.get(raw_name, [])
    if raw_name != norm_name:
        return f"{raw_name}→{norm_name}"
    if not owners:
        return f"{raw_name}[无档案]"
    if len(owners) > 1:
        return f"{raw_name}[同名{len(owners)}人]"
    return raw_name


def render_batch(folder: Path, batch_no: int, clean: bool = False) -> None:
    pairs, name_index = load_store(folder)
    renames = load_renames(folder)
    decisions_path = folder / "confirm-decisions.json"
    seat_overrides: dict[tuple[str, int], str] = {}
    if decisions_path.exists():
        for o in json.loads(decisions_path.read_text(encoding="utf-8")).get("overrides", []):
            seat_overrides[(str(o["match_id"]), o["seat"])] = o["to"]
    total_batches = (len(pairs) + BATCH_SIZE - 1) // BATCH_SIZE
    if not 1 <= batch_no <= total_batches:
        raise SystemExit(f"批次号超出范围 1-{total_batches}")

    start = (batch_no - 1) * BATCH_SIZE
    chunk = pairs[start : start + BATCH_SIZE]
    print(f"## 批次 {batch_no}/{total_batches}（第 {start + 1}-{start + len(chunk)} 场，共 {len(pairs)} 场）")
    for no, (payload, match) in enumerate(chunk, start + 1):
        raw = payload["match"]
        norm_by_seat = {p["seat"]: p for p in match["players"]}
        ban = f" 禁{raw['disabled_faction']}" if raw.get("disabled_faction") else ""
        # match_key 形如 2026-10-13T16-万象大赛 展示成日期+点次
        shown_id = str(match["id"]).split("-万象大赛")[0].replace("T", " ")
        print(f"\n**{no}. {shown_id}**{ban}")
        parts = []
        for player in sorted(payload["players"], key=lambda p: p["rank"]):
            norm = norm_by_seat[player["rank"]]
            final_name = renames.get(norm["name"], norm["name"])
            final_name = seat_overrides.get((str(match["id"]), player["rank"]), final_name)
            if clean:
                # 干净模式 只显示最终入库名 不带当时名箭头
                shown = final_name
            else:
                shown = player_tags(player["name"], final_name, name_index)
            parts.append(f"{player['rank']}️⃣{shown}（{norm['lord']}）")
        print("　" + " ".join(parts))


def apply_decisions(
    folder: Path, decisions_path: Path, out_path: Path, limit: int | None = None
) -> None:
    """先套全局改名 再把单场改名人覆盖到 store 输出最终入库文件

    limit 只保留按时间排序的前 N 场 用于分批入库
    """
    store = json.loads((folder / "ace-store-from-foxminer.json").read_text(encoding="utf-8"))
    decisions = json.loads(decisions_path.read_text(encoding="utf-8"))
    renames = load_renames(folder)

    renamed = 0
    for match in store["matches"]:
        for player in match["players"]:
            if player["name"] in renames:
                player["name"] = renames[player["name"]]
                renamed += 1

    index = {(str(m["id"]), p["seat"]): p for m in store["matches"] for p in m["players"]}
    applied = 0
    for override in decisions.get("overrides", []):
        player = index.get((str(override["match_id"]), override["seat"]))
        if player is None:
            raise SystemExit(f"改名人找不到: {override}")
        if override.get("expect_from") and player["name"] != override["expect_from"]:
            raise SystemExit(
                f"对局 {override['match_id']} 座位 {override['seat']} 当前是 "
                f"{player['name']} 与决定记录的 {override['expect_from']} 不符"
            )
        player["name"] = override["to"]
        applied += 1

    kept = store["matches"]
    if limit is not None:
        kept = sorted(kept, key=lambda m: str(m["id"]))[:limit]
        store["matches"] = kept
    out_path.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    confirmed = len(decisions.get("confirmed_batches", []))
    print(
        f"已应用全局改名 {renamed} 条 单场改人 {applied} 条"
        f"（已确认批次 {confirmed} 个）输出 {len(kept)} 场: {out_path}"
    )


def main():
    parser = argparse.ArgumentParser(description="对局玩家名字人工核对辅助")
    parser.add_argument("data_dir", type=Path, help="foxminer-data 归档目录")
    parser.add_argument("command", choices=["render", "apply"])
    parser.add_argument("--batch", type=int, default=1, help="render: 渲染第几批")
    parser.add_argument(
        "--clean", action="store_true", help="render: 只显示最终入库名不带当时名箭头"
    )
    parser.add_argument(
        "--decisions", type=Path, help="apply: 核对决定账本路径",
        default=None,
    )
    parser.add_argument(
        "--out", type=Path, help="apply: 最终入库文件路径",
        default=None,
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="apply: 只保留时间序前 N 场(分批入库用)"
    )
    args = parser.parse_args()

    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")

    if args.command == "render":
        render_batch(args.data_dir, args.batch, clean=args.clean)
    else:
        if args.decisions is None or args.out is None:
            raise SystemExit("apply 需要 --decisions 和 --out")
        apply_decisions(args.data_dir, args.decisions, args.out, limit=args.limit)


if __name__ == "__main__":
    main()
