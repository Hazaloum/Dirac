"""Market Discovery aggregates for the IQVIA/EphMRA hierarchy.

The source contains one row per product/pack.  Combination products are
allocated evenly across their constituent molecules, matching the convention
used by the rest of the analysis pipeline.
"""
from __future__ import annotations

import re
from typing import Any

import pandas as pd


LEVELS = ("ATC1", "ATC2", "ATC3", "ATC4")


def _years(df: pd.DataFrame, suffix: str) -> list[int]:
    pattern = re.compile(rf"^(\d{{4}})\s+{re.escape(suffix)}$")
    return sorted(int(m.group(1)) for c in df.columns if (m := pattern.match(str(c))))


def _code_name(value: Any) -> tuple[str, str]:
    text = " ".join(str(value).split()).strip()
    if not text or text.lower() in {"nan", "none"}:
        return "", ""
    code, _, name = text.partition(" ")
    return code, name


def _same_class(series: pd.Series, selector: str) -> pd.Series:
    """Match either the complete IQVIA label or just its code."""
    wanted = " ".join(str(selector).split()).upper()
    wanted_code = wanted.split(" ", 1)[0]
    normal = series.fillna("").astype(str).str.replace(r"\s+", " ", regex=True).str.strip().str.upper()
    return (normal == wanted) | (normal.str.split(" ", n=1).str[0] == wanted_code)


def _allocate_factor(df: pd.DataFrame) -> pd.Series:
    combos = df.get("Molecule Combination", pd.Series("", index=df.index)).fillna("").astype(str)
    counts = combos.str.split(" + ", regex=False).map(lambda values: max(1, len([v for v in values if v.strip()])))
    return 1 / counts


def _cagr_from_first_positive(class_df: pd.DataFrame, years: list[int], latest: int) -> float | None:
    """Value CAGR from the first positive complete year through ``latest``."""
    latest_value = float(class_df[f"_value_{latest}"].sum())
    if latest_value <= 0:
        return None
    for year in years:
        if year >= latest:
            break
        start_value = float(class_df[f"_value_{year}"].sum())
        if start_value > 0:
            return ((latest_value / start_value) ** (1 / (latest - year)) - 1) * 100
    return None


