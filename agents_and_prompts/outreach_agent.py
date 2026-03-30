"""
outreach_agent.py
-----------------
Identifies 5 pharmaceutical companies in a given country for COMIX to contact.
Checks each company against MOHAP and UPP to flag UAE market presence.

Usage:
    python outreach_agent.py --country "Portugal"
    python outreach_agent.py --country "India" --model gpt-4o-mini
"""

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────

THIS_DIR     = Path(__file__).parent
BD_INTEL_DIR = THIS_DIR.parent / "comix-bd-intelligence"
DATA_DIR     = BD_INTEL_DIR / "data" / "read"

sys.path.insert(0, str(BD_INTEL_DIR))

# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────

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

# Cost per 1k tokens (input, output) in USD
MODEL_COSTS = {
    "haiku":       (0.0008,  0.004),
    "sonnet":      (0.003,   0.015),
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4o":      (0.0025,  0.01),
}

_usage = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}

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


# ─────────────────────────────────────────────────────────────
# Tavily search
# ─────────────────────────────────────────────────────────────

def run_searches(country: str) -> str:
    if not TAVILY_API_KEY:
        print("  [No Tavily key — proceeding without search results]")
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
    except Exception as e:
        print(f"  [Tavily failed: {e}]")
        return ""


# ─────────────────────────────────────────────────────────────
# LLM call
# ─────────────────────────────────────────────────────────────

def _track(model_name: str, inp: int, out: int):
    ci, co = MODEL_COSTS[model_name]
    _usage["input_tokens"]  += inp
    _usage["output_tokens"] += out
    _usage["cost_usd"]      += (inp / 1000 * ci) + (out / 1000 * co)


def call_llm(prompt: str, model_name: str) -> str:
    provider, model_id = MODELS[model_name]
    if provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        resp   = client.messages.create(
            model=model_id, max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        _track(model_name, resp.usage.input_tokens, resp.usage.output_tokens)
        return resp.content[0].text
    else:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
        resp   = client.chat.completions.create(
            model=model_id, max_tokens=4096, stream=False,
            messages=[{"role": "user", "content": prompt}],
        )
        _track(model_name, resp.usage.prompt_tokens, resp.usage.completion_tokens)
        return resp.choices[0].message.content


# ─────────────────────────────────────────────────────────────
# UAE presence check (MOHAP + UPP fuzzy match)
# ─────────────────────────────────────────────────────────────

def load_uae_data() -> tuple:
    """Returns (df_mohap, df_upp, mohap_names, upp_names)."""
    try:
        from data_processing_extraction.loader import load_all
        dfs = load_all(
            iqvia_path=str(DATA_DIR / "iqvia.csv"),
            upp_path=str(DATA_DIR / "upp.csv"),
            mohap_path=str(DATA_DIR / "mohap.csv"),
        )
        mohap_names = set(dfs["mohap"]["Company"].dropna().str.upper().unique())
        upp_names   = set(dfs["upp"]["Manufacturer Name"].dropna().str.upper().unique())
        return dfs["mohap"], dfs["upp"], mohap_names, upp_names
    except Exception as e:
        print(f"  [Could not load UAE data: {e}]")
        return None, None, set(), set()


def check_uae_presence(
    company: str,
    df_mohap, df_upp,
    mohap_names: set, upp_names: set,
) -> dict:
    """Fuzzy match company against MOHAP and UPP. Returns match name + agents."""
    try:
        from rapidfuzz import process, fuzz
        threshold     = 80
        company_upper = company.upper()

        mohap_match = process.extractOne(
            company_upper, mohap_names,
            scorer=fuzz.token_set_ratio, score_cutoff=threshold,
        )
        upp_match = process.extractOne(
            company_upper, upp_names,
            scorer=fuzz.token_set_ratio, score_cutoff=threshold,
        )

        result = {
            "mohap_name":   mohap_match[0] if mohap_match else None,
            "upp_name":     upp_match[0]   if upp_match   else None,
            "mohap_agents": [],
            "upp_agents":   [],
        }

        if result["mohap_name"] and df_mohap is not None and "Agent" in df_mohap.columns:
            agents = (
                df_mohap[df_mohap["Company"].str.upper() == result["mohap_name"]]
                ["Agent"].dropna().unique().tolist()
            )
            result["mohap_agents"] = [a for a in agents if str(a).strip() not in ("", "nan")]

        if result["upp_name"] and df_upp is not None and "Agent Name" in df_upp.columns:
            agents = (
                df_upp[df_upp["Manufacturer Name"].str.upper() == result["upp_name"]]
                ["Agent Name"].dropna().unique().tolist()
            )
            result["upp_agents"] = [a for a in agents if str(a).strip() not in ("", "nan")]

        return result

    except ImportError:
        return {"mohap_name": None, "upp_name": None,
                "mohap_agents": [], "upp_agents": [],
                "error": "rapidfuzz not installed"}


BD_TITLES = {
    "business development", "bd", "partnerships", "licensing",
    "commercial", "export", "international", "sales", "marketing",
}

def _is_bd_contact(title: str) -> bool:
    t = title.lower()
    return any(kw in t for kw in BD_TITLES)


def lookup_emails_hunter(domain: str) -> list:
    """Query Hunter.io domain search. Returns list of {name, email, title} dicts."""
    if not HUNTER_API_KEY or not domain or domain == "unknown":
        return []
    try:
        import urllib.request, json
        url  = f"https://api.hunter.io/v2/domain-search?domain={domain}&api_key={HUNTER_API_KEY}&limit=10"
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read())
        emails = data.get("data", {}).get("emails", [])
        contacts = []
        for e in emails:
            title = e.get("position") or e.get("title") or ""
            if _is_bd_contact(title):
                contacts.append({
                    "name":  f"{e.get('first_name', '')} {e.get('last_name', '')}".strip(),
                    "email": e.get("value", ""),
                    "title": title,
                    "confidence": e.get("confidence", 0),
                })
        # Fall back to any contact if no BD match found
        if not contacts and emails:
            e = emails[0]
            contacts.append({
                "name":  f"{e.get('first_name', '')} {e.get('last_name', '')}".strip(),
                "email": e.get("value", ""),
                "title": e.get("position") or e.get("title") or "Unknown",
                "confidence": e.get("confidence", 0),
            })
        return contacts
    except Exception as ex:
        return [{"error": str(ex)}]


