"""
reference_data.py — IQVIA / UPP / MOHAP / WHO ATC reference data in Supabase.

These datasets are read once at startup (see data_processing/loader.py) and
refreshed with the scripts in scripts/. Nothing is read from local files.

Tables
------
iqvia_sales          one row per product/pack/market; yearly "YYYY LC Value" /
                     "YYYY Units" figures live in the `sales` jsonb column so a
                     refresh that adds a year needs no schema change
upp_drugs            UPP drug registry, original column names
mohap_prices         MOHAP price list, original column names
who_atc_classes      WHO ATC1–ATC4 hierarchy
who_atc_molecules    WHO ATC5 molecules per ATC4
who_iqvia_crosswalk  reviewed WHO → IQVIA class mapping
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

from supabase_client import fetch_all, get_client

LEVELS = ("ATC1", "ATC2", "ATC3", "ATC4")
YEAR_COL = re.compile(r"^(\d{4}) (LC Value|Units)$")
UPLOAD_BATCH = 500

TABLES = {"iqvia": "iqvia_sales", "upp": "upp_drugs", "mohap": "mohap_prices"}


# ─── Reading ──────────────────────────────────────────────────────────────────

def _frame(rows: list[dict]) -> pd.DataFrame:
    """Rows → DataFrame shaped like the old read_csv output (NaN for blanks)."""
    df = pd.DataFrame(rows)
    if "id" in df.columns:
        df = df.drop(columns=["id"])
    with pd.option_context("future.no_silent_downcasting", True):
        return df.fillna(np.nan)


def fetch_iqvia() -> pd.DataFrame:
    df = _frame(fetch_all(TABLES["iqvia"]))
    sales = pd.DataFrame(df.pop("sales").tolist(), index=df.index)
    year_cols = sorted(
        (c for c in sales.columns if YEAR_COL.match(c)),
        key=lambda c: (int(c[:4]), c[5:] != "LC Value"),
    )
    return pd.concat([df, sales.reindex(columns=year_cols).astype(float)], axis=1)


def fetch_upp() -> pd.DataFrame:
    return _frame(fetch_all(TABLES["upp"]))


def fetch_mohap() -> pd.DataFrame:
    return _frame(fetch_all(TABLES["mohap"]))


def fetch_who() -> tuple[dict, dict]:
    """Return (hierarchy, crosswalk) in the shape who_crosswalk.py expects."""
    hierarchy: dict = {"levels": {level: {} for level in LEVELS}, "molecules_by_atc4": {}}
    for row in fetch_all("who_atc_classes"):
        hierarchy["levels"][row["level"]][row["code"]] = {
            "code": row["code"], "name": row["name"], "parent": row["parent"],
        }
    for row in fetch_all("who_atc_molecules"):
        hierarchy["molecules_by_atc4"].setdefault(row["atc4"], []).append(
            {"code": row["code"], "name": row["name"], "key": row["key"]}
        )

    crosswalk: dict = {"mappings": {level: {} for level in LEVELS}, "meta": {level: {} for level in LEVELS}}
    for row in fetch_all("who_iqvia_crosswalk"):
        crosswalk["mappings"][row["level"]][row["who_code"]] = row["iqvia_codes"]
        crosswalk["meta"][row["level"]][row["who_code"]] = {
            key: row[key]
            for key in ("method", "status", "overlap", "confidence", "rationale")
            if row[key] is not None
        }
    return hierarchy, crosswalk


# ─── Writing (refresh scripts only) ───────────────────────────────────────────

def _normalise_headers(df: pd.DataFrame) -> pd.DataFrame:
    """'Pharmacy Price\\n(AED)' → 'Pharmacy Price (AED)'."""
    df = df.copy()
    df.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in df.columns]
    return df


def _records(df: pd.DataFrame) -> list[dict]:
    """JSON-safe rows: NaN → None, numpy scalars → Python scalars."""
    clean = df.astype(object).where(pd.notna(df), None)
    return [
        {k: (v.item() if isinstance(v, np.generic) else v) for k, v in row.items()}
        for row in clean.to_dict("records")
    ]


def replace_table(table: str, rows: list[dict]) -> int:
    """Delete every row of ``table`` and insert ``rows`` in batches.

    Not atomic: if an insert batch fails the table is left partially loaded.
    Re-run the refresh; the running backend keeps its in-memory copy until it
    restarts.
    """
    client = get_client()
    client.table(table).delete().gte("id", 0).execute()
    for start in range(0, len(rows), UPLOAD_BATCH):
        client.table(table).insert(rows[start:start + UPLOAD_BATCH]).execute()
    return len(rows)


def upload_iqvia(df: pd.DataFrame) -> int:
    df = _normalise_headers(df)
    year_cols = [c for c in df.columns if YEAR_COL.match(c)]
    rows = []
    for dims, sales in zip(_records(df.drop(columns=year_cols)), _records(df[year_cols])):
        dims["sales"] = {k: v for k, v in sales.items() if v is not None}
        rows.append(dims)
    return replace_table(TABLES["iqvia"], rows)


def upload_upp(df: pd.DataFrame) -> int:
    return replace_table(TABLES["upp"], _records(_normalise_headers(df)))


def upload_mohap(df: pd.DataFrame) -> int:
    return replace_table(TABLES["mohap"], _records(_normalise_headers(df)))


def upload_who(hierarchy: dict, crosswalk: dict) -> dict[str, int]:
    classes = [
        {"level": level, "code": code, "name": node["name"], "parent": node["parent"]}
        for level in LEVELS for code, node in hierarchy["levels"][level].items()
    ]
    molecules = [
        {"atc4": atc4, "code": m["code"], "name": m["name"], "key": m["key"]}
        for atc4, items in hierarchy["molecules_by_atc4"].items() for m in items
    ]
    mappings = []
    for level in LEVELS:
        for who_code, targets in crosswalk["mappings"][level].items():
            meta = crosswalk["meta"][level].get(who_code, {})
            mappings.append({
                "level": level, "who_code": who_code, "iqvia_codes": list(targets),
                "method": meta.get("method"), "status": meta.get("status"),
                "overlap": meta.get("overlap"), "confidence": meta.get("confidence"),
                "rationale": meta.get("rationale"),
            })
    return {
        "who_atc_classes": replace_table("who_atc_classes", classes),
        "who_atc_molecules": replace_table("who_atc_molecules", molecules),
        "who_iqvia_crosswalk": replace_table("who_iqvia_crosswalk", mappings),
    }