def build_market_discovery(
    df: pd.DataFrame,
    level: str = "ATC1",
    parent: str | None = None,
) -> dict:
    """Return segmented-bar nodes for one EphMRA level.

    ``parent`` may be a complete class label or its code, e.g. ``N05A``.
    The response includes child summaries so the client can drill from ATC1
    to ATC4 without needing a second request (the ``parent`` query remains
    available for focused requests).
    """
    level = level.upper()
    if level not in LEVELS:
        raise ValueError(f"level must be one of {', '.join(LEVELS)}")
    if level != "ATC1" and not parent:
        # A level request without a parent is still useful for tables, so it
        # returns all classes; this is intentionally not an error.
        pass

    work = df.copy()
    if level not in work.columns:
        raise ValueError(f"IQVIA data has no {level} column")
    if parent:
        parent_level = LEVELS[LEVELS.index(level) - 1]
        if parent_level not in work.columns:
            raise ValueError(f"IQVIA data has no {parent_level} column")
        work = work[_same_class(work[parent_level], parent)]
    # Keep totals aligned with the classes rendered by the client. The loader
    # normalises missing labels to the literal string "NAN".
    normal_level = work[level].fillna("").astype(str).str.strip().str.upper()
    work = work[~normal_level.isin({"", "NAN", "NONE"})].copy()

    value_years = _years(work, "LC Value")
    unit_years = _years(work, "Units")
    years = sorted(set(value_years).intersection(unit_years))
    if not years:
        raise ValueError("No yearly LC Value/Units columns found")
    # Match the existing IQVIA analysis convention: the final year may be a
    # partial current-year extract, so use the preceding complete year.
    latest, first = (years[-2] if len(years) >= 2 else years[-1]), years[0]
    value_col, units_col = f"{latest} LC Value", f"{latest} Units"
    work["_factor"] = _allocate_factor(work)
    work["_value_latest"] = pd.to_numeric(work[value_col], errors="coerce").fillna(0) * work["_factor"]
    work["_units_latest"] = pd.to_numeric(work[units_col], errors="coerce").fillna(0) * work["_factor"]
    complete_years = [year for year in years if year <= latest]
    for year in complete_years:
        work[f"_value_{year}"] = pd.to_numeric(work[f"{year} LC Value"], errors="coerce").fillna(0) * work["_factor"]

    children_level = LEVELS[LEVELS.index(level) + 1] if level != LEVELS[-1] else None
    nodes = []
    for raw_class, class_df in work.groupby(level, dropna=False):
        if pd.isna(raw_class) or str(raw_class).strip().upper() in {"NAN", "NONE", ""}:
            continue
        code, name = _code_name(raw_class)
        latest_value = float(class_df["_value_latest"].sum())
        latest_units = float(class_df["_units_latest"].sum())
        cagr = _cagr_from_first_positive(class_df, complete_years, latest)
        company_values = class_df.groupby("Manufacturer")["_value_latest"].sum().sort_values(ascending=False)
        top_company = str(company_values.index[0]) if len(company_values) else None
        top_share = float(company_values.iloc[0] / latest_value * 100) if len(company_values) and latest_value else 0.0
        node = {
            "code": code,
            "name": name,
            "label": " ".join(str(raw_class).split()),
            "level": level,
            "value": round(latest_value, 2),
            "units": round(latest_units, 2),
            "cagr": round(cagr, 2) if cagr is not None else None,
            "top_company": top_company,
            "top_company_share": round(top_share, 2),
            "child_count": int(class_df[children_level].nunique()) if children_level else int(class_df["Molecule"].nunique()),
            # ATC4 drills into individual molecules rather than another ATC level.
            "has_children": bool(class_df[children_level].nunique()) if children_level else bool(class_df["Molecule"].nunique()),
            "molecule_count": int(class_df["Molecule"].nunique()) if "Molecule" in class_df.columns else 0,
        }
        if children_level:
            node["children"] = _child_summaries(class_df, children_level)
        nodes.append(node)
    nodes.sort(key=lambda item: item["value"], reverse=True)
    total_value = float(work["_value_latest"].sum())
    total_units = float(work["_units_latest"].sum())
    total_cagr = _cagr_from_first_positive(work, complete_years, latest)
    parent_name = None
    if parent and len(work):
        parent_level = LEVELS[LEVELS.index(level) - 1]
        _, parent_name = _code_name(work[parent_level].iloc[0])
    return {
        "level": level,
        "parent": parent,
        "parent_code": parent,
        "parent_name": parent_name,
        "latest_year": latest,
        "analysis_year": latest,
        "available_latest_year": years[-1],
        "start_year": first,
        "cagr_period": f"{first}-{latest}",
        "currency": "AED",
        "source_label": "IQVIA UAE market data",
        "total_value": round(total_value, 2),
        "total_units": round(total_units, 2),
        "cagr": round(total_cagr, 2) if total_cagr is not None else None,
        "nodes": nodes,
    }


def _prepared_market_frame(df: pd.DataFrame) -> tuple[pd.DataFrame, list[int], int, int]:
    """Add allocated value/unit columns used by molecule and company views."""
    work = df.copy()
    value_years = _years(work, "LC Value")
    unit_years = _years(work, "Units")
    years = sorted(set(value_years).intersection(unit_years))
    if not years:
        raise ValueError("No yearly LC Value/Units columns found")
    latest = years[-2] if len(years) >= 2 else years[-1]
    complete_years = [year for year in years if year <= latest]
    work["_factor"] = _allocate_factor(work)
    work["_value_latest"] = pd.to_numeric(work[f"{latest} LC Value"], errors="coerce").fillna(0) * work["_factor"]
    work["_units_latest"] = pd.to_numeric(work[f"{latest} Units"], errors="coerce").fillna(0) * work["_factor"]
    for year in complete_years:
        work[f"_value_{year}"] = pd.to_numeric(work[f"{year} LC Value"], errors="coerce").fillna(0) * work["_factor"]
    return work, complete_years, latest, years[0]


