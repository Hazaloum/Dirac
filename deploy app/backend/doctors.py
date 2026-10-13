"""
doctors.py — the UAE health-professional register (Data → Doctors), for finding leads for the medical reps.

Source: the DHA (Dubai) professional register, table `hcp_professionals` (one row per DHA unique ID: name,
profession / grade / specialty parsed from the directory category, facility, licences, experience, education,
languages, and contact details). The table holds personal contact data, so RLS gives the anon key nothing; this
module reads it with the service-role client only.

- facets(): professions, specialties and grades with counts, for the filters.
- search(...): paged list (no contact details), SQL hcp_search.
- detail(dha_id): one full profile, contacts included.
- add_to_field_force(dha_id, area_id): creates a Field force client (accounts, type doctor) from the profile and
  links it back (hcp_professionals.account_id). The doctor's facility becomes the client's address, and its hospital
  if a hospital client with that name exists.
"""
from __future__ import annotations

from supabase_client import get_service_client



def _db():
    return get_service_client()


_facets: dict = {}


def facets() -> dict:
    """Counts for the filters; the register only changes on a re-import, so cached per process."""
    if not _facets:
        _facets.update(_db().rpc("hcp_facets", {}).execute().data or {})
    return _facets


def search(q: str = "", profession: str | None = None, specialty: str | None = None, grade: str | None = None,
           with_contact: bool = False, offset: int = 0, limit: int = 50) -> dict:
    rows = _db().rpc("hcp_search", {"p_q": q or "", "p_profession": profession or None,
                                    "p_specialty": specialty or None, "p_grade": grade or None,
                                    "p_with_contact": with_contact, "p_offset": offset, "p_limit": limit}).execute().data or []
    total = rows[0]["total"] if rows else 0
    for r in rows:
        r.pop("total", None)
    return {"total": total, "offset": offset, "rows": rows}


def _split(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split("|") if v.strip() and v.strip() != "-"]


def detail(dha_id: str) -> dict | None:
    rows = _db().table("hcp_professionals").select("*").eq("dha_id", dha_id).execute().data
    if not rows:
        return None
    p = rows[0]
    emails = list(dict.fromkeys(e for e in (p.get("work_email"), p.get("personal_email"), p.get("header_email")) if e))
    phones = list(dict.fromkeys(m for m in (p.get("mobile"), p.get("header_mobile"), p.get("office_number")) if m))
    return {
        **{k: p.get(k) for k in ("dha_id", "name", "profession", "grade", "specialty", "category_raw", "facility",
                                 "nationality", "license_type", "profile_status", "profile_url", "linkedin", "twitter",
                                 "account_id", "snapshot_date", "work_email", "personal_email", "mobile", "office_number")},
        "emails": emails,
        "phones": phones,
        "specialties": _split(p.get("specialties")),
        "licensed_facilities": [f for f in _split(p.get("licensed_facilities")) if f.lower() != "not licensed"],
        "experience": list(zip(_split(p.get("experience_roles")), _split(p.get("experience_facilities")))),
        "qualifications": _split(p.get("qualifications")),
        "education": _split(p.get("education_institutions")),
        "languages": _split(p.get("languages")),
    }


def add_to_field_force(dha_id: str, area_id: int | None = None) -> dict:
    db = _db()
    p = detail(dha_id)
    if not p:
        raise ValueError("No professional with that DHA ID")
    if p["account_id"]:
        return {"account_id": p["account_id"], "created": False}
    if (p["specialty"] or "").lower().startswith("pharmacist") and p["facility"]:
        # A pharmacist leads to their pharmacy: the client is the pharmacy (found by name, else created).
        hit = db.table("accounts").select("id").eq("type", "pharmacy").ilike("name", p["facility"]).limit(1).execute().data
        account_id = hit[0]["id"] if hit else db.table("accounts").insert({
            "type": "pharmacy", "name": p["facility"], "area_id": area_id,
            "phone": p["phones"][0] if p["phones"] else None, "created_by": None}).execute().data[0]["id"]
        db.table("hcp_professionals").update({"account_id": account_id}).eq("dha_id", dha_id).execute()
        return {"account_id": account_id, "created": not hit, "type": "pharmacy"}
    parent = None
    if p["facility"]:
        hit = db.table("accounts").select("id").eq("type", "hospital").ilike("name", p["facility"]).limit(1).execute().data
        parent = hit[0]["id"] if hit else None
    account = db.table("accounts").insert({
        "type": "doctor",
        "name": p["name"],
        "specialty": p["specialty"] or p["category_raw"],
        "area_id": area_id,
        "parent_id": parent,
        "phone": p["phones"][0] if p["phones"] else None,
        "address": p["facility"],
        "created_by": None,
    }).execute().data[0]
    db.table("hcp_professionals").update({"account_id": account["id"]}).eq("dha_id", dha_id).execute()
    return {"account_id": account["id"], "created": True, "type": "doctor"}
