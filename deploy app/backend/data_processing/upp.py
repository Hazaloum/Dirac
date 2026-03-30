"""
UPP Extractor
=============
Extracts the number of active registered manufacturers for a molecule
from the cleaned UPP DataFrame. Receives the DataFrame from loader.py.

Only confirmed data point for scoring:
  - num_manufacturers: distinct manufacturers with active UPP registrations

Combination molecules require ALL constituent INNs to be present in the
same product record. Falls back to fuzzy matching if exact search fails.
"""

import logging
import re
from typing import List

import pandas as pd

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# Internal search helpers
# ─────────────────────────────────────────────────────────────

def _split_constituents(molecule: str) -> List[str]:
    """Split a molecule name into constituents using any combination separator."""
    upper = molecule.strip().upper()
    parts = re.split(r'\s*\+\s*|\s*/\s*|\s*,\s*|\s*;\s*|\s*&\s*|\s+AND\s+', upper, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip()]


def _search_single(df: pd.DataFrame, molecule: str) -> pd.DataFrame:
    """
    Find rows matching a single-INN molecule.
    Excludes products that are combinations (contain +, , or ; in Generic Name).
    """
    mol_upper = molecule.strip().upper()

    mask = (
        df["Package Name"].str.contains(mol_upper, na=False, regex=False) |
        df["Generic Name"].str.contains(mol_upper, na=False, regex=False)
    )

    # Exclude combination products
    for indicator in ["+", ",", ";"]:
        mask &= ~df["Generic Name"].str.contains(indicator, na=False, regex=False)

    return df[mask].copy()


def _search_combination(df: pd.DataFrame, constituents: List[str]) -> pd.DataFrame:
    """
    Find rows where ALL constituent INNs are present.
    Also filters to products with the same number of molecules as the query
    to avoid partial-combination false positives.
    """
    mask = pd.Series([True] * len(df), index=df.index)
    for mol in constituents:
        mol_mask = (
            df["Package Name"].str.contains(mol, na=False, regex=False) |
            df["Generic Name"].str.contains(mol, na=False, regex=False)
        )
        mask &= mol_mask

    # Exclude products with more molecules than we're searching for
    expected_count = len(constituents)

    def count_molecules(gen_name: str) -> int:
        if pd.isna(gen_name):
            return 0
        return gen_name.count("+") + gen_name.count(",") + gen_name.count(";") + 1

    mol_counts = df["Generic Name"].apply(count_molecules)
    mask &= (mol_counts == expected_count)

    return df[mask].copy()


def _fuzzy_fallback(df: pd.DataFrame, molecule: str, threshold: int = 80) -> pd.DataFrame:
    """
    Fuzzy match using rapidfuzz when exact search returns nothing.
    Returns matching rows above the similarity threshold.
    """
    try:
        from rapidfuzz import fuzz
    except ImportError:
        logger.warning("rapidfuzz not installed — fuzzy fallback unavailable")
        return pd.DataFrame()

    constituents = _split_constituents(molecule)
    matched_indices = []

    for idx, row in df.iterrows():
        pkg  = str(row["Package Name"]) if pd.notna(row["Package Name"]) else ""
        gen  = str(row["Generic Name"])  if pd.notna(row["Generic Name"])  else ""
        combined = f"{pkg} {gen}"

        if len(constituents) == 1:
            score = fuzz.partial_ratio(constituents[0], combined)
            if score >= threshold:
                matched_indices.append(idx)
        else:
            if all(fuzz.partial_ratio(mol, combined) >= threshold for mol in constituents):
                matched_indices.append(idx)

    return df.loc[matched_indices].copy() if matched_indices else pd.DataFrame()


# ─────────────────────────────────────────────────────────────
# Master extraction function
# ─────────────────────────────────────────────────────────────

def get_upp_data(df: pd.DataFrame, molecule: str) -> dict:
    """
    Return the number of active registered manufacturers for a molecule in UPP.

    Args:
        df:       Cleaned UPP DataFrame from loader.load_upp()
        molecule: Molecule name (will be uppercased internally)

    Returns:
        {
            "found":             bool,
            "num_manufacturers": int,   # 0 if not found
            "error":             str | None,
        }
    """
    mol_upper   = molecule.strip().upper()
    constituents = _split_constituents(mol_upper)
    is_combo     = len(constituents) > 1

    # Exact search
    results = _search_combination(df, constituents) if is_combo else _search_single(df, mol_upper)

    # Fuzzy fallback
    if results.empty:
        logger.debug(f"UPP: exact search empty for '{molecule}', trying fuzzy")
        results = _fuzzy_fallback(df, mol_upper)

    if results.empty:
        logger.info(f"UPP: '{molecule}' not found")
        return {"found": False, "num_manufacturers": 0, "error": "Not found in UPP"}

    # Filter to active products only
    active = results[results["Status"] == "ACTIVE"]
    if active.empty:
        return {"found": True, "num_manufacturers": 0, "error": "All UPP products inactive"}

    num_manufacturers = active["Manufacturer Name"].nunique()
    logger.info(f"UPP: '{molecule}' → {num_manufacturers} active manufacturers")

    return {
        "found":             True,
        "num_manufacturers": num_manufacturers,
        "error":             None,
    }
