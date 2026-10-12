"""Download each registry, map it to the shared registrations row shape, write JSON chunks.

Row: {record_key, registration_no, product_name, company_raw, ingredients (list or text),
      strength_raw, form_raw, atc, status}
Output: tools/data/registries/<key>/part-NNN.json, tools/data/registries/manifest.json,
        tools/data/registries/translations/part-000.json (Latin/Czech -> English substance names).
Packs are collapsed: one row per product x strength x form.
"""
import datetime as dt
import io
import json
import re
import sys
import traceback
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pandas as pd
import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"}
OUT = Path("tools/data/registries")
CHUNK = 8000
TODAY = dt.date.today().isoformat()
LOG: list[str] = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


def get(url):
    r = requests.get(url, headers=UA, timeout=300)
    log(f"GET {url} -> {r.status_code} {len(r.content):,} bytes")
    r.raise_for_status()
    return r.content


def s(v):
    """Clean cell -> str ('' for NaN/None)."""
    if v is None:
        return ""
    if isinstance(v, float) and pd.isna(v):
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def atc_code(v):
    m = re.match(r"\s*([A-Z][0-9]{2}[A-Z]{0,2}[0-9]{0,2})", s(v).upper())
    return m.group(1) if m else ""


def dedupe(rows):
    seen, out = set(), []
    for r in rows:
        if r["record_key"] and r["record_key"] not in seen:
            seen.add(r["record_key"])
            out.append(r)
    return out


EU_PACK = re.compile(r"(EU/\d+/\d+/\d+)/\d+")


def row(record_key, registration_no, product_name, company_raw, ingredients, strength_raw="", form_raw="", atc="", status="active"):
    # EU (centralised) numbers carry a pack suffix (EU/1/15/1029/025): drop it so packs collapse into one product
    return {"record_key": EU_PACK.sub(r"\1", s(record_key)), "registration_no": EU_PACK.sub(r"\1", s(registration_no)), "product_name": s(product_name),
            "company_raw": s(company_raw), "ingredients": ingredients if isinstance(ingredients, list) else s(ingredients),
            "strength_raw": s(strength_raw), "form_raw": s(form_raw), "atc": atc_code(atc), "status": status}


# ---------------------------------------------------------------- registries

def nl():
    df = pd.read_csv(io.BytesIO(get("https://www.geneesmiddeleninformatiebank.nl/metadata.csv")), sep="|", dtype=str)
    df = df[df["SOORT"].fillna("").str.strip() != "RVH"]          # drop homeopathic
    rows = [row(r.REGISTRATIENUMMER, r.REGISTRATIENUMMER, r.PRODUCTNAAM, r.HANDELSVERGUNNINGHOUDER, s(r.WERKZAMESTOFFEN),
                r.POTENTIE, r.FARMACEUTISCHEVORM, r.ATC) for r in df.itertuples()]
    return dict(country="NL", name="CBG-MEB medicines register", source_url="https://www.geneesmiddeleninformatiebank.nl/metadata.csv",
                company_field="HANDELSVERGUNNINGHOUDER (MAH)"), rows


def pl():
    df = pd.read_excel(io.BytesIO(get("https://rejestry.ezdrowie.gov.pl/api/rpl/medicinal-products/public-pl-report/get-xlsx")), dtype=str)
    df = df[df["Rodzaj preparatu"] == "Ludzki"]
    rows = [row(r["Identyfikator Produktu Leczniczego"], r["Numer pozwolenia"], r["Nazwa Produktu Leczniczego"], r["Podmiot odpowiedzialny"],
                s(r["Nazwa powszechnie stosowana"]), r["Moc"], r["Postać farmaceutyczna"], r["Kod ATC"]) for _, r in df.iterrows()]
    return dict(country="PL", name="URPL medicinal products register", source_url="https://rejestry.ezdrowie.gov.pl/api/rpl/medicinal-products/public-pl-report/get-xlsx",
                company_field="Podmiot odpowiedzialny (MAH)"), rows


