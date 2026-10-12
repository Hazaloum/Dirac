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
for pat in [r"productsSearchProducts\(", r"productsExportProducts\(", r"usage:\"human"]:
    for m in list(re.finditer(pat, js))[1:3]:
        log(f"  ctx {pat}: " + js[max(0, m.start() - 500):m.end() + 900])
s = requests.Session()
s.headers.update({"User-Agent": UA, "Accept-Language": "en"})
cfg = s.get("https://medicinesdatabase.be/api/config").json()
for path, params, acc in [("/api/products/export", {"usage": "human"}, "text/html"), ("/api/products/export", {"usage": "HUMAN_USE"}, "text/html"),
                          ("/api/products/export", {"term": "a", "usage": "human"}, "*/*"), ("/api/products", {"usage": "human"}, "application/json"),
                          ("/api/products/search", {"usage": "human"}, "application/json")]:
    r = s.get("https://medicinesdatabase.be" + path, params=params, headers={"xsrf-token": be_token(cfg["key"]), "Accept": acc}, timeout=300)
    log(f"GET {path} {params} -> {r.status_code} {r.headers.get('content-type')} {r.headers.get('content-disposition')} {len(r.content):,} {r.content[:300]!r}")

log("######## at")
js = main_js("https://medikamente.basg.gv.at/de/medicinal-products/", "https://medikamente.basg.gv.at/de/")
for pat in [r"rootUrl=i", r"\.rootUrl=", r"assets/[a-zA-Z_-]+\.json", r"environment"]:
    for m in list(re.finditer(pat, js))[:3]:
        log(f"  ctx {pat}: " + js[max(0, m.start() - 700):m.end() + 300])
for u in ["https://medikamente.basg.gv.at/de/assets/config.json", "https://medikamente.basg.gv.at/de/assets/env.json",
          "https://medikamente.basg.gv.at/assets/config.json", "https://medikamente.basg.gv.at/de/config.json"]:
    r = requests.get(u, headers={"User-Agent": UA}, timeout=60)
    log(f"GET {u} -> {r.status_code} {r.headers.get('content-type')} {r.text[:400]!r}")
OUT.write_text("\n".join(lines))
