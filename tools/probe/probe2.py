"""BE / AT registry APIs: reproduce the BE xsrf token and try the export endpoints."""
import base64
import hashlib
import hmac
import json
import random
import re
import time
from pathlib import Path

import requests

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
OUT = Path("tools/data/registries/probe2.txt")
lines = []


def log(s=""):
    print(s, flush=True)
    lines.append(str(s))


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def be_token(key):
    jti = str(int(time.time() * 1000) * random.randint(1, 9999))
    exp = int(time.time() + 300)
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64(json.dumps({"a": UA, "exp": exp, "jti": jti}, separators=(",", ":")).encode())
    sig = b64(hmac.new(key.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{sig}.{jti}{exp}"


def main_js(page, base):
    html = requests.get(page, headers={"User-Agent": UA}, timeout=60).text
    src = next(s for s in re.findall(r"""<script[^>]+src=["']([^"']+)["']""", html) if s.startswith("main"))
    return requests.get(base + src, headers={"User-Agent": UA}, timeout=120).text


log("######## be")
s = requests.Session()
s.headers.update({"User-Agent": UA, "Accept-Language": "en", "Accept": "application/json"})
cfg = s.get("https://medicinesdatabase.be/api/config").json()
def get(params):
    r = s.get("https://medicinesdatabase.be/api/products", params=params, headers={"xsrf-token": be_token(cfg["key"])}, timeout=300)
    return r.status_code, r.json() if r.ok else r.text[:200]
code, d = get({"usage": "human"})
log(f"default: rows={d['rows']} n={len(d['data'])} keys={list(d)}")
log("record: " + json.dumps(d["data"][0], ensure_ascii=False)[:3000])
html = requests.get("https://medicinesdatabase.be/human-use", headers={"User-Agent": UA}).text
src = next(x for x in re.findall(r"""<script[^>]+src=["']([^"']+)["']""", html) if x.startswith("main"))
js = requests.get("https://medicinesdatabase.be/" + src, headers={"User-Agent": UA}).text
for m in list(re.finditer(r"basePath\}/products`", js))[:2]:
    log("  ctx: " + js[max(0, m.start() - 2500):m.end() + 50])
first = d["data"][0]["id"]
for params in [{"skip": 20}, {"offset": 20}, {"start": 20}, {"from": 20}, {"pageIndex": 1}, {"pageNumber": 2}, {"p": 2}, {"page": 2}, {"page": 1, "limit": 500}, {"limit": 500, "offset": 20}, {"pageSize": 500, "page": 2}, {"take": 500, "skip": 20}, {"size": 500, "page": 2}]:
    code, x = get({"usage": "human", **params})
    if isinstance(x, dict):
        log(f"{params}: n={len(x['data'])} first_same={x['data'][0]['id'] == first if x['data'] else None}")
    else:
        log(f"{params}: {code} {x}")
OUT.write_text("\n".join(lines))