def ro():
    df = pd.read_excel(io.BytesIO(get("https://nomenclator.anm.ro/files/nomenclator.xlsx")), dtype=str)
    rows = []
    for _, r in df.iterrows():
        app = re.sub(r"/\d+$", "", s(r["Nr / data ambalaj APP"]))
        holder = re.sub(r"\s+-\s+[A-Z .]+$", "", s(r["Firma / tara detinatoare APP"]))       # drop "- AUSTRIA"
        rows.append(row(f"{app}|{s(r['Concentratie'])}|{s(r['Forma farmaceutica'])}", app, r["Denumire comerciala"], holder,
                        s(r["DCI"]), r["Concentratie"], r["Forma farmaceutica"], r["Cod ATC"]))
    return dict(country="RO", name="ANMDMR nomenclator", source_url="https://nomenclator.anm.ro/files/nomenclator.xlsx",
                company_field="Firma / tara detinatoare APP (holder)"), rows


def hu():
    df = pd.read_csv(io.BytesIO(get("https://ogyei.gov.hu/generalt_listak/tk_lista.csv")), sep=";", dtype=str, encoding="cp1250")
    df.columns = [c.strip() for c in df.columns]
    rows = []
    for _, r in df.iterrows():
        tk = re.sub(r"/\d+$", "", s(r["TK-szám"]))
        rows.append(row(f"{tk}|{s(r['Név'])}", tk, r["Név"], s(r["Forg_Eng_Jog"]).lstrip("'"), s(r["INN"]),
                        "", "", s(r["ATC kód 1/ATC kód 2"]).split("/")[0]))
    return dict(country="HU", name="OGYÉI medicines database", source_url="https://ogyei.gov.hu/generalt_listak/tk_lista.csv",
                company_field="Forg_Eng_Jog (MAH)"), rows


def _xml_dict(z, fname, key_tag, val_tag):
    out = {}
    for _, el in ET.iterparse(z.open(fname)):
        tag = el.tag.split("}")[-1]
        if len(el) and any(c.tag.split("}")[-1] == key_tag for c in el):
            vals = {c.tag.split("}")[-1]: (c.text or "").strip() for c in el}
            out[vals.get(key_tag)] = vals.get(val_tag, "")
            el.clear()
    return out


def es():
    z = zipfile.ZipFile(io.BytesIO(get("https://listadomedicamentos.aemps.gob.es/prescripcion.zip")))
    names = {n.upper(): n for n in z.namelist()}
    pa = _xml_dict(z, names["DICCIONARIO_PRINCIPIOS_ACTIVOS.XML"], "nroprincipioactivo", "principioactivo")
    labs = _xml_dict(z, names["DICCIONARIO_LABORATORIOS.XML"], "codigolaboratorio", "laboratorio")
    forms = _xml_dict(z, names["DICCIONARIO_FORMA_FARMACEUTICA.XML"], "codigoformafarmaceutica", "formafarmaceutica")
    log(f"es dictionaries: {len(pa)} substances, {len(labs)} labs, {len(forms)} forms")
    rows = []
    main = next(n for n in z.namelist() if n.lower().startswith("prescripcion"))
    for _, el in ET.iterparse(z.open(main)):
        if el.tag.split("}")[-1] != "prescription":
            continue
        g = lambda t: (el.findtext(f".//{{*}}{t}") or "").strip()
        ingredients = [pa.get((c.findtext("{*}cod_principio_activo") or "").strip(), "") for c in el.iter() if c.tag.endswith("composicion_pa")]
        sit = g("cod_sitreg_presen") or g("cod_sitreg")
        status = "active" if sit == "1" else "withdrawn" if sit in ("3", "4") else "unknown"
        rows.append(row(g("nro_definitivo"), g("nro_definitivo"), re.sub(r",[^,]*$", "", g("des_prese")) or g("des_nomco"),
                        labs.get(g("laboratorio_titular"), g("laboratorio_titular")), [i for i in ingredients if i],
                        g("des_dosific"), forms.get(g("cod_forfar"), ""), g("cod_atc"), status))
        el.clear()
    # one authorisation number = one product; prefer an active presentation
    rows.sort(key=lambda r: r["status"] != "active")
    return dict(country="ES", name="AEMPS CIMA Nomenclátor", source_url="https://listadomedicamentos.aemps.gob.es/prescripcion.zip",
                company_field="laboratorio_titular (MAH)"), rows


CZ_TRANSLATIONS: list[dict] = []


