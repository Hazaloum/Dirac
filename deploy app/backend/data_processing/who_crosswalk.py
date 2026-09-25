"""Merge the reviewed WHO hierarchy into IQVIA Market Discovery responses."""
from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import pandas as pd


LEVELS = ("ATC1", "ATC2", "ATC3", "ATC4")
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def _normalise(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text.upper().strip())


@lru_cache(maxsize=1)
def _assets() -> tuple[dict, dict]:
    hierarchy = json.loads((DATA_DIR / "who_atc_hierarchy.json").read_text(encoding="utf-8"))
    crosswalk = json.loads((DATA_DIR / "who_iqvia_crosswalk.json").read_text(encoding="utf-8"))
    return hierarchy, crosswalk


def _latest_year(df: pd.DataFrame) -> tuple[int | None, int | None]:
    years = sorted({int(match.group(1)) for col in df.columns if (match := re.match(r"^(\d{4}) LC Value$", str(col)))})
    if not years:
        return None, None
    return (years[-2] if len(years) > 1 else years[-1]), years[0]


def _who_classes(level: str, iqvia_code: str) -> list[dict]:
    hierarchy, crosswalk = _assets()
    result = []
    for who_code, targets in crosswalk["mappings"][level].items():
        if iqvia_code not in targets:
            continue
        node = hierarchy["levels"][level][who_code]
        meta = crosswalk["meta"][level].get(who_code, {})
        result.append({
            "code": who_code,
            "name": node["name"],
            "status": meta.get("status", "AUTO"),
            "confidence": meta.get("confidence"),
        })
    return sorted(result, key=lambda item: item["code"])


def _has_unmapped_children(level: str, code: str) -> bool:
    if level == "ATC4":
        hierarchy, _ = _assets()
        return bool(hierarchy["molecules_by_atc4"].get(code))
    hierarchy, crosswalk = _assets()
    child_level = LEVELS[LEVELS.index(level) + 1]
    return any(
        node["parent"] == code and not crosswalk["mappings"][child_level].get(child_code)
        for child_code, node in hierarchy["levels"][child_level].items()
    )


def _who_node(level: str, code: str, name: str) -> dict:
    return {
        "code": code,
        "name": name,
        "label": f"{code} {name}",
        "level": level,
        "value": 0,
        "units": 0,
        "cagr": None,
        "top_company": None,
        "top_company_share": None,
        "molecule_count": 0,
        "has_children": _has_unmapped_children(level, code),
        "source": "WHO",
        "source_status": "who_only",
        "market_data_available": False,
        "who_classes": [{"code": code, "name": name, "status": "WHO_ONLY", "confidence": None}],
    }


def enrich_iqvia_response(response: dict, level: str, parent: str | None) -> dict:
    """Label mapped IQVIA nodes and append separately browsable WHO-only nodes."""
    hierarchy, crosswalk = _assets()
    for node in response["nodes"]:
        linked = _who_classes(level, node["code"])
        node.update({
            "source": "IQVIA",
            "source_status": "iqvia_with_who" if linked else "iqvia_only",
            "market_data_available": True,
            "who_classes": linked,
        })

    if level == "ATC1":
        eligible_parents = {""}
    else:
        parent_level = LEVELS[LEVELS.index(level) - 1]
        eligible_parents = {
            who_code
            for who_code, targets in crosswalk["mappings"][parent_level].items()
            if parent in targets
        }
    who_only = []
    for who_code, who_data in hierarchy["levels"][level].items():
        if who_data["parent"] not in eligible_parents:
            continue
        if crosswalk["mappings"][level].get(who_code):
            continue
        who_only.append(_who_node(level, who_code, who_data["name"]))
    response["nodes"].extend(sorted(who_only, key=lambda item: item["code"]))
    response["who_only_count"] = len(who_only)
    response["source_label"] = "IQVIA UAE market data + WHO ATC/DDD 2026"
    return response


