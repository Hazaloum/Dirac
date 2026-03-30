"""
IQVIA Extractor
===============
Extracts all confirmed scoring data points for a molecule from the cleaned
IQVIA DataFrame. Receives the DataFrame from loader.py — never reads files.

All data points confirmed for use in scorer.py:
  - total_value, total_units (latest full year)
  - value_cagr, unit_cagr
  - num_competitors
  - market_leader_share, leader_share_change
  - launch_year
  - private_pct, lpo_pct, private_cagr, lpo_cagr
  - atc1, atc2, atc3, atc4
  - atc4_class_value, atc4_class_cagr, atc4_molecule_count

Combination molecules (e.g. AMLODIPINE + VALSARTAN) are handled by dividing
all unit/value aggregations by the number of constituent molecules to prevent
double-counting — same fix applied throughout Pharmozi/CursorFile.py.
"""

import logging
from typing import List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# Year detection helpers
# ─────────────────────────────────────────────────────────────

def _detect_year_columns(df: pd.DataFrame, suffix: str) -> List[str]:
    """Return sorted list of columns matching '\\d{4} {suffix}'."""
    import re
    pattern = re.compile(rf"^\d{{4}}\s+{re.escape(suffix)}$")
    return sorted([c for c in df.columns if pattern.match(c)])


def _get_years(df: pd.DataFrame, suffix: str = "Units") -> Tuple[List[int], int]:
    """
    Return (sorted_years, end_year) where end_year is second-to-last
    to ensure we use a complete year of data.
    """
    cols = _detect_year_columns(df, suffix)
    years = sorted([int(c.split()[0]) for c in cols])
    if not years:
        raise ValueError(f"No '{suffix}' year columns found in DataFrame")
    end_year = years[-2] if len(years) >= 2 else years[-1]
    return years, end_year


# ─────────────────────────────────────────────────────────────
# CAGR calculation
# ─────────────────────────────────────────────────────────────

def _calculate_cagr(start_val: float, end_val: float, n_years: int) -> float:
    """Standard CAGR formula. Returns 0.0 on invalid inputs."""
    if n_years <= 0 or start_val <= 0 or end_val <= 0:
        return 0.0
    try:
        return round(((end_val / start_val) ** (1 / n_years) - 1) * 100, 2)
    except (ZeroDivisionError, ValueError):
        return 0.0


def _flexible_cagr(mol_df: pd.DataFrame, suffix: str, num_molecules: int) -> float:
    """
    CAGR from the first non-zero year to end_year.
    Divides by num_molecules to correct for combination double-counting.
    """
    years, end_year = _get_years(mol_df, suffix)
    end_val = mol_df[f"{end_year} {suffix}"].sum() / num_molecules

    for year in years:
        start_val = mol_df[f"{year} {suffix}"].sum() / num_molecules
        if start_val > 0 and year < end_year:
            return _calculate_cagr(start_val, end_val, end_year - year)

    return 0.0


# ─────────────────────────────────────────────────────────────
# Sub-extractors
# ─────────────────────────────────────────────────────────────

def _get_totals(mol_df: pd.DataFrame, end_year: int, num_molecules: int) -> dict:
    total_value = mol_df[f"{end_year} LC Value"].sum() / num_molecules
    total_units = mol_df[f"{end_year} Units"].sum() / num_molecules
    return {
        "total_value": round(total_value, 0),
        "total_units": round(total_units, 0),
    }


def _get_cagrs(mol_df: pd.DataFrame, num_molecules: int) -> dict:
    return {
        "unit_cagr":  _flexible_cagr(mol_df, "Units",    num_molecules),
        "value_cagr": _flexible_cagr(mol_df, "LC Value", num_molecules),
    }


def _get_market_split(mol_df: pd.DataFrame, end_year: int, num_molecules: int) -> dict:
    private_df = mol_df[mol_df["Market"] == "PRIVATE MARKET"]
    lpo_df     = mol_df[mol_df["Market"] == "LPO"]

    private_units = private_df[f"{end_year} Units"].sum() / num_molecules
    lpo_units     = lpo_df[f"{end_year} Units"].sum()     / num_molecules
    total_units   = private_units + lpo_units

    private_pct = (private_units / total_units * 100) if total_units > 0 else 0.0
    lpo_pct     = (lpo_units     / total_units * 100) if total_units > 0 else 0.0

    private_cagr = _flexible_cagr(private_df, "Units", num_molecules) if len(private_df) > 0 else 0.0
    lpo_cagr     = _flexible_cagr(lpo_df,     "Units", num_molecules) if len(lpo_df)     > 0 else 0.0

    return {
        "private_pct":  round(private_pct, 1),
        "lpo_pct":      round(lpo_pct, 1),
        "private_cagr": private_cagr,
        "lpo_cagr":     lpo_cagr,
    }


