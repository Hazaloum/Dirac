"""
db.py — PostgreSQL persistence for outreach runs.
Connection: DATABASE_URL
Tables:
  outreach_runs      — one row per country run
  outreach_companies — one row per company (full card data stored as JSON)
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime

from database import connection as _conn
from database import init_db


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

    with _conn() as con:
        con.execute(
            "INSERT INTO outreach_runs VALUES (%s,%s,%s,%s,%s,%s)",
            (run_id, country, model, run_date, len(companies), contacts_found),
        )
        for c in companies:
            con.execute(
                """INSERT INTO outreach_companies
                   (run_id, company, website, overview,
                    uae_mohap, uae_upp, mohap_agents, upp_agents, contacts)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    run_id,
                    c.get("company", ""),
                    c.get("website", ""),
                    c.get("overview", ""),
                    c.get("uae_presence", {}).get("mohap") or "",
                    c.get("uae_presence", {}).get("upp") or "",
                    json.dumps(c.get("uae_presence", {}).get("mohap_agents", [])),
                    json.dumps(c.get("uae_presence", {}).get("upp_agents", [])),
                    json.dumps(c.get("contacts", [])),
                ),
            )
    return run_id


# ─── Read ─────────────────────────────────────────────────────────────────────

def list_outreach_runs() -> list[dict]:
    """Return all runs newest-first (summary only)."""
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM outreach_runs ORDER BY run_date DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_outreach_run(run_id: str) -> dict | None:
    """Return full run with all company cards."""
    with _conn() as con:
        run = con.execute(
            "SELECT * FROM outreach_runs WHERE run_id=%s", (run_id,)
        ).fetchone()
        if not run:
            return None

        companies = con.execute(
            "SELECT * FROM outreach_companies WHERE run_id=%s ORDER BY id",
            (run_id,),
        ).fetchall()

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
        **dict(run),
        "companies": [_row_to_company(r) for r in companies],
    }


def delete_outreach_run(run_id: str) -> bool:
    with _conn() as con:
        cur = con.execute(
            "DELETE FROM outreach_runs WHERE run_id=%s", (run_id,)
        )
    return cur.rowcount > 0
