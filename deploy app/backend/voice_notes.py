"""
voice_notes.py — turn a rep's spoken visit summary into the visit form's fields.

The rep app records audio and posts it here with the rep's Supabase session.
We transcribe it, then ask an OpenAI model to fill only the structured fields
(outcome, molecules discussed, doctor stance + reason, samples, shelf check,
order, next visit). Every value is checked against the allowed options and
COMIX's carried SKUs, so nothing invented reaches the form. The rep reviews
the pre-filled form and saves it; the transcript is stored with the visit.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from supabase_client import fetch_all, get_service_client

TRANSCRIBE_MODEL = "gpt-4o-transcribe"
EXTRACT_MODEL = "gpt-5.6-luna"

OUTCOMES = {
    "clinic": ["met", "not_available", "cancelled"],
    "pharmacy": ["order_taken", "no_order", "not_available"],
}
STANCES = ["prescribing", "will_try", "not_interested"]
REASONS = ["price", "efficacy", "side_effects", "competitor", "not_stocked"]
SHELF = ["in", "low", "out"]

DUBAI = timezone(timedelta(hours=4))


class NotARep(Exception):
    """The request didn't come from an active, signed-in rep."""


def rep_for_token(token: str) -> dict:
    db = get_service_client()
    try:
        user = db.auth.get_user(token).user
    except Exception as e:  # expired / malformed token
        raise NotARep("Your session has expired — sign in again") from e
    rows = db.table("reps").select("id, name, active").eq("id", user.id).execute().data
    if not rows or not rows[0]["active"]:
        raise NotARep("This login isn't an active rep")
    return rows[0]


def account_type(account_id: int) -> str:
    rows = get_service_client().table("accounts").select("type").eq("id", account_id).execute().data
    if not rows:
        raise ValueError("Client not found")
    return rows[0]["type"]


def _skus() -> list[dict]:
    return fetch_all("inventory_stock", "pack_key, molecule, strength, form, pack_size", order="molecule")


def _sku_label(s: dict) -> str:
    size = s.get("pack_size") or ""
    size = f"pack of {size}" if size.isdigit() else size
    return " ".join(x for x in [s["molecule"], s.get("strength") or "", (s.get("form") or "").lower(), size] if x)


def transcribe(audio: bytes, filename: str, content_type: str, molecules: list[str]) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    result = client.audio.transcriptions.create(
        model=TRANSCRIBE_MODEL,
        file=(filename, audio, content_type),
        # Spelling hints: the rep will say these drug names, often mixed with Arabic.
        prompt="Medical rep visit summary in English or Arabic. Drug names: " + ", ".join(molecules),
    )
    return result.text.strip()


def _schema(kind: str) -> dict:
    """Strict JSON schema for the visit form (OpenAI structured outputs)."""
    line = lambda extra: {"type": "object", "properties": {"pack_key": {"type": "string"}, **extra},
                          "required": ["pack_key", *extra.keys()], "additionalProperties": False}
    return {
        "name": "fill_visit",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "outcome": {"type": ["string", "null"], "enum": [*OUTCOMES[kind], None]},
                "molecules_discussed": {"type": "array", "items": {"type": "string"}},
                "feedback": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "molecule": {"type": "string"},
                        "stance": {"type": "string", "enum": STANCES},
                        "reason": {"type": ["string", "null"], "enum": [*REASONS, None]},
                    },
                    "required": ["molecule", "stance", "reason"],
                    "additionalProperties": False,
                }},
                "samples": {"type": "array", "items": line({"quantity": {"type": "integer"}})},
                "shelf": {"type": "array", "items": line({"status": {"type": "string", "enum": SHELF}})},
                "order": {"type": "array", "items": line({"quantity": {"type": "integer"}})},
                "next_visit_on": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
            },
            "required": ["outcome", "molecules_discussed", "feedback", "samples", "shelf", "order", "next_visit_on"],
            "additionalProperties": False,
        },
    }