def _get_competitor_info(
    mol_df: pd.DataFrame,
    df_full: pd.DataFrame,
    end_year: int,
    total_value: float,
    num_molecules: int,
) -> dict:
    num_competitors = mol_df["Manufacturer"].nunique()

    manu_values = mol_df.groupby("Manufacturer")[f"{end_year} LC Value"].sum() / num_molecules
    top_manu = manu_values.idxmax() if len(manu_values) > 0 else None
    leader_share_current = (manu_values.max() / total_value * 100) if total_value > 0 else 0.0

    # Leader share change: compare to first available year
    years, _ = _get_years(mol_df, "Units")
    start_year = years[0]
    start_total_value = mol_df[f"{start_year} LC Value"].sum() / num_molecules
    if top_manu and start_total_value > 0:
        top_start_value = mol_df[mol_df["Manufacturer"] == top_manu][f"{start_year} LC Value"].sum() / num_molecules
        leader_share_start = top_start_value / start_total_value * 100
    else:
        leader_share_start = 0.0

    share_change = leader_share_current - leader_share_start

    top3_share = round(manu_values.nlargest(3).sum() / total_value * 100, 1) if total_value > 0 else 0.0

    # Leader CAGR (value and units)
    leader_value_cagr = None
    leader_units_cagr = None
    if top_manu:
        leader_df         = mol_df[mol_df["Manufacturer"] == top_manu]
        leader_value_cagr = _flexible_cagr(leader_df, "LC Value", num_molecules)
        leader_units_cagr = _flexible_cagr(leader_df, "Units",    num_molecules)

    # Second-ranked player by value (CAGR value and units)
    second_manu       = None
    second_value_cagr = None
    second_units_cagr = None
    if len(manu_values) >= 2:
        second_manu   = manu_values.nlargest(2).index[-1]
        second_df     = mol_df[mol_df["Manufacturer"] == second_manu]
        second_value_cagr = _flexible_cagr(second_df, "LC Value", num_molecules)
        second_units_cagr = _flexible_cagr(second_df, "Units",    num_molecules)

    return {
        "num_competitors":       num_competitors,
        "market_leader":         top_manu,
        "market_leader_share":   round(leader_share_current, 1),
        "leader_share_change":   round(share_change, 1),
        "leader_value_cagr":     leader_value_cagr,
        "leader_units_cagr":     leader_units_cagr,
        "top3_company_share":    top3_share,
        "second_player":         second_manu,
        "second_value_cagr":     second_value_cagr,
        "second_units_cagr":     second_units_cagr,
    }


def _class_ranks_and_pcts(
    df_full: pd.DataFrame,
    atc_level: str,
    atc_val: str,
    end_year: int,
    num_molecules: int,
    molecule_upper: str,
    mol_value: float,
    mol_units: float,
) -> dict:
    """
    Compute class-level stats for a given ATC level (ATC3 or ATC4):
      - class value, units, molecule count, CAGR
      - molecule rank by value and units within the class (1 = highest), as "rank/N"
      - molecule % of class by value and units
    """
    normalised = df_full[atc_level].astype(str).str.split().str.join(" ")
    class_df = df_full[normalised == atc_val]
    class_value = class_df[f"{end_year} LC Value"].sum() / num_molecules
    class_units = class_df[f"{end_year} Units"].sum()    / num_molecules
    mol_count   = class_df["Molecule Combination"].nunique()
    class_cagr  = _flexible_cagr(class_df, "LC Value", num_molecules)

    value_by_mol = (
        class_df.groupby("Molecule Combination")[f"{end_year} LC Value"].sum()
        .sort_values(ascending=False).reset_index()
    )
    units_by_mol = (
        class_df.groupby("Molecule Combination")[f"{end_year} Units"].sum()
        .sort_values(ascending=False).reset_index()
    )
    value_ranks = {r["Molecule Combination"]: i + 1 for i, r in value_by_mol.iterrows()}
    units_ranks = {r["Molecule Combination"]: i + 1 for i, r in units_by_mol.iterrows()}

    n = mol_count
    value_rank = f"{value_ranks[molecule_upper]}/{n}" if molecule_upper in value_ranks else None
    units_rank = f"{units_ranks[molecule_upper]}/{n}" if molecule_upper in units_ranks else None
    value_pct  = round(mol_value / class_value * 100, 1) if class_value  > 0 else None
    units_pct  = round(mol_units / class_units * 100, 1) if class_units  > 0 else None

    return {
        "class_value":    round(class_value, 0),
        "class_units":    round(class_units, 0),
        "molecule_count": mol_count,
        "class_cagr":     class_cagr,
        "value_rank":     value_rank,
        "units_rank":     units_rank,
        "value_pct":      value_pct,
        "units_pct":      units_pct,
    }


