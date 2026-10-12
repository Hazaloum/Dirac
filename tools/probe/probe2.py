"""Probe the not-yet-loaded registries (IT, FR, BE, AT, IE, BG, BH, OM): fetch each candidate URL, list data links on
HTML pages, show the head of data files. Output: tools/data/registries/probe2.txt"""
import gzip
import io
import re
import urllib.parse as up
from pathlib import Path

import pandas as pd
import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"}
OUT = Path("tools/data/registries/probe2.txt")
lines = []


def log(s=""):
    print(s, flush=True)
    lines.append(str(s))


DATA = re.compile(r"""href=["']([^"']+?(?:\.csv|\.xlsx?|\.xml|\.zip|\.gz|\.txt|\.pdf|export[^"']*|download[^"']*|telechargement[^"']*|fichier=[^"']*))["']""", re.I)

TARGETS = {
    "ie": ["https://assets.hpra.ie/products/xml/latestHumanlist.xml"],
    "bg": ["https://www.bda.bg/images/stories/documents/registers/Register_Lekarstva/IAL_Register_08_2026.xlsx"],
    "be": ["https://medicinesdatabase.be/human-use"],
    "at": ["https://medikamente.basg.gv.at/de/medicinal-products/"],
}


def show_file(url, c, ctype):
    name = url.lower()
    if c[:2] == b"\x1f\x8b":
        c = gzip.decompress(c)
    if c[:4] == b"PK\x03\x04" and (".xls" in name or "spreadsheet" in ctype):
        x = pd.read_excel(io.BytesIO(c), sheet_name=None, nrows=4)
        for sh, df in x.items():
            log(f"  sheet {sh}: cols {list(df.columns)}")
            for _, r in df.head(3).iterrows():
                log("    " + " | ".join(str(v)[:60] for v in r.values))
        return
    if c[:4] == b"%PDF":
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(c)) as pdf:
                log(f"  pdf pages: {len(pdf.pages)}")
                for t in (pdf.pages[0].extract_tables() or [])[:1]:
                    for r in t[:6]:
                        log("    " + " | ".join(str(v)[:40] for v in r))
                log("  text: " + (pdf.pages[1].extract_text() or "")[:800].replace("\n", " // "))
        except Exception as e:
            log(f"  pdf read failed: {e}")
        return
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            t = c[:4000].decode(enc)
            break
        except UnicodeDecodeError:
            continue
    log(f"  head ({enc}):")
    if t.lstrip().startswith("<"):
        log("    " + t[:3000].replace("\n", " "))
        return
    for l in t.splitlines()[:6]:
        log("    " + l[:300])


def probe(key, url):
    try:
        r = requests.get(url, headers=UA, timeout=180)
    except Exception as e:
        log(f"GET {url} -> ERROR {type(e).__name__}: {e}")
        return
    ctype = r.headers.get("content-type", "")
    log(f"GET {url} -> {r.status_code} {len(r.content):,} bytes {ctype} final={r.url}")
    if r.status_code != 200:
        log("  body: " + r.text[:300].replace("\n", " "))
        return
    if "html" in ctype:
        links = sorted({up.urljoin(r.url, h) for h in DATA.findall(r.text)})
        log(f"  data links ({len(links)}):")
        for l in links[:60]:
            log("    " + l)
        forms = re.findall(r"<form[^>]*>", r.text)[:5]
        log(f"  forms: {forms}")
        buttons = re.findall(r"""(?:id|name)=["']([^"']*(?:export|Export|download|csv|CSV)[^"']*)["']""", r.text)[:20]
        log(f"  export-ish ids: {buttons}")
        log("  html: " + r.text[:1500].replace("\n", " "))
        for src in re.findall(r"""<script[^>]+src=["']([^"']+)["']""", r.text)[:10]:
            js = requests.get(up.urljoin(r.url, src), headers=UA, timeout=120).text
            apis = sorted(set(re.findall(r"""["'`]((?:https?://|/)[^"'`\s]*(?:api|export|download|csv|search)[^"'`\s]*)["'`]""", js, re.I)))
            log(f"  script {src} {len(js):,} chars, api-ish strings: {apis[:40]}")
    else:
        show_file(url, r.content, ctype)


for key, urls in TARGETS.items():
    log(f"\n######## {key}")
    for u in urls:
        probe(key, u)
OUT.write_text("\n".join(lines))
