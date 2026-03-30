"""
outreach_runner.py
------------------
Web-adapted outreach logic for the COMIX deploy app.
Prompt and all core logic identical to outreach_agent.py.
Adapted to yield SSE event dicts instead of printing.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Generator

from dotenv import load_dotenv

load_dotenv(override=True)

BACKEND_DIR = Path(__file__).parent
DATA_DIR    = BACKEND_DIR / "data"
sys.path.insert(0, str(BACKEND_DIR))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY    = os.getenv("OPENAI_API_KEY", "")
TAVILY_API_KEY    = os.getenv("TAVILY_API_KEY", "")
HUNTER_API_KEY    = os.getenv("HUNTER_API_KEY", "")

MODELS = {
    "haiku":       ("anthropic", "claude-haiku-4-5-20251001"),
    "sonnet":      ("anthropic", "claude-sonnet-4-6"),
    "gpt-4o-mini": ("openai",    "gpt-4o-mini"),
    "gpt-4o":      ("openai",    "gpt-4o"),
}

# ── Prompt unchanged from outreach_agent.py ──────────────────────────────────
PROMPT = """You are a senior pharmaceutical business development executive with 25+ years of experience. You have built partnerships with manufacturers across Europe, Asia, and the Americas, and have deep knowledge of which companies are serious exporters, GMP-certified, and capable of supplying the Middle East market at scale.

Your task: identify the 5 best pharmaceutical manufacturers or CDMOs headquartered in {country} that COMIX should contact to acquire product portfolios for the UAE market.

COMIX is a Dubai-based licensing company that in-licenses generic molecules from manufacturers and commercialises them in the UAE through local distributors. They focus on CNS and are expanding into cardiovascular, metabolic, and oncology.

Use the search results below to inform your selections. Only include companies that appear in the search data — do not invent companies.

Search results:
{search_results}

For each company return the following in this exact markdown format:

## [Company Name]
**Website:** [company website if known, otherwise write "unknown"]
**Overview:** Two to three sentences covering: what they manufacture, their regulatory standing (GMP/EMA/WHO/FDA), their export reach, and why they are a strong candidate for COMIX specifically.

