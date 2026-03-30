"""
agent.py
--------
Two-pass pharmaceutical BD intelligence agent for COMIX.

Country mode (web discovery):
    python agent.py --country "Portugal"
    python agent.py --country "India" --pass1 haiku --pass2 sonnet

PDF mode (catalogue scan):
    python agent.py --pdf catalogue.pdf
    python agent.py --pdf catalogue.pdf --company "Bluepharma" --pass2 sonnet
"""

import argparse
import json
import os
import re
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

# Make comix-bd-intelligence importable so we can reuse its data extractors
sys.path.insert(0, str(BD_INTEL_DIR))

DISCOVERY_PROMPT = THIS_DIR / "prompt_discovery.txt"
SCORING_PROMPT   = THIS_DIR / "prompt_scoring.txt"

# ─────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY    = os.getenv("OPENAI_API_KEY", "")
TAVILY_API_KEY    = os.getenv("TAVILY_API_KEY", "")

# Friendly name → (provider, model_id, cost_per_1k_in, cost_per_1k_out)  USD
MODELS = {
    "haiku":       ("anthropic", "claude-haiku-4-5-20251001", 0.0008,  0.004),
    "sonnet":      ("anthropic", "claude-sonnet-4-6",         0.003,   0.015),
    "gpt-4o-mini": ("openai",    "gpt-4o-mini",               0.00015, 0.0006),
    "gpt-4o":      ("openai",    "gpt-4o",                    0.0025,  0.01),
}

# Token accumulator for the full run
_usage = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}


# ─────────────────────────────────────────────────────────────
# Tavily pre-search
# ─────────────────────────────────────────────────────────────

def search_manufacturers(country: str) -> str:
    if not TAVILY_API_KEY:
        return ""
    try:
        from tavily import TavilyClient
        client   = TavilyClient(api_key=TAVILY_API_KEY)
        response = client.search(
            query=f"top generic pharmaceutical manufacturers CDMOs {country} 2024",
            max_results=5,
            search_depth="basic",
        )
        return "\n\n".join(
            f"Source: {r['url']}\n{r['content'][:400]}"
            for r in response.get("results", [])
        )
    except Exception as e:
        print(f"[Tavily search failed: {e}]\n")
        return ""


# ─────────────────────────────────────────────────────────────
# LLM calls
# ─────────────────────────────────────────────────────────────

def _track(model_name: str, input_tokens: int, output_tokens: int):
    _, _, cost_in, cost_out = MODELS[model_name]
    cost = (input_tokens / 1000 * cost_in) + (output_tokens / 1000 * cost_out)
    _usage["input_tokens"]  += input_tokens
    _usage["output_tokens"] += output_tokens
    _usage["cost_usd"]      += cost


