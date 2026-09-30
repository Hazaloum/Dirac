"""
db.py — Supabase persistence for outreach runs.
Database: Supabase project (public schema).
Tables:
  outreach_runs      — one row per country run
  outreach_companies — one row per company (full card data stored as JSON)
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime

from supabase_client import get_client


# ─── Write ────────────────────────────────────────────────────────────────────

def save_outreach_run(country: str, model: str, companies: list[dict]) -> str:
    """
    Persist a completed outreach run.
    `companies` is the list of company result dicts from run_outreach_stream.
    Returns the run_id.
    """
    run_id         = str(uuid.uuid4())[:8]
    run_date       = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    contacts_found = sum(len(c.get("contacts", [])) for c in companies)

    client = get_client()
    client.table("outreach_runs").insert({
        "run_id": run_id,
        "country": country,
        "model": model,
        "run_date": run_date,
        "companies_found": len(companies),
        "contacts_found": contacts_found,
    }).execute()

    if companies:
        rows = [
            {
                "run_id": run_id,
                "company": c.get("company", ""),
                "website": c.get("website", ""),
                "overview": c.get("overview", ""),
                "uae_mohap": c.get("uae_presence", {}).get("mohap") or "",
                "uae_upp": c.get("uae_presence", {}).get("upp") or "",
                "mohap_agents": json.dumps(c.get("uae_presence", {}).get("mohap_agents", [])),
                "upp_agents": json.dumps(c.get("uae_presence", {}).get("upp_agents", [])),
                "contacts": json.dumps(c.get("contacts", [])),
            }
            for c in companies
        ]
        client.table("outreach_companies").insert(rows).execute()

    return run_id


# ─── Read ─────────────────────────────────────────────────────────────────────

def list_outreach_runs() -> list[dict]:
    """Return all runs newest-first (summary only)."""
    client = get_client()
    rows = (
        client.table("outreach_runs").select("*")
        .order("run_date", desc=True).execute().data
    )
    return list(rows)


def get_outreach_run(run_id: str) -> dict | None:
    """Return full run with all company cards."""
    client = get_client()
    runs = client.table("outreach_runs").select("*").eq("run_id", run_id).execute().data
    if not runs:
        return None
    run = runs[0]

    companies = (
        client.table("outreach_companies").select("*")
        .eq("run_id", run_id).order("id").execute().data
    )

    def _row_to_company(r) -> dict:
        return {
            "company": r["company"],
            "website": r["website"] or "",
            "overview": r["overview"] or "",
            "uae_presence": {
                "mohap":        r["uae_mohap"] or None,
                "upp":          r["uae_upp"] or None,
                "mohap_agents": json.loads(r["mohap_agents"] or "[]"),
                "upp_agents":   json.loads(r["upp_agents"]   or "[]"),
            },
            "contacts": json.loads(r["contacts"] or "[]"),
        }

    return {
        **run,
        "companies": [_row_to_company(r) for r in companies],
    }


def delete_outreach_run(run_id: str) -> bool:
    client = get_client()
    # outreach_companies has an FK to outreach_runs with ON DELETE CASCADE, but
    # delete explicitly first to mirror the previous behaviour exactly.
    client.table("outreach_companies").delete().eq("run_id", run_id).execute()
    res = client.table("outreach_runs").delete().eq("run_id", run_id).execute()
    return len(res.data) > 0