def _get_atc_context(
    df_full: pd.DataFrame,
    mol_df: pd.DataFrame,
    end_year: int,
    num_molecules: int,
    molecule_upper: str,
) -> dict:
    """Extract ATC codes plus ATC3 and ATC4 class metrics with rankings and percentages."""
    atc_codes = {}
    for level in ["ATC1", "ATC2", "ATC3", "ATC4"]:
        col = next((c for c in mol_df.columns if c.strip() == level), None)
        if col and not mol_df[col].isna().all():
            mode_val = mol_df[col].mode()
            raw = mode_val[0] if len(mode_val) > 0 else None
            atc_codes[level.lower()] = (
                " ".join(str(raw).split()) if raw is not None else None
            )
        else:
            atc_codes[level.lower()] = None

    mol_value = mol_df[f"{end_year} LC Value"].sum() / num_molecules
    mol_units = mol_df[f"{end_year} Units"].sum()    / num_molecules

    result = {**atc_codes}

    for atc_level, prefix in [("ATC4", "atc4"), ("ATC3", "atc3")]:
        atc_val = atc_codes.get(prefix)
        actual_col = next((c for c in df_full.columns if c.strip() == atc_level), None)
        if atc_val and actual_col:
            stats = _class_ranks_and_pcts(
                df_full, actual_col, atc_val, end_year,
                num_molecules, molecule_upper, mol_value, mol_units,
            )
            result.update({
                f"{prefix}_class_value":    stats["class_value"],
                f"{prefix}_class_units":    stats["class_units"],
                f"{prefix}_molecule_count": stats["molecule_count"],
                f"{prefix}_class_cagr":     stats["class_cagr"],
                f"{prefix}_value_rank":     stats["value_rank"],
                f"{prefix}_units_rank":     stats["units_rank"],
                f"{prefix}_value_pct":      stats["value_pct"],
                f"{prefix}_units_pct":      stats["units_pct"],
            })
        else:
            for key in ["class_value", "class_units", "molecule_count", "class_cagr",
                        "value_rank", "units_rank", "value_pct", "units_pct"]:
                result[f"{prefix}_{key}"] = None

    return result


# ─────────────────────────────────────────────────────────────
# Master extraction function
# ─────────────────────────────────────────────────────────────

def get_iqvia_data(df: pd.DataFrame, molecule: str) -> Optional[dict]:
    """
    Extract all confirmed scoring data points for a molecule.

    Args:
        df:       Cleaned IQVIA DataFrame from loader.load_iqvia()
        molecule: Molecule name — must match 'Molecule Combination' column.
                  Use molecule_normalizer to resolve the canonical name first.

    Returns:
        Dict of all data points, or None if molecule not found.
    """
    molecule_upper = molecule.strip().upper()

    mol_df = df[df["Molecule Combination"].str.upper() == molecule_upper].copy()
    if mol_df.empty:
        logger.warning(f"IQVIA: molecule not found — '{molecule}'")
        return None

    # Combination molecules need denominator correction to avoid double-counting
    num_molecules = len(molecule_upper.split(" + ")) if " + " in molecule_upper else 1

    _, end_year = _get_years(mol_df, "Units")

    totals      = _get_totals(mol_df, end_year, num_molecules)
    cagrs       = _get_cagrs(mol_df, num_molecules)
    market_split = _get_market_split(mol_df, end_year, num_molecules)
    competitors  = _get_competitor_info(mol_df, df, end_year, totals["total_value"], num_molecules)
    atc_context  = _get_atc_context(df, mol_df, end_year, num_molecules, molecule_upper)

    launch_year = None
    if "Launch Year" in mol_df.columns and not mol_df["Launch Year"].isna().all():
        launch_year = int(mol_df["Launch Year"].min())

    cagr_delta = round(cagrs["value_cagr"] - cagrs["unit_cagr"], 2)

    return {
        "molecule":      molecule_upper,
        "analysis_year": end_year,
        "launch_year":   launch_year,
        **totals,
        **cagrs,
        "cagr_delta":    cagr_delta,
        **market_split,
        **competitors,
        **atc_context,
    }
