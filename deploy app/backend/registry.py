"""
registry.py — read-only lookups on the master registry (Supabase `registrations` / `companies`).

- search_companies(q): company groups for the company picker (most registrations first), each with its member
  companies. A company with no group is its own one-member group.
- check_catalogue(result, company_id, whole_group): read-only check of an uploaded catalogue against the company's
  registry portfolio (whole group, or just that company), SQL registry_check_upload. Tags each card
  `registry_status`: in_registry / already_uploaded / new / unmatched (no registry molecule found).
- add_uploaded(company_id, items, source): the review screen's "Add to registries" — writes the confirmed products
  to the 'uploaded' registry under the company (SQL registry_add_uploaded, with form, strengths, approved/submitted).
- molecule_companies(name): every company holding a registration for a molecule or combination
  (IQVIA-style name, e.g. "AMLODIPINE + VALSARTAN"), via SQL registry_molecule_holders: match "exact" = the same
  molecule / combination; "combination" = a combination that contains it (amlodipine -> amlodipine + valsartan).
  Rolled up to company groups: one row per group, with its member companies.
"""
from __future__ import annotations

from supabase_client import get_client


def search_companies(q: str, limit: int = 15) -> list[dict]:
    q = (q or "").strip()
    if len(q) < 2:
        return []
    return get_client().rpc("registry_search_company_groups_v4", {"p_q": q, "p_limit": limit}).execute().data or []


def check_catalogue(result: dict, company_id: int, whole_group: bool) -> dict:
    cards = result.get("molecules", [])
    names = [c.get("registry_name") or c["molecule"] for c in cards]
    rows = get_client().rpc("registry_check_upload", {"p_company_id": company_id, "p_whole_group": whole_group,
                                                     "p_names": names}).execute().data or []
    found = {r["name"].lower(): r for r in rows}
    counts = {"in_registry": 0, "already_uploaded": 0, "new": 0, "unmatched": 0}
    for card, name in zip(cards, names):
        r = found.get(name.strip().lower())
        if not r:
            continue
        status = "unmatched" if r["status"] == "new" and not r["combo_key"] else r["status"]
        card["registry_name"] = name
        card["registry_status"] = status
        counts[status] += 1
    result["registry_check"] = {"company_id": company_id, "whole_group": whole_group, **counts}
    return result


def add_uploaded(company_id: int, items: list[dict], source: str) -> dict:
    rows = get_client().rpc("registry_add_uploaded", {"p_company_id": company_id, "p_items": items,
                                                     "p_source": source}).execute().data or []
    if any(r["status"] == "added" for r in rows):
        import threading
        threading.Thread(target=lambda: get_client().rpc("registry_refresh_molecule_index", {}).execute(), daemon=True).start()
    return {"rows": rows, "added": sum(r["status"] == "added" for r in rows),
            "updated": sum(r["status"] == "updated" for r in rows)}


def _by_group(rows: list[dict]) -> list[dict]:
    """One row per company group (summed products, union of countries), its companies listed under `members`."""
    out: dict[str, dict] = {}
    for r in rows:
        key = r.get("group_key") or f"c{r['company_id']}"
        g = out.setdefault(key, {"company_id": r["company_id"], "group_key": key, "name": r.get("group_name") or r["name"],
                                 "match": r["match"], "combos": set(), "countries": set(), "products": 0,
                                 "in_uae": False, "product_names": [], "members": []})
        g["combos"].update(r.get("combos") or [])
        g["countries"].update(r.get("countries") or [])
        g["products"] += r["products"]
        g["in_uae"] = g["in_uae"] or bool(r.get("in_uae"))
        g["product_names"] += [p for p in (r.get("product_names") or []) if p not in g["product_names"]]
        g["members"].append({"company_id": r["company_id"], "name": r["name"], "countries": r.get("countries") or [],
                             "products": r["products"], "in_uae": bool(r.get("in_uae"))})
    for g in out.values():
        g["combos"] = sorted(g["combos"]) or None
        g["countries"] = sorted(g["countries"])
        g["product_names"] = g["product_names"][:6]
        g["members"].sort(key=lambda m: -m["products"])
    return sorted(out.values(), key=lambda g: (-len(g["countries"]), -g["products"]))


def molecule_companies(name: str) -> dict:
    rows = get_client().rpc("registry_molecule_holders_g", {"p_name": name}).execute().data or []
    exact = _by_group([r for r in rows if r["match"] == "exact"])
    combos = _by_group([r for r in rows if r["match"] == "combination"])
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


def search_molecules(q: str, limit: int = 15) -> list[dict]:
    """Molecules and combinations in the registries (combo keys, e.g. amlodipine+valsartan), single molecules first."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    return get_client().rpc("registry_search_molecules", {"p_q": q, "p_limit": limit}).execute().data or []


def company_portfolio(company_id: int, dfs: dict | None, whole_group: bool = True) -> dict:
    from events import company_portfolio as portfolio
    return portfolio(company_id, dfs, whole_group)