def cz():
    z = zipfile.ZipFile(io.BytesIO(get("https://opendata.sukl.cz/soubory/SOD20260827/DLP20260827.zip")))
    rd = lambda n: pd.read_csv(z.open(n), sep=";", dtype=str, encoding="cp1250")
    lp, org, latky, slozeni, stavy = rd("dlp_lecivepripravky.csv"), rd("dlp_organizace.csv"), rd("dlp_latky.csv"), rd("dlp_slozeni.csv"), rd("dlp_stavyreg.csv")
    log("cz stavyreg:", stavy.to_dict("records"))
    log("cz slozeni columns:", list(slozeni.columns), slozeni.head(3).to_dict("records"))
    en = {s(r.KOD_LATKY): s(r.NAZEV_EN) or s(r.NAZEV_INN) for r in latky.itertuples()}
    for r in latky.itertuples():
        for foreign in (s(r.NAZEV_INN), s(r.NAZEV)):
            if foreign and s(r.NAZEV_EN) and foreign.lower() != s(r.NAZEV_EN).lower():
                CZ_TRANSLATIONS.append({"alias": foreign, "english": s(r.NAZEV_EN)})
    # active substances per product code (S = "L" active substance, "X" excipient)
    act = slozeni[slozeni["S"].fillna("") == "L"]
    ing = act.groupby("KOD_SUKL")["KOD_LATKY"].apply(lambda xs: [en.get(s(x), "") for x in xs]).to_dict()
    orgs = {(s(r.ZKR_ORG), s(r.ZEM)): s(r.NAZEV) for r in org.itertuples()}
    rows = []
    for r in lp.itertuples():
        reg = s(r.REG)
        status = "active" if reg in ("R", "B", "V", "F") else "withdrawn" if reg in ("C", "Z", "N", "Y") else "unknown"
        rows.append(row(f"{s(r.RC)}|{s(r.SILA)}|{s(r.FORMA)}", r.RC, r.NAZEV, orgs.get((s(r.DRZ), s(r.ZEMDRZ)), s(r.DRZ)),
                        [i for i in ing.get(s(r.KOD_SUKL), []) if i], r.SILA, r.FORMA, r.ATC_WHO, status))
    rows.sort(key=lambda r: r["status"] != "active")
    return dict(country="CZ", name="SÚKL DLP medicines database", source_url="https://opendata.sukl.cz/soubory/SOD20260827/DLP20260827.zip",
                company_field="DRZ (MAH)"), rows


def sk():
    z = zipfile.ZipFile(io.BytesIO(get("https://www.sukl.sk/verejne/Zoznam_liekov/zoznam_liekov_aktualny.zip")))
    df = pd.read_excel(io.BytesIO(z.read("zoznam_liekov.xlsx")), dtype=str)
    firmy = pd.read_excel(io.BytesIO(z.read("firmy.xls")), dtype=str)
    names = {s(r.fir_kod): s(r.fir_nazov) for r in firmy.itertuples()}
    rows = [row(f"{s(r['Registračné číslo'])}|{s(r['lie_sila'])}|{s(r['form_kod'])}", r["Registračné číslo"], r["Názov"],
                names.get(s(r["Kód držiteľa"]), s(r["Kód držiteľa"])), s(r["atc_nazov_sk"]), r["lie_sila"], r["form_kod"], r["ATC kód"])
            for _, r in df.iterrows()]
    return dict(country="SK", name="ŠÚKL list of medicines", source_url="https://www.sukl.sk/verejne/Zoznam_liekov/zoznam_liekov_aktualny.zip",
                company_field="Kód držiteľa (MAH)"), rows


def se():
    html = get("https://www.lakemedelsverket.se/sv/om-webbplatsen/oppna-data").decode("utf-8", "replace")
    links = re.findall(r"/globalassets/excel/Lakemedelsprodukter-\d{4}-\d{2}-\d{2}\.xlsx", html)
    log("se links:", links[:3])
    url = "https://www.lakemedelsverket.se" + (links[0] if links else "/globalassets/excel/Lakemedelsprodukter-2026-09-05.xlsx")
    xl = pd.ExcelFile(io.BytesIO(get(url)))
    df = xl.parse(xl.sheet_names[0], dtype=str)
    log("se columns:", list(df.columns))
    if "H/V" in df:
        df = df[df["H/V"].fillna("").str.upper().str.startswith("HUM")]
    rows = []
    for _, r in df.iterrows():
        reg, sale = s(r.get("Registrerings-status")).lower(), s(r.get("Försäljningsstatus")).lower()
        status = "withdrawn" if ("avregistrerad" in reg or "återkallad" in reg) else "active" if "godkänd" in reg or "registrerad" in reg else "unknown"
        rows.append(row(r.get("NPL-id") or r.get("MT-nummer"), r.get("MT-nummer"), r.get("Namn"), r.get("Innehavare"),
                        s(r.get("Verksamt ämne (förenklat)")) or s(r.get("Verksamt ämne")), r.get("Styrka"), r.get("Form"), r.get("ATC-kod"), status))
    return dict(country="SE", name="Läkemedelsverket medicinal products", source_url=url, company_field="Innehavare (MAH)"), rows


