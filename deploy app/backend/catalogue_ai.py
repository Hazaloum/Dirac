"""
catalogue_ai.py — read a supplier catalogue's product list with Claude (Analysis → Upload catalogue).

Flow: split the file into pages (PDF: text per page; a page with almost no text is sent as an image, e.g. a
scanned table or a cover; an image file (photo / screenshot of a price list) is one image page; Excel/CSV: the
extracted text in parts) → chunks (text pages together, each image
page alone) read in parallel by Claude Haiku 5.5 with a strict JSON schema → checks → merged products.

Each product cites its page and a short `source` quote. A product from a text page whose quote isn't on the
page is dropped (an invented product); one from an image page can't be checked and is marked `from_image`.

Each chunk's result is cached in Supabase `catalogue_ai_cache` (key = hash of model, prompt, schema, company
and the chunk's pages), so re-uploading the same file — e.g. after a dropped connection or a backend
redeploy mid-read — reuses the chunks already read instead of paying for them again.

Several files can be uploaded together (e.g. screenshots of one email): their pages are numbered on from one file
to the next and read as one catalogue.

read_catalogue(...) is a generator: ("pages", {...}) once, ("products", [...]) per chunk as it finishes, then
("done", {...}). Raises on any failure so the caller can fall back to keyword matching.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

MODEL = "claude-haiku-5-5"
MIN_PAGE_TEXT = 100        # fewer characters than this → the page is read as an image
MAX_IMAGE_PAGES = 40
CHUNK_CHARS = 12000
CHUNK_PAGES = 8
WORKERS = 4
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
MAX_IMAGE_SIDE = 2000      # longer edge, px; bigger photos are scaled down before sending


def is_image(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_SUFFIXES


def _image_page(content: bytes) -> dict:
    """An uploaded image file → one image page (JPEG, EXIF rotation applied, scaled down to MAX_IMAGE_SIDE so it
    stays under the API's 5 MB image limit)."""
    from PIL import Image, ImageOps
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(content))).convert("RGB")
    img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return {"page": 1, "image": base64.standard_b64encode(buf.getvalue()).decode(), "media_type": "image/jpeg"}

SYSTEM = """You extract the product list from a pharmaceutical company's product catalogue. The text was pulled from a PDF or spreadsheet, so table columns may be run together (e.g. "10mgBulgaria"), rows may wrap across lines, and section headings can appear in odd places. Some pages are given as images instead (scans, designed pages, covers).

Return one entry per product = one set of active ingredients in one dosage form. Rules:
- ingredients: the active ingredient(s) as English INN names, one array element per ingredient. A combination ("A/B", "A + B", "A and B") is ONE product with several ingredients — never split it into separate products. Keep salt/ester words only if the catalogue writes them (e.g. "Icatibant acetate"); do not add any.
- brand: a brand name if the catalogue gives one (e.g. text in brackets with ®), else "". Never put a brand in ingredients.
- dosage_form: as written (e.g. "Film Coated Tablets", "Pre-Filled Syringe"), else "".
- strengths: array of strengths as written, one per element (e.g. ["5mg/500mg", "12.5mg/1,000mg"]).
- countries: array of country names listed for that product.
- status: "approved" or "submitted" from the section the row sits in (headings like "AVAILABLE MAs | APPROVED" / "AVAILABLE MAs | SUBMITTED" — the heading may be printed AFTER the rows it covers), or "unknown" if unclear.
- expected_date: only if the catalogue states when the product is expected to be approved or launched (e.g. "Q2 2027", "2027"), copied as written; else "". Never estimate one.
- page: the page number (from the "=== PAGE n ===" marker) the product row is on.
- source: a short exact quote (up to ~60 characters) copied from that page's text where the product appears, e.g. "Bosutinib Film Coated Tablets 100mg". For an image page, copy the words as they appear in the image.
- If the same ingredients appear twice with different dosage forms (e.g. tablets and XR tablets), return two entries.
- Skip covers, contents, headings, column titles, disclaimers, company/marketing text and pictures. A page with no product rows returns no products. Do not invent products that are not on the pages."""

