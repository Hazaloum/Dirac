"""Download each registry file and print its shape (headers + sample rows) to tools/data/registries/probe.txt."""
import io
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd
import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"}
OUT = Path("tools/data/registries/probe.txt")
lines: list[str] = []


def log(s=""):
    print(s)
    lines.append(str(s))


def get(url, **kw):
    r = requests.get(url, headers=UA, timeout=180, **kw)
    log(f"GET {url} -> {r.status_code} {len(r.content):,} bytes {r.headers.get('content-type')}")
    r.raise_for_status()
    return r


def find_link(page, pattern):
    html = get(page).text
    m = re.findall(pattern, html)
    log(f"links matching {pattern}: {m[:5]}")
    return m


def show(df, name):
    log(f"== {name}: {len(df):,} rows x {len(df.columns)} cols")
    log("columns: " + " | ".join(map(str, df.columns)))
    for _, row in df.head(3).iterrows():
        log("  " + " | ".join(str(v)[:80] for v in row.values))


def probe_zip(content, name, readers):
    z = zipfile.ZipFile(io.BytesIO(content))
    log(f"{name} zip: " + ", ".join(f"{i.filename} ({i.file_size:,})" for i in z.infolist()[:60]))
    for fname, reader in readers.items():
        matches = [n for n in z.namelist() if re.search(fname, n, re.I)]
        for n in matches[:3]:
            try:
                show(reader(z.open(n)), f"{name}/{n}")
            except Exception as e:
                log(f"  read {n} failed: {e}")


def run(key, fn):
    log(f"\n######## {key}")
    try:
        fn()
    except Exception as e:
        log(f"FAILED {key}: {type(e).__name__}: {e}")


def nl():
    df = pd.read_csv(io.BytesIO(get("https://www.geneesmiddeleninformatiebank.nl/metadata.csv").content), sep="|", dtype=str, nrows=200000)
    show(df, "nl")
    for c in ("SOORT", "AFLEVERSTATUS"):
        if c in df:
            log(f"{c} values: {df[c].value_counts().head(10).to_dict()}")


def pl():
    df = pd.read_excel(io.BytesIO(get("https://rejestry.ezdrowie.gov.pl/api/rpl/medicinal-products/public-pl-report/get-xlsx").content), dtype=str)
    show(df, "pl")
    for c in df.columns:
        if "Rodzaj" in str(c) or "procedury" in str(c):
            log(f"{c} values: {df[c].value_counts().head(10).to_dict()}")


def se():
    links = find_link("https://www.lakemedelsverket.se/sv/om-webbplatsen/oppna-data", r'[^"\']*Lakemedelsprodukter-\d{4}-\d{2}-\d{2}\.xlsx')
    url = links[0] if links else "https://www.lakemedelsverket.se/globalassets/excel/Lakemedelsprodukter-2026-09-05.xlsx"
    if url.startswith("/"):
        url = "https://www.lakemedelsverket.se" + url
    xl = pd.ExcelFile(io.BytesIO(get(url).content))
    log(f"sheets: {xl.sheet_names}")
    df = xl.parse(xl.sheet_names[0], dtype=str)
    show(df, "se")
    for c in ("Registrerings-status", "Försäljningsstatus", "H/V"):
        if c in df:
            log(f"{c} values: {df[c].value_counts().head(10).to_dict()}")


def ro():
    df = pd.read_excel(io.BytesIO(get("https://nomenclator.anm.ro/files/nomenclator.xlsx").content), dtype=str)
    show(df, "ro")


def hu():
    content = get("https://ogyei.gov.hu/generalt_listak/tk_lista.csv").content
    for enc in ("utf-8", "cp1250", "iso-8859-2"):
        try:
            df = pd.read_csv(io.BytesIO(content), sep=";", dtype=str, encoding=enc)
            log(f"encoding {enc} ok")
            break
        except Exception as e:
            log(f"encoding {enc} failed: {e}")
    show(df, "hu")


def bh():
    links = find_link("https://www.nhra.bh/Departments/PPR/?page=102", r'[^"\']*Registered[^"\']*Price[^"\']*\.xlsx')
    url = links[0] if links else "https://www.nhra.bh/Departments/PPR/MediaHandler/GenericHandler/documents/departments/PPR/Medicines/List/PPR_LISTS_Registered%20Medicine%20Price%20List_20260614.xlsx"
    if url.startswith("/"):
        url = "https://www.nhra.bh" + url
    df = pd.read_excel(io.BytesIO(get(url.replace(" ", "%20")).content), dtype=str)
    show(df, "bh")


def es():
    content = get("https://listadomedicamentos.aemps.gob.es/prescripcion.zip").content
    z = zipfile.ZipFile(io.BytesIO(content))
    log("es zip: " + ", ".join(f"{i.filename} ({i.file_size:,})" for i in z.infolist()))
    xml = z.open([n for n in z.namelist() if n.lower().startswith("prescripcion")][0]).read(6000).decode("utf-8", "replace")
    log("Prescripcion.xml head:\n" + xml)
    for n in z.namelist():
        if "PRINCIPIOS" in n or "LABORATORIOS" in n or "SITUACION" in n or "FORMA_FARMACEUTICA" in n:
            log(f"{n} head:\n" + z.open(n).read(1200).decode("utf-8", "replace"))


def cz():
    content = get("https://opendata.sukl.cz/soubory/SOD20260827/DLP20260827.zip").content
    rd = lambda f: pd.read_csv(f, sep=";", dtype=str, encoding="cp1250")
    probe_zip(content, "cz", {r"lecivepripravky": rd, r"organizace": rd, r"stavyreg": rd, r"dlp_latky": rd, r"lecivelatky": rd})


def sk():
    content = get("https://www.sukl.sk/verejne/Zoznam_liekov/zoznam_liekov_aktualny.zip").content
    probe_zip(content, "sk", {r"zoznam_liekov\.xlsx": lambda f: pd.read_excel(io.BytesIO(f.read()), dtype=str),
                              r"firmy": lambda f: pd.read_excel(io.BytesIO(f.read()), dtype=str)})


def us():
    content = get("https://www.fda.gov/media/89850/download?attachment=").content
    rd = lambda f: pd.read_csv(f, sep="\t", dtype=str, encoding="latin-1", on_bad_lines="skip")
    probe_zip(content, "us", {r"^Products\.txt": rd, r"^Applications\.txt": rd, r"^MarketingStatus\.txt": rd, r"MarketingStatus_Lookup": rd})


ALL = {"nl": nl, "pl": pl, "se": se, "ro": ro, "hu": hu, "bh": bh, "es": es, "cz": cz, "sk": sk, "us": us}
for key in (sys.argv[1:] or ALL):
    run(key, ALL[key])
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(lines))
