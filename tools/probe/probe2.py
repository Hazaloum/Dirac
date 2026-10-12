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
js = main_js("https://medicinesdatabase.be/human-use", "https://medicinesdatabase.be/")
for m in list(re.finditer(r"products/export", js))[:1]:
    log("  ctx: " + js[m.start() - 3000:m.end() + 100])
s = requests.Session()
s.headers.update({"User-Agent": UA, "Accept-Language": "en"})
cfg = s.get("https://medicinesdatabase.be/api/config").json()
for params in [{}, {"usage": "human"}, {"usage": "human", "format": "csv"}]:
    r = s.get("https://medicinesdatabase.be/api/products/export", params=params, headers={"xsrf-token": be_token(cfg["key"])}, timeout=300)
    log(f"GET products/export {params} -> {r.status_code} {r.headers.get('content-type')} {r.headers.get('content-disposition')} {len(r.content):,} {r.content[:400]!r}")

log("######## at")
js = main_js("https://medikamente.basg.gv.at/de/medicinal-products/", "https://medikamente.basg.gv.at/de/")
for pat in [r"aspregisterservice", r"exportMedicalItems\$Csv\(\{", r"ExportType|exportType"]:
    for m in list(re.finditer(pat, js))[:3]:
        log(f"  ctx {pat}: " + js[max(0, m.start() - 600):m.end() + 600])
for root in ["https://medikamente.basg.gv.at/aspregisterservice", "https://aspregister.basg.gv.at/aspregisterservice"]:
    for typ in ["CSV", "EXCEL", None]:
        try:
            r = requests.post(root + "/api/v1/medication/export", params={"type": typ} if typ else {}, json={},
                              headers={"User-Agent": UA, "Accept": "text/csv", "Accept-Language": "de", "Content-Type": "application/json"}, timeout=300)
            log(f"POST {root} type={typ} -> {r.status_code} {r.headers.get('content-type')} {len(r.content):,} {r.content[:500]!r}")
        except Exception as e:
            log(f"POST {root} failed {e}")
    try:
        r = requests.get(root + "/api/v1/medication/last-update", headers={"User-Agent": UA}, timeout=60)
        log(f"GET {root}/last-update -> {r.status_code} {r.text[:300]!r}")
    except Exception as e:
        log(f"GET failed {e}")
OUT.write_text("\n".join(lines))