_STR_LIST = {"type": "array", "items": {"type": "string"}}
SCHEMA = {
    "type": "object",
    "properties": {"products": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "ingredients": _STR_LIST,
            "brand": {"type": "string"},
            "dosage_form": {"type": "string"},
            "strengths": _STR_LIST,
            "countries": _STR_LIST,
            "status": {"type": "string", "enum": ["approved", "submitted", "unknown"]},
            "expected_date": {"type": "string"},
            "page": {"type": "integer"},
            "source": {"type": "string"},
        },
        "required": ["ingredients", "brand", "dosage_form", "strengths", "countries", "status", "expected_date",
                     "page", "source"],
        "additionalProperties": False,
    }}},
    "required": ["products"],
    "additionalProperties": False,
}


# ─── Pages and chunks ────────────────────────────────────────────────────────

def catalogue_pages(content: bytes, filename: str) -> list[dict]:
    """[{page, text}] or [{page, image (base64 PNG / JPEG)}] — PDFs page by page; an image file as one page; other files as text parts."""
    if is_image(filename):
        return [_image_page(content)]
    if Path(filename).suffix.lower() == ".pdf" or content[:5] == b"%PDF-":
        import pdfplumber
        pages, images = [], 0
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for n, page in enumerate(pdf.pages, start=1):
                text = (page.extract_text() or "").strip()
                if len(text) >= MIN_PAGE_TEXT:
                    pages.append({"page": n, "text": text})
                elif images < MAX_IMAGE_PAGES:
                    buf = io.BytesIO()
                    page.to_image(resolution=110).original.convert("RGB").save(buf, format="PNG")
                    pages.append({"page": n, "image": base64.standard_b64encode(buf.getvalue()).decode()})
                    images += 1
        return pages

    from agent_runner import _extract_text
    text = _extract_text(content, filename)
    parts, current = [], ""
    for line in text.splitlines(keepends=True):
        if current and len(current) + len(line) > CHUNK_CHARS:
            parts.append(current)
            current = ""
        current += line
    if current.strip():
        parts.append(current)
    return [{"page": n, "text": t} for n, t in enumerate(parts, start=1)]


def _chunks(pages: list[dict]) -> list[list[dict]]:
    """Text pages grouped (≤ CHUNK_PAGES / CHUNK_CHARS); each image page on its own."""
    chunks, current, size = [], [], 0
    for p in pages:
        if "image" in p:
            chunks.append([p])
            continue
        if current and (len(current) >= CHUNK_PAGES or size + len(p["text"]) > CHUNK_CHARS):
            chunks.append(current)
            current, size = [], 0
        current.append(p)
        size += len(p["text"])
    if current:
        chunks.append(current)
    return chunks


# ─── Reading ─────────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _from(p: dict, lead: str = ", ") -> str:
    """ "from <file>" for the page header when several files were uploaded."""
    if not p.get("file"):
        return ""
    return f"{lead}from {p['file']}" + (")" if lead.startswith(" (") else "")


def all_pages(files: list[tuple[bytes, str]]) -> list[dict]:
    """catalogue_pages of every file, pages numbered on across files (each tagged with its file when > 1)."""
    pages: list[dict] = []
    for content, filename in files:
        for p in catalogue_pages(content, filename):
            pages.append({**p, "page": len(pages) + 1, **({"file": filename} if len(files) > 1 else {})})
    return pages


