"""
research.py — recent research cards per molecule for the reps (Curie).

Pulls the 5 most recent trials / meta-analyses / systematic reviews for a
molecule from PubMed, then asks gpt-5.6-luna to write each one up as: what the study found, one line the rep can say to the
doctor, and a caution. Cards are stored in Supabase `molecule_research`
(replaced on each refresh) so every rep reads the same set instantly.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from supabase_client import get_service_client

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
SUMMARY_MODEL = "gpt-5.6-luna"
CANDIDATES = 15  # PubMed's date sort is by issue date; we re-sort by publication date and keep the newest 5
CARDS = 5
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}


# ─── PubMed ───────────────────────────────────────────────────────────────────

def _get(path: str, params: dict) -> bytes:
    url = f"{EUTILS}/{path}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        return resp.read()


def search(molecule: str, limit: int = CANDIDATES) -> list[str]:
    """Newest PubMed IDs: trials, meta-analyses and systematic reviews with an abstract."""
    term = (f"{molecule.lower()}[ti] AND (randomized controlled trial[pt] OR meta-analysis[pt] "
            f"OR systematic review[pt]) AND hasabstract")
    data = json.loads(_get("esearch.fcgi", {"db": "pubmed", "term": term, "sort": "pub_date",
                                            "retmax": limit, "retmode": "json"}))
    return data["esearchresult"]["idlist"]


def _published_on(article: ET.Element) -> str | None:
    """Electronic publication date if there is one, else the issue date (YYYY-MM-DD)."""
    ed = article.find(".//ArticleDate")
    if ed is not None and ed.findtext("Year"):
        return f"{ed.findtext('Year')}-{int(ed.findtext('Month') or 1):02d}-{int(ed.findtext('Day') or 1):02d}"
    pd = article.find(".//Journal/JournalIssue/PubDate")
    if pd is None or not pd.findtext("Year"):
        return None
    month = pd.findtext("Month") or "1"
    month = MONTHS.get(month[:3], int(month) if month.isdigit() else 1)
    day = pd.findtext("Day") or "1"
    return f"{pd.findtext('Year')}-{month:02d}-{int(day) if day.isdigit() else 1:02d}"


def parse_articles(xml: bytes) -> list[dict]:
    out = []
    for item in ET.fromstring(xml).findall(".//PubmedArticle"):
        art = item.find(".//Article")
        if art is None:
            continue
        abstract = " ".join("".join(t.itertext()) for t in art.findall("Abstract/AbstractText")).strip()
        out.append({
            "pmid": item.findtext(".//PMID"),
            "title": re.sub(r"\s+", " ", "".join(art.find("ArticleTitle").itertext())).strip(),
            "journal": art.findtext("Journal/ISOAbbreviation") or art.findtext("Journal/Title"),
            "published_on": _published_on(item),
            "types": [t.text for t in art.findall("PublicationTypeList/PublicationType") if t.text],
            "abstract": abstract,
        })
    return [a for a in out if a["pmid"] and a["abstract"]]


def fetch(pmids: list[str]) -> list[dict]:
    if not pmids:
        return []
    return parse_articles(_get("efetch.fcgi", {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"}))


# ─── Summaries ────────────────────────────────────────────────────────────────

_SCHEMA = {
    "name": "research_cards",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {"cards": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "pmid": {"type": "string"},
                "study": {"type": "string"},
                "finding": {"type": "string"},
                "say": {"type": "string"},
                "caution": {"type": ["string", "null"]},
            },
            "required": ["pmid", "study", "finding", "say", "caution"],
            "additionalProperties": False,
        }}},
        "required": ["cards"],
        "additionalProperties": False,
    },
}


def _prompt(molecule: str, forms: list[str], articles: list[dict]) -> str:
    papers = "\n\n".join(
        f"PMID {a['pmid']} | {a['journal']} | {a['published_on']} | {', '.join(a['types'])}\n"
        f"Title: {a['title']}\nAbstract: {a['abstract'][:2500]}"
        for a in articles
    )
    return f"""You prepare research cards for COMIX's medical reps in the UAE. A rep scans a card in 20 seconds before seeing a doctor and uses it in the conversation.