def call_llm(prompt: str, model_name: str, stream: bool = False) -> str:
    """
    Call the LLM by friendly model name (haiku / sonnet / gpt-4o-mini / gpt-4o).
    stream=True prints to stdout and returns "".
    stream=False returns the full text response.
    """
    if model_name not in MODELS:
        raise ValueError(f"Unknown model '{model_name}'. Choose from: {list(MODELS)}")

    provider, model_id, _, _ = MODELS[model_name]

    if provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        if stream:
            with client.messages.stream(
                model=model_id,
                max_tokens=8096,
                messages=[{"role": "user", "content": prompt}],
            ) as s:
                for text in s.text_stream:
                    print(text, end="", flush=True)
                msg = s.get_final_message()
                _track(model_name, msg.usage.input_tokens, msg.usage.output_tokens)
            return ""
        else:
            resp = client.messages.create(
                model=model_id,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            _track(model_name, resp.usage.input_tokens, resp.usage.output_tokens)
            return resp.content[0].text

    else:  # openai
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
        if stream:
            s = client.chat.completions.create(
                model=model_id,
                max_tokens=8096,
                stream=True,
                stream_options={"include_usage": True},
                messages=[{"role": "user", "content": prompt}],
            )
            for chunk in s:
                if chunk.choices:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        print(delta, end="", flush=True)
                if chunk.usage:
                    _track(model_name, chunk.usage.prompt_tokens, chunk.usage.completion_tokens)
            return ""
        else:
            resp = client.chat.completions.create(
                model=model_id,
                max_tokens=2048,
                stream=False,
                messages=[{"role": "user", "content": prompt}],
            )
            _track(model_name, resp.usage.prompt_tokens, resp.usage.completion_tokens)
            return resp.choices[0].message.content


# ─────────────────────────────────────────────────────────────
# Pass 1 — Discovery
# ─────────────────────────────────────────────────────────────

def discover(country: str, search_results: str, model_name: str) -> list:
    """Returns list of company dicts: {name, website, description, molecules}"""
    template = DISCOVERY_PROMPT.read_text(encoding="utf-8")
    prompt   = (
        template
        .replace("{country}", country)
        .replace("{search_results}", search_results or "(none — use training knowledge)")
    )

    print(f"  Pass 1 [{model_name}]: discovering companies and portfolios...")
    raw  = call_llm(prompt, model_name, stream=False)
    text = raw.strip()

    # Strip markdown fences if present
    text = re.sub(r"^```[a-z]*\n?", "", text)
    text = re.sub(r"\n?```$",       "", text)
    text = text.strip()

    try:
        data = json.loads(text)
        return data.get("companies", [])
    except json.JSONDecodeError:
        # Try extracting a JSON object from somewhere in the response
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group()).get("companies", [])
            except Exception:
                pass

    print("  [Warning: could not parse discovery JSON — check Pass 1 output]")
    return []


# ─────────────────────────────────────────────────────────────
# Data layer — reuse comix-bd-intelligence extractors
# ─────────────────────────────────────────────────────────────

_dfs            = None
_market_context = None   # computed once, cached

def load_data() -> dict:
    global _dfs, _market_context
    if _dfs is None:
        from data_processing_extraction.loader     import load_all
        from data_processing_extraction.benchmarks import compute_market_benchmarks, format_market_context
        print("  Loading UAE market data (IQVIA / UPP / MOHAP)...")
        _dfs = load_all(
            iqvia_path=str(DATA_DIR / "iqvia.csv"),
            upp_path=str(DATA_DIR / "upp.csv"),
            mohap_path=str(DATA_DIR / "mohap.csv"),
        )
        print("  Computing market benchmarks...")
        _market_context = format_market_context(compute_market_benchmarks(_dfs["iqvia"]))
    return _dfs


