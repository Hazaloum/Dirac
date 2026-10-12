"""Company merge review, run by GitHub Actions (no Supabase calls from the chat).

1. If tools/data/companies/decisions.json exists: save each verdict on company_merge_candidates and merge the
   "same" pairs (apply_company_merges), then move the file to decisions_applied/<timestamp>.json.
2. Export the still-unreviewed candidate pairs to tools/data/companies/candidates.json.
Env: SUPABASE_URL, SUPABASE_KEY (service role).
"""
import datetime as dt
import json
import os
from pathlib import Path

import requests

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_KEY"]
HEAD = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
DATA = Path("tools/data/companies")


def apply_decisions():
    f = DATA / "decisions.json"
    if not f.exists():
        return
    decisions = json.loads(f.read_text())
    rows = [{"a": d["a"], "b": d["b"], "verdict": d["verdict"]} for d in decisions]
    for i in range(0, len(rows), 500):
        r = requests.post(f"{URL}/rest/v1/company_merge_candidates?on_conflict=a,b", json=rows[i:i + 500],
                          headers={**HEAD, "Prefer": "resolution=merge-duplicates,return=minimal"}, timeout=300)
        r.raise_for_status()
    same = [[d["a"], d["b"]] for d in decisions if d["verdict"] == "same"]
    r = requests.post(f"{URL}/rest/v1/rpc/apply_company_merges", json={"p_pairs": same}, headers=HEAD, timeout=900)
    r.raise_for_status()
    print(f"verdicts saved: {len(rows)}, same: {len(same)}, result: {r.json()}")
    done = DATA / "decisions_applied"
    done.mkdir(exist_ok=True)
    f.rename(done / f"{dt.datetime.utcnow():%Y%m%dT%H%M%S}.json")


def export_candidates():
    """Unreviewed look-alike pairs with countries + example products (SQL registry_company_pairs)."""
    r = requests.post(f"{URL}/rest/v1/rpc/registry_company_pairs", json={"p_verdict": None, "p_limit": 5000}, headers=HEAD, timeout=900)
    r.raise_for_status()
    rows = r.json()
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "candidates.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0))
    print(f"candidates exported: {len(rows)}")


def exhibitors():
    """CPHI exhibitors -> companies: apply exhibitor_decisions.json, export open candidates."""
    f = DATA / "exhibitor_decisions.json"
    if f.exists():
        decisions = json.loads(f.read_text())
        rows = [{"exhibitor_id": d["exhibitor_id"], "company_id": d["company_id"], "verdict": d["verdict"]} for d in decisions]
        for i in range(0, len(rows), 500):
            r = requests.post(f"{URL}/rest/v1/exhibitor_match_candidates?on_conflict=exhibitor_id,company_id", json=rows[i:i + 500],
                              headers={**HEAD, "Prefer": "resolution=merge-duplicates,return=minimal"}, timeout=300)
            r.raise_for_status()
        linked = 0
        for d in decisions:
            if d["verdict"] == "same":
                r = requests.patch(f"{URL}/rest/v1/event_exhibitors?id=eq.{d['exhibitor_id']}&company_id=is.null",
                                   json={"company_id": d["company_id"], "company_match": "ai"}, headers=HEAD, timeout=60)
                r.raise_for_status()
                linked += 1
        print(f"exhibitor verdicts: {len(rows)}, linked: {linked}")
        done = DATA / "decisions_applied"
        done.mkdir(exist_ok=True)
        f.rename(done / f"exhibitors-{dt.datetime.utcnow():%Y%m%dT%H%M%S}.json")
    r = requests.get(f"{URL}/rest/v1/exhibitor_match_candidates?verdict=is.null&select=exhibitor_id,company_id,ex_name,ex_country,co_name,co_countries,sim&order=exhibitor_id",
                     headers={**HEAD, "Range": "0-4999"}, timeout=300)
    r.raise_for_status()
    ex_ids = sorted({x["exhibitor_id"] for x in r.json()})
    desc = {}
    for i in range(0, len(ex_ids), 200):
        q = requests.get(f"{URL}/rest/v1/event_exhibitors?id=in.({','.join(map(str, ex_ids[i:i + 200]))})&select=id,zone,description",
                         headers=HEAD, timeout=300)
        q.raise_for_status()
        desc.update({x["id"]: {"zone": x["zone"], "about": (x["description"] or "")[:300]} for x in q.json()})
    rows = [{**x, **desc.get(x["exhibitor_id"], {})} for x in r.json()]
    (DATA / "exhibitor_candidates.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0))
    print(f"exhibitor candidates exported: {len(rows)}")


def export_name_map():
    """Backup of raw company name -> company, as a CSV in the repo."""
    import csv
    rows, start = [], 0
    while True:
        r = requests.get(f"{URL}/rest/v1/company_name_map?select=raw_name,raw_name_lower,company_id,company_name,method,confidence,company_countries&order=company_name,raw_name_lower",
                         headers={**HEAD, "Range": f"{start}-{start + 999}"}, timeout=300)
        r.raise_for_status()
        page = r.json()
        rows += page
        if len(page) < 1000:
            break
        start += 1000
    with open(DATA / "company_name_map.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"name map exported: {len(rows)}")


if __name__ == "__main__":
    apply_decisions()
    export_candidates()
    exhibitors()
    export_name_map()
