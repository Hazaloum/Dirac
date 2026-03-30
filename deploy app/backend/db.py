"""
db.py — SQLite persistence for outreach runs.
Database: backend/data/contacts.db
Tables:
  outreach_runs      — one row per country run
  outreach_companies — one row per company (full card data stored as JSON)
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "contacts.db"


@contextmanager
def _conn():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db() -> None:
    """Create tables if they don't exist. Called once at startup."""
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS outreach_runs (
                run_id          TEXT PRIMARY KEY,
                country         TEXT NOT NULL,
                model           TEXT,
                run_date        TEXT NOT NULL,
                companies_found INTEGER DEFAULT 0,
                contacts_found  INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS outreach_companies (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id          TEXT NOT NULL REFERENCES outreach_runs(run_id),
                company         TEXT NOT NULL,
                website         TEXT,
                overview        TEXT,
                uae_mohap       TEXT,
                uae_upp         TEXT,
                mohap_agents    TEXT,   -- JSON array
                upp_agents      TEXT,   -- JSON array
                contacts        TEXT    -- JSON array of {name, title, email, linkedin_url}
            );
        """)


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
            "INSERT INTO outreach_runs VALUES (?,?,?,?,?,?)",
            (run_id, country, model, run_date, len(companies), contacts_found),
        )
        for c in companies:
            con.execute(
                """INSERT INTO outreach_companies
                   (run_id, company, website, overview,
                    uae_mohap, uae_upp, mohap_agents, upp_agents, contacts)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
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
            "SELECT * FROM outreach_runs WHERE run_id=?", (run_id,)
        ).fetchone()
        if not run:
            return None

        companies = con.execute(
            "SELECT * FROM outreach_companies WHERE run_id=? ORDER BY id",
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
            "DELETE FROM outreach_runs WHERE run_id=?", (run_id,)
        )
        con.execute(
            "DELETE FROM outreach_companies WHERE run_id=?", (run_id,)
        )
    return cur.rowcount > 0