def build_who_response(df: pd.DataFrame, level: str, parent: str) -> dict:
    """Return unmapped WHO children for a separately retained WHO branch."""
    hierarchy, crosswalk = _assets()
    if level not in LEVELS:
        raise ValueError(f"Unsupported WHO hierarchy level: {level}")
    nodes = [
        _who_node(level, code, data["name"])
        for code, data in hierarchy["levels"][level].items()
        if data["parent"] == parent and not crosswalk["mappings"][level].get(code)
    ]
    latest, first = _latest_year(df)
    parent_level = LEVELS[LEVELS.index(level) - 1] if level != "ATC1" else None
    parent_name = hierarchy["levels"].get(parent_level, {}).get(parent, {}).get("name", "WHO-only class")
    return {
        "level": level,
        "parent": parent,
        "parent_code": parent,
        "parent_name": parent_name,
        "analysis_year": latest,
        "cagr_period": f"{first}-{latest}" if first and latest else None,
        "currency": "AED",
        "source_label": "WHO ATC/DDD 2026 · No IQVIA market data",
        "total_value": 0,
        "total_units": 0,
        "cagr": None,
        "who_only_count": len(nodes),
        "nodes": sorted(nodes, key=lambda item: item["code"]),
    }


def enrich_molecule_response(response: dict, atc4: str) -> dict:
    """Append WHO molecules absent from IQVIA to a mapped IQVIA ATC4."""
    hierarchy, crosswalk = _assets()
    who_atc4s = [code for code, targets in crosswalk["mappings"]["ATC4"].items() if atc4 in targets]
    who_molecules: dict[str, dict] = {}
    for who_code in who_atc4s:
        targets = crosswalk["mappings"]["ATC4"].get(who_code, [])
        for molecule in hierarchy["molecules_by_atc4"].get(who_code, []):
            item = who_molecules.setdefault(molecule["key"], {**molecule, "who_codes": [], "missing_allowed": False})
            item["who_codes"].append(who_code)
            # A split class can label observed IQVIA molecules in both targets,
            # but its absent molecules cannot safely be assigned to either one.
            item["missing_allowed"] = item["missing_allowed"] or len(targets) == 1

    observed = {_normalise(node["name"]): node for node in response["nodes"]}
    for key, node in observed.items():
        who_match = who_molecules.get(key)
        node.update({
            "source": "IQVIA",
            "source_status": "iqvia_with_who" if who_match else "iqvia_only",
            "market_data_available": True,
            "who_codes": who_match["who_codes"] if who_match else [],
        })
    for key, molecule in who_molecules.items():
        if key in observed or not molecule["missing_allowed"]:
            continue
        response["nodes"].append({
            "code": molecule["name"].upper(),
            "name": molecule["name"],
            "atc5_code": molecule["code"],
            "level": "MOLECULE",
            "value": 0,
            "units": 0,
            "cagr": None,
            "top_company": None,
            "top_company_share": None,
            "has_children": False,
            "source": "WHO",
            "source_status": "who_only",
            "market_data_available": False,
            "who_codes": molecule["who_codes"],
        })
    response["nodes"].sort(key=lambda item: (not item.get("market_data_available", False), -item.get("value", 0), item["name"]))
    response["who_classes"] = _who_classes("ATC4", atc4)
    response["source_label"] = "IQVIA UAE market data + WHO ATC/DDD 2026"
    return response


def build_who_molecules_response(df: pd.DataFrame, atc4: str) -> dict:
    hierarchy, _ = _assets()
    class_data = hierarchy["levels"]["ATC4"].get(atc4)
    if not class_data:
        raise ValueError(f"Unknown WHO ATC4 class: {atc4}")
    nodes = [{
        "code": item["name"].upper(),
        "name": item["name"],
        "atc5_code": item["code"],
        "level": "MOLECULE",
        "value": 0,
        "units": 0,
        "cagr": None,
        "top_company": None,
        "top_company_share": None,
        "has_children": False,
        "source": "WHO",
        "source_status": "who_only",
        "market_data_available": False,
        "who_codes": [atc4],
    } for item in hierarchy["molecules_by_atc4"].get(atc4, [])]
    latest, first = _latest_year(df)
    return {
        "level": "MOLECULE",
        "parent": atc4,
        "parent_code": atc4,
        "parent_name": class_data["name"],
        "analysis_year": latest,
        "cagr_period": f"{first}-{latest}" if first and latest else None,
        "source_label": "WHO ATC/DDD 2026 · No IQVIA market data",
        "total_value": 0,
        "total_units": 0,
        "cagr": None,
        "nodes": nodes,
    }