def _prompt(kind: str, transcript: str, skus: list[dict], today: datetime) -> str:
    molecules = sorted({s["molecule"] for s in skus})
    sku_lines = "\n".join(f"- {s['pack_key']}: {_sku_label(s)}" for s in skus)
    outcome_help = (
        "met = saw the doctor; not_available = doctor wasn't there; cancelled = visit didn't happen"
        if kind == "clinic" else
        "order_taken = pharmacy placed an order; no_order = visited, no order; not_available = pharmacist wasn't there"
    )
    sections = (
        "molecules_discussed, feedback (the doctor's stance per molecule; reason only when not_interested), samples"
        if kind == "clinic" else
        "shelf (stock on the pharmacy shelf: in / low / out) and order (packs ordered)"
    )
    return f"""A COMIX medical rep just finished a visit to a {'pharmacy' if kind == 'pharmacy' else 'doctor / hospital'} and summarised it out loud. Fill the visit form from their words.

Today is {today:%A %d %B %Y} ({today:%Y-%m-%d}).

Outcome options: {outcome_help}.
For this client type, fill: {sections}. Leave the other lists empty.

Molecules COMIX carries (use these exact names): {', '.join(molecules) or 'none'}

SKUs COMIX carries (use the pack_key on the left):
{sku_lines or '- none'}

Rules:
- Only fill what the rep actually said. Unknown → null or an empty list. Never guess.
- Match drug names to the list even if mispronounced or said in Arabic. If a molecule isn't on the list, leave it out.
- A sample/shelf/order line needs a specific SKU. If the rep names a molecule and strength and only one carried pack fits, use it; if several fit and they didn't say which, leave the line out.
- Stance: prescribing = already prescribes it; will_try = agreed to try / will start; not_interested = declined. Reasons: price, efficacy, side_effects, competitor (prefers another brand), not_stocked (not available in nearby pharmacies).
- next_visit_on: convert "in two weeks", "next month", "Thursday" into a date from today.

Rep's words:
\"\"\"{transcript}\"\"\""""


def extract(transcript: str, kind: str, skus: list[dict], today: datetime | None = None) -> dict:
    from openai import OpenAI

    today = today or datetime.now(DUBAI)
    response = OpenAI(api_key=os.getenv("OPENAI_API_KEY")).chat.completions.create(
        model=EXTRACT_MODEL,
        max_completion_tokens=4000,
        response_format={"type": "json_schema", "json_schema": _schema(kind)},
        messages=[{"role": "user", "content": _prompt(kind, transcript, skus, today)}],
    )
    try:
        raw = json.loads(response.choices[0].message.content or "{}")
    except json.JSONDecodeError:
        raw = {}
    return clean(raw, kind, skus)


def clean(raw: dict, kind: str, skus: list[dict]) -> dict:
    """Keep only values the form accepts: allowed options and carried SKUs/molecules."""
    keys = {s["pack_key"] for s in skus}
    molecules = {s["molecule"].upper(): s["molecule"] for s in skus}
    clinic = kind == "clinic"

    def molecule(name) -> str | None:
        return molecules.get(str(name or "").strip().upper())

    def lines(items, field, allowed=None) -> list[dict]:
        out, seen = [], set()
        for item in items or []:
            key, value = item.get("pack_key"), item.get(field)
            if key not in keys or key in seen:
                continue
            if allowed is None:
                if not isinstance(value, int) or value <= 0:
                    continue
            elif value not in allowed:
                continue
            seen.add(key)
            out.append({"pack_key": key, field: value})
        return out

    feedback = {}
    for f in (raw.get("feedback") or []) if clinic else []:
        m = molecule(f.get("molecule"))
        if m and f.get("stance") in STANCES:
            reason = f.get("reason") if f["stance"] == "not_interested" and f.get("reason") in REASONS else None
            feedback[m] = {"molecule": m, "stance": f["stance"], "reason": reason}
    discussed = [m for m in (molecule(x) for x in (raw.get("molecules_discussed") or [])) if m] if clinic else []
    discussed = list(dict.fromkeys([*discussed, *feedback]))

    next_visit = raw.get("next_visit_on")
    try:
        next_visit = datetime.strptime(next_visit, "%Y-%m-%d").date().isoformat() if next_visit else None
    except (TypeError, ValueError):
        next_visit = None

    return {
        "outcome": raw.get("outcome") if raw.get("outcome") in OUTCOMES[kind] else None,
        "molecules": discussed,
        "feedback": list(feedback.values()),
        "samples": lines(raw.get("samples"), "quantity") if clinic else [],
        "shelf": lines(raw.get("shelf"), "status", SHELF) if not clinic else [],
        "order": lines(raw.get("order"), "quantity") if not clinic else [],
        "next_visit_on": next_visit,
    }


def process(audio: bytes, filename: str, content_type: str, account_id: int) -> dict:
    kind = "pharmacy" if account_type(account_id) == "pharmacy" else "clinic"
    skus = _skus()
    transcript = transcribe(audio, filename, content_type, sorted({s["molecule"] for s in skus}))
    if not transcript:
        return {"transcript": "", "fields": clean({}, kind, skus)}
    return {"transcript": transcript, "fields": extract(transcript, kind, skus)}