def _market_response(nodes: list[dict], level: str, parent: str, parent_name: str, work: pd.DataFrame,
                     years: list[int], latest: int, first: int) -> dict:
    nodes.sort(key=lambda item: item["value"], reverse=True)
    total_value = float(work["_value_latest"].sum())
    total_units = float(work["_units_latest"].sum())
    total_cagr = _cagr_from_first_positive(work, years, latest)
    return {
        "level": level,
        "parent": parent,
        "parent_code": parent,
        "parent_name": parent_name,
        "latest_year": latest,
        "analysis_year": latest,
        "start_year": first,
        "cagr_period": f"{first}-{latest}",
        "currency": "AED",
        "source_label": "IQVIA UAE market data",
        "total_value": round(total_value, 2),
        "total_units": round(total_units, 2),
        "cagr": round(total_cagr, 2) if total_cagr is not None else None,
        "nodes": nodes,
    }


def build_market_molecules(df: pd.DataFrame, atc4: str) -> dict:
    """Return individual molecules within one IQVIA ATC4 class.

    Combination products contribute an equal allocated share to each ingredient,
    so a combination is not presented as an additional molecule and totals do
    not double count the market.
    """
    if "Molecule" not in df.columns or "ATC4" not in df.columns:
        raise ValueError("IQVIA data has no Molecule or ATC4 column")
    selected = df[_same_class(df["ATC4"], atc4)].copy()
    selected = selected[~selected["Molecule"].fillna("").astype(str).str.strip().str.upper().isin({"", "NAN", "NONE"})]
    if selected.empty:
        raise ValueError(f"No molecules found for ATC4 {atc4}")
    work, years, latest, first = _prepared_market_frame(selected)
    _, class_name = _code_name(work["ATC4"].iloc[0])
    nodes = []
    for molecule, molecule_df in work.groupby("Molecule", dropna=False):
        name = " ".join(str(molecule).split()).upper()
        value = float(molecule_df["_value_latest"].sum())
        companies = molecule_df.groupby("Manufacturer")["_value_latest"].sum().sort_values(ascending=False)
        top_company = str(companies.index[0]) if len(companies) else None
        nodes.append({
            "code": name,
            "name": name,
            "label": name,
            "level": "MOLECULE",
            "value": round(value, 2),
            "units": round(float(molecule_df["_units_latest"].sum()), 2),
            "cagr": (round(cagr, 2) if (cagr := _cagr_from_first_positive(molecule_df, years, latest)) is not None else None),
            "top_company": top_company,
            "top_company_share": round(float(companies.iloc[0] / value * 100), 2) if len(companies) and value else 0.0,
            "child_count": int(molecule_df["Manufacturer"].nunique()),
            "has_children": bool(molecule_df["Manufacturer"].nunique()),
        })
    return _market_response(nodes, "MOLECULE", atc4, class_name, work, years, latest, first)


def build_market_competitors(df: pd.DataFrame, atc4: str, molecule: str) -> dict:
    """Return manufacturer shares for an individual molecule within an ATC4."""
    selected = df[_same_class(df["ATC4"], atc4)].copy()
    normal_molecule = selected["Molecule"].fillna("").astype(str).str.replace(r"\s+", " ", regex=True).str.strip().str.upper()
    selected = selected[normal_molecule == " ".join(molecule.split()).upper()]
    if selected.empty:
        raise ValueError(f"No market data found for {molecule} in {atc4}")
    work, years, latest, first = _prepared_market_frame(selected)
    nodes = []
    for manufacturer, company_df in work.groupby("Manufacturer", dropna=False):
        name = " ".join(str(manufacturer).split())
        value = float(company_df["_value_latest"].sum())
        nodes.append({
            "code": name,
            "name": name,
            "label": name,
            "level": "COMPANY",
            "value": round(value, 2),
            "units": round(float(company_df["_units_latest"].sum()), 2),
            "cagr": (round(cagr, 2) if (cagr := _cagr_from_first_positive(company_df, years, latest)) is not None else None),
            "top_company": name,
            "top_company_share": round(value / float(work["_value_latest"].sum()) * 100, 2) if value else 0.0,
            "has_children": False,
        })
    return _market_response(nodes, "COMPANY", molecule, molecule.upper(), work, years, latest, first)


def _child_summaries(df: pd.DataFrame, level: str) -> list[dict]:
    result = []
    for raw, child in df.groupby(level, dropna=False):
        if pd.isna(raw) or str(raw).strip().upper() in {"NAN", "NONE", ""}:
            continue
        code, name = _code_name(raw)
        result.append({"code": code, "name": name, "label": " ".join(str(raw).split()), "level": level})
    return sorted(result, key=lambda item: item["code"])
