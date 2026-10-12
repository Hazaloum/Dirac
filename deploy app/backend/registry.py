"""
registry.py — read-only lookups on the master registry (Supabase `registrations` / `companies`).

- search_companies(q): canonical companies for the company-name picker (most registrations first).
- molecule_companies(name): every company holding a registration for a molecule or combination
  (IQVIA-style name, e.g. "AMLODIPINE + VALSARTAN"); matched on combo_key via SQL registry_molecule_key.
"""
from __future__ import annotations

from supabase_client import get_client


def search_companies(q: str, limit: int = 15) -> list[dict]:
    q = (q or "").strip()
    if len(q) < 2:
        return []
    return get_client().rpc("registry_search_companies", {"p_q": q, "p_limit": limit}).execute().data or []


def molecule_companies(name: str) -> dict:
    rows = get_client().rpc("registry_molecule_companies", {"p_name": name}).execute().data or []
    countries = sorted({c for r in rows for c in (r.get("countries") or [])})
    return {
        "molecule": name,
        "combo_key": rows[0]["combo_key"] if rows else None,
        "companies": rows,
        "countries": countries,
        "in_uae": sum(1 for r in rows if r.get("in_uae")),
    }
