"""
store.py — SQLite persistence for analysis runs + My Portfolio.
Migrated from JSON files to SQLite (same contacts.db) so data survives
Railway container restarts without needing separate persistent volumes.
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


# ─── Analysis runs ────────────────────────────────────────────────────────────

def save_analysis(
    source_name: str,
    source_type: str,
    result: dict,
    report: str = "",
    model: str = "",
) -> str:
    """Persist an analysis run. Returns the new run_id."""
    run_id = str(uuid.uuid4())[:8]
    with _conn() as con:
        con.execute(
            """INSERT INTO analysis_runs
               (run_id, source_name, source_type, model, saved_at, stats, result, report, has_report)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                run_id, source_name, source_type, model,
                datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
                json.dumps(result.get("stats", {})),
                json.dumps(result),
                report,
                int(bool(report)),
            ),
        )
        # Keep at most 100 runs — prune oldest beyond the limit
        con.execute("""
            DELETE FROM analysis_runs WHERE run_id NOT IN (
                SELECT run_id FROM analysis_runs ORDER BY saved_at DESC LIMIT 100
            )
        """)
    return run_id


def list_analyses() -> list[dict]:
    """Return summary rows (no heavy result/report payload)."""
    with _conn() as con:
        rows = con.execute(
            """SELECT run_id, source_name, source_type, model, saved_at, stats, has_report
               FROM analysis_runs ORDER BY saved_at DESC"""
        ).fetchall()
    return [
        {
            "run_id":      r["run_id"],
            "source_name": r["source_name"],
            "source_type": r["source_type"] or "upload",
            "model":       r["model"] or "",
            "saved_at":    r["saved_at"],
            "stats":       json.loads(r["stats"] or "{}"),
            "has_report":  bool(r["has_report"]),
        }
        for r in rows
    ]


def get_analysis(run_id: str) -> dict | None:
    """Return full entry including result + report."""
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM analysis_runs WHERE run_id=?", (run_id,)
        ).fetchone()
    if not row:
        return None
    return {
        "run_id":      row["run_id"],
        "source_name": row["source_name"],
        "source_type": row["source_type"] or "upload",
        "model":       row["model"] or "",
        "saved_at":    row["saved_at"],
        "stats":       json.loads(row["stats"] or "{}"),
        "result":      json.loads(row["result"] or "{}"),
        "report":      row["report"] or "",
        "has_report":  bool(row["has_report"]),
    }


def delete_analysis(run_id: str) -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM analysis_runs WHERE run_id=?", (run_id,))
    return cur.rowcount > 0


# ─── My Portfolio ─────────────────────────────────────────────────────────────

def get_my_portfolio() -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT * FROM my_portfolio WHERE id=1").fetchone()
    if not row:
        return None
    return {
        "company_name": row["company_name"],
        "result":       json.loads(row["result"] or "{}"),
        "report":       row["report"] or "",
        "saved_at":     row["saved_at"],
    }


def save_my_portfolio(company_name: str, result: dict) -> None:
    with _conn() as con:
        con.execute(
            """INSERT INTO my_portfolio (id, company_name, result, report, saved_at)
               VALUES (1, ?, ?, '', ?)
               ON CONFLICT(id) DO UPDATE SET
                   company_name = excluded.company_name,
                   result       = excluded.result,
                   report       = '',
                   saved_at     = excluded.saved_at""",
            (company_name, json.dumps(result), datetime.utcnow().strftime("%Y-%m-%d %H:%M")),
        )


def save_my_portfolio_report(report: str) -> bool:
    with _conn() as con:
        cur = con.execute(
            "UPDATE my_portfolio SET report=? WHERE id=1", (report,)
        )
    return cur.rowcount > 0


def delete_my_portfolio() -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM my_portfolio WHERE id=1")
    return cur.rowcount > 0