def lookup_molecule(molecule: str, dfs: dict) -> dict:
    from data_processing_extraction.iqvia  import get_iqvia_data
    from data_processing_extraction.upp    import get_upp_data
    from data_processing_extraction.mohap  import get_mohap_data

    mol_upper = molecule.upper()
    iqvia  = get_iqvia_data(dfs["iqvia"], mol_upper)
    upp    = get_upp_data(dfs["upp"],     mol_upper)
    mohap  = get_mohap_data(dfs["mohap"], mol_upper)

    result = {"molecule": molecule, "in_iqvia": iqvia is not None}

    if iqvia:
        result.update({
            "market_value_aed":     iqvia.get("total_value"),
            "value_cagr_pct":       iqvia.get("value_cagr"),
            "unit_cagr_pct":        iqvia.get("unit_cagr"),
            "num_competitors":      iqvia.get("num_competitors"),
            "market_leader":        iqvia.get("market_leader"),
            "leader_share_pct":     iqvia.get("market_leader_share"),
            "leader_share_change":  iqvia.get("leader_share_change"),
            "leader_value_cagr":    iqvia.get("leader_value_cagr"),
            "leader_units_cagr":    iqvia.get("leader_units_cagr"),
            "top3_company_share":   iqvia.get("top3_company_share"),
            "cagr_delta":           iqvia.get("cagr_delta"),
            "second_player":        iqvia.get("second_player"),
            "second_value_cagr":    iqvia.get("second_value_cagr"),
            "second_units_cagr":    iqvia.get("second_units_cagr"),
            "private_pct":          iqvia.get("private_pct"),
            "lpo_pct":              iqvia.get("lpo_pct"),
            "launch_year":          iqvia.get("launch_year"),
            "atc4_class":           iqvia.get("atc4"),
            "atc4_class_value_aed": iqvia.get("atc4_class_value"),
            "atc4_class_units":     iqvia.get("atc4_class_units"),
            "atc4_class_cagr":      iqvia.get("atc4_class_cagr"),
            "atc4_molecule_count":  iqvia.get("atc4_molecule_count"),
            "atc4_value_rank":      iqvia.get("atc4_value_rank"),
            "atc4_units_rank":      iqvia.get("atc4_units_rank"),
            "atc4_value_pct":       iqvia.get("atc4_value_pct"),
            "atc4_units_pct":       iqvia.get("atc4_units_pct"),
            "atc3_class":           iqvia.get("atc3"),
            "atc3_class_value_aed": iqvia.get("atc3_class_value"),
            "atc3_class_units":     iqvia.get("atc3_class_units"),
            "atc3_class_cagr":      iqvia.get("atc3_class_cagr"),
            "atc3_molecule_count":  iqvia.get("atc3_molecule_count"),
            "atc3_value_rank":      iqvia.get("atc3_value_rank"),
            "atc3_units_rank":      iqvia.get("atc3_units_rank"),
            "atc3_value_pct":       iqvia.get("atc3_value_pct"),
            "atc3_units_pct":       iqvia.get("atc3_units_pct"),
            "private_cagr":         iqvia.get("private_cagr"),
            "lpo_cagr":             iqvia.get("lpo_cagr"),
        })

    result["upp_manufacturers"]   = upp.get("num_manufacturers",   0) if upp   else 0
    result["mohap_manufacturers"] = mohap.get("num_manufacturers", 0) if mohap else 0
    return result


def format_enriched_data(companies: list, lookups: dict) -> str:
    lines = []
    for company in companies:
        lines.append(f"\n### {company['name']}")
        for mol in company.get("molecules", []):
            d = lookups.get(mol.lower(), {"molecule": mol, "in_iqvia": False})
            if d["in_iqvia"]:
                lines.append(
                    f"  {mol}:\n"
                    f"    market={_aed(d.get('market_value_aed'))}, value_cagr={_pct(d.get('value_cagr_pct'))}, "
                    f"competitors={d.get('num_competitors', 'N/A')}, launch={d.get('launch_year', 'N/A')}\n"
                    f"    private={_pct(d.get('private_pct'))}, private_cagr={_pct(d.get('private_cagr'))}, "
                    f"lpo={_pct(d.get('lpo_pct'))}, lpo_cagr={_pct(d.get('lpo_cagr'))}\n"
                    f"    leader_share={_pct(d.get('leader_share_pct'))}, leader_change={_pct(d.get('leader_share_change'))}, "
                    f"top3_share={_pct(d.get('top3_company_share'))}, cagr_delta={d.get('cagr_delta', 'N/A')}%\n"
                    f"    leader={d.get('market_leader', 'N/A')}, leader_value_cagr={_pct(d.get('leader_value_cagr'))}, "
                    f"leader_units_cagr={_pct(d.get('leader_units_cagr'))}\n"
                    f"    second_player={d.get('second_player', 'N/A')}, second_value_cagr={_pct(d.get('second_value_cagr'))}, "
                    f"second_units_cagr={_pct(d.get('second_units_cagr'))}\n"
                    f"    upp_mfrs={d.get('upp_manufacturers', 0)}, mohap_mfrs={d.get('mohap_manufacturers', 0)}\n"
                    f"    atc4={d.get('atc4_class', 'N/A')}, atc4_molecules={d.get('atc4_molecule_count', 'N/A')}, "
                    f"atc4_value_rank={d.get('atc4_value_rank', 'N/A')}, atc4_units_rank={d.get('atc4_units_rank', 'N/A')}, "
                    f"atc4_value_pct={d.get('atc4_value_pct', 'N/A')}%, atc4_units_pct={d.get('atc4_units_pct', 'N/A')}%\n"
                    f"    atc3={d.get('atc3_class', 'N/A')}, atc3_molecules={d.get('atc3_molecule_count', 'N/A')}, "
                    f"atc3_value_rank={d.get('atc3_value_rank', 'N/A')}, atc3_units_rank={d.get('atc3_units_rank', 'N/A')}, "
                    f"atc3_value_pct={d.get('atc3_value_pct', 'N/A')}%, atc3_units_pct={d.get('atc3_units_pct', 'N/A')}%"
                )
            else:
                lines.append(f"  {mol}: NOT IN UAE DATA")
    return "\n".join(lines)


