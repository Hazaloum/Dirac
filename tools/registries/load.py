"""Sync the built registry chunks into Supabase as a diff (PostgREST RPC).

Per registry: registry_sync_begin (new run row) -> registry_sync_part per chunk (the database fetches it from
raw.githubusercontent.com at the given commit) -> registry_sync_apply (new / changed / withdrawn, change log,
molecule + company matching, look-alike pairs for new companies). A download that looks broken (fewer than half
the products on file) is skipped by the database, so a bad month never withdraws a whole country.
Env: SUPABASE_URL, SUPABASE_KEY (service role), SHA (commit holding tools/data/registries).
"""
import json
import os
import sys
import time
from pathlib import Path

import requests

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_KEY"]
SHA = os.environ["SHA"]
BASE = f"https://raw.githubusercontent.com/Hazaloum/Dirac/{SHA}/tools/data/registries"
HEAD = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def rpc(fn, **params):
    for attempt in range(4):
        r = requests.post(f"{URL}/rest/v1/rpc/{fn}", headers=HEAD, json=params, timeout=900)
        if r.ok:
            return r.json()
        print(f"  {fn} {params} -> {r.status_code} {r.text[:400]}", flush=True)
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"{fn} failed")


def main(keys):
    manifest = json.loads(Path("tools/data/registries/manifest.json").read_text())
    built = json.loads(Path("tools/data/registries/built.json").read_text()) if Path("tools/data/registries/built.json").exists() else None
    keys = keys or built or list(manifest)
    summary = []
    for key in keys:
        if key not in manifest:
            print(f"## {key}: not in manifest, skipped", flush=True)
            continue
        m = manifest[key]
        print(f"## {key}: {m['rows']:,} rows in {m['parts']} parts", flush=True)
        try:
            run = rpc("registry_sync_begin", p_base=BASE, p_key=key)
            for part in range(m["parts"]):
                rpc("registry_sync_part", p_run=run, p_url=f"{BASE}/{key}/part-{part:03d}.json", p_part=part)
            res = rpc("registry_sync_apply", p_run=run)
            print("  ", json.dumps(res)[:600], flush=True)
            summary.append(f"{key}: {res.get('status')} +{res.get('added', 0)} new, {res.get('changed', 0)} changed, "
                           f"{res.get('withdrawn', 0)} withdrawn, {res.get('new_companies', 0)} new companies")
        except Exception as e:
            print(f"  FAILED {key}: {e}", flush=True)
            summary.append(f"{key}: FAILED {e}")
    print("\n".join(["## summary", *summary]), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