def _read_chunk(client, chunk: list[dict], company: str) -> tuple[list[dict], int]:
    content = [{"type": "text", "text": f"Company: {company}"}]
    for p in chunk:
        if "image" in p:
            content.append({"type": "text", "text": f"=== PAGE {p['page']} (image{_from(p)}) ==="})
            content.append({"type": "image", "source": {"type": "base64", "media_type": p.get("media_type", "image/png"), "data": p["image"]}})
        else:
            content.append({"type": "text", "text": f"=== PAGE {p['page']}{_from(p, ' (')} ===\n{p['text']}"})

    resp = client.messages.create(
        model=MODEL, max_tokens=16000, system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": content}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("the model declined to read this catalogue")
    if resp.stop_reason == "max_tokens":
        raise RuntimeError("a catalogue section was too long to read in one go")
    data = json.loads(next(b.text for b in resp.content if b.type == "text"))

    by_page = {p["page"]: p for p in chunk}
    chunk_text = _norm(" ".join(p.get("text", "") for p in chunk))
    kept, dropped = [], 0
    for prod in data.get("products", []):
        ingredients = [i.strip() for i in prod.get("ingredients", []) if i and i.strip()]
        if not ingredients:
            continue
        page = by_page.get(prod.get("page"))
        from_image = bool(page and "image" in page) or (page is None and all("image" in p for p in chunk))
        if not from_image:
            quote = _norm(prod.get("source", ""))
            text = _norm(page["text"]) if page else chunk_text
            if not quote or quote not in text:
                dropped += 1      # its quote isn't on the page: treat as invented
                continue
        kept.append({**prod, "ingredients": ingredients, "from_image": from_image})
    return kept, dropped


def _cache_key(chunk: list[dict], company: str) -> str:
    h = hashlib.sha256()
    for part in (MODEL, SYSTEM, json.dumps(SCHEMA, sort_keys=True), company):
        h.update(part.encode())
        h.update(b"\0")
    for p in chunk:
        h.update(f"{p['page']}\0".encode())
        h.update((p.get("text") or p.get("image") or "").encode())
        h.update(b"\0")
    return h.hexdigest()


def _cache_get(key: str):
    try:
        from supabase_client import get_client
        rows = get_client().table("catalogue_ai_cache").select("products, dropped").eq("key", key).execute().data
        return (json.loads(rows[0]["products"]), rows[0]["dropped"]) if rows else None
    except Exception:
        return None       # the cache is an optimisation: never fail the read over it


def _cache_put(key: str, products: list[dict], dropped: int) -> None:
    try:
        from supabase_client import get_client
        get_client().table("catalogue_ai_cache").upsert(
            {"key": key, "products": json.dumps(products), "dropped": dropped}).execute()
    except Exception:
        pass


def _read_chunk_cached(client, chunk: list[dict], company: str) -> tuple[list[dict], int]:
    key = _cache_key(chunk, company)
    hit = _cache_get(key)
    if hit is not None:
        return hit
    products, dropped = _read_chunk(client, chunk, company)
    _cache_put(key, products, dropped)
    return products, dropped


def read_catalogue(files: list[tuple[bytes, str]], company: str):
    """files = [(bytes, filename), …], read as one catalogue."""
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    import anthropic
    client = anthropic.Anthropic(api_key=key, max_retries=3)

    pages = all_pages(files)
    if not pages:
        raise RuntimeError("no readable pages in the file" + ("s" if len(files) > 1 else ""))
    chunks = _chunks(pages)
    yield "pages", {"pages": len(pages), "image_pages": sum("image" in p for p in pages), "calls": len(chunks)}

    dropped = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(_read_chunk_cached, client, c, company) for c in chunks]
        for f in as_completed(futures):
            products, n = f.result()      # any failure propagates → keyword fallback
            dropped += n
            yield "products", products
    yield "done", {"dropped": dropped}


def _unique_strengths(labels: list[str]) -> list[str]:
    """'1 mg' and '1mg' are one strength: keep the first spelling of each dose."""
    seen, out = set(), []
    for s in labels:
        k = strength_key(s) or (s.strip().lower(),)
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out


def merge_products(products: list[dict]) -> list[dict]:
    """One entry per ingredients × dosage form: strengths, countries and pages united; approved beats submitted."""
    rank = {"approved": 0, "submitted": 1, "unknown": 2}
    merged: dict[tuple, dict] = {}
    for p in products:
        key = (tuple(sorted(i.lower() for i in p["ingredients"])), (p.get("dosage_form") or "").strip().lower())
        m = merged.get(key)
        if m is None:
            merged[key] = {**p, "pages": [p.get("page")], "strengths": _unique_strengths(p.get("strengths") or []),
                           "countries": list(dict.fromkeys(p.get("countries") or []))}
            continue
        m["strengths"] = _unique_strengths(m["strengths"] + (p.get("strengths") or []))
        m["countries"] = list(dict.fromkeys(m["countries"] + (p.get("countries") or [])))
        m["pages"] = sorted({*m["pages"], p.get("page")} - {None})
        if rank.get(p.get("status"), 2) < rank.get(m.get("status"), 2):
            m["status"] = p["status"]
        m["brand"] = m.get("brand") or p.get("brand") or ""
        m["expected_date"] = m.get("expected_date") or p.get("expected_date") or ""
        m["from_image"] = m["from_image"] and p["from_image"]
    return list(merged.values())


