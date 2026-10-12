"""
registry_review.py — the AI review step of the master registry, run by the backend.

GitHub Actions does the heavy monthly work (download, diff, rule matching) and leaves two queues in Supabase:
  * company look-alike pairs (company_merge_candidates, verdict null) — new spellings vs existing companies
  * ingredient names no rule could match to a molecule (registration_molecules.molecule_id null)
Every day at 10:00 Dubai (and on demand from Data → Review) this module sends both queues to Claude Haiku:
  * confident "same company" → merged (apply_company_merges; merging only points a company at another, nothing is deleted)
  * confident "different" → saved, never asked again
  * unsure → verdict "unsure", shown on the Review page for a person to decide
  * an ingredient Haiku maps to a WHO INN that exists in `molecules` → molecule alias (method "ai"), applied at once;
    otherwise the attempt is saved (no_inn / unsure) so it is not asked again.
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from supabase_client import get_client, get_service_client

MODEL = "claude-haiku-5-5"
DUBAI = ZoneInfo("Asia/Dubai")
REVIEW_HOUR = 10
COMPANY_BATCH, MOLECULE_BATCH = 25, 40
MAX_COMPANY_PAIRS, MAX_MOLECULES = 2000, 4000          # per run, so one run stays a few minutes
MERGE_CONFIDENCE = 0.8

_lock = threading.Lock()
last_review: dict = {}


def _db():
    """Service-role client when available: merges and re-matching are heavier than the anon role's 8 s limit."""
    try:
        return get_service_client()
    except RuntimeError:
        return get_client()


def _claude():
    import anthropic
    return anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def _ask(system: str, payload: list[dict], schema: dict) -> dict:
    response = _claude().messages.create(
        model=MODEL,
        max_tokens=8000,
        system=system,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined this batch")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)


# ---------------------------------------------------------------- companies

COMPANY_SYSTEM = (
    "You decide whether two company names from medicine registries are the same company group, for a pharma "
    "licensing team that wants one company per group. Same = the same company or group written differently, a "
    "local subsidiary or branch of the same group, a renamed or transliterated name (e.g. Bulgarian 'Teva Farma' "
    "and 'Teva'; 'Sandoz GmbH' and 'SANDOZ GMBH -- AUSTRIA'). Different = unrelated firms that only share a word "
    "(e.g. 'Medochemie' vs 'Medopharm', two different 'Pharma Nord' style generic names in different groups). "
    "Use the countries and example products as evidence. Give confidence 0-1; below 0.8 means a person should check."
)
COMPANY_SCHEMA = {
    "type": "object",
    "properties": {"decisions": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "verdict": {"type": "string", "enum": ["same", "different"]},
                       "confidence": {"type": "number"}},
        "required": ["id", "verdict", "confidence"], "additionalProperties": False}}},
    "required": ["decisions"], "additionalProperties": False,
}


def review_companies(db) -> dict:
    judged = merged = unsure = 0
    while judged < MAX_COMPANY_PAIRS:
        pairs = db.rpc("registry_company_pairs", {"p_verdict": None, "p_limit": COMPANY_BATCH}).execute().data or []
        if not pairs:
            break
        payload = [{"id": i, "a": p["a_name"], "a_countries": p["a_countries"], "a_products": p["a_examples"],
                    "b": p["b_name"], "b_countries": p["b_countries"], "b_products": p["b_examples"]}
                   for i, p in enumerate(pairs)]
        decisions = {d["id"]: d for d in _ask(COMPANY_SYSTEM, payload, COMPANY_SCHEMA)["decisions"]}
        rows, same = [], []
        for i, p in enumerate(pairs):
            d = decisions.get(i)
            if not d:
                verdict = "unsure"
            elif d["confidence"] < MERGE_CONFIDENCE:
                verdict = "unsure"
            else:
                verdict = d["verdict"]
            rows.append({"a": p["a"], "b": p["b"], "verdict": verdict})
            if verdict == "same":
                same.append([p["a"], p["b"]])
            unsure += verdict == "unsure"
        db.table("company_merge_candidates").upsert(rows, on_conflict="a,b").execute()
        if same:
            db.rpc("apply_company_merges", {"p_pairs": same}).execute()
            merged += len(same)
        judged += len(pairs)
    return {"companies_judged": judged, "companies_merged": merged, "companies_unsure": unsure}