Repeat for all 5 companies. No prose outside this format. No introductions or conclusions."""


# ─── LLM helper ──────────────────────────────────────────────────────────────

def _call_llm(prompt: str, model_name: str) -> str:
    provider, model_id = MODELS.get(model_name, MODELS["haiku"])
    if provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        resp = client.messages.create(
            model=model_id, max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text
    else:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model=model_id, max_tokens=4096, stream=False,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content


# ─── Tavily search (same queries as outreach_agent.py) ───────────────────────

def _run_searches(country: str) -> str:
    if not TAVILY_API_KEY:
        return ""
    try:
        from tavily import TavilyClient
        client  = TavilyClient(api_key=TAVILY_API_KEY)
        queries = [
            f"top generic pharmaceutical manufacturers {country} export",
            f"{country} pharmaceutical company Middle East",
            f"{country} CDMO API manufacturer GMP regulatory approved",
        ]
        results = []
        for q in queries:
            r = client.search(query=q, max_results=5, search_depth="basic")
            for item in r.get("results", []):
                results.append(f"Source: {item['url']}\n{item['content'][:400]}")
        return "\n\n".join(results)
    except Exception:
        return ""


# ─── Parsing helpers ──────────────────────────────────────────────────────────

def _parse_company_names(text: str) -> list[str]:
    import re
    return re.findall(r"^##\s+(.+)$", text, re.MULTILINE)


def _parse_website(text: str, company: str) -> str:
    import re
    pattern = rf"##\s+{re.escape(company)}.*?\*\*Website:\*\*\s*(\S+)"
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    if m:
        site = m.group(1).strip(".").replace("https://", "").replace("http://", "").split("/")[0]
        return site if site.lower() != "unknown" else ""
    return ""


def _parse_overview(text: str, company: str) -> str:
    import re
    pattern = rf"##\s+{re.escape(company)}.*?\*\*Overview:\*\*\s*(.+?)(?=\n##|\Z)"
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


# ─── UAE presence check (identical logic to outreach_agent.py) ───────────────

def _check_uae_presence(company: str, df_mohap, df_upp, mohap_names, upp_names) -> dict:
    try:
        from rapidfuzz import process, fuzz
        threshold     = 80
        company_upper = company.upper()

        mohap_match = process.extractOne(company_upper, mohap_names, scorer=fuzz.token_set_ratio, score_cutoff=threshold)
        upp_match   = process.extractOne(company_upper, upp_names,   scorer=fuzz.token_set_ratio, score_cutoff=threshold)

        result = {
            "mohap_name":   mohap_match[0] if mohap_match else None,
            "upp_name":     upp_match[0]   if upp_match   else None,
            "mohap_agents": [],
            "upp_agents":   [],
        }
        if result["mohap_name"] and df_mohap is not None and "Agent" in df_mohap.columns:
            agents = df_mohap[df_mohap["Company"].str.upper() == result["mohap_name"]]["Agent"].dropna().unique().tolist()
            result["mohap_agents"] = [a for a in agents if str(a).strip() not in ("", "nan")]
        if result["upp_name"] and df_upp is not None and "Agent Name" in df_upp.columns:
            agents = df_upp[df_upp["Manufacturer Name"].str.upper() == result["upp_name"]]["Agent Name"].dropna().unique().tolist()
            result["upp_agents"] = [a for a in agents if str(a).strip() not in ("", "nan")]
        return result
    except ImportError:
        return {"mohap_name": None, "upp_name": None, "mohap_agents": [], "upp_agents": []}


# ─── Contact lookup (identical logic to outreach_agent.py) ───────────────────

BD_TITLES = {"business development", "bd", "partnerships", "licensing", "commercial", "export", "international", "sales", "marketing"}


def _lookup_emails_hunter(domain: str) -> list:
    if not HUNTER_API_KEY or not domain:
        return []
    try:
        import urllib.request
        url = f"https://api.hunter.io/v2/domain-search?domain={domain}&api_key={HUNTER_API_KEY}&limit=10"
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read())
        emails = data.get("data", {}).get("emails", [])
        contacts = []
        for e in emails:
            title = e.get("position") or e.get("title") or ""
            if any(kw in title.lower() for kw in BD_TITLES):
                contacts.append({
                    "name":         f"{e.get('first_name', '')} {e.get('last_name', '')}".strip(),
                    "email":        e.get("value", ""),
                    "title":        title,
                    "linkedin_url": "",
                })
        if not contacts and emails:
            e = emails[0]
            contacts.append({
                "name":         f"{e.get('first_name', '')} {e.get('last_name', '')}".strip(),
                "email":        e.get("value", ""),
                "title":        e.get("position") or "Unknown",
                "linkedin_url": "",
            })
        return contacts
    except Exception:
        return []


def _find_linkedin_contacts(company: str, model_name: str) -> list:
    if not TAVILY_API_KEY:
        return []
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=TAVILY_API_KEY)
        r = client.search(
            query=f'site:linkedin.com/in "{company}" "business development" OR "licensing" OR "export" OR "partnerships" pharmaceutical',
            max_results=6, search_depth="basic",
        )
        results = r.get("results", [])
        if not results:
            return []

        raw = "\n\n".join(f"URL: {item['url']}\n{item['content'][:300]}" for item in results)

        parse_prompt = f"""Extract BD contacts from these LinkedIn search results for {company}.

{raw}

Return ONLY a JSON array. Each object must have exactly these keys:
  "name": full name (string)
  "title": job title (string)
  "linkedin_url": LinkedIn profile URL (string)

