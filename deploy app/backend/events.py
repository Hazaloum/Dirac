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


# WHO ATC level 1 (anatomical main groups).
ATC1_NAMES = {
    "A": "Alimentary tract and metabolism", "B": "Blood and blood forming organs", "C": "Cardiovascular system",
    "D": "Dermatologicals", "G": "Genito-urinary system and sex hormones",
    "H": "Systemic hormonal preparations", "J": "Antiinfectives for systemic use",
    "L": "Antineoplastic and immunomodulating agents", "M": "Musculo-skeletal system", "N": "Nervous system",
    "P": "Antiparasitic products", "R": "Respiratory system", "S": "Sensory organs", "V": "Various",
}

_iqvia_values: dict | None = None


def iqvia_market_values(dfs: dict) -> tuple[dict[str, float], int | None]:
    """UAE market value (AED, latest full year) per IQVIA 'Molecule Combination', computed once per process.

    Same rule as get_iqvia_data: end year = years[-2], combination totals divided by their molecule count.
    """
    global _iqvia_values
    if _iqvia_values is None:
        from data_processing.iqvia import _get_years
        df = dfs["iqvia"]
        _, end_year = _get_years(df, "Units")
        sums = df.groupby(df["Molecule Combination"].str.upper())[f"{end_year} LC Value"].sum()
        values = {name: round(float(v) / (len(name.split(" + ")) if " + " in name else 1), 0) for name, v in sums.items()}
        _iqvia_values = {"values": values, "year": end_year}
    return _iqvia_values["values"], _iqvia_values["year"]


def iqvia_name(molecule_key: str) -> str:
    """Registry combo key ("amlodipine+valsartan") -> IQVIA naming ("AMLODIPINE + VALSARTAN")."""
    return " + ".join(sorted(m.strip().upper() for m in molecule_key.split("+")))


def summarise_portfolio(regs: list[dict]) -> list[dict]:
    """Registrations -> one row per molecule/combination with countries, product count, UAE presence and ATC1."""
    by: dict[str, dict] = {}
    for r in regs:
        key = r["combo_key"] or (r["molecule_raw"] or "").lower()
        if not key:
            continue
        m = by.setdefault(key, {"molecule": key, "matched": bool(r["combo_key"]), "countries": set(), "products": 0, "atc1s": {}})
        m["countries"].add(r["country"])
        m["products"] += 1
        letter = (r.get("atc") or "")[:1].upper()
        if letter in ATC1_NAMES:
            m["atc1s"][letter] = m["atc1s"].get(letter, 0) + 1
    molecules = []
    for m in by.values():
        atc1s = m.pop("atc1s")
        molecules.append({**m, "countries": sorted(m["countries"]), "in_uae": "AE" in m["countries"],
                          "combination": "+" in m["molecule"],
                          "atc1": max(atc1s, key=atc1s.get) if atc1s else None})
    molecules.sort(key=lambda m: (-len(m["countries"]), m["molecule"]))
    return molecules


def group_by_atc1(molecules: list[dict]) -> list[dict]:
    """ATC1 sections A..V (unclassified last); molecules by IQVIA market value, then number of countries."""
    groups: dict[str, list[dict]] = {}
    for m in molecules:
        groups.setdefault(m["atc1"] or "?", []).append(m)
    out = []
    for letter in sorted(groups, key=lambda g: (g == "?", g)):
        mols = sorted(groups[letter], key=lambda m: (-(m.get("market_value_aed") or 0), -len(m["countries"]), m["molecule"]))
        out.append({"atc1": None if letter == "?" else letter, "name": ATC1_NAMES.get(letter, "Unclassified"),
                    "molecules": mols, "market_value_aed": sum(m.get("market_value_aed") or 0 for m in mols)})
    return out


def exhibitor_portfolio(exhibitor_id: int, dfs: dict | None = None) -> dict | None:
    """What a matched exhibitor holds in the master registry, grouped by ATC1, with UAE IQVIA market values.

    Unmatched exhibitors return matched=False.
    """
    client = get_client()
    rows = client.table("event_exhibitors").select("id,name,company_id").eq("id", exhibitor_id).execute().data
    if not rows:
        return None
    company_id = rows[0]["company_id"]
    if not company_id:
        return {"matched": False, "company": None, "groups": [], "iqvia_year": None}
    # The whole company group's portfolio (all its subsidiaries), named after the group.
    company = client.table("company_group_of").select("company_id,group_name,group_id").eq("company_id", company_id).execute().data
    company = company[0] if company else {"company_id": company_id, "group_name": None, "group_id": None}
    if company["group_id"]:
        members = client.table("companies").select("id,name").eq("group_id", company["group_id"]).is_("merged_into", "null").execute().data
    else:
        members = client.table("companies").select("id,name").eq("id", company_id).execute().data
    ids = [m["id"] for m in members]
    company = {"id": company_id, "name": company["group_name"] or (members[0]["name"] if members else ""),
               "entities": sorted(m["name"] for m in members)}
    regs, start = [], 0
    while True:
        page = (client.table("registrations").select("country,combo_key,molecule_raw,status,atc")
                .in_("company_id", ids).neq("status", "withdrawn").order("id")
                .range(start, start + PAGE_SIZE - 1).execute().data)
        regs.extend(page)
        if len(page) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    molecules = summarise_portfolio(regs)

    # ATC1 from WHO by name where no registry gave an ATC code (first ingredient of a combination).
    missing = sorted({m["molecule"].split("+")[0] for m in molecules if not m["atc1"] and m["matched"]})
    who: dict[str, str] = {}
    for i in range(0, len(missing), 200):
        for w in client.table("who_atc_molecules").select("name,code").in_("name", missing[i:i + 200]).execute().data:
            who.setdefault(w["name"].lower(), w["code"][:1].upper())
    for m in molecules:
        if not m["atc1"]:
            m["atc1"] = who.get(m["molecule"].split("+")[0])

    values, year = iqvia_market_values(dfs) if dfs else ({}, None)
    for m in molecules:
        m["market_value_aed"] = values.get(iqvia_name(m["molecule"])) if m["matched"] else None

    countries = sorted({r["country"] for r in regs})
    return {"matched": True, "company": {**company, "countries": countries, "products": len(regs), "molecules": len(molecules)},
            "groups": group_by_atc1(molecules), "iqvia_year": year}