def _aed(v): return f"{v:,.0f} AED" if v is not None else "N/A"
def _pct(v): return f"{v:.1f}%"     if v is not None else "N/A"


# ─────────────────────────────────────────────────────────────
# Pass 2 — Scoring
# ─────────────────────────────────────────────────────────────

def score(country: str, companies: list, enriched_data: str, model_name: str,
          market_context: str = "", atc4_context: str = ""):
    template = SCORING_PROMPT.read_text(encoding="utf-8")

    companies_summary = "\n".join(
        f"- {c['name']}: {', '.join(c.get('molecules', []))}"
        for c in companies
    )

    prompt = (
        template
        .replace("{country}",          country)
        .replace("{companies_summary}", companies_summary)
        .replace("{enriched_data}",    enriched_data)
        .replace("{market_context}",   market_context)
        .replace("{atc4_context}",     atc4_context)
    )

    print(f"  Pass 2 [{model_name}]: scoring with UAE market data...\n")
    call_llm(prompt, model_name, stream=True)


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

def run(country: str, pass1: str, pass2: str):
    print(f"Searching for manufacturers in {country}...")
    search_results = search_manufacturers(country)

    print(f"\n{'=' * 60}")
    print(f"  COMIX BD INTELLIGENCE — {country.upper()}")
    print(f"  Pass 1: {pass1}  |  Pass 2: {pass2}")
    print(f"{'=' * 60}\n")

    # Pass 1: discover
    companies = discover(country, search_results, pass1)
    if not companies:
        print("No companies discovered. Exiting.")
        return

    for c in companies:
        found_flag = c.get("portfolio_found", True)
        mol_count  = len(c.get("molecules", []))
        status     = f"{mol_count} molecules" if found_flag else "no portfolio found (skipped)"
        print(f"    • {c['name']}: {status}")

    all_molecules = [mol for c in companies for mol in c.get("molecules", [])]
    print(f"  Total: {len(companies)} companies, {len(all_molecules)} molecules")

    # Data lookup
    dfs     = load_data()
    lookups = {mol.lower(): lookup_molecule(mol, dfs) for mol in all_molecules}
    found   = sum(1 for d in lookups.values() if d["in_iqvia"])
    print(f"  {found}/{len(all_molecules)} molecules matched in IQVIA\n")

    # Pass 2: score
    enriched     = format_enriched_data(companies, lookups)
    atc4_context = _build_atc4_context(lookups, dfs["iqvia"])
    score(country, companies, enriched, pass2, _market_context or "", atc4_context)
    _print_usage()