# ─── Strengths vs the UAE market (IQVIA packs) ───────────────────────────────

# IQVIA writes micrograms as "Y" and decimals as ".10"; a trailing "<count> <size> ML/G" is the pack size.
_DOSE = re.compile(r"(\d+(?:\.\d+)?|\.\d+)\s*(MCG|Y|MG|G|IU|%)(?![A-Z])")
_PACK_SIZE = re.compile(r"\s\d+(?:\s+\d+(?:\.\d+)?)?\s*(?:ML|G|L)\s*$")


def _doses(text: str, pack: bool = False) -> list[str]:
    """Doses as mass: '5mg/1,000mg' → ['5MG', '1000MG']; '0.1%' → '1MG' (per g); per-volume dropped; IU only when
    there's no mass. pack=True strips IQVIA's trailing pack size first."""
    t = (text or "").upper().replace(",", "")
    if pack:
        t = _PACK_SIZE.sub("", t)
    found = _DOSE.findall(t)
    mass = [(a, u) for a, u in found if u != "IU"] or found
    out = []
    for a, u in mass:
        amount = float(a)
        if u == "%":
            amount, u = amount * 10, "MG"
        out.append(f"{amount:g}{'MCG' if u == 'Y' else u}")
    return out


def strength_key(text: str) -> tuple:
    """'12.5mg/1,000mg' and 'FCT 12.5MG/ 1000 MG 60' → ('1000MG', '12.5MG'): doses, order-free."""
    return tuple(sorted(_doses(text)))


# Dosage-form groups, so a gel is compared with gels and a tablet with tablets. IQVIA: the NFC3 code's first letter
# (A/B oral solid, D oral liquid, F/G injection, M skin, …); the catalogue: keywords in its free-text form.
FORM_GROUPS = {
    "oral_solid": "Tablets / capsules", "oral_liquid": "Oral liquids / sachets", "injection": "Injections",
    "skin": "Skin (gel, cream, spray)", "eye": "Eye", "ear": "Ear", "nose": "Nose", "inhaled": "Inhaled",
    "mouth": "Mouth / throat", "vaginal": "Vaginal", "rectal": "Rectal", "patch": "Patches / other systemic",
}
_NFC1_GROUP = {"A": "oral_solid", "B": "oral_solid", "D": "oral_liquid", "F": "injection", "G": "injection",
               "H": "rectal", "I": "nose", "J": "patch", "K": "mouth", "M": "skin", "N": "eye", "P": "ear",
               "Q": "nose", "R": "inhaled", "T": "vaginal"}
_FORM_WORDS = [   # first match wins: specific routes before generic shapes
    ("eye", r"eye|ophthalm|ocular"), ("ear", r"\bear\b|otic|auricular"), ("nose", r"nasal|nose"),
    ("inhaled", r"inhal|nebuli|respule|aerosol for inhal|dry powder"), ("vaginal", r"vagin|pessar"),
    ("rectal", r"rectal|suppositor|enema"), ("patch", r"transdermal|patch"),
    ("mouth", r"mouth|oromucos|throat|lozenge|buccal|gingival|dental"),
    ("injection", r"inject|infus|vial|ampoule|ampul|syringe|\bpen\b|\bi\.?v\b|\bi\.?m\b|parenteral|concentrate for"),
    ("skin", r"\bgels?\b|emulgel|cream|ointment|lotion|cutaneous|topical|dermal|foam|shampoo|paste|emulsion|spray|liniment"),
    ("oral_liquid", r"solution|syrup|suspension|drops|elixir|sachet|granul|powder|liquid|stick|emulsion"),
    ("oral_solid", r"tablet|tab\b|capsule|caps?\b|caplet|pill|dragee|chewable|orodispers"),
]