def decide_company_pair(a: int, b: int, verdict: str) -> dict:
    """A person's answer on the Review page."""
    if verdict not in ("same", "different"):
        raise ValueError("verdict must be same or different")
    db = _db()
    db.table("company_merge_candidates").upsert({"a": a, "b": b, "verdict": verdict}, on_conflict="a,b").execute()
    if verdict == "same":
        return db.rpc("apply_company_merges", {"p_pairs": [[a, b]]}).execute().data
    return {"saved": True}


# ---------------------------------------------------------------- molecules

MOLECULE_SYSTEM = (
    "Each item is an active-ingredient name taken from a national medicine registry (any language: Italian, "
    "French, German, Bulgarian, Latin, English with salts or typos), with the countries it appears in. Give the "
    "WHO INN in English for the active moiety, salt removed (e.g. 'amlodipina besilato' -> 'amlodipine', "
    "'acide acétylsalicylique' -> 'acetylsalicylic acid', 'metformini hydrochloridum' -> 'metformin'). If the "
    "text holds several actives, list each. Use kind 'not_inn' for herbal extracts, homeopathic stocks, "
    "excipients, vitamins mixtures without an INN, allergens, and anything that is not a single defined drug "
    "substance. Confidence 0-1."
)
MOLECULE_SCHEMA = {
    "type": "object",
    "properties": {"answers": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "kind": {"type": "string", "enum": ["inn", "not_inn"]},
                       "inns": {"type": "array", "items": {"type": "string"}}, "confidence": {"type": "number"}},
        "required": ["id", "kind", "inns", "confidence"], "additionalProperties": False}}},
    "required": ["answers"], "additionalProperties": False,
}


def review_molecules(db) -> dict:
    db.rpc("registry_refresh_ingredient_queue", {}).execute()      # one slow scan, then the queue is a small table
    judged = matched = unsure = 0
    while judged < MAX_MOLECULES:
        items = db.rpc("registry_unmatched_ingredients", {"p_limit": MOLECULE_BATCH, "p_status": None}).execute().data or []
        if not items:
            break
        payload = [{"id": i, "name": x["example"], "countries": x["countries"]} for i, x in enumerate(items)]
        answers = {a["id"]: a for a in _ask(MOLECULE_SYSTEM, payload, MOLECULE_SCHEMA)["answers"]}
        # resolve every proposed INN against our molecule list in one call
        proposed = sorted({n for a in answers.values() for n in a["inns"] if n.strip()})
        resolved = {r["name"]: r for r in (db.rpc("registry_resolve_inns", {"p_names": proposed}).execute().data or [])} if proposed else {}
        attempts = []
        for i, x in enumerate(items):
            a = answers.get(i)
            status, answer, molecule_id, conf = "unsure", None, None, 0.0
            if a:
                conf, answer = float(a["confidence"]), " + ".join(a["inns"]) or None
                hits = [resolved.get(n, {}).get("molecule_id") for n in a["inns"]]
                if a["kind"] == "not_inn" and conf >= MERGE_CONFIDENCE:
                    status = "not_inn"
                elif a["kind"] == "inn" and len(hits) == 1 and hits[0] and conf >= MERGE_CONFIDENCE:
                    status, molecule_id = "matched", hits[0]
                elif a["kind"] == "inn" and len(hits) > 1 and all(hits):
                    status = "combination"          # an unsplit combination: left for the splitter / a person
                elif a["kind"] == "inn" and hits and not all(hits):
                    status = "no_inn"               # an INN we don't have in the WHO list
            if status == "matched":
                db.rpc("registry_apply_alias", {"p_alias": x["alias"], "p_molecule_id": molecule_id,
                                                "p_method": "ai", "p_confidence": conf}).execute()
                matched += 1
            unsure += status == "unsure"
            attempts.append({"alias": x["alias"], "answer": answer, "molecule_id": molecule_id, "confidence": conf,
                             "status": status, "products": x["products"]})
        db.table("molecule_ai_attempts").upsert(attempts, on_conflict="alias").execute()
        judged += len(items)
    return {"molecules_judged": judged, "molecules_matched": matched, "molecules_unsure": unsure}


