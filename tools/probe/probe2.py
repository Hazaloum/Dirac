"""Find the JSON APIs behind the Belgian (medicinesdatabase.be) and Austrian (medikamente.basg.gv.at) registry apps."""
import re
from pathlib import Path

import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"}
OUT = Path("tools/data/registries/probe2.txt")
lines = []


def log(s=""):
    print(s, flush=True)
    lines.append(str(s))


def js_contexts(js, pat, n=60, width=160):
    for m in list(re.finditer(pat, js))[:n]:
        log("    ..." + js[max(0, m.start() - width):m.end() + width].replace("\n", " ") + "...")


for name, page, base in [("be", "https://medicinesdatabase.be/human-use", "https://medicinesdatabase.be/"),
                         ("at", "https://medikamente.basg.gv.at/de/medicinal-products/", "https://medikamente.basg.gv.at/de/")]:
    log(f"\n######## {name}")
    html = requests.get(page, headers=UA, timeout=60).text
    for src in re.findall(r"""<script[^>]+src=["']([^"']+)["']""", html):
        if not src.startswith("main"):
            continue
        js = requests.get(base + src, headers=UA, timeout=120).text
        log(f"  {src}: {len(js):,} chars")
        js_contexts(js, r"""["'`][^"'`]{0,40}/api[^"'`]{0,80}["'`]""")
        js_contexts(js, r"(?i)export|csv|xlsx", n=25, width=120)
    for path in ["api/config", "api/resources", "api/strings"]:
        try:
            r = requests.get(base.replace("/de/", "/") + path, headers=UA, timeout=60)
            log(f"  GET {path} -> {r.status_code} {r.headers.get('content-type')} {r.text[:1500]}")
        except Exception as e:
            log(f"  GET {path} failed {e}")
OUT.write_text("\n".join(lines))
