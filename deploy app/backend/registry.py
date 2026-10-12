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


def list_registries() -> list[dict]:
    rows = get_client().table("registries").select("key,country,name,source_url,company_field,snapshot_date,row_count").execute().data or []
    return sorted(rows, key=lambda r: (r["country"] != "AE", r["country"]))


def search_registry(registry: str, q: str = "", status: str = "active", offset: int = 0, limit: int = 50) -> dict:
    status = status if status in ("active", "withdrawn", "all") else "active"
    rows = get_client().rpc("registry_search", {"p_registry": registry, "p_q": q or "", "p_status": status,
                                                "p_offset": max(offset, 0), "p_limit": min(max(limit, 1), 200)}).execute().data or []
    total = rows[0]["total"] if rows else 0
    for r in rows:
        r.pop("total", None)
    return {"total": total, "offset": offset, "rows": rows}
