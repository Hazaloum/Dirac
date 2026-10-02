"""
field_force.py — Dirac's side of the medical rep CRM.

Reps use the separate mobile rep app (`rep app/`); this module lets COMIX set
the field force up (reps, areas, accounts) and see what is happening
(coverage, samples, shelf stock-outs, orders). The CRM tables are locked to
signed-in reps, so everything here uses the service-role client.
"""
from __future__ import annotations

import io
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from supabase_client import fetch_all, get_service_client

ACCOUNT_TYPES = {"doctor", "pharmacy", "hospital"}
NOT_REACHED = {"not_available", "cancelled"}
DEFAULT_CADENCE = {"doctor": 28, "hospital": 28, "pharmacy": 14}


def _db():
    return get_service_client()


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# ─── Setup: reps ──────────────────────────────────────────────────────────────

def list_setup() -> dict:
    db = _db()
    reps = fetch_all("reps", order="name", client=db)
    rep_areas = fetch_all("rep_areas", order="rep_id", client=db)
    areas = fetch_all("areas", order="name", client=db)
    by_rep: dict[str, list[int]] = defaultdict(list)
    for row in rep_areas:
        by_rep[row["rep_id"]].append(row["area_id"])
    return {
        "reps": [{**r, "area_ids": by_rep.get(r["id"], [])} for r in reps],
        "areas": areas,
    }


def create_rep(name: str, email: str, password: str, role: str, area_ids: list[int]) -> dict:
    """Create the rep's login (email confirmed, password set by COMIX) and profile."""
    db = _db()
    user = db.auth.admin.create_user({
        "email": email.strip().lower(),
        "password": password,
        "email_confirm": True,
        "user_metadata": {"name": name},
    }).user
    rep = {"id": user.id, "name": name.strip(), "email": user.email, "role": role, "active": True}
    db.table("reps").insert(rep).execute()
    _set_rep_areas(user.id, area_ids)
    return {**rep, "area_ids": area_ids}


def update_rep(rep_id: str, name: str | None, role: str | None, active: bool | None,
               area_ids: list[int] | None, password: str | None) -> None:
    db = _db()
    changes = {k: v for k, v in {"name": name, "role": role, "active": active}.items() if v is not None}
    if changes:
        db.table("reps").update(changes).eq("id", rep_id).execute()
    if area_ids is not None:
        _set_rep_areas(rep_id, area_ids)
    if password:
        db.auth.admin.update_user_by_id(rep_id, {"password": password})
    if active is False:
        # Inactive reps lose their login too, not just their territory.
        db.auth.admin.update_user_by_id(rep_id, {"ban_duration": "876000h"})
    elif active is True:
        db.auth.admin.update_user_by_id(rep_id, {"ban_duration": "none"})


def _set_rep_areas(rep_id: str, area_ids: list[int]) -> None:
    db = _db()
    db.table("rep_areas").delete().eq("rep_id", rep_id).execute()
    if area_ids:
        db.table("rep_areas").insert([{"rep_id": rep_id, "area_id": a} for a in dict.fromkeys(area_ids)]).execute()


# ─── Setup: areas ─────────────────────────────────────────────────────────────

def create_area(name: str, emirate: str | None) -> dict:
    return _db().table("areas").insert({"name": name.strip(), "emirate": (emirate or "").strip() or None}).execute().data[0]


def delete_area(area_id: int) -> None:
    _db().table("areas").delete().eq("id", area_id).execute()


def _area_id(name: str, cache: dict[str, int]) -> int | None:
    """Area by name (case-insensitive), created on first use."""
    key = name.strip().lower()
    if not key:
        return None
    if key not in cache:
        cache[key] = create_area(name, None)["id"]
    return cache[key]


# ─── Setup: accounts ──────────────────────────────────────────────────────────

def list_accounts() -> list[dict]:
    db = _db()
    accounts = fetch_all("account_status", order="name", client=db)
    reps = {r["id"]: r["name"] for r in fetch_all("reps", order="name", client=db)}
    for a in accounts:
        a["assigned_rep_name"] = reps.get(a["assigned_rep_id"])
        a["created_by_name"] = reps.get(a["created_by"])
    return accounts


def update_account(account_id: int, changes: dict) -> None:
    allowed = {"type", "name", "specialty", "area_id", "assigned_rep_id", "phone", "address", "visit_every_days", "parent_id"}
    payload = {k: v for k, v in changes.items() if k in allowed}
    if payload:
        _db().table("accounts").update(payload).eq("id", account_id).execute()