def find_linkedin_contacts(company: str, model_name: str) -> list:
    """Search LinkedIn for BD contacts at the company, parse with LLM.
    Returns list of {name, title, linkedin_url} dicts."""
    if not TAVILY_API_KEY:
        return []
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=TAVILY_API_KEY)
        r = client.search(
            query=f'site:linkedin.com/in "{company}" "business development" OR "licensing" OR "export" OR "partnerships" pharmaceutical',
            max_results=6,
            search_depth="basic",
        )
        results = r.get("results", [])
        if not results:
            return []

        # Build a compact block for the LLM to parse
        raw = "\n\n".join(
            f"URL: {item['url']}\n{item['content'][:300]}"
            for item in results
        )

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

        import json
        raw_json = call_llm(parse_prompt, model_name)
        # Strip markdown code fences if present
        raw_json = raw_json.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        contacts = json.loads(raw_json)
        return contacts if isinstance(contacts, list) else []
    except Exception:
        return []


def parse_website(text: str, company: str) -> str:
    """Extract website from ## section for a given company."""
    import re
    pattern = rf"##\s+{re.escape(company)}.*?\*\*Website:\*\*\s*(\S+)"
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    if m:
        site = m.group(1).strip(".").replace("https://", "").replace("http://", "").split("/")[0]
        return site if site.lower() != "unknown" else ""
    return ""


def parse_company_names(text: str) -> list:
    """Extract company names from ## headers in the LLM output."""
    import re
    return re.findall(r"^##\s+(.+)$", text, re.MULTILINE)


