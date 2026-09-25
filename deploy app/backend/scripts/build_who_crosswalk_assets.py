"""Build compact runtime WHO hierarchy and WHO→IQVIA mapping assets.

Usage:
    python scripts/build_who_crosswalk_assets.py \
      --who /path/to/WHO_ATC_2026_hierarchy.xlsx \
      --crosswalk /path/to/atc_crosswalk_data.json \
      --reviews /path/to/luna_review_ac.json /path/to/luna_review_dl.json /path/to/luna_review_mv.json
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

import pandas as pd


LEVELS = ("ATC1", "ATC2", "ATC3", "ATC4")


def split_label(value: object) -> tuple[str, str]:
    text = " ".join(str(value).split())
    if " — " in text:
        return tuple(text.split(" — ", 1))
    code, _, name = text.partition(" ")
    return code, name


def normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text.upper().strip())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--who", required=True, type=Path)
    parser.add_argument("--crosswalk", required=True, type=Path)
    parser.add_argument("--reviews", nargs="*", default=[], type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    args = parser.parse_args()

    who = pd.read_excel(args.who)
    hierarchy: dict[str, dict] = {level: {} for level in LEVELS}
    for level_index, level in enumerate(LEVELS):
        parent_level = LEVELS[level_index - 1] if level_index else None
        for raw, group in who.groupby(level, sort=True):
            code, name = split_label(raw)
            parent = split_label(group[parent_level].iloc[0])[0] if parent_level else ""
            hierarchy[level][code] = {"code": code, "name": name, "parent": parent}

    molecules_by_atc4: dict[str, list[dict[str, str]]] = {}
    for raw_atc4, group in who.groupby("ATC4", sort=True):
        atc4_code, _ = split_label(raw_atc4)
        molecules = []
        for raw_atc5 in group["ATC5"].dropna().unique():
            code, name = split_label(raw_atc5)
            molecules.append({"code": code, "name": name, "key": normalize(name)})
        molecules_by_atc4[atc4_code] = molecules

    deterministic = json.loads(args.crosswalk.read_text(encoding="utf-8"))
    mappings: dict[str, dict[str, list[str]]] = {level: {} for level in LEVELS}
    mapping_meta: dict[str, dict[str, dict]] = {level: {} for level in LEVELS}
    for level in LEVELS:
        for row in deterministic["levels"][level]:
            who_code = row.get("WHO code")
            iqvia_code = row.get("IQVIA code")
            if not who_code:
                continue
            if row.get("Status") == "AUTO" and iqvia_code:
                mappings[level].setdefault(who_code, []).append(iqvia_code)
                mapping_meta[level][who_code] = {
                    "method": row.get("Method", ""),
                    "status": "AUTO",
                    "overlap": row.get("% overlap", 0),
                }
            else:
                mappings[level].setdefault(who_code, [])
                mapping_meta[level].setdefault(who_code, {
                    "method": row.get("Method", ""),
                    "status": row.get("Status", "WHO_ONLY"),
                    "overlap": row.get("% overlap", 0),
                })

    reviewed: dict[tuple[str, str], dict] = {}
    for review_path in args.reviews:
        for decision in json.loads(review_path.read_text(encoding="utf-8")):
            level = decision.get("level", "ATC4")
            reviewed[(level, decision["who_code"])] = decision

    for (level, who_code), decision in reviewed.items():
        if level not in mappings:
            continue
        resolved = decision.get("decision") != "UNRESOLVED"
        mappings[level][who_code] = list(dict.fromkeys(decision.get("proposed_iqvia_codes", []))) if resolved else []
        mapping_meta[level][who_code] = {
            "method": "LUNA_REVIEW",
            "status": decision.get("decision", "UNRESOLVED"),
            "confidence": decision.get("confidence", ""),
            "rationale": decision.get("rationale", ""),
        }

    for level in LEVELS:
        for who_code in hierarchy[level]:
            mappings[level].setdefault(who_code, [])
            mapping_meta[level].setdefault(who_code, {"method": "WHO_ONLY", "status": "WHO_ONLY"})
        for who_code, targets in mappings[level].items():
            mappings[level][who_code] = sorted(set(targets))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "who_atc_hierarchy.json").write_text(json.dumps({
        "levels": hierarchy,
        "molecules_by_atc4": molecules_by_atc4,
    }, separators=(",", ":")), encoding="utf-8")
    (args.output_dir / "who_iqvia_crosswalk.json").write_text(json.dumps({
        "mappings": mappings,
        "meta": mapping_meta,
    }, separators=(",", ":")), encoding="utf-8")

    mapped = {level: sum(bool(targets) for targets in mappings[level].values()) for level in LEVELS}
    print(json.dumps({"mapped_who_classes": mapped, "reviewed_decisions": len(reviewed)}, indent=2))


if __name__ == "__main__":
    main()
