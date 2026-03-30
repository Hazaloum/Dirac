"""
store.py — Lightweight JSON persistence for analysis + outreach runs.
Saves to backend/data/analyses.json and backend/data/outreach.json.
No external dependencies.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

STORE_PATH          = Path(__file__).parent / "data" / "analyses.json"
OUTREACH_STORE_PATH = Path(__file__).parent / "data" / "outreach.json"


def _load() -> list[dict]:
    if not STORE_PATH.exists():
        return []
    try:
        return json.loads(STORE_PATH.read_text())
    except Exception:
        return []


def _save(entries: list[dict]) -> None:
    STORE_PATH.write_text(json.dumps(entries, indent=2))


def save_analysis(
    source_name: str,
    source_type: str,          # "upload" | "craft" | "molecule"
    result: dict,              # full AnalysisResult from agent_runner
    report: str = "",
    model: str = "",
) -> str:
    """Persist an analysis. Returns the new run_id."""
    entries = _load()
    run_id  = str(uuid.uuid4())[:8]

    entries.insert(0, {
        "run_id":      run_id,
        "source_name": source_name,
        "source_type": source_type,
        "model":       model,
        "saved_at":    datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
        "stats":       result.get("stats", {}),
        "result":      result,
        "report":      report,
    })

    # Keep last 100 runs
    _save(entries[:100])
    return run_id


def list_analyses() -> list[dict]:
    """Return summary rows (no heavy result/report payload)."""
    return [
        {
            "run_id":      e["run_id"],
            "source_name": e["source_name"],
            "source_type": e.get("source_type", "upload"),
            "model":       e.get("model", ""),
            "saved_at":    e["saved_at"],
            "stats":       e.get("stats", {}),
            "has_report":  bool(e.get("report")),
        }
        for e in _load()
    ]


def get_analysis(run_id: str) -> dict | None:
    """Return full entry including result + report."""
    for e in _load():
        if e["run_id"] == run_id:
            return e
    return None


def delete_analysis(run_id: str) -> bool:
    entries = _load()
    new     = [e for e in entries if e["run_id"] != run_id]
    if len(new) == len(entries):
        return False
    _save(new)
    return True
