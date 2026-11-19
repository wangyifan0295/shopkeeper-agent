"""
foxminer 万象棋历史数据抓取脚本

从 foxminer.icu 公开历史接口拉取万象大赛对局 归档原始数据 并转成
import_ace_matches.py 可导入的 ace-duel-store 格式

曾用名处理 对局记录里存的是当时的昵称 同一选手改名后会被拆成两个人
归一时以接口给出的选手 identity 为准 把历史昵称映射回当前昵称
原始归档保持当时名字不动 只在转换入库时归一
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

BASE_URL = "https://foxminer.icu/api/history"
MODE = "万象大赛"
PAGE_SIZE = 100
REQUEST_INTERVAL = 0.15

# 接口时间为东八区 startedAt 按攻略站惯例存 UTC
UTC_OFFSET = timedelta(hours=8)


def get_json(path: str, params: dict | None = None, retries: int = 3) -> dict:
    """带重试的 GET 请求 返回解析后的 JSON"""
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"{BASE_URL}/{path}{query}"
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:
                return json.load(resp)
        except Exception as exc:
            if attempt == retries:
                raise
            print(f"请求失败即将重试 {url}: {exc}")
            time.sleep(2 * attempt)
    raise RuntimeError("unreachable")


def paged_get(path: str, extra_params: dict | None = None) -> list[dict]:
    """翻页拉全一个列表接口"""
    items = []
    offset = 0
    while True:
        params = {"limit": PAGE_SIZE, "offset": offset, **(extra_params or {})}
        page = get_json(path, params)
        batch = page.get("items", [])
        items.extend(batch)
        offset += len(batch)
        if not batch or offset >= page.get("total", 0):
            return items
        time.sleep(REQUEST_INTERVAL)


def fetch_match_details(match_keys: list[str]) -> list[dict]:
    """逐场拉取对局详情 原样归档"""
    details = []
    for index, key in enumerate(match_keys, 1):
        payload = get_json("match", {"key": key})
        if "match" not in payload or "players" not in payload:
            raise ValueError(f"对局 {key} 详情结构不完整")
        details.append(payload)
        if index % 50 == 0:
            print(f"已抓取对局详情 {index}/{len(match_keys)}")
        time.sleep(REQUEST_INTERVAL)
    return details


def build_name_index(players: list[dict]) -> dict[str, list[dict]]:
    """名字 -> 使用过该名字(当前或曾用)的选手列表 用于归一和同名冲突检测"""
    index: dict[str, list[dict]] = {}
    for player in players:
        for name in [player["name"], *player.get("old_names", [])]:
            index.setdefault(name, []).append(player)
    return index


def resolve_ambiguous_names(
    name_index: dict[str, list[dict]], players: list[dict]
) -> tuple[dict[tuple[str, str], str], list[str]]:
    """
    同名冲突逐场对账

    冲突名字的使用者分两类
    - 当前名就是冲突名 两个 identity 同名连档案接口都无法区分 按名保留
    - 冲突名只是其曾用名 拉其档案(逐场列了当时的名字) 把 (场次 名字)
      唯一归属到人 归一到其当前名

    档案接口只认名字不认 identity 名字对应多个 identity 时返回空
    所以依次尝试本人用过的每个名字(当前名优先) 本地先跳过已知重名的
    并校验返回的 identity 确实是本人 防止张冠李戴
    """
    overrides: dict[tuple[str, str], str] = {}
    unqueryable: list[str] = []
    profile_cache: dict[str, dict] = {}

    def profile_for(owner: dict) -> dict | None:
        for candidate in [owner["name"], *owner.get("old_names", [])]:
            if len(name_index.get(candidate, [])) != 1:
                continue
            if candidate not in profile_cache:
                profile_cache[candidate] = get_json("player", {"name": candidate})
                time.sleep(REQUEST_INTERVAL)
            profile = profile_cache[candidate]
            if profile.get("identity") == owner["identity"]:
                return profile
        return None

    for name, owners in name_index.items():
        if len(owners) < 2 or all(o["name"] == name for o in owners):
            continue
        for owner in owners:
            if owner["name"] == name:
                continue
            profile = profile_for(owner)
            if profile is None:
                unqueryable.append(owner["name"])
                continue
            for entry in profile.get("matches", []):
                if entry["name"] == name:
                    overrides[(entry["match_key"], name)] = owner["name"]

    return overrides, sorted(set(unqueryable))


def build_store(
    matches_raw: list[dict],
    players: list[dict],
    catalog: dict,
    overrides: dict[tuple[str, str], str],
) -> tuple[dict, dict]:
    """把 foxminer 原始对局转成 ace-duel-store 格式 姓名归一为当前昵称"""
    name_index = build_name_index(players)
    lord_catalog = set(catalog["lords"])
    faction_catalog = {f["name"] for f in catalog["factions"]}

    matches = []
    renamed_hits = 0
    resolved_hits = 0
    unmapped_names: dict[str, int] = {}
    ambiguous_names: dict[str, int] = {}
    # 入库名字映射账本 同一个原名可能部分对账归一、部分按名保留
    # 所以按 原名+归宿+类型 聚合 而不是只按原名
    name_mapping: dict[tuple[str, str, str], int] = {}

    def record_mapping(kind: str, original: str, mapped_to: str) -> None:
        name_mapping[(original, mapped_to, kind)] = (
            name_mapping.get((original, mapped_to, kind), 0) + 1
        )

    for payload in matches_raw:
        raw = payload["match"]
        match_id = raw["match_key"]

        bans = [raw["disabled_faction"]] if raw.get("disabled_faction") else []
        if bans and bans[0] not in faction_catalog:
            raise ValueError(f"对局 {match_id} 禁用了目录外阵营: {bans[0]}")

        # slot_hour 是东八区开赛整点 转成攻略站惯例的 UTC startedAt
        started_local = datetime.fromisoformat(
            f"{raw['match_date']}T{raw['slot_hour']:02d}:00:00"
        )
        started_at = (started_local - UTC_OFFSET).strftime("%Y-%m-%dT%H:%M:%S.000Z")

        players_out = []
        for player in payload["players"]:
            name = player["name"]
            owners = name_index.get(name, [])
            if len(owners) == 1:
                canonical = owners[0]["name"]
                if canonical != name:
                    renamed_hits += 1
                    record_mapping("renamed", name, canonical)
                name = canonical
            elif len(owners) > 1:
                # 同名冲突 优先用档案对账结果 没对上的属于当前同名者 按名保留
                override = overrides.get((match_id, name))
                if override:
                    resolved_hits += 1
                    record_mapping("ambiguous_resolved", name, override)
                    name = override
                else:
                    ambiguous_names[name] = ambiguous_names.get(name, 0) + 1
                    record_mapping("ambiguous_kept", name, name)
            else:
                unmapped_names[name] = unmapped_names.get(name, 0) + 1

            lord = player["character_name"]
            if lord not in lord_catalog:
                raise ValueError(f"对局 {match_id} 出现目录外主公: {lord}")

            # foxminer 只有名次没有座位 名次即 1-6 完整排列 借作座位号
            players_out.append(
                {
                    "seat": player["rank"],
                    "name": name,
                    "lord": lord,
                    "place": player["rank"],
                }
            )

        places = [p["place"] for p in players_out]
        if len(players_out) != 6 or sorted(p["seat"] for p in players_out) != places:
            raise ValueError(f"对局 {match_id} 选手名次结构异常")

        matches.append(
            {"id": match_id, "startedAt": started_at, "bans": bans, "players": players_out}
        )

    report = {
        "renamed_entries": renamed_hits,
        "ambiguous_resolved_entries": resolved_hits,
        "unmapped_names": unmapped_names,
        "ambiguous_names": ambiguous_names,
    }
    store = {
        "matches": matches,
        "lords": catalog["lords"],
        "factions": catalog["factions"],
    }
    mappings = [
        {"name": original, "mapped_to": mapped_to, "kind": kind, "entries": entries}
        for (original, mapped_to, kind), entries in sorted(
            name_mapping.items(), key=lambda kv: -kv[1]
        )
    ]
    return store, report, mappings


def dump(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="抓取 foxminer 万象大赛历史数据并转换")
    parser.add_argument("out_dir", type=Path, help="归档输出目录")
    parser.add_argument(
        "--catalog",
        type=Path,
        required=True,
        help="现有 ace-duel-store.json 路径 主公与阵营目录以其为准",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="强制重新抓取 缺省时归档已存在则直接复用",
    )
    args = parser.parse_args()

    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))

    raw_path = out_dir / "matches-raw.json"
    players_path = out_dir / "players.json"
    if not args.refresh and raw_path.exists() and players_path.exists():
        raw_archive = json.loads(raw_path.read_text(encoding="utf-8"))
        matches_raw = raw_archive["items"]
        players = json.loads(players_path.read_text(encoding="utf-8"))["items"]
        fetched_at = raw_archive["fetched_at"]
        print(f"复用已有归档({fetched_at}): 对局 {len(matches_raw)} 场 选手 {len(players)} 个")
    else:
        fetched_at = datetime.now().isoformat(timespec="seconds")
        summary = get_json("summary")
        print(
            f"站点总量: {summary['matches']} 场 其中{MODE} "
            f"{summary['mode_counts'].get(MODE, 0)} 场"
        )

        match_keys = [item["match_key"] for item in paged_get("matches", {"mode": MODE})]
        print(f"对局列表: {len(match_keys)} 场 开始抓详情")
        matches_raw = fetch_match_details(match_keys)

        players = paged_get("players", {"mode": MODE})
        print(f"选手目录: {len(players)} 个 identity")

        dump(out_dir / "summary.json", summary)
        dump(
            out_dir / "matches-raw.json",
            {"fetched_at": fetched_at, "mode": MODE, "count": len(matches_raw), "items": matches_raw},
        )
        dump(
            out_dir / "players.json",
            {"fetched_at": fetched_at, "mode": MODE, "count": len(players), "items": players},
        )

    print("同名冲突对账: 拉取相关选手档案")
    overrides, unqueryable = resolve_ambiguous_names(build_name_index(players), players)

    store, report, mappings = build_store(matches_raw, players, catalog, overrides)
    dump(
        out_dir / "ace-store-from-foxminer.json",
        {"_meta": {"source": "foxminer.icu", "fetched_at": fetched_at, **report}, **store},
    )
    dump(
        out_dir / "name-mapping.json",
        {
            "generated_at": fetched_at,
            "note": "入库时实际发生的名字映射 mapped_to 为归一后的当前昵称"
            " identity 与完整曾用名目录见 players.json",
            "mappings": mappings,
        },
    )

    print(
        f"转换完成: {len(store['matches'])} 场 | 曾用名归一 {report['renamed_entries']} 条"
        f" 同名对账归一 {report['ambiguous_resolved_entries']} 条"
    )
    if unqueryable:
        print(f"提示 档案无法区分的同名当前名: {unqueryable}")
    if report["unmapped_names"]:
        print(f"警告 未匹配到 identity 的名字: {report['unmapped_names']}")
    if report["ambiguous_names"]:
        print(
            f"提示 按名保留的同名参赛记录(当前同名者): {report['ambiguous_names']}"
        )
    print(f"输出目录: {out_dir}")


if __name__ == "__main__":
    main()
