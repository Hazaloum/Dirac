"""
MOHAP Extractor
===============
Extracts the number of registered manufacturers for a molecule from the
cleaned MOHAP price list DataFrame. Receives the DataFrame from loader.py.

Only confirmed data point for scoring:
  - num_manufacturers: distinct companies listed for this molecule in MOHAP

Combination molecules require ALL constituent INNs to be present in the
Ingredient field of the same row.
"""

import logging
import re
from typing import List

import pandas as pd

from data_processing.molecule_normalizer import strip_salt_forms

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# Internal search helpers
# ─────────────────────────────────────────────────────────────

def _split_constituents(molecule: str) -> List[str]:
    """
    Split a molecule name into constituents and strip salt forms from each.
    'DAPAGLIFLOZIN PROPANEDIOL + METFORMIN HCL' → ['DAPAGLIFLOZIN', 'METFORMIN']
    """
    upper = molecule.strip().upper()
    parts = re.split(r'\s*\+\s*|\s*/\s*|\s*,\s*|\s*;\s*|\s*&\s*|\s+AND\s+', upper, flags=re.IGNORECASE)
    return [strip_salt_forms(p.strip()) for p in parts if p.strip()]


def _search_single(df: pd.DataFrame, molecule: str) -> pd.DataFrame:
    """Case-insensitive substring match on the Ingredient column."""
    mol_upper = molecule.strip().upper()
    mask = df["Ingredient"].str.contains(mol_upper, na=False, regex=False)
    return df[mask].copy()


def _search_combination(df: pd.DataFrame, constituents: List[str]) -> pd.DataFrame:
    """All constituent INNs must appear in the Ingredient field of the same row."""
    mask = pd.Series([True] * len(df), index=df.index)
    for mol in constituents:
        mask &= df["Ingredient"].str.contains(mol, na=False, regex=False)
    return df[mask].copy()


# ─────────────────────────────────────────────────────────────
# Master extraction function
# ─────────────────────────────────────────────────────────────

def get_mohap_data(df: pd.DataFrame, molecule: str) -> dict:
    """
    Return the number of distinct companies registered for a molecule in MOHAP.

    Args:
        df:       Cleaned MOHAP DataFrame from loader.load_mohap()
        molecule: Molecule name (will be uppercased internally)

    Returns:
        {
            "found":             bool,
            "num_manufacturers": int,   # 0 if not found
            "error":             str | None,
        }
    """
    mol_upper    = molecule.strip().upper()
    constituents = _split_constituents(mol_upper)
    is_combo     = len(constituents) > 1

    results = _search_combination(df, constituents) if is_combo else _search_single(df, mol_upper)

    if results.empty:
        logger.info(f"MOHAP: '{molecule}' not found")
        return {"found": False, "num_manufacturers": 0, "error": "Not found in MOHAP"}

    num_manufacturers = results["Company"].nunique()
    logger.info(f"MOHAP: '{molecule}' → {num_manufacturers} manufacturers")

    return {
        "found":             True,
        "num_manufacturers": num_manufacturers,
        "error":             None,
    }
