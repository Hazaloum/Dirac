"""One-off: load the DHA professional register (Sheryan medical directory export) into Supabase hcp_professionals.

Downloads the two xlsx files from the Supabase Storage bucket `imports` (made public only for the run), parses them
and sends rows to the SQL function hcp_import_chunk (security definer, only open while the `hcp_dha` row in
import_switches is in date; the table itself is closed to the anon key).
The ID index is loaded first (every professional), then the master profiles add the details and contacts.
No personal data is written to the repository.
"""
import json
import os
import sys
import urllib.request

import pandas as pd

URL, KEY = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_KEY"]
SNAPSHOT = "2026-09-22"
FILES = {"index": f"DHA_medical_registry_ID_index_{SNAPSHOT}.xlsx",
         "master": f"DHA_medical_registry_master_profiles_{SNAPSHOT}.xlsx"}
GRADES = ["Senior Consultant", "Consultant", "Senior Specialist", "Specialist", "Assistant Specialist",
          "General Practitioner", "General Dentist", "Senior Registrar", "Registrar", "Resident", "Intern"]


def fetch(name):
    path = f"/tmp/{name}"
    with urllib.request.urlopen(f"{URL}/storage/v1/object/public/imports/{name}", timeout=300) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def split_category(raw):
    """'Physician-Specialist Internal Medicine' -> ('Physician', 'Specialist', 'Internal Medicine')."""
    raw = (raw or "").strip()
    if not raw:
        return None, None, None
    profession, _, role = raw.partition("-")
    role = role.strip()
    grade = next((g for g in GRADES if role.lower().startswith(g.lower())), None)
    specialty = role[len(grade):].strip() if grade else role
    if grade in ("General Practitioner", "General Dentist") and not specialty:
        specialty = grade
    return profession.strip() or None, grade, specialty or None


def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return None if not s or s.lower() == "nan" else s


def num(v):
    v = clean(v)
    try:
        return int(float(v)) if v is not None else None
    except ValueError:
        return None


def send(rows):
    body = json.dumps({"p_rows": rows}).encode()
    req = urllib.request.Request(f"{URL}/rest/v1/rpc/hcp_import_chunk", data=body, method="POST",
                                 headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                                          "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return int(r.read())
        except Exception as e:
            if attempt == 3:
                raise
            print("retry", e)


def load(rows, label):
    total = 0
    for i in range(0, len(rows), 1000):
        total += send(rows[i:i + 1000])
    print(f"{label}: {len(rows)} rows sent, {total} upserted")


def main():
    idx = pd.read_excel(fetch(FILES["index"]), dtype=str)
    print("index columns:", list(idx.columns), len(idx))
    rows = []
    for _, r in idx.iterrows():
        cat = clean(r.get("Category or Specialty (Raw)"))
        prof, grade, spec = split_category(cat)
        rows.append({"dha_id": clean(r.get("DHA Unique ID")), "name": clean(r.get("Name (Raw)")), "category_raw": cat,
                     "profession": prof, "grade": grade, "specialty": spec,
                     "license_type": clean(r.get("License Type Code (Raw)")), "facility": clean(r.get("Facility (Raw)")),
                     "license_count": num(r.get("License Count Reported")),
                     "additional_facility_count": num(r.get("Additional Facility Count Reported")),
                     "profile_url": clean(r.get("Profile URL")), "snapshot_date": SNAPSHOT})
    load(rows, "index")

    m = pd.read_excel(fetch(FILES["master"]), dtype=str)
    print("master columns:", list(m.columns), len(m))
    cols = {"Profile Status": "profile_status", "Nationality": "nationality", "Directory License Type Code": "license_type",
            "Directory Facility": "facility", "Specialties": "specialties", "Licence Numbers": "licence_numbers",
            "Licence Statuses": "licence_statuses", "Licensed Facilities": "licensed_facilities",
            "Experience Roles": "experience_roles", "Experience Facilities": "experience_facilities",
            "Experience Licence Numbers": "experience_licence_numbers", "Experience Dates and Locations": "experience_dates",
            "Qualifications": "qualifications", "Education Institutions": "education_institutions",
            "Education Details": "education_details", "Languages and Proficiency": "languages",
            "Personal Email": "personal_email", "Work Email": "work_email", "Mobile Number": "mobile",
            "Office Number": "office_number", "LinkedIn": "linkedin", "Twitter": "twitter",
            "Header Email": "header_email", "Header Mobile": "header_mobile", "Profile URL": "profile_url"}
    rows = []
    for _, r in m.iterrows():
        cat = clean(r.get("Directory Category or Specialty"))
        prof, grade, spec = split_category(cat)
        row = {"dha_id": clean(r.get("DHA Unique ID")), "name": clean(r.get("Name")), "category_raw": cat,
               "profession": prof, "grade": grade, "specialty": spec, "snapshot_date": SNAPSHOT,
               "license_count": num(r.get("Directory License Count")),
               "additional_facility_count": num(r.get("Directory Additional Facility Count"))}
        row.update({dst: clean(r.get(src)) for src, dst in cols.items()})
        rows.append(row)
    load(rows, "master")


if __name__ == "__main__":
    sys.exit(main())
