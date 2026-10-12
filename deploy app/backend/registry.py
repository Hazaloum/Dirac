"""
registry.py — read-only lookups on the master registry (Supabase `registrations` / `companies`).

- search_companies(q): canonical companies for the company-name picker (most registrations first).
- molecule_companies(name): every company holding a registration for a molecule or combination
  (IQVIA-style name, e.g. "AMLODIPINE + VALSARTAN"), via SQL registry_molecule_holders: match "exact" = the same
  molecule / combination; "combination" = a combination that contains it (amlodipine -> amlodipine + valsartan).
"""
from __future__ import annotations

from supabase_client import get_client


def search_companies(q: str, limit: int = 15) -> list[dict]:
    q = (q or "").strip()
    if len(q) < 2:
        return []
    return get_client().rpc("registry_search_companies", {"p_q": q, "p_limit": limit}).execute().data or []


def molecule_companies(name: str) -> dict:
    rows = get_client().rpc("registry_molecule_holders", {"p_name": name}).execute().data or []
    exact = [r for r in rows if r["match"] == "exact"]
    combos = [r for r in rows if r["match"] == "combination"]
    return {
        "molecule": name,
        "combo_key": rows[0]["combo_key"] if rows else get_client().rpc("registry_molecule_key", {"p_name": name}).execute().data,
        "companies": exact,
        "combination_companies": combos,
        "countries": sorted({c for r in exact for c in (r.get("countries") or [])}),
        "in_uae": sum(1 for r in exact if r.get("in_uae")),
    }