def import_accounts(content: bytes, filename: str) -> dict:
    """Import accounts from CSV/Excel.

    Columns (case-insensitive; only type and name required): type, name,
    specialty, area, phone, address, rep (email of the assigned rep),
    hospital (name of the doctor's hospital). Unknown areas are created.
    Rows already present (same type + name + area) are skipped.
    """
    buf = io.BytesIO(content)
    df = pd.read_csv(buf) if filename.lower().endswith(".csv") else pd.read_excel(buf)
    df.columns = [str(c).strip().lower() for c in df.columns]
    if not {"type", "name"} <= set(df.columns):
        raise ValueError("The file needs at least 'type' and 'name' columns")
    df = df.astype(object).where(pd.notna(df), None)

    db = _db()
    areas = {a["name"].strip().lower(): a["id"] for a in fetch_all("areas", client=db)}
    reps = {r["email"].lower(): r["id"] for r in fetch_all("reps", order="name", client=db)}
    existing = {(a["type"], a["name"].strip().lower(), a["area_id"]): a["id"]
                for a in fetch_all("accounts", client=db)}

    def text(row, col) -> str:
        value = row.get(col)
        return str(value).strip() if value is not None else ""

    created, skipped, errors = 0, 0, []
    pending_parents: list[tuple[int, str]] = []
    for i, row in enumerate(df.to_dict("records"), start=2):
        kind, name = text(row, "type").lower(), text(row, "name")
        if kind not in ACCOUNT_TYPES or not name:
            errors.append(f"Row {i}: type must be doctor, pharmacy or hospital, and name is required")
            continue
        area_id = _area_id(text(row, "area"), areas)
        key = (kind, name.lower(), area_id)
        if key in existing:
            skipped += 1
            continue
        rep_email = text(row, "rep").lower()
        if rep_email and rep_email not in reps:
            errors.append(f"Row {i}: no rep with email {rep_email} — imported unassigned")
        inserted = db.table("accounts").insert({
            "type": kind,
            "name": name,
            "specialty": text(row, "specialty") or None,
            "area_id": area_id,
            "assigned_rep_id": reps.get(rep_email),
            "phone": text(row, "phone") or None,
            "address": text(row, "address") or None,
            "created_by": None,
        }).execute().data[0]
        existing[key] = inserted["id"]
        created += 1
        if text(row, "hospital"):
            pending_parents.append((inserted["id"], text(row, "hospital").lower()))

    hospitals = {name: id_ for (kind, name, _), id_ in existing.items() if kind == "hospital"}
    for account_id, hospital in pending_parents:
        if hospital in hospitals:
            db.table("accounts").update({"parent_id": hospitals[hospital]}).eq("id", account_id).execute()
    return {"created": created, "skipped": skipped, "errors": errors}


# ─── Dashboard ────────────────────────────────────────────────────────────────

