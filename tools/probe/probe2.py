"""BE / AT registry APIs: show code around the export calls and try them."""
import json
import re
from pathlib import Path

import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"}
OUT = Path("tools/data/registries/probe2.txt")
lines = []


def log(s=""):
    print(s, flush=True)
    lines.append(str(s))


def ctx(js, pat, n=8, width=700):
    for m in list(re.finditer(pat, js))[:n]:
        log("    >>> " + js[max(0, m.start() - width):m.end() + width].replace("\n", " "))


def main_js(page, base):
    html = requests.get(page, headers=UA, timeout=60).text
    src = next(s for s in re.findall(r"""<script[^>]+src=["']([^"']+)["']""", html) if s.startswith("main"))
    return requests.get(base + src, headers=UA, timeout=120).text


log("######## be")
js = main_js("https://medicinesdatabase.be/human-use", "https://medicinesdatabase.be/")
ctx(js, r"products/export", 3)
ctx(js, r"getT\(\)\{", 3)
ctx(js, r"exportProducts|productsExport", 4, 500)
log("######## at")
js = main_js("https://medikamente.basg.gv.at/de/medicinal-products/", "https://medikamente.basg.gv.at/de/")
ctx(js, r"rootUrl\s*=", 4, 300)
ctx(js, r"exportMedicalItems\$Csv\(", 4, 900)
ctx(js, r"MedicationSearch|searchMedicalItems\(", 4, 600)
s = requests.Session()
s.headers.update(UA)
for root in ["https://medikamente.basg.gv.at", "https://medikamente.basg.gv.at/de", "https://medikamente.basg.gv.at/backend"]:
    for typ in ["CSV", "csv", None]:
        try:
            r = s.post(root + "/api/v1/medication/export", params={"type": typ} if typ else {}, json={},
                       headers={"Accept": "text/csv", "Accept-Language": "de"}, timeout=180)
            log(f"POST {root}/api/v1/medication/export type={typ} -> {r.status_code} {r.headers.get('content-type')} {len(r.content):,} {r.text[:600]!r}")
        except Exception as e:
            log(f"POST {root} failed {e}")
    try:
        r = s.get(root + "/api/v1/medication/last-update", timeout=60)
        log(f"GET {root}/api/v1/medication/last-update -> {r.status_code} {r.text[:300]!r}")
    except Exception as e:
        log(f"GET failed {e}")
OUT.write_text("\n".join(lines))