def append_uae_flags(
    output: str,
    df_mohap, df_upp,
    mohap_names: set, upp_names: set,
    country: str = "",
    model_name: str = "haiku",
) -> tuple:
    """Insert UAE presence + distributor + BD contact lines after each ## company header.
    Returns (formatted_text, rows) where rows is a list of dicts for CSV export."""
    import re
    rows = []

    def replace_header(m):
        name  = m.group(1).strip()
        uae   = check_uae_presence(name, df_mohap, df_upp, mohap_names, upp_names)

        mohap_s = f"✓ `{uae['mohap_name']}`" if uae.get("mohap_name") else "✗ not found"
        upp_s   = f"✓ `{uae['upp_name']}`"   if uae.get("upp_name")   else "✗ not found"
        flag    = f"\n**UAE Presence:** MOHAP {mohap_s}  |  UPP {upp_s}"

        mohap_dist = ", ".join(uae.get("mohap_agents", [])[:5])
        upp_dist   = ", ".join(uae.get("upp_agents",   [])[:5])

        if mohap_dist:
            flag += f"\n**MOHAP Distributors:** {mohap_dist}"
        if upp_dist:
            flag += f"\n**UPP Distributors:** {upp_dist}"

        # LinkedIn contact lookup — Hunter.io if key present, else Tavily + LLM parse
        domain   = parse_website(output, name)
        contacts = lookup_emails_hunter(domain) if HUNTER_API_KEY else []
        if not contacts:
            contacts = find_linkedin_contacts(name, model_name)

        valid = [c for c in contacts[:3] if isinstance(c, dict) and "error" not in c]

        if valid:
            lines = []
            for c in valid:
                url = f" — {c['linkedin_url']}" if c.get("linkedin_url") else ""
                lines.append(f"{c.get('name', '—')} — {c.get('title', '—')}{url}")
                rows.append({
                    "country":          country,
                    "company":          name,
                    "mohap_match":      uae.get("mohap_name", ""),
                    "upp_match":        uae.get("upp_name", ""),
                    "mohap_dist":       mohap_dist,
                    "upp_dist":         upp_dist,
                    "contact_name":     c.get("name", ""),
                    "contact_title":    c.get("title", ""),
                    "linkedin_url":     c.get("linkedin_url", ""),
                })
            flag += "\n**BD Contacts:**\n" + "\n".join(f"  - {l}" for l in lines)
        else:
            flag += "\n**BD Contacts:** not found"
            rows.append({
                "country":       country,
                "company":       name,
                "mohap_match":   uae.get("mohap_name", ""),
                "upp_match":     uae.get("upp_name", ""),
                "mohap_dist":    mohap_dist,
                "upp_dist":      upp_dist,
                "contact_name":  "",
                "contact_title": "",
                "linkedin_url":  "",
            })

        return m.group(0) + flag

    formatted = re.sub(r"^(##\s+.+)$", replace_header, output, flags=re.MULTILINE)
    return formatted, rows


# ─────────────────────────────────────────────────────────────
# CSV export
# ─────────────────────────────────────────────────────────────

CSV_PATH = THIS_DIR / "BD contacts.csv"
CSV_HEADERS = [
    "date", "country", "company",
    "mohap_match", "upp_match", "mohap_dist", "upp_dist",
    "contact_name", "contact_title", "linkedin_url",
]

def save_to_csv(rows: list):
    import csv
    from datetime import date
    today = date.today().isoformat()
    write_header = not CSV_PATH.exists()
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        if write_header:
            writer.writeheader()
        for row in rows:
            writer.writerow({"date": today, **row})
    print(f"  Saved {len(rows)} row(s) → {CSV_PATH.name}")


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

def run(country: str, model_name: str):
    print(f"\n{'=' * 60}")
    print(f"  COMIX OUTREACH INTELLIGENCE — {country.upper()}")
    print(f"  Model: {model_name}")
    print(f"{'=' * 60}\n")

    print("  Running Tavily searches...")
    search_results = run_searches(country)

    print(f"  Calling {model_name} for company profiles...")
    prompt = PROMPT.replace("{country}", country).replace("{search_results}", search_results or "(none)")
    output = call_llm(prompt, model_name)

    print("  Loading UAE market data for presence check...")
    df_mohap, df_upp, mohap_names, upp_names = load_uae_data()

    print("  Checking UAE presence + finding LinkedIn BD contacts...\n")
    companies = parse_company_names(output)
    output_with_flags, rows = append_uae_flags(
        output, df_mohap, df_upp, mohap_names, upp_names,
        country=country, model_name=model_name,
    )

    print(output_with_flags)

    save_to_csv(rows)

    print(f"\n{'─' * 60}")
    print(f"  Companies identified: {len(companies)}")
    print(f"  Tokens in:  {_usage['input_tokens']:,}")
    print(f"  Tokens out: {_usage['output_tokens']:,}")
    print(f"  Cost:       ${_usage['cost_usd']:.4f} USD")
    print(f"{'─' * 60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="COMIX Outreach Intelligence Agent")
    parser.add_argument("--country", required=True)
    parser.add_argument("--model",   default="haiku", choices=list(MODELS))
    args = parser.parse_args()
    run(args.country, args.model)