def us():
    z = zipfile.ZipFile(io.BytesIO(get("https://download.open.fda.gov/drug/drugsfda/drug-drugsfda-0001-of-0001.json.zip")))
    data = json.loads(z.read(z.namelist()[0]))
    rows = []
    for app in data["results"]:
        for p in app.get("products", []):
            ms = s(p.get("marketing_status")).lower()
            status = "withdrawn" if "discontinued" in ms else "active" if ms in ("prescription", "over-the-counter") else "unknown"
            rows.append(row(f"{app.get('application_number')}|{p.get('product_number')}", app.get("application_number"), p.get("brand_name"),
                            app.get("sponsor_name"), [s(i.get("name")) for i in p.get("active_ingredients", [])],
                            "; ".join(s(i.get("strength")) for i in p.get("active_ingredients", [])), p.get("dosage_form"), "", status))
    rows.sort(key=lambda r: r["status"] != "active")
    return dict(country="US", name="Drugs@FDA (openFDA)", source_url="https://download.open.fda.gov/drug/drugsfda/drug-drugsfda-0001-of-0001.json.zip",
                company_field="sponsor_name (applicant)"), rows


# ---------------------------------------------------------------- foreign INN -> English (FR / IT / OM)
SALT_WORDS = set("""chlorhydrate dichlorhydrate cloridrato dicloridrato idrocloruro hydrochloride dihydrochloride bromhydrate bromidrato hydrobromide
sulfate solfato maleate maleato fumarate fumarato hemifumarate tartrate tartrato bitartrate citrate citrato acetate acetato succinate succinato
mesilate mesilato mesylate besilate besilato besylate phosphate fosfato sodique disodique sodico disodico sodium disodium potassique potassico
potassium calcique calcico calcium magnesien magnesico magnesium monohydrate monoidrato dihydrate diidrato trihydrate triidrato hemihydrate
emiidrato sesquihydrate pentahydrate heptahydrate anhydre anidro anhydrous base dipropionate dipropionato propionate propionato valerate
valerato furoate furoato nitrate nitrato lactate lattato gluconate gluconato hyclate iclato trometamol arginine lisina lysine sel sels de d di
hydrate idrato hcl monosodique monosodico trisodique""".split())
INN_INDEX: dict[str, str] = {}


def _unaccent(t):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))


def _skel_word(w):
    w = w.replace("ph", "f").replace("th", "t").replace("rh", "r").replace("y", "i").replace("k", "c").replace("ae", "e").replace("oe", "e")
    w = re.sub(r"(.)\1+", r"\1", w)
    w = re.sub(r"(ique|ico|ica)$", "ic", w)
    w = re.sub(r"(ate|ato)$", "at", w)
    return re.sub(r"(?<=...)[aeio]+$", "", w)


def inn_key(t):
    words = re.findall(r"[a-z]+", _unaccent(t).lower())
    acid = [w for w in words if w in ("acide", "acido", "acid")]
    words = [w for w in words if w not in ("acide", "acido", "acid")] + (["acid"] if acid else [])
    return " ".join(_skel_word(w) for w in words)


