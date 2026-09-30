"""
store.py — Supabase persistence for analysis runs + My Portfolio.
Migrated from SQLite (contacts.db) to Supabase so data survives
Railway container restarts without needing separate persistent volumes.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime

from supabase_client import get_client


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
    client = get_client()
    client.table("analysis_runs").insert({
        "run_id": run_id,
        "source_name": source_name,
        "source_type": source_type,
        "model": model,
        "saved_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
        "stats": json.dumps(result.get("stats", {})),
        "result": json.dumps(result),
        "report": report,
        "has_report": int(bool(report)),
    }).execute()

    # Keep at most 100 runs — prune oldest beyond the limit
    rows = (
        client.table("analysis_runs").select("run_id")
        .order("saved_at", desc=True).execute().data
    )
    stale_ids = [r["run_id"] for r in rows[100:]]
    if stale_ids:
        client.table("analysis_runs").delete().in_("run_id", stale_ids).execute()

    return run_id


def list_analyses() -> list[dict]:
    """Return summary rows (no heavy result/report payload)."""
    client = get_client()
    rows = (
        client.table("analysis_runs")
        .select("run_id,source_name,source_type,model,saved_at,stats,has_report")
        .order("saved_at", desc=True).execute().data
    )
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
    client = get_client()
    rows = (
        client.table("analysis_runs").select("*").eq("run_id", run_id).execute().data
    )
    if not rows:
        return None
    row = rows[0]
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
    client = get_client()
    res = client.table("analysis_runs").delete().eq("run_id", run_id).execute()
    return len(res.data) > 0


# ─── My Portfolio ─────────────────────────────────────────────────────────────

def get_my_portfolio() -> dict | None:
    client = get_client()
    rows = client.table("my_portfolio").select("*").eq("id", 1).execute().data
    if not rows:
        return None
    row = rows[0]
    return {
        "company_name": row["company_name"],
        "result":       json.loads(row["result"] or "{}"),
        "report":       row["report"] or "",
        "saved_at":     row["saved_at"],
    }


def save_my_portfolio(company_name: str, result: dict) -> None:
    client = get_client()
    client.table("my_portfolio").upsert(
        {
            "id": 1,
            "company_name": company_name,
            "result": json.dumps(result),
            "report": "",
            "saved_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
        },
        on_conflict="id",
    ).execute()


def save_my_portfolio_report(report: str) -> bool:
    client = get_client()
    res = client.table("my_portfolio").update({"report": report}).eq("id", 1).execute()
    return len(res.data) > 0


def delete_my_portfolio() -> bool:
    client = get_client()
    res = client.table("my_portfolio").delete().eq("id", 1).execute()
    return len(res.data) > 0


# ─── Evaluation pipeline ─────────────────────────────────────────────────────

def list_pipeline_decisions() -> list[dict]:
    """Return all cross-catalogue molecule decisions, most recently updated first."""
    client = get_client()
    rows = (
        client.table("pipeline_decisions").select("*")
        .order("updated_at", desc=True).order("molecule").execute().data
    )
    return [
        {
            "molecule": r["molecule"],
            "decision": r["decision"],
            "source_name": r["source_name"] or "",
            "snapshot": json.loads(r["snapshot"] or "{}"),
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]


def save_pipeline_decision(
    molecule: str,
    decision: str,
    source_name: str,
    snapshot: dict,
) -> dict:
    """Upsert a molecule's Yes/Maybe/No evaluation decision."""
    updated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    molecule_upper = molecule.upper()
    client = get_client()
    client.table("pipeline_decisions").upsert(
        {
            "molecule": molecule_upper,
            "decision": decision,
            "source_name": source_name,
            "snapshot": json.dumps(snapshot),
            "updated_at": updated_at,
        },
        on_conflict="molecule",
    ).execute()
    return {
        "molecule": molecule_upper,
        "decision": decision,
        "source_name": source_name,
        "snapshot": snapshot,
        "updated_at": updated_at,
    }


def delete_pipeline_decision(molecule: str) -> bool:
    client = get_client()
    res = (
        client.table("pipeline_decisions").delete()
        .eq("molecule", molecule.upper()).execute()
    )
    return len(res.data) > 0
