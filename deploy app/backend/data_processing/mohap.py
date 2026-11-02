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

def find_mohap_rows(df: pd.DataFrame, molecule: str) -> pd.DataFrame:
    """The MOHAP rows counted for a molecule (combinations: every INN in the same row)."""
    mol_upper    = molecule.strip().upper()
    constituents = _split_constituents(mol_upper)
    if len(constituents) > 1:
        return _search_combination(df, constituents)
    return _search_single(df, mol_upper)


def _text(v) -> str:
    return "" if pd.isna(v) or str(v).strip().upper() in ("", "NAN", "NONE") else str(v).strip()


def _num(v):
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def get_mohap_competitors(df: pd.DataFrame, molecule: str) -> list[dict]:
    """
    The companies behind the MOHAP holder count, each with its products
    (trade name, ingredient, strength, form, pack, public price, agent).
    Biggest product list first.
    """
    rows = find_mohap_rows(df, molecule)
    companies = []
    for company, g in rows.groupby("Company", dropna=False):
        products, seen = [], set()
        for _, r in g.iterrows():
            p = {
                "name":       _text(r.get("Trade Name")),
                "ingredient": _text(r.get("Ingredient")),
                "strength":   _text(r.get("Strength")),
                "form":       _text(r.get("Form")),
                "pack":       _text(r.get("Pack Size")),
                "price":      _num(r.get("Public Price (AED)")),
                "agent":      _text(r.get("Agent")),
            }
            key = (p["name"], p["strength"], p["form"], p["pack"])
            if key in seen:
                continue
            seen.add(key)
            products.append(p)
        products.sort(key=lambda p: (p["name"], p["strength"], p["form"], p["pack"]))
        agents = sorted({p["agent"] for p in products if p["agent"]})
        companies.append({"company": _text(company) or "Unknown", "agents": agents, "products": products})
    companies.sort(key=lambda c: (-len(c["products"]), c["company"]))
    return companies


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
    results = find_mohap_rows(df, molecule)

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
