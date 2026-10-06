"""Deal Tracker: one deal per in-licensed molecule, moving through ten stages.

Each stage has a trigger (the event that moves the deal on) and the
information that trigger asks for. Fields marked "dirac" are filled from data
Dirac already holds (IQVIA, MOHAP/UPP, Pipeline, forecast, PO Tracker,
inventory); the rest are entered on the deal. Nothing is required: a deal can
move to any stage with fields left empty.

Tables: `deals` (one row per molecule; entered values in `info`, a JSON
string), `deal_events` (stage and status changes), `deal_documents` (optional
files, stored in the `deal-documents` storage bucket).
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from supabase_client import fetch_all, get_client

BUCKET = "deal-documents"
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

# (key, label, type, source). type: text | longtext | date | choice:<a>|<b>… | dirac
STAGES: list[dict] = [
    {"key": "sourced", "name": "Sourced", "phase": "Find", "trigger": "Passes the market screen", "fields": [
        ("market_value", "IQVIA market value", "dirac"),
        ("cagr", "Value / unit CAGR", "dirac"),
        ("competitors", "Competitor count", "dirac"),
        ("private_lpo", "Private / LPO split", "dirac"),
        ("registrations", "MOHAP / UPP registrations", "dirac"),
        ("ai_score", "AI score", "dirac"),
        ("pipeline_decision", "Pipeline decision", "dirac"),
    ]},
    {"key": "shortlisted", "name": "Shortlisted", "phase": "Find", "trigger": "A manufacturer replies with interest", "fields": [
        ("partner_country", "Manufacturer country", "text"),
        ("bd_contact", "BD contact", "text"),
        ("first_reply_date", "Date of first reply", "date"),
        ("reference_markets", "Registered in reference markets", "text"),
        ("existing_uae_partner", "Existing UAE partner?", "text"),
    ]},
    {"key": "engaged", "name": "Partner engaged", "phase": "Agree", "trigger": "CDA / NDA signed", "doc": "CDA", "fields": [
        ("cda_signed", "CDA signed", "date"),
        ("cda_expiry", "CDA expiry", "date"),
    ]},
    {"key": "due_diligence", "name": "Due diligence", "phase": "Agree", "trigger": "Dossier accepted, business case holds", "doc": "Dossier review", "fields": [
        ("ctd_modules", "CTD / eCTD modules available", "text"),
        ("gmp_certificate", "GMP certificate (EU / PIC/S)", "text"),
        ("cpp", "CPP from reference country", "text"),
        ("stability_ivb", "Zone IVb stability (30°C / 75% RH)", "choice:Yes|Partial|No"),
        ("bioequivalence", "Bioequivalence study vs reference", "text"),
        ("api_source", "API source / DMF", "text"),
        ("forecast", "Y1–Y3 forecast", "dirac"),
    ]},
    {"key": "terms", "name": "Negotiating terms", "phase": "Agree", "trigger": "Licence & supply agreement signed", "doc": "Agreement", "fields": [
        ("transfer_price", "Transfer price per pack", "text"),
        ("territory", "Territory & exclusivity", "text"),
        ("moq", "MOQ / minimum purchase", "text"),
        ("fees", "Upfront / milestone fees", "text"),
        ("term_length", "Term length", "text"),
        ("agreement_signed", "Agreement signed", "date"),
    ]},
    {"key": "submission", "name": "Preparing submission", "phase": "Register", "trigger": "Dossier submitted to MOHAP", "fields": [
        ("submission_date", "Submission date", "date"),
        ("application_number", "Application number", "text"),
        ("pack_sizes", "Pack sizes applied for", "text"),
    ]},
    {"key": "registration", "name": "MOHAP registration", "phase": "Register", "trigger": "Registration certificate issued", "doc": "Registration certificate", "fields": [
        ("query_rounds", "Query rounds (date, topic)", "longtext"),
        ("registration_number", "Registration number", "text"),
        ("registration_date", "Registration date", "date"),
    ]},
    {"key": "pricing", "name": "MOHAP pricing", "phase": "Register", "trigger": "Public price approved", "doc": "Price letter", "fields": [
        ("price_submitted", "Price submitted", "text"),
        ("approved_price", "Approved public price per pack", "text"),
        ("forecast_retail", "Forecast retail price, to compare", "dirac"),
        ("price_approval_date", "Approval date", "date"),
    ]},
    {"key": "launch_prep", "name": "Launch prep", "phase": "Sell", "trigger": "First stock received", "fields": [
        ("first_po", "First PO (PO Tracker)", "dirac"),
        ("stock", "Stock in inventory", "dirac"),
        ("distributor", "Distributor", "text"),
        ("launch_date", "Launch date", "date"),
    ]},
    {"key": "launched", "name": "Launched", "phase": "Sell", "trigger": None, "fields": []},
]
STAGE_KEYS = [s["key"] for s in STAGES]
ENTERED_KEYS = {f[0] for s in STAGES for f in s["fields"] if f[2] != "dirac"}
STATUSES = {"active", "on_hold", "dropped"}
MAH_OPTIONS = {"", "comix", "partner_agent"}
REASONS = ["Market too small", "Partner declined", "Dossier gaps", "Terms not agreed",
           "Price not approved", "Competitor got there first", "Other"]


def stages_config() -> list[dict]:
    """The stage list as the frontend renders it."""
    return [{**s, "fields": [{"key": k, "label": label, "type": t} for k, label, t in s["fields"]]} for s in STAGES]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Values Dirac already holds ───────────────────────────────────────────────
_iqvia_cache: dict[str, dict] = {}   # reference data is fixed for the process lifetime


def _aed(value) -> str | None:
    if value is None:
        return None
    v = float(value)
    for div, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if abs(v) >= div:
            return f"AED {v / div:.1f}{suffix}"
    return f"AED {v:,.0f}"


def _pct(value) -> str | None:
    return None if value is None else f"{float(value):+.1f}%"


def _iqvia_facts(molecule: str, dfs: dict) -> dict:
    """Market facts and the 15%-growth forecast for a molecule, cached per process."""
    if molecule in _iqvia_cache:
        return _iqvia_cache[molecule]
    from agent_runner import lookup_molecule
    from DetailedForecast import forecast_top_product
    facts = lookup_molecule(molecule, dfs)
    if facts.get("in_iqvia"):
        try:
            facts["forecast"] = forecast_top_product(dfs["iqvia"], molecule, 0.15)
        except Exception:
            facts["forecast"] = None
    _iqvia_cache[molecule] = facts
    return facts


def _live_facts() -> dict:
    """Pipeline decisions, PO Tracker links and stock — read once per request."""
    client = get_client()
    pipeline = {r["molecule"].upper(): r for r in
                client.table("pipeline_decisions").select("molecule, decision, snapshot").execute().data}
    po: dict[str, list[str]] = {}
    for r in fetch_all("supplier_order_molecules", order="ref"):
        po.setdefault(r["molecule"].upper(), []).append(r["ref"])
    stock: dict[str, int] = {}
    for r in client.table("inventory_stock").select("molecule, stock_quantity").execute().data:
        key = str(r["molecule"]).upper()
        stock[key] = stock.get(key, 0) + int(r["stock_quantity"] or 0)
    return {"pipeline": pipeline, "po": po, "stock": stock}


def dirac_values(molecule: str, dfs: dict, live: dict) -> dict:
    """Display values for every "dirac" field; None where Dirac has nothing."""
    mol = molecule.upper()
    f = _iqvia_facts(mol, dfs)
    in_iqvia = bool(f.get("in_iqvia"))
    pipe = live["pipeline"].get(mol)
    snapshot = json.loads(pipe["snapshot"] or "{}") if pipe else {}
    forecast = f.get("forecast")
    retail = None
    if forecast and forecast.get("packs"):
        top = max(forecast["packs"], key=lambda p: p["pack_units"])
        retail = f"AED {top['retail_price']:,.2f} ({top['pack']})"
    cagr = None
    if in_iqvia and f.get("value_cagr_pct") is not None:
        cagr = f"{_pct(f['value_cagr_pct'])} value"
        if f.get("unit_cagr_pct") is not None:
            cagr += f" / {_pct(f['unit_cagr_pct'])} units"
    private_lpo = None
    if in_iqvia and f.get("private_pct") is not None and f.get("lpo_pct") is not None:
        private_lpo = f"{f['private_pct']:.0f}% private / {f['lpo_pct']:.0f}% LPO"
    refs = live["po"].get(mol)
    return {
        "market_value": _aed(f.get("market_value_aed")) if in_iqvia else None,
        "cagr": cagr,
        "competitors": str(f["num_competitors"]) if in_iqvia and f.get("num_competitors") is not None else None,
        "private_lpo": private_lpo,
        "registrations": f"{f.get('mohap_manufacturers', 0)} MOHAP / {f.get('upp_manufacturers', 0)} UPP",
        "ai_score": f"{snapshot['ai_score']}/10" if snapshot.get("ai_score") is not None else None,
        "pipeline_decision": pipe["decision"].capitalize() if pipe else None,
        "forecast": (" · ".join(_aed(forecast["summary"][f"total_y{y}_revenue"]) for y in (1, 2, 3)) + " (15% growth)")
                    if forecast else None,
        "forecast_retail": retail,
        "first_po": ", ".join(sorted(refs)) if refs else None,
        "stock": f"{live['stock'][mol]:,} packs" if live["stock"].get(mol) else None,
        "_area": f.get("atc1_class") if in_iqvia else None,
    }


# ─── Deals ────────────────────────────────────────────────────────────────────
def _filled(info: dict, dirac: dict) -> dict[str, int]:
    out = {}
    for s in STAGES:
        out[s["key"]] = sum(1 for k, _, t in s["fields"] if (dirac.get(k) if t == "dirac" else info.get(k)))
    return out


def _summary(row: dict, dfs: dict, live: dict, doc_counts: dict[int, int]) -> dict:
    info = json.loads(row["info"] or "{}")
    dirac = dirac_values(row["molecule"], dfs, live)
    return {
        "id": row["id"], "molecule": row["molecule"], "partner": row["partner"], "mah": row["mah"],
        "stage": row["stage"], "stage_entered_at": row["stage_entered_at"],
        "status": row["status"], "status_reason": row["status_reason"],
        "area": dirac.pop("_area"), "filled": _filled(info, dirac),
        "documents": doc_counts.get(row["id"], 0), "updated_at": row["updated_at"],
    }


def _doc_counts() -> dict[int, int]:
    counts: dict[int, int] = {}
    for r in fetch_all("deal_documents", columns="id, deal_id"):
        counts[r["deal_id"]] = counts.get(r["deal_id"], 0) + 1
    return counts


def list_deals(dfs: dict) -> dict:
    live = _live_facts()
    counts = _doc_counts()
    rows = fetch_all("deals")
    return {"stages": stages_config(), "reasons": REASONS,
            "deals": [_summary(r, dfs, live, counts) for r in rows]}


def _row(deal_id: int) -> dict | None:
    rows = get_client().table("deals").select("*").eq("id", deal_id).execute().data
    return rows[0] if rows else None


def get_deal(deal_id: int, dfs: dict) -> dict | None:
    row = _row(deal_id)
    if not row:
        return None
    client = get_client()
    live = _live_facts()
    docs = (client.table("deal_documents").select("id, stage, file_name, size_bytes, uploaded_at")
            .eq("deal_id", deal_id).order("uploaded_at").execute().data)
    events = (client.table("deal_events").select("kind, from_value, to_value, at")
              .eq("deal_id", deal_id).order("at").execute().data)
    deal = _summary(row, dfs, live, {deal_id: len(docs)})
    dirac = dirac_values(row["molecule"], dfs, live)
    dirac.pop("_area")
    return {**deal, "info": json.loads(row["info"] or "{}"), "dirac": dirac, "notes": row["notes"],
            "document_list": docs, "events": events}


def create_deal(molecule: str, partner: str, stage: str) -> dict:
    molecule = molecule.strip().upper()
    if not molecule:
        raise ValueError("Molecule is required")
    if stage not in STAGE_KEYS:
        raise ValueError(f"Unknown stage {stage!r}")
    client = get_client()
    if client.table("deals").select("id").eq("molecule", molecule).execute().data:
        raise ValueError(f"{molecule} already has a deal")
    row = client.table("deals").insert({"molecule": molecule, "partner": partner.strip(), "stage": stage}).execute().data[0]
    client.table("deal_events").insert({"deal_id": row["id"], "kind": "stage", "to_value": stage}).execute()
    return row


def update_deal(deal_id: int, changes: dict) -> dict | None:
    """Apply partner / mah / status / reason / notes / info changes. Info values merge; '' clears one."""
    row = _row(deal_id)
    if not row:
        return None
    patch: dict = {}
    events: list[dict] = []
    if "partner" in changes and changes["partner"] is not None:
        patch["partner"] = str(changes["partner"]).strip()
    if "notes" in changes and changes["notes"] is not None:
        patch["notes"] = str(changes["notes"])
    if changes.get("mah") is not None:
        if changes["mah"] not in MAH_OPTIONS:
            raise ValueError("Authorisation holder must be comix, partner_agent or empty")
        patch["mah"] = changes["mah"]
    if changes.get("status") is not None:
        status = changes["status"]
        if status not in STATUSES:
            raise ValueError("Status must be active, on_hold or dropped")
        if status != row["status"]:
            patch["status"] = status
            events.append({"deal_id": deal_id, "kind": "status", "from_value": row["status"], "to_value": status})
        if status == "active":
            patch["status_reason"] = ""
    if changes.get("status_reason") is not None:
        patch["status_reason"] = str(changes["status_reason"]).strip()
    if changes.get("info"):
        info = json.loads(row["info"] or "{}")
        for key, value in changes["info"].items():
            if key not in ENTERED_KEYS:
                raise ValueError(f"Unknown field {key!r}")
            value = "" if value is None else str(value).strip()
            if value:
                info[key] = value
            else:
                info.pop(key, None)
        patch["info"] = json.dumps(info)
    if not patch:
        return row
    patch["updated_at"] = _now()
    client = get_client()
    updated = client.table("deals").update(patch).eq("id", deal_id).execute().data[0]
    if events:
        client.table("deal_events").insert(events).execute()
    return updated


def move_deal(deal_id: int, stage: str) -> dict | None:
    """Move a deal to any stage. Never blocked by empty fields."""
    if stage not in STAGE_KEYS:
        raise ValueError(f"Unknown stage {stage!r}")
    row = _row(deal_id)
    if not row:
        return None
    if stage == row["stage"]:
        return row
    client = get_client()
    now = _now()
    updated = client.table("deals").update({"stage": stage, "stage_entered_at": now, "updated_at": now}) \
        .eq("id", deal_id).execute().data[0]
    client.table("deal_events").insert({"deal_id": deal_id, "kind": "stage",
                                        "from_value": row["stage"], "to_value": stage}).execute()
    return updated


def delete_deal(deal_id: int) -> bool:
    client = get_client()
    paths = [d["storage_path"] for d in
             client.table("deal_documents").select("storage_path").eq("deal_id", deal_id).execute().data]
    if paths:
        client.storage.from_(BUCKET).remove(paths)
    return bool(client.table("deals").delete().eq("id", deal_id).execute().data)


# ─── Documents ────────────────────────────────────────────────────────────────
def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")[:120] or "file"


def add_document(deal_id: int, stage: str, file_name: str, content_type: str, data: bytes) -> dict:
    if stage not in STAGE_KEYS:
        raise ValueError(f"Unknown stage {stage!r}")
    if not data:
        raise ValueError("The file is empty")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValueError("Files can be up to 20 MB")
    if not _row(deal_id):
        raise LookupError("Deal not found")
    content_type = content_type or "application/octet-stream"
    path = f"{deal_id}/{uuid.uuid4().hex}-{_safe_name(file_name)}"
    client = get_client()
    client.storage.from_(BUCKET).upload(path, data, {"content-type": content_type})
    return client.table("deal_documents").insert({
        "deal_id": deal_id, "stage": stage, "file_name": file_name or "file",
        "content_type": content_type, "size_bytes": len(data), "storage_path": path,
    }).execute().data[0]


def _document(doc_id: int) -> dict | None:
    rows = get_client().table("deal_documents").select("*").eq("id", doc_id).execute().data
    return rows[0] if rows else None


def read_document(doc_id: int) -> tuple[dict, bytes] | None:
    doc = _document(doc_id)
    if not doc:
        return None
    return doc, get_client().storage.from_(BUCKET).download(doc["storage_path"])


def delete_document(doc_id: int) -> bool:
    doc = _document(doc_id)
    if not doc:
        return False
    client = get_client()
    client.storage.from_(BUCKET).remove([doc["storage_path"]])
    client.table("deal_documents").delete().eq("id", doc_id).execute()
    return True
