"""
catalogue_ai.py — read a supplier catalogue's product list with Claude (Analysis → Upload catalogue).

Flow: split the file into pages (PDF: text per page; a page with almost no text is sent as an image, e.g. a
scanned table or a cover; Excel/CSV: the extracted text in parts) → chunks (text pages together, each image
page alone) read in parallel by Claude Haiku 5.5 with a strict JSON schema → checks → merged products.

Each product cites its page and a short `source` quote. A product from a text page whose quote isn't on the
page is dropped (an invented product); one from an image page can't be checked and is marked `from_image`.

read_catalogue(...) is a generator: ("pages", {...}) once, ("products", [...]) per chunk as it finishes, then
("done", {...}). Raises on any failure so the caller can fall back to keyword matching.
"""
from __future__ import annotations

import base64
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
    """[{page, text}] or [{page, image (base64 PNG)}] — PDFs page by page; other files as text parts."""
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


def _read_chunk(client, chunk: list[dict], company: str) -> tuple[list[dict], int]:
    content = [{"type": "text", "text": f"Company: {company}"}]
    for p in chunk:
        if "image" in p:
            content.append({"type": "text", "text": f"=== PAGE {p['page']} (image) ==="})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": p["image"]}})
        else:
            content.append({"type": "text", "text": f"=== PAGE {p['page']} ===\n{p['text']}"})

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


def read_catalogue(content: bytes, filename: str, company: str):
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    import anthropic
    client = anthropic.Anthropic(api_key=key, max_retries=3)

    pages = catalogue_pages(content, filename)
    if not pages:
        raise RuntimeError("no readable pages in the file")
    chunks = _chunks(pages)
    yield "pages", {"pages": len(pages), "image_pages": sum("image" in p for p in pages), "calls": len(chunks)}

    dropped = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(_read_chunk, client, c, company) for c in chunks]
        for f in as_completed(futures):
            products, n = f.result()      # any failure propagates → keyword fallback
            dropped += n
            yield "products", products
    yield "done", {"dropped": dropped}


def merge_products(products: list[dict]) -> list[dict]:
    """One entry per ingredients × dosage form: strengths, countries and pages united; approved beats submitted."""
    rank = {"approved": 0, "submitted": 1, "unknown": 2}
    merged: dict[tuple, dict] = {}
    for p in products:
        key = (tuple(sorted(i.lower() for i in p["ingredients"])), (p.get("dosage_form") or "").strip().lower())
        m = merged.get(key)
        if m is None:
            merged[key] = {**p, "pages": [p.get("page")], "strengths": list(dict.fromkeys(p.get("strengths") or [])),
                           "countries": list(dict.fromkeys(p.get("countries") or []))}
            continue
        m["strengths"] = list(dict.fromkeys(m["strengths"] + (p.get("strengths") or [])))
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


def uae_strengths(df_iqvia, molecule: str) -> dict[tuple, str]:
    """Strengths sold in the UAE for an IQVIA molecule, from the pack text (falls back to the Strength column)."""
    rows = df_iqvia[df_iqvia["Molecule Combination"] == molecule]
    out: dict[tuple, str] = {}
    for pack, strength in zip(rows["Pack"].astype(str), rows["Strength"].astype(str)):
        doses = _doses(pack, pack=True) or _doses(re.sub(r"^0+(?=\d)", "", strength))
        if doses:
            out.setdefault(tuple(sorted(doses)), "/".join(d.lower() for d in doses))
    return out