def decide_molecule(alias: str, inn: str | None) -> dict:
    """A person's answer: an INN to map the ingredient to, or None for 'not a molecule'."""
    db = _db()
    if not inn:
        db.table("molecule_ai_attempts").upsert({"alias": alias, "status": "not_inn", "answer": None}, on_conflict="alias").execute()
        return {"saved": True}
    hit = (db.rpc("registry_resolve_inns", {"p_names": [inn]}).execute().data or [{}])[0]
    if not hit.get("molecule_id"):
        raise ValueError(f"'{inn}' isn't in the WHO molecule list")
    n = db.rpc("registry_apply_alias", {"p_alias": alias, "p_molecule_id": hit["molecule_id"],
                                        "p_method": "manual", "p_confidence": 1}).execute().data
    db.table("molecule_ai_attempts").upsert({"alias": alias, "status": "matched_manual", "answer": hit["inn"],
                                             "molecule_id": hit["molecule_id"], "confidence": 1}, on_conflict="alias").execute()
    return {"molecule": hit["inn"], "ingredient_rows": n}


# ---------------------------------------------------------------- runs

def run_review(trigger: str) -> dict:
    """One review at a time; the outcome is logged in registry_review_log."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set on the backend")
    if not _lock.acquire(blocking=False):
        raise RuntimeError("A review is already running — give it a few minutes")
    db = _db()
    log = db.table("registry_review_log").insert({"trigger": trigger}).execute().data[0]
    result: dict = {}
    try:
        result.update(review_companies(db))
        result.update(review_molecules(db))
        db.table("registry_review_log").update({**result, "finished_at": datetime.now(timezone.utc).isoformat()}).eq("id", log["id"]).execute()
        last_review.clear()
        last_review.update({"ok": True, **result})
        return result
    except Exception as e:
        db.table("registry_review_log").update({**result, "error": str(e)[:1000],
                                                "finished_at": datetime.now(timezone.utc).isoformat()}).eq("id", log["id"]).execute()
        last_review.clear()
        last_review.update({"ok": False, "error": str(e)})
        raise
    finally:
        _lock.release()


def start_review(trigger: str) -> bool:
    """Run in a background thread (the Run review now button); False if one is already running."""
    if _lock.locked():
        return False
    threading.Thread(target=lambda: _safe(trigger), daemon=True).start()
    return True


def _safe(trigger: str):
    try:
        print("Registry review:", run_review(trigger))
    except Exception as e:
        print("Registry review failed:", e)


def seconds_until_next_run(now: datetime | None = None) -> float:
    now = (now or datetime.now(timezone.utc)).astimezone(DUBAI)
    target = now.replace(hour=REVIEW_HOUR, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def daily_review() -> None:
    """Background task started with the backend: review the queues at 10:00 Dubai every day."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("Registry review off — ANTHROPIC_API_KEY not set")
        return
    while True:
        await asyncio.sleep(seconds_until_next_run())
        await asyncio.to_thread(_safe, "schedule")


# ---------------------------------------------------------------- Review page

def review_overview() -> dict:
    db = get_client()
    runs = db.table("registry_runs").select("*").order("id", desc=True).limit(60).execute().data or []
    reviews = db.table("registry_review_log").select("*").order("id", desc=True).limit(10).execute().data or []
    return {
        "runs": runs,
        "reviews": reviews,
        "running": _lock.locked(),
        "counts": db.rpc("registry_review_counts", {}).execute().data,
        "company_pairs": db.rpc("registry_company_pairs", {"p_verdict": "unsure", "p_limit": 100}).execute().data or [],
        "molecules": db.rpc("registry_unmatched_ingredients", {"p_limit": 100, "p_status": "unsure"}).execute().data or [],
    }


def run_changes(run_id: int, kind: str | None = None, limit: int = 200) -> list[dict]:
    db = get_client()
    q = db.table("registration_changes").select("kind,changes,registration_id").eq("run_id", run_id)
    if kind:
        q = q.eq("kind", kind)
    rows = q.limit(limit).execute().data or []
    ids = list({r["registration_id"] for r in rows})
    regs = {}
    for i in range(0, len(ids), 200):
        for g in db.table("registrations").select("id,product_name,company_raw,molecule_raw,combo_key,strength_raw,status") \
                .in_("id", ids[i:i + 200]).execute().data or []:
            regs[g["id"]] = g
    return [{**r, **regs.get(r["registration_id"], {})} for r in rows]