Rules:
- Only include people currently at {company} or recently listed there.
- Only include BD-relevant roles: business development, licensing, partnerships, export, commercial, international sales, marketing.
- If the same person appears twice, include once.
- If no valid contacts found, return [].
- Return raw JSON only. No markdown, no explanation."""

        raw_json = _call_llm(parse_prompt, model_name)
        raw_json = raw_json.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        contacts = json.loads(raw_json)
        return contacts if isinstance(contacts, list) else []
    except Exception:
        return []


# ─── Main streaming generator ────────────────────────────────────────────────

def run_outreach_stream(country: str, model_name: str = "haiku") -> Generator[dict, None, None]:
    """Yields SSE event dicts. Types: status | company | result_row | complete."""

    yield {"type": "status", "message": f"Searching for manufacturers in {country}..."}
    search_results = _run_searches(country)

    yield {"type": "status", "message": "Generating company profiles..."}
    prompt = PROMPT.replace("{country}", country).replace("{search_results}", search_results or "(none)")
    output = _call_llm(prompt, model_name)

    yield {"type": "status", "message": "Loading UAE market data for presence check..."}
    try:
        from data_processing.loader import load_all
        dfs = load_all(
            iqvia_path=str(DATA_DIR / "iqvia.csv"),
            upp_path=str(DATA_DIR / "upp.csv"),
            mohap_path=str(DATA_DIR / "mohap.csv"),
        )
        df_mohap    = dfs["mohap"]
        df_upp      = dfs["upp"]
        mohap_names = set(df_mohap["Company"].dropna().str.upper().unique())
        upp_names   = set(df_upp["Manufacturer Name"].dropna().str.upper().unique())
    except Exception:
        df_mohap = df_upp = None
        mohap_names = upp_names = set()

    companies = _parse_company_names(output)
    yield {"type": "status", "message": f"Found {len(companies)} companies — checking UAE presence and contacts..."}

    for company in companies:
        yield {"type": "status", "message": f"Processing {company}..."}

        uae      = _check_uae_presence(company, df_mohap, df_upp, mohap_names, upp_names)
        domain   = _parse_website(output, company)
        overview = _parse_overview(output, company)

        contacts = _lookup_emails_hunter(domain) if HUNTER_API_KEY else []
        if not contacts:
            contacts = _find_linkedin_contacts(company, model_name)
        valid_contacts = [c for c in contacts[:3] if isinstance(c, dict) and "error" not in c]

        mohap_dist = ", ".join(uae.get("mohap_agents", [])[:5])
        upp_dist   = ", ".join(uae.get("upp_agents",   [])[:5])

        company_result = {
            "company":  company,
            "website":  domain,
            "overview": overview,
            "uae_presence": {
                "mohap":        uae.get("mohap_name"),
                "upp":          uae.get("upp_name"),
                "mohap_agents": uae.get("mohap_agents", []),
                "upp_agents":   uae.get("upp_agents",   []),
            },
            "contacts": valid_contacts,
        }

        yield {"type": "company", "data": company_result}

        # Emit rows for Google Sheets save
        if valid_contacts:
            for c in valid_contacts:
                yield {"type": "result_row", "data": {
                    "country":       country,
                    "company":       company,
                    "mohap_match":   uae.get("mohap_name", ""),
                    "upp_match":     uae.get("upp_name",   ""),
                    "mohap_dist":    mohap_dist,
                    "upp_dist":      upp_dist,
                    "contact_name":  c.get("name",         ""),
                    "contact_title": c.get("title",        ""),
                    "contact_email": c.get("email",        ""),
                    "linkedin_url":  c.get("linkedin_url", ""),
                }}
        else:
            yield {"type": "result_row", "data": {
                "country":       country,
                "company":       company,
                "mohap_match":   uae.get("mohap_name", ""),
                "upp_match":     uae.get("upp_name",   ""),
                "mohap_dist":    mohap_dist,
                "upp_dist":      upp_dist,
                "contact_name":  "",
                "contact_title": "",
                "contact_email": "",
                "linkedin_url":  "",
            }}

    yield {"type": "complete", "country": country, "companies_found": len(companies)}
