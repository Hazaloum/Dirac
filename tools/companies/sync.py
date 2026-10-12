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
    rows, start = [], 0
    while True:
        r = requests.get(f"{URL}/rest/v1/company_merge_review?select=*&order=a,b", timeout=300,
                         headers={**HEAD, "Range": f"{start}-{start + 999}"})
        r.raise_for_status()
        page = r.json()
        rows += page
        if len(page) < 1000:
            break
        start += 1000
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "candidates.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0))
    print(f"candidates exported: {len(rows)}")


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
    export_name_map()
