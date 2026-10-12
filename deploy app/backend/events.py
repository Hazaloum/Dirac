"""Events (CPHI etc.): exhibitor lists pulled from the organiser's directory.

`events` holds one row per event; `event_exhibitors` one row per exhibitor
(name, country, booth, the organiser's zone, org types, markets, certifications,
categories, description, CPHI Online link). The CPHI directory needs a real
browser to fetch, so lists are loaded by a sync job, not on request.
"""
from __future__ import annotations

import json

from supabase_client import PAGE_SIZE, get_client

# The organiser's zones, in the order the page shows them (anything else follows, A–Z).
ZONE_ORDER = [
    "Finished Dosage & Formulation", "Integrated Pharma", "Contract Manufacturing & Services", "API",
    "BioProduction", "Excipients&Fine Chemicals", "Natural Extracts", "Packaging & Drug Delivery",
    "CRO", "Machinery & Equipment", "Contamination Control", "Labelling", "Cold Chain & Logistics",
    "AI & Tech", "Start-Up Market", "Other",
]
LIST_FIELDS = ["org_types", "business_activities", "markets", "certifications", "categories"]


def list_events() -> list[dict]:
    rows = get_client().table("events").select("*").order("starts_on", desc=True).execute().data
    return rows


def _zone_rank(zone: str) -> tuple[int, str]:
    return (ZONE_ORDER.index(zone), zone) if zone in ZONE_ORDER else (len(ZONE_ORDER), zone)


def _exhibitors(key: str) -> list[dict]:
    """Every exhibitor of an event, paging past PostgREST's 1000-row cap."""
    client, rows, start = get_client(), [], 0
    while True:
        page = (client.table("event_exhibitors").select("*").eq("event_key", key).order("id")
                .range(start, start + PAGE_SIZE - 1).execute().data)
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def get_event(key: str) -> dict | None:
    """The event with its exhibitors grouped by zone (zones in ZONE_ORDER, exhibitors A–Z)."""
    rows = get_client().table("events").select("*").eq("key", key).execute().data
    if not rows:
        return None
    exhibitors = _exhibitors(key)
    groups: dict[str, list[dict]] = {}
    for r in exhibitors:
        for f in LIST_FIELDS:
            r[f] = json.loads(r[f] or "[]")
        r.pop("event_key", None)
        groups.setdefault(r["zone"] or "Other", []).append(r)
    zones = [{"zone": z, "exhibitors": sorted(groups[z], key=lambda e: e["name"].lower())}
             for z in sorted(groups, key=_zone_rank)]
    return {**rows[0], "zones": zones}


def summarise_portfolio(regs: list[dict]) -> list[dict]:
    """Registrations -> one row per molecule/combination with countries, product count and UAE presence."""
    by: dict[str, dict] = {}
    for r in regs:
        key = r["combo_key"] or (r["molecule_raw"] or "").lower()
        if not key:
            continue
        m = by.setdefault(key, {"molecule": key, "matched": bool(r["combo_key"]), "countries": set(), "products": 0})
        m["countries"].add(r["country"])
        m["products"] += 1
    molecules = [{**m, "countries": sorted(m["countries"]), "in_uae": "AE" in m["countries"],
                  "combination": "+" in m["molecule"]} for m in by.values()]
    molecules.sort(key=lambda m: (-len(m["countries"]), m["molecule"]))
    return molecules


def exhibitor_portfolio(exhibitor_id: int) -> dict | None:
    """What a matched exhibitor holds in the master registry, one row per molecule (or combination).

    Each row: the molecule(s), countries where it is registered (active or unknown status), product count,
    and whether it is registered in the UAE. Unmatched exhibitors return matched=False.
    """
    client = get_client()
    rows = client.table("event_exhibitors").select("id,name,company_id").eq("id", exhibitor_id).execute().data
    if not rows:
        return None
    company_id = rows[0]["company_id"]
    if not company_id:
        return {"matched": False, "company": None, "molecules": []}
    company = client.table("companies").select("id,name").eq("id", company_id).execute().data[0]
    regs, start = [], 0
    while True:
        page = (client.table("registrations").select("country,combo_key,molecule_raw,status")
                .eq("company_id", company_id).neq("status", "withdrawn").order("id")
                .range(start, start + PAGE_SIZE - 1).execute().data)
        regs.extend(page)
        if len(page) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    molecules = summarise_portfolio(regs)
    countries = sorted({r["country"] for r in regs})
    return {"matched": True, "company": {**company, "countries": countries, "products": len(regs)}, "molecules": molecules}
