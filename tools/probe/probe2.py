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
    "it": ["https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv", "https://drive.aifa.gov.it/farmaci/PA_confezioni.csv",
           "https://drive.aifa.gov.it/farmaci/confezioni.csv", "https://www.aifa.gov.it/liste-dei-farmaci",
           "https://www.aifa.gov.it/en-US/web/guest/liste-dei-farmaci"],
    "fr": ["https://base-donnees-publique.medicaments.gouv.fr/telechargement",
           "https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_bdpm.txt",
           "https://base-donnees-publique.medicaments.gouv.fr/telechargement.php?fichier=CIS_bdpm.txt",
           "https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_COMPO_bdpm.txt",
           "https://base-donnees-publique.medicaments.gouv.fr/telechargement.php?fichier=CIS_COMPO_bdpm.txt"],
    "ie": ["https://www.hpra.ie/find-a-medicine/for-human-use/xml-product-listings",
           "https://www.hpra.ie/img/uploaded/swedocuments/latestHumanlist.xml"],
    "be": ["https://medicinesdatabase.be/human-use", "https://medicinesdatabase.be/"],
    "at": ["https://aspregister.basg.gv.at/", "https://aspregister.basg.gv.at/aspregister/faces/aspregister.jspx"],
    "bg": ["https://www.bda.bg/bg/%D1%80%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B8/%D1%80%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B8-%D0%BD%D0%B0-%D0%BB%D0%B5%D0%BA%D0%B0%D1%80%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%B8-%D0%BF%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82%D0%B8"],
    "bh": ["https://www.nhra.bh/Departments/PPR/MediaHandler/GenericHandler/documents/departments/PPR/Medicines/List/PPR_LISTS_Registered%20Medicine%20Price%20List_20260614.xlsx"],
    "om": ["https://www.moh.gov.om/media/zkmlrorx/pharmaceutical-products-list-with-prices-07-07-2026.pdf"],
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
    else:
        show_file(url, r.content, ctype)


for key, urls in TARGETS.items():
    log(f"\n######## {key}")
    for u in urls:
        probe(key, u)
OUT.write_text("\n".join(lines))
