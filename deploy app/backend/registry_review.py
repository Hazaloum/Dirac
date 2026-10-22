"""
registry_review.py — the AI review step of the master registry, run by the backend.

GitHub Actions does the heavy monthly work (download, diff, rule matching) and leaves two queues in Supabase:
  * company look-alike pairs (company_merge_candidates, verdict null) — new spellings vs existing companies
  * brand clusters (company_group_candidates, status pending) — companies sharing a brand word, to group into
    company groups (Pfizer Romania, Pfizer Hellas … → group "Pfizer")
  * ingredient names no rule could match to a molecule (registration_molecules.molecule_id null)
After each registry refresh (the backend checks hourly for a run that finished since the last review) and on demand
from Data → Review, this module sends both queues to Claude Haiku, until they are empty:
  * confident "same company" (same legal entity, spelt differently) → merged (apply_company_merges; merging only points a company at another, nothing is deleted)
  * confident "different" → saved, never asked again
  * unsure → verdict "unsure", shown on the Review page for a person to decide
  * brand clusters: Haiku splits each into groups (subsidiaries of one parent); confident → applied (companies.group_id),
    unsure → shown on the Review page
  * an ingredient Haiku maps to a WHO INN that exists in `molecules` → molecule alias (method "ai"), applied at once;
    otherwise the attempt is saved (no_inn / unsure) so it is not asked again.
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from datetime import datetime, timezone

from supabase_client import get_client, get_service_client

MODEL = "claude-haiku-5-5"
CHECK_EVERY = 3600                                      # seconds between "has a refresh landed?" checks
COMPANY_BATCH, MOLECULE_BATCH, GROUP_BATCH = 25, 40, 5
MAX_COMPANY_PAIRS, MAX_MOLECULES, MAX_GROUPS = 20000, 50000, 5000       # safety caps only; a run normally empties both queues
MERGE_CONFIDENCE = 0.8

_lock = threading.Lock()
_deadline: float | None = None      # time.monotonic() after which the queues stop (a time-limited run, e.g. on Vercel)


def _out_of_time() -> bool:
    return _deadline is not None and time.monotonic() > _deadline
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
    "You decide whether two company names from medicine registries are the same company: the same legal entity "
    "written differently — spelling, punctuation, legal-form suffix, a country or city added, a transliteration "
    "(e.g. 'Sandoz GmbH' and 'SANDOZ GMBH -- AUSTRIA'; 'Adalvo Limited' and 'Adalvo Limited Malta'; Bulgarian "
    "'Teva Farma' and 'Тева Фарма'). Different = separate legal entities, including subsidiaries of one group in "
    "different countries (e.g. 'Pfizer Hellas' vs 'Pfizer Romania' — those are grouped separately, not merged) "
    "and unrelated firms that only share a word ('Medochemie' vs 'Medopharm'). Use the countries and example "
    "products as evidence. Give confidence 0-1; below 0.8 means a person should check."
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
    while judged < MAX_COMPANY_PAIRS and not _out_of_time():
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


# ---------------------------------------------------------------- company groups

GROUP_SYSTEM = (
    "Each item is a cluster of companies from medicine registries whose names share a brand word, with their "
    "countries, product counts, example products and any group already assigned. Split each cluster into company "
    "groups: one group = one parent company and its subsidiaries, country affiliates, factories and branches (e.g. "
    "'Pfizer Hellas', 'Pfizer Romania', 'Pfizer Europe MA EEIG' -> group 'Pfizer'). Keep apart firms that only share "
    "a word: 'Merck KGaA' (Germany) and 'Merck Sharp & Dohme' (MSD, US) are different groups; unrelated local firms "
    "with a common word (pharmacies, 'Euro-Pharma' style names) are not grouped. Name each group by its parent's "
    "usual short name. Leave out companies that belong to no group with another member. Only list groups of 2+ "
    "members. Confidence 0-1 per group; below 0.8 means a person should check."
)
GROUP_SCHEMA = {
    "type": "object",
    "properties": {"clusters": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "groups": {"type": "array", "items": {
            "type": "object",
            "properties": {"name": {"type": "string"}, "member_ids": {"type": "array", "items": {"type": "integer"}},
                           "confidence": {"type": "number"}},
            "required": ["name", "member_ids", "confidence"], "additionalProperties": False}}},
        "required": ["id", "groups"], "additionalProperties": False}}},
    "required": ["clusters"], "additionalProperties": False,
}


def review_groups(db) -> dict:
    db.rpc("registry_build_group_candidates", {}).execute()
    judged = applied = unsure = 0
    while judged < MAX_GROUPS and not _out_of_time():
        clusters = db.rpc("registry_group_clusters", {"p_status": "pending", "p_limit": GROUP_BATCH}).execute().data or []
        if not clusters:
            break
        payload = [{"id": k["id"], "brand": k["brand"],
                    "companies": [{"id": m["id"], "name": m["name"], "countries": m["countries"], "products": m["products"],
                                   "examples": m["examples"], **({"current_group": m["group"]} if m.get("group") else {})}
                                  for m in (k["members"] or [])]}
                   for k in clusters]
        answers = {a["id"]: a for a in _ask(GROUP_SYSTEM, payload, GROUP_SCHEMA)["clusters"]}
        for k in clusters:
            a = answers.get(k["id"])
            groups = [g for g in (a or {}).get("groups", []) if len(g["member_ids"]) >= 2]
            if a is None or any(g["confidence"] < MERGE_CONFIDENCE for g in groups):
                db.table("company_group_candidates").update({"status": "unsure", "proposal": groups}).eq("id", k["id"]).execute()
                unsure += 1
            else:
                db.rpc("registry_apply_groups", {"p_cluster": k["id"], "p_groups": groups, "p_method": "ai",
                                                 "p_status": "applied" if groups else "no_group"}).execute()
                applied += bool(groups)
        judged += len(clusters)
    return {"groups_judged": judged, "groups_applied": applied, "groups_unsure": unsure}


def decide_group(cluster_id: int, groups: list[dict]) -> dict:
    """A person's answer on the Review page: the groups to form ([] = none of these belong together)."""
    groups = [{"name": (g.get("name") or "").strip(), "member_ids": [int(i) for i in g.get("member_ids", [])]}
              for g in groups if len(g.get("member_ids", [])) >= 2]
    return _db().rpc("registry_apply_groups", {"p_cluster": cluster_id, "p_groups": groups, "p_method": "manual",
                                               "p_status": "manual"}).execute().data


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
    while judged < MAX_MOLECULES and not _out_of_time():
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