def dashboard(days: int = 30) -> dict:
    db = _db()
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    week_start = now - timedelta(days=7)

    reps = [r for r in fetch_all("reps", order="name", client=db) if r["active"]]
    rep_areas = fetch_all("rep_areas", order="rep_id", client=db)
    accounts = fetch_all("account_status", client=db)
    all_visits = {v["id"]: v for v in fetch_all("visits", client=db)}
    visits = [v for v in all_visits.values() if _parse_ts(v["visited_at"]) >= since]
    visit_ids = {v["id"] for v in visits}
    samples = [s for s in fetch_all("sample_drops", client=db) if s["visit_id"] in visit_ids]
    shelf = fetch_all("shelf_checks", client=db)
    orders = [o for o in fetch_all("orders", client=db)
              if _parse_ts(o["created_at"]) >= since and o["status"] != "cancelled"]
    order_ids = {o["id"] for o in orders}
    lines = [l for l in fetch_all("order_lines", client=db) if l["order_id"] in order_ids]
    feedback = [f for f in fetch_all("visit_feedback", client=db) if f["visit_id"] in visit_ids]

    areas_by_rep: dict[str, set[int]] = defaultdict(set)
    for row in rep_areas:
        areas_by_rep[row["rep_id"]].add(row["area_id"])

    def territory(rep_id: str) -> list[dict]:
        return [a for a in accounts
                if a["assigned_rep_id"] == rep_id
                or (a["assigned_rep_id"] is None and a["area_id"] in areas_by_rep[rep_id])]

    today = date.today()

    def on_track(account: dict) -> bool:
        return bool(account["last_visited_at"]) and date.fromisoformat(account["due_on"]) >= today

    visits_by_rep = Counter(v["rep_id"] for v in visits)
    reached_by_rep = Counter(v["rep_id"] for v in visits if v.get("outcome") not in NOT_REACHED)
    week_by_rep = Counter(v["rep_id"] for v in visits if _parse_ts(v["visited_at"]) >= week_start)
    rep_of_visit = {v["id"]: v["rep_id"] for v in visits}
    samples_by_rep = Counter()
    for s in samples:
        samples_by_rep[rep_of_visit[s["visit_id"]]] += s["quantity"]
    orders_by_rep = Counter(o["rep_id"] for o in orders)

    rep_rows = []
    for rep in reps:
        own = territory(rep["id"])
        covered = sum(on_track(a) for a in own)
        rep_rows.append({
            "rep_id": rep["id"],
            "name": rep["name"],
            "accounts": len(own),
            "on_track": covered,
            "coverage_pct": round(covered / len(own) * 100) if own else None,
            "visits_7d": week_by_rep[rep["id"]],
            "visits": visits_by_rep[rep["id"]],
            "reached": reached_by_rep[rep["id"]],
            "samples": samples_by_rep[rep["id"]],
            "orders": orders_by_rep[rep["id"]],
        })

    # Latest shelf status per pharmacy × SKU; flag what is currently low/out.
    account_names = {a["id"]: a["name"] for a in accounts}
    latest: dict[tuple[int, str], dict] = {}
    for check in shelf:
        visit = all_visits.get(check["visit_id"])
        if not visit:
            continue
        key = (visit["account_id"], check["pack_key"])
        if key not in latest or visit["visited_at"] > latest[key]["checked_at"]:
            latest[key] = {"account": account_names.get(visit["account_id"], "?"), "sku": check["sku_label"],
                           "status": check["status"], "checked_at": visit["visited_at"]}
    alerts = sorted((r for r in latest.values() if r["status"] != "in"),
                    key=lambda r: (r["status"] != "out", r["checked_at"]), reverse=False)

    def by_sku(rows: list[dict]) -> list[dict]:
        totals = Counter()
        for r in rows:
            totals[r["sku_label"]] += r["quantity"]
        return [{"sku": sku, "quantity": qty} for sku, qty in totals.most_common()]

    # Doctor feedback: each doctor's latest stance per molecule in the window.
    latest_stance: dict[tuple[int, str], dict] = {}
    for f in feedback:
        visit = all_visits[f["visit_id"]]
        key = (visit["account_id"], f["molecule"])
        if key not in latest_stance or visit["visited_at"] > latest_stance[key]["at"]:
            latest_stance[key] = {**f, "at": visit["visited_at"]}
    by_molecule: dict[str, dict] = {}
    for f in latest_stance.values():
        row = by_molecule.setdefault(f["molecule"], {"molecule": f["molecule"], "prescribing": 0, "will_try": 0,
                                                      "not_interested": 0, "reasons": Counter()})
        row[f["stance"]] += 1
        if f["stance"] == "not_interested" and f.get("reason"):
            row["reasons"][f["reason"]] += 1
    feedback_rows = sorted(
        ({**r, "reasons": [{"reason": k, "count": n} for k, n in r["reasons"].most_common()]} for r in by_molecule.values()),
        key=lambda r: -(r["prescribing"] + r["will_try"] + r["not_interested"]),
    )

    overdue = sorted(
        (a for a in accounts if not on_track(a)),
        key=lambda a: (a["last_visited_at"] is not None, a["due_on"]),
    )
    return {
        "days": days,
        "totals": {
            "reps": len(reps),
            "accounts": len(accounts),
            "on_track": sum(on_track(a) for a in accounts),
            "visits": len(visits),
            "reached": sum(v.get("outcome") not in NOT_REACHED for v in visits),
            "samples": sum(s["quantity"] for s in samples),
            "orders": len(orders),
            "stock_alerts": len(alerts),
        },
        "reps": rep_rows,
        "stock_alerts": alerts,
        "feedback": feedback_rows,
        "samples_by_sku": by_sku(samples),
        "orders_by_sku": by_sku(lines),
        "overdue": [{"name": a["name"], "type": a["type"], "area": a["area_name"],
                     "last_visited_at": a["last_visited_at"]} for a in overdue[:50]],
    }