def form_group(dosage_form: str) -> str | None:
    """Catalogue form text → FORM_GROUPS key ('Spray gel' → 'skin', 'Oral solution in bottle' → 'oral_liquid')."""
    t = (dosage_form or "").lower()
    for group, pattern in _FORM_WORDS:
        if re.search(pattern, t):
            return group
    return None


def _dose_sort(label: str) -> tuple:
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", label)]
    return (nums or [0.0], label)


def uae_strengths(df_iqvia, molecule: str) -> dict[str, dict[tuple, str]]:
    """Strengths sold in the UAE for an IQVIA molecule per form group: {group: {strength key: label}}, from the
    pack text (falls back to the Strength column). Packs without an NFC3 go under "" (any form)."""
    rows = df_iqvia[df_iqvia["Molecule Combination"] == molecule]
    nfc3 = rows["NFC3"].astype(str) if "NFC3" in rows.columns else [""] * len(rows)
    out: dict[str, dict[tuple, str]] = {}
    for pack, strength, nfc in zip(rows["Pack"].astype(str), rows["Strength"].astype(str), nfc3):
        doses = _doses(pack, pack=True) or _doses(re.sub(r"^0+(?=\d)", "", strength))
        if doses:
            group = _NFC1_GROUP.get(nfc.strip()[:1].upper(), "")
            out.setdefault(group, {}).setdefault(tuple(sorted(doses)), "/".join(d.lower() for d in doses))
    return out


def compare_strengths(uae: dict[str, dict[tuple, str]], products: list[dict]) -> tuple[list[dict], list[dict]]:
    """Catalogue products vs UAE strengths, form by form.

    Returns (rows, other_forms). Each row = one catalogue product with `uae_form` and `strengths`: every UAE strength
    of that form plus the catalogue's, each {label, offered, in_uae}. other_forms = UAE forms the catalogue doesn't
    offer, each {form, strengths:[label]}. Without IQVIA data in_uae is None."""
    have_uae = bool(uae)
    # One row per form group: "Tablets" and "Film-coated tablets" are both tablets, so their strengths share a row.
    by_group: dict[str, dict] = {}
    for i, p in enumerate(products):
        group = form_group(p.get("dosage_form") or "")
        row = by_group.get(group or f"?{i}")
        if row is None:
            by_group[group or f"?{i}"] = {**p, "form_group": group, "strengths": list(p.get("strengths") or []),
                                          "forms": [p.get("dosage_form") or ""]}
            continue
        row["strengths"] += p.get("strengths") or []
        row["forms"].append(p.get("dosage_form") or "")
        row["countries"] = list(dict.fromkeys((row.get("countries") or []) + (p.get("countries") or [])))
        row["pages"] = sorted(set(row.get("pages") or []) | set(p.get("pages") or []))
        row["from_image"] = bool(row.get("from_image")) and bool(p.get("from_image"))
        if p.get("status") == "approved" or row.get("status") == "unknown":
            row["status"] = p.get("status") or row.get("status")
        row["expected_date"] = row.get("expected_date") or p.get("expected_date") or ""
    rows, used = [], set()
    for row in by_group.values():
        group = row["form_group"]
        pool = uae.get(group, {}) if group else {k: v for g in uae.values() for k, v in g.items()}
        if group:
            used.add(group)
        cells: dict[tuple, dict] = {k: {"label": label, "offered": False, "in_uae": True} for k, label in pool.items()}
        for s in row["strengths"]:
            k = strength_key(s) or (s.strip().lower(),)
            if k in cells:
                if not cells[k]["offered"]:
                    cells[k].update(offered=True, label=s)
            else:
                cells[k] = {"label": s, "offered": True, "in_uae": False if have_uae else None}
        forms = list(dict.fromkeys(f for f in row.pop("forms") if f))
        rows.append({**row, "dosage_form": " / ".join(forms), "uae_form": FORM_GROUPS.get(group, ""),
                     "strengths": sorted(cells.values(), key=lambda c: _dose_sort(c["label"]))})
    other = [{"form": FORM_GROUPS.get(g, "Other"), "strengths": sorted(v.values(), key=_dose_sort)}
             for g, v in uae.items() if g not in used and v]
    return rows, other