def run_review(trigger: str, budget_s: float | None = None) -> dict:
    """One review at a time; the outcome is logged in registry_review_log. With budget_s the queues stop after that
    many seconds (result `partial`); the next run carries on where this one stopped."""
    global _deadline
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set on the backend")
    if not _lock.acquire(blocking=False):
        raise RuntimeError("A review is already running — give it a few minutes")
    db = _db()
    log = db.table("registry_review_log").insert({"trigger": trigger}).execute().data[0]
    result: dict = {}
    _deadline = time.monotonic() + budget_s if budget_s else None
    try:
        result.update(review_companies(db))
        result.update(review_groups(db))
        result.update(review_molecules(db))
        partial = _out_of_time()
        if not partial:
            db.rpc("registry_refresh_molecule_index", {}).execute()     # molecule search on the Registries page
        db.table("registry_review_log").update({**result, "finished_at": datetime.now(timezone.utc).isoformat()}).eq("id", log["id"]).execute()
        last_review.clear()
        last_review.update({"ok": True, **result, **({"partial": True} if partial else {})})
        return {**result, **({"partial": True} if partial else {})}
    except Exception as e:
        db.table("registry_review_log").update({**result, "error": str(e)[:1000],
                                                "finished_at": datetime.now(timezone.utc).isoformat()}).eq("id", log["id"]).execute()
        last_review.clear()
        last_review.update({"ok": False, "error": str(e)})
        raise
    finally:
        _deadline = None
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


def refresh_landed() -> bool:
    """True when a registry run finished after the last review started (or there has never been a review)."""
    db = get_client()
    run = db.table("registry_runs").select("finished_at").eq("status", "applied").order("finished_at", desc=True).limit(1).execute().data
    if not run or not run[0]["finished_at"]:
        return False
    review = db.table("registry_review_log").select("started_at").order("started_at", desc=True).limit(1).execute().data
    return not review or run[0]["finished_at"] > review[0]["started_at"]


def work_waiting() -> bool:
    """True when a queue still has unjudged items, e.g. a review cut short by a backend restart."""
    c = get_client().rpc("registry_review_counts", {}).execute().data or {}
    return bool(c.get("companies_waiting") or c.get("groups_waiting") or c.get("molecules_waiting"))


def should_review() -> bool:
    return refresh_landed() or work_waiting()


async def review_after_refresh() -> None:
    """Background task started with the backend: once an hour, review the queues if a registry refresh landed
    or a queue still has unjudged items."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("Registry review off — ANTHROPIC_API_KEY not set")
        return
    while True:
        try:
            if not _lock.locked() and await asyncio.to_thread(should_review):
                await asyncio.to_thread(_safe, "after refresh")
        except Exception as e:      # keep the loop alive
            print("Registry review check failed:", e)
        await asyncio.sleep(CHECK_EVERY)


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
        "group_clusters": db.rpc("registry_group_clusters", {"p_status": "unsure", "p_limit": 100}).execute().data or [],
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