def load_inns():
    import os
    if INN_INDEX or not os.environ.get("SUPABASE_URL"):
        return
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_KEY"]
    inns, start = [], 0
    while True:
        r = requests.get(f"{url}/rest/v1/molecules?select=inn&order=id", headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": f"{start}-{start + 999}"}, timeout=120)
        r.raise_for_status()
        page = [x["inn"] for x in r.json()]
        inns += page
        if len(page) < 1000:
            break
        start += 1000
    seen: dict[str, set] = {}
    for inn in inns:
        seen.setdefault(inn_key(inn), set()).add(inn)
    INN_INDEX.update({k: next(iter(v)) for k, v in seen.items() if len(v) == 1 and k})
    log(f"INN index: {len(INN_INDEX):,} keys from {len(inns):,} molecules")


TRANSLATED = {"hit": 0, "miss": 0}


def to_english(name):
    """French/Italian/messy INN -> WHO English INN when it can be matched, else the name as given."""
    n = re.sub(r"\(.*?\)", " ", s(name))
    if not n:
        return ""
    words = re.findall(r"[a-z]+", _unaccent(n).lower())
    for cand in (" ".join(words), " ".join(w for w in words if w not in SALT_WORDS)):
        k = inn_key(cand)
        if k in INN_INDEX:
            TRANSLATED["hit"] += 1
            return INN_INDEX[k]
    TRANSLATED["miss"] += 1
    return n.strip()


def it():
    load_inns()
    base = "https://drive.aifa.gov.it/farmaci/"
    df = pd.read_csv(io.BytesIO(get(base + "confezioni.csv")), sep=";", dtype=str, encoding="utf-8")
    pa = pd.read_csv(io.BytesIO(get(base + "PA_confezioni.csv")), sep=";", dtype=str, encoding="utf-8")
    pa = pa[~pa["PRINCIPIO_ATTIVO"].fillna("N.D.").str.strip().isin(["N.D.", ""])]
    ing = pa.groupby("CODICE_AIC")["PRINCIPIO_ATTIVO"].apply(lambda xs: list(dict.fromkeys(to_english(x) for x in xs))).to_dict()
    log("it states:", df["STATO_AMMINISTRATIVO"].value_counts().to_dict())
    strength = re.compile(r"\d+(?:[.,]\d+)?\s*(?:MG|MCG|µG|G|UI|U\.I\.|%|ML|MMOL)(?:\s*/\s*\d*(?:[.,]\d+)?\s*(?:ML|G|MG|DOSE|H|24 ORE))?", re.I)
    rows = []
    for r in df.itertuples():
        st = s(r.STATO_AMMINISTRATIVO).lower()
        status = "active" if st.startswith("autorizz") else "withdrawn" if st.startswith("revoc") else "unknown"
        m = strength.search(s(r.DESCRIZIONE))
        sv = m.group(0).upper().replace(" ", "") if m else ""
        ingredients = ing.get(s(r.CODICE_AIC)) or [to_english(x) for x in re.split(r"\s*[;/+]\s*", s(r.PA_ASSOCIATI)) if x and x != "N.D."]
        rows.append(row(f"{s(r.COD_FARMACO)}|{sv}|{s(r.FORMA)}", r.COD_FARMACO, r.DENOMINAZIONE, r.RAGIONE_SOCIALE, ingredients,
                        sv, r.FORMA, r.CODICE_ATC, status))
    rows.sort(key=lambda r: r["status"] != "active")
    log(f"it translation: {TRANSLATED}")
    return dict(country="IT", name="AIFA authorised medicines (confezioni)", source_url=base + "confezioni.csv",
                company_field="RAGIONE_SOCIALE (MAH)"), rows


def fr():
    load_inns()
    base = "https://base-donnees-publique.medicaments.gouv.fr/download/file/"
    rd = lambda f, cols: pd.read_csv(io.BytesIO(get(base + f)), sep="\t", header=None, dtype=str, encoding="cp1252", quoting=3,
                                     names=range(cols), usecols=range(cols), on_bad_lines="skip")
    cis = rd("CIS_bdpm.txt", 12)
    compo = rd("CIS_COMPO_bdpm.txt", 8)
    compo["key"] = compo[0].str.strip() + "|" + compo[7].fillna("").str.strip()
    compo["ft"] = compo[6].fillna("").str.strip() == "FT"
    compo = compo.sort_values("ft", ascending=False).drop_duplicates("key")      # per linked pair keep the FT (base) name
    ing, dose = {}, {}
    for r in compo.itertuples():
        c = s(r[1])
        name = to_english(r[4])
        if name and name not in ing.setdefault(c, []):
            ing[c].append(name)
            dose.setdefault(c, []).append(s(r[5]))
    rows = []
    for r in cis.itertuples():
        proc, st = s(r[6]).lower(), s(r[5]).lower()
        if "homéo" in proc or "homeo" in proc:
            continue
        status = "active" if "active" in st else "unknown" if "suspen" in st else "withdrawn"
        c = s(r[1])
        rows.append(row(c, s(r[10]) or c, re.sub(r",[^,]*$", "", s(r[2])), s(r[11]).split(";")[0], ing.get(c, []),
                        " + ".join(dose.get(c, [])), r[3], "", status))
    rows.sort(key=lambda r: r["status"] != "active")
    log(f"fr translation: {TRANSLATED}")
    return dict(country="FR", name="ANSM base de données publique des médicaments", source_url=base + "CIS_bdpm.txt",
                company_field="Titulaire (MAH)"), rows


def ie():
    content = get("https://assets.hpra.ie/products/xml/latestHumanlist.xml")
    rows = []
    for _, el in ET.iterparse(io.BytesIO(content)):
        if el.tag.split("}")[-1] != "Product":
            continue
        g = lambda t: (el.findtext(f"{{*}}{t}") or "").strip()
        atcs = sorted((a.text or "").strip() for a in el.iter() if a.tag.endswith("}ATC"))
        subs = [(a.text or "").strip() for a in el.iter() if a.tag.endswith("}ActiveSubstance") and (a.text or "").strip()]
        st = g("RegistrationStatus")
        rows.append(row(g("LicenceNumber") or g("DrugIDPK"), g("LicenceNumber"), g("ProductName"), g("PAHolder"), subs, "", g("DosageForm"),
                        max(atcs, key=len) if atcs else "", "active" if st == "AU" else "unknown"))
        el.clear()
    return dict(country="IE", name="HPRA human medicines", source_url="https://assets.hpra.ie/products/xml/latestHumanlist.xml",
                company_field="PAHolder (MAH)"), rows


BG_LAT = dict(zip("абвгдежзийклмнопрстуфхцчшщъьюя", ["a","b","v","g","d","e","zh","z","i","y","k","l","m","n","o","p","r","s","t","u","f","h","ts","ch","sh","sht","a","","yu","ya"]))


def bg_latin(t):
    """Cyrillic company name -> Latin (Bulgarian transliteration), legal forms dropped: 'Тева Фарма ЕАД' -> 'Teva Farma'."""
    t = re.sub(r"\b(ЕАД|АД|ЕООД|ООД|ЕТ|СД|КД)\b\.?", " ", s(t), flags=re.I)
    if not re.search(r"[\u0400-\u04FF]", t):
        return s(t)
    out = "".join((BG_LAT.get(c.lower(), c) if c.lower() in BG_LAT else c) if True else c for c in t)
    words = [w.capitalize() if re.search(r"[\u0400-\u04FF]", o) else w for w, o in zip(out.split(), t.split())] if len(out.split()) == len(t.split()) else out.split()
    return s(" ".join(words).strip('"„“ '))


def bg():
    page = "https://www.bda.bg/bg/%D1%80%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B8/%D1%80%D0%B5%D0%B3%D0%B8%D1%81%D1%82%D1%80%D0%B8-%D0%BD%D0%B0-%D0%BB%D0%B5%D0%BA%D0%B0%D1%80%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%B8-%D0%BF%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82%D0%B8"
    html = get(page).decode("utf-8", "replace")
    found = re.findall(r"""/images/stories/documents/registers/Register_Lekarstva/[^"']+\.xlsx""", html)
    log("bg links:", found)
    ial = next((u for u in found if "IAL_Register" in u), "/images/stories/documents/registers/Register_Lekarstva/IAL_Register_08_2026.xlsx")
    url = "https://www.bda.bg" + ial
    df = pd.read_excel(io.BytesIO(get(url)), dtype=str)
    fix_atc = lambda a: re.sub(r"^([A-Z]\d\d[A-Z]{2})\s+(\d)$", r"\g<1>0\2", re.sub(r"^([A-Z]\d\d[A-Z]{2})\s*(\d\d)$", r"\1\2", s(a)))
    rows = [row(f"{s(r['Рег. №'])}|{s(r['Количество на акт.в-во'])}", r["Рег. №"], r["Търговско име"], bg_latin(r["Притежател на РУ"]), s(r["INN"]),
                r["Количество на акт.в-во"], r["Лек. форма EN"], fix_atc(r["АТС-Код"])) for _, r in df.iterrows()]
    cap = next((u for u in found if "Centrally" in u), None)
    if cap:
        try:
            c = pd.read_excel(io.BytesIO(get("https://www.bda.bg" + cap.replace(" ", "%20"))), dtype=str)
            log("bg CAP columns:", list(c.columns), c.head(3).to_dict("records"))
        except Exception as e:
            log("bg CAP read failed:", e)
    return dict(country="BG", name="BDA register of medicinal products (national)", source_url=url, company_field="Притежател на РУ (MAH)"), rows


def om():
    import pdfplumber
    load_inns()
    url = "https://www.moh.gov.om/media/zkmlrorx/pharmaceutical-products-list-with-prices-07-07-2026.pdf"
    content = get(url)
    raw = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for i, page in enumerate(pdf.pages):
            for t in page.extract_tables() or []:
                raw += [r for r in t if r and len(r) >= 8]
            page.flush_cache()
            if i % 100 == 0:
                log(f"om page {i}/{len(pdf.pages)}: {len(raw):,} rows")
    raw = [r for r in raw if s(r[0]) and not s(r[0]).lower().startswith(("regn", "for search")) and not re.search(r"[؀-ۿ]", s(r[0]))]
    from collections import Counter
    width = []
    for i in range(8):
        longest = Counter(max(len(p) for p in s_lines(r[i])) for r in raw if len(s_lines(r[i])) > 1)
        width.append(longest.most_common(1)[0][0] if longest else 999)
    log("om wrap widths:", width)

    def cell(v, i):
        parts = s_lines(v)
        out = ""
        for p in parts:
            out += ("" if out and len(prev) >= width[i] - 1 and out[-1].isalpha() and p[:1].isalpha() else " " if out else "") + p
            prev = p
        return out.strip()

    dose = re.compile(r"\s+\d[\d.,]*\s*(MG|MCG|G|IU|ML|%|MMOL|UNITS?)\b.*$", re.I)
    rows = []
    for r in raw:
        acts = []
        for v in (r[3], r[4]):
            a = dose.sub("", cell(v, 3)).strip()
            if not a:
                continue
            glued = dose.sub("", "".join(s_lines(v))).strip()      # retry with every break glued, keep whichever is an INN
            e = to_english(a)
            if e == a and glued != a and to_english(glued) != glued:
                e = to_english(glued)
            acts.append(e)
        rows.append(row(f"{cell(r[0], 0)}|{cell(r[1], 1)}", cell(r[0], 0), cell(r[1], 1), cell(r[6], 6), acts, "", "", ""))
    log(f"om translation: {TRANSLATED}")
    return dict(country="OM", name="MOH Oman pharmaceutical products list with prices", source_url=url, company_field="Mfr Name (manufacturer)"), rows


def s_lines(v):
    return [p.strip() for p in str(v or "").split("\n") if p.strip()]


ALL = {"nl_cbg": nl, "pl_urpl": pl, "ro_anm": ro, "hu_ogyei": hu, "es_aemps": es, "cz_sukl": cz, "sk_sukl": sk, "se_lv": se, "us_fda": us, "it_aifa": it, "fr_ansm": fr, "ie_hpra": ie, "bg_bda": bg, "om_moh": om}


def write(key, meta, rows):
    rows = dedupe(rows)
    d = OUT / key
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob("part-*.json"):
        old.unlink()
    parts = 0
    for i in range(0, len(rows), CHUNK):
        (d / f"part-{parts:03d}.json").write_text(json.dumps(rows[i:i + CHUNK], ensure_ascii=False, separators=(",", ":")))
        parts += 1
    with_ing = sum(1 for r in rows if r["ingredients"])
    log(f"{key}: {len(rows):,} rows in {parts} parts ({with_ing:,} with ingredients); sample: {json.dumps(rows[:2], ensure_ascii=False)[:600]}")
    return {**meta, "snapshot_date": TODAY, "parts": parts, "rows": len(rows)}


def main(keys):
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for key in keys:
        log(f"\n######## {key}")
        try:
            meta, rows = ALL[key]()
            manifest[key] = write(key, meta, rows)
        except Exception as e:
            log(f"FAILED {key}: {type(e).__name__}: {e}")
            log(traceback.format_exc()[-1500:])
    if CZ_TRANSLATIONS:
        t = OUT / "translations"
        t.mkdir(parents=True, exist_ok=True)
        (t / "part-000.json").write_text(json.dumps(CZ_TRANSLATIONS, ensure_ascii=False, separators=(",", ":")))
        log(f"translations: {len(CZ_TRANSLATIONS):,}")
    manifest_path.write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    (OUT / "build_log.txt").write_text("\n".join(LOG))


if __name__ == "__main__":
    main(sys.argv[1:] or list(ALL))