Molecule: {molecule}
What COMIX sells: {', '.join(forms) or 'oral forms'}

Write one card for EVERY paper below (they are the {CARDS} most recent). If a paper is about a formulation COMIX doesn't sell (e.g. a long-acting injection when COMIX sells tablets) or is a lab-marker / mechanistic study, still write the card and say so in the caution.

For each card:
- study: type and size in a few words, e.g. "Meta-analysis · 11 trials, 1,135 children" or "Randomised double-blind trial · 60 patients, 7 weeks".
- finding: one or two short sentences with the actual result and numbers from the abstract.
- say: one line the rep could say to the doctor, plain and confident, never overstating the result.
- caution: the main limitation or side effect the rep must not hide (small study, short follow-up, evidence limited, adverse effects, use may be outside the approved indication) — or null if there is none worth stating.

Only use what the abstracts say — no outside facts, no invented numbers. Plain English, no hype.

Papers:
{papers}"""


def summarize(molecule: str, forms: list[str], articles: list[dict]) -> list[dict]:
    from openai import OpenAI

    response = OpenAI(api_key=os.getenv("OPENAI_API_KEY")).chat.completions.create(
        model=SUMMARY_MODEL,
        max_completion_tokens=6000,
        response_format={"type": "json_schema", "json_schema": _SCHEMA},
        messages=[{"role": "user", "content": _prompt(molecule, forms, articles)}],
    )
    try:
        cards = json.loads(response.choices[0].message.content or "{}").get("cards", [])
    except json.JSONDecodeError:
        cards = []
    return build_cards(molecule, cards, articles)


def build_cards(molecule: str, cards: list[dict], articles: list[dict]) -> list[dict]:
    """Join the AI's cards to the real papers (newest first); drop any PMID the AI made up or repeated."""
    by_pmid = {a["pmid"]: a for a in articles}
    order = {a["pmid"]: i for i, a in enumerate(newest(articles, len(articles)))}
    cards = sorted(cards, key=lambda c: order.get(str(c.get("pmid", "")).strip(), len(order)))
    out, seen = [], set()
    for card in cards:
        paper = by_pmid.get(str(card.get("pmid", "")).strip())
        if not paper or paper["pmid"] in seen or not (card.get("finding") or "").strip():
            continue
        seen.add(paper["pmid"])
        out.append({
            "molecule": molecule,
            "pmid": paper["pmid"],
            "title": paper["title"],
            "journal": paper["journal"],
            "published_on": paper["published_on"],
            "study": (card.get("study") or "").strip() or None,
            "finding": card["finding"].strip(),
            "say": (card.get("say") or "").strip() or None,
            "caution": (card.get("caution") or "").strip() or None,
            "rank": len(out),
        })
        if len(out) == CARDS:
            break
    return out


# ─── Refresh + read ───────────────────────────────────────────────────────────

def _forms(molecule: str) -> list[str]:
    rows = get_service_client().table("inventory_stock").select("strength, form").eq("molecule", molecule).execute().data
    return sorted({f"{r['strength']} {r['form'].lower()}".strip() for r in rows if r.get("form")})


def newest(articles: list[dict], n: int = CARDS) -> list[dict]:
    return sorted(articles, key=lambda a: a["published_on"] or "", reverse=True)[:n]


def refresh(molecule: str) -> list[dict]:
    """Pull the 5 newest papers from PubMed, summarise them, and replace the molecule's cards."""
    molecule = molecule.strip().upper()
    articles = newest(fetch(search(molecule)))
    if not articles:
        raise ValueError(f"No recent trials or reviews found on PubMed for {molecule.title()}")
    cards = summarize(molecule, _forms(molecule), articles)
    if not cards:
        raise ValueError("Couldn't write research cards this time — try again")
    db = get_service_client()
    db.table("molecule_research").delete().eq("molecule", molecule).execute()
    now = datetime.now(timezone.utc).isoformat()
    # Upsert, so two reps refreshing at once can't trip the (molecule, pmid) unique key.
    db.table("molecule_research").upsert([{**c, "created_at": now} for c in cards], on_conflict="molecule,pmid").execute()
    return cards