def _build_atc4_context(lookups: dict, df_iqvia) -> str:
    from data_processing_extraction.benchmarks import compute_atc4_benchmarks, format_atc4_context
    seen = set()
    blocks = []
    for d in lookups.values():
        atc4 = d.get("atc4_class")
        if atc4 and atc4 not in seen:
            seen.add(atc4)
            b = compute_atc4_benchmarks(df_iqvia, atc4)
            if b:
                blocks.append(format_atc4_context(b))
    return "\n\n".join(blocks)


def _print_usage():
    print(f"\n{'─' * 60}")
    print(f"  Tokens in:  {_usage['input_tokens']:,}")
    print(f"  Tokens out: {_usage['output_tokens']:,}")
    print(f"  Cost:       ${_usage['cost_usd']:.4f} USD")
    print(f"{'─' * 60}\n")


# ─────────────────────────────────────────────────────────────
# PDF mode
# ─────────────────────────────────────────────────────────────

def extract_text_from_file(path: str) -> str:
    import io
    suffix = Path(path).suffix.lower()

    if suffix in (".csv", ".xlsx", ".xls"):
        import pandas as pd
        df = pd.read_csv(path) if suffix == ".csv" else pd.read_excel(path)
        # Concatenate all string columns into one blob of text
        return " ".join(
            df[col].dropna().astype(str).str.cat(sep=" ")
            for col in df.columns
            if df[col].dtype == object
        )

    # PDF (default)
    content = open(path, "rb").read()
    text = ""
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(content))
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + " "
    except Exception:
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + " "
        except ImportError:
            raise RuntimeError("Install PyPDF2 or pdfplumber: pip install PyPDF2")
    return text


def scan_pdf(pdf_path: str, company_name: str, pass2: str):
    print(f"\n{'=' * 60}")
    print(f"  COMIX BD — PDF SCAN: {company_name}")
    print(f"  Scoring model: {pass2}")
    print(f"{'=' * 60}\n")

    # Extract text
    print(f"  Extracting text from {Path(pdf_path).suffix.upper() or 'file'}...")
    text = extract_text_from_file(pdf_path)
    print(f"  {len(text):,} characters extracted")

    # Load data + get known molecules
    dfs = load_data()
    known_molecules = set(dfs["iqvia"]["Molecule Combination"].dropna().unique())

    # Smart molecule search
    from data_processing_extraction.molecule_normalizer import smart_molecule_search
    print("  Matching molecules against IQVIA...")
    found_molecules, contexts = smart_molecule_search(text, known_molecules)
    print(f"  {len(found_molecules)} molecules matched in IQVIA\n")

    if not found_molecules:
        print("  No molecules matched. Check the PDF contains INN molecule names.")
        return

    for mol in found_molecules:
        print(f"    • {mol}  [{contexts.get(mol, '')}]")
    print()

    # Look up market data
    lookups = {mol.lower(): lookup_molecule(mol, dfs) for mol in found_molecules}

    # Structure as a single-company list for format_enriched_data
    companies = [{"name": company_name, "molecules": found_molecules}]
    enriched  = format_enriched_data(companies, lookups)

    # Score
    atc4_context = _build_atc4_context(lookups, dfs["iqvia"])
    score(company_name, companies, enriched, pass2, _market_context or "", atc4_context)
    _print_usage()


# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="COMIX BD Intelligence Agent")

    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--country", help="Discover manufacturers in this country")
    mode.add_argument("--pdf",     help="Path to a manufacturer's PDF catalogue")

    parser.add_argument("--company", default=None,        help="Company name (PDF mode, defaults to filename)")
    parser.add_argument("--pass1",   default="haiku",       choices=list(MODELS), help="Discovery model (default: haiku)")
    parser.add_argument("--pass2",   default="gpt-4o-mini", choices=list(MODELS), help="Scoring model (default: gpt-4o-mini)")
    args = parser.parse_args()

    if args.pdf:
        company = args.company or Path(args.pdf).stem
        scan_pdf(args.pdf, company, args.pass2)
    else:
        run(args.country, args.pass1, args.pass2)
