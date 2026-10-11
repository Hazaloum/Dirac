"""Load the built registry chunks into Supabase via the registry_* SQL functions (PostgREST RPC).

The database fetches each chunk itself from raw.githubusercontent.com at the given commit.
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


def key_role():
    import base64
    try:
        payload = KEY.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("role", "?")
    except Exception:
        return "non-JWT key"


def main(keys):
    print("Supabase key role:", key_role(), flush=True)
    manifest = json.loads(Path("tools/data/registries/manifest.json").read_text())
    for key in keys or list(manifest):
        m = manifest[key]
        print(f"## {key}: {m['rows']:,} rows in {m['parts']} parts", flush=True)
        for part in range(m["parts"]):
            print("  ", rpc("registry_load_part", p_base=BASE, p_key=key, p_part=part), flush=True)
        print("  match:", rpc("registry_finish_load", p_registry=key), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
