"""
agent_runner.py
---------------
Web-adapted BD analysis logic for the COMIX deploy app.
Core logic is identical to agent.py — same enrichment fields, same prompt injection,
same .replace() pattern. Adapted to return structured data instead of printing,
and to stream Pass 2 via a generator rather than stdout.
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path
from typing import Generator

from dotenv import load_dotenv

load_dotenv(override=True)

BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY    = os.getenv("OPENAI_API_KEY", "")

MODELS = {
    "haiku":       ("anthropic", "claude-haiku-4-5-20251001", 0.0008,  0.004),
    "sonnet":      ("anthropic", "claude-sonnet-4-6",         0.003,   0.015),
    "gpt-4o-mini": ("openai",    "gpt-4o-mini",               0.00015, 0.0006),
    "gpt-4o":      ("openai",    "gpt-4o",                    0.0025,  0.01),
}


# ─── Data loading ─────────────────────────────────────────────────────────────

def load_data(data_dir: Path) -> tuple[dict, str]:
    """Load IQVIA/UPP/MOHAP once at startup. Returns (dfs, market_context)."""
    from data_processing.loader     import load_all
    from data_processing.benchmarks import compute_market_benchmarks, format_market_context

    dfs = load_all(
        iqvia_path=str(data_dir / "iqvia.csv"),
        upp_path=str(data_dir / "upp.csv"),
        mohap_path=str(data_dir / "mohap.csv"),
    )
    market_context = format_market_context(compute_market_benchmarks(dfs["iqvia"]))
    return dfs, market_context


# ─── Molecule lookup — identical field set to agent.py ───────────────────────

def lookup_molecule(molecule: str, dfs: dict) -> dict:
    from data_processing.iqvia  import get_iqvia_data
    from data_processing.upp    import get_upp_data
    from data_processing.mohap  import get_mohap_data

    mol_upper = molecule.upper()
    iqvia = get_iqvia_data(dfs["iqvia"], mol_upper)
    upp   = get_upp_data(dfs["upp"],     mol_upper)
    mohap = get_mohap_data(dfs["mohap"], mol_upper)

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
            "atc1_class":           iqvia.get("atc1"),
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


def _build_atc4_context(lookups: dict, df_iqvia) -> str:
    from data_processing.benchmarks import compute_atc4_benchmarks, format_atc4_context
    seen, blocks = set(), []
    for d in lookups.values():
        atc4 = d.get("atc4_class")
        if atc4 and atc4 not in seen:
            seen.add(atc4)
            b = compute_atc4_benchmarks(df_iqvia, atc4)
            if b:
                blocks.append(format_atc4_context(b))
    return "\n\n".join(blocks)


def format_enriched_data(companies: list, lookups: dict) -> str:
    """Identical format to agent.py — feeds directly into prompt_scoring.txt."""
    def _aed(v): return f"{v:,.0f} AED" if v is not None else "N/A"
    def _pct(v): return f"{v:.1f}%"     if v is not None else "N/A"

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


# ─── Phase 1: Extract + Enrich ───────────────────────────────────────────────

def extract_and_enrich(file_bytes: bytes, filename: str, company_name: str, dfs: dict) -> dict:
    """Extract molecules from uploaded file and enrich with market data."""
    from data_processing.molecule_normalizer import smart_molecule_search

    text = _extract_text(file_bytes, filename)
    known_molecules = set(dfs["iqvia"]["Molecule Combination"].dropna().unique())
    found_molecules, contexts = smart_molecule_search(text, known_molecules)

    lookups = {mol.lower(): lookup_molecule(mol, dfs) for mol in found_molecules}
    atc4_context = _build_atc4_context(lookups, dfs["iqvia"])
    companies = [{"name": company_name, "molecules": found_molecules}]
    enriched_data = format_enriched_data(companies, lookups)

    return _build_response(companies, lookups, enriched_data, atc4_context, contexts)


def enrich_molecules(molecules: list[str], company_name: str, dfs: dict) -> dict:
    """Enrich a manually selected list of molecules (craft / single molecule modes)."""
    df_upper = dfs["iqvia"]["Molecule Combination"].str.upper()
    found = [m for m in molecules if m.upper() in df_upper.values]

    lookups = {mol.lower(): lookup_molecule(mol, dfs) for mol in found}
    atc4_context = _build_atc4_context(lookups, dfs["iqvia"])
    companies = [{"name": company_name, "molecules": found}]
    enriched_data = format_enriched_data(companies, lookups)

    return _build_response(companies, lookups, enriched_data, atc4_context, {})


def _build_response(companies, lookups, enriched_data, atc4_context, contexts) -> dict:
    molecules_data = []
    molecules_by_atc1: dict[str, list[str]] = {}
    molecule_metrics: dict[str, dict] = {}

    for _, d in lookups.items():
        mol_name = d["molecule"]
        card: dict = {"molecule": mol_name, "in_iqvia": d["in_iqvia"], "context": contexts.get(mol_name, "")}

        if d["in_iqvia"]:
            card.update({
                "market_value_aed":   d.get("market_value_aed"),
                "value_cagr_pct":     d.get("value_cagr_pct"),
                "unit_cagr_pct":      d.get("unit_cagr_pct"),
                "num_competitors":    d.get("num_competitors"),
                "market_leader":      d.get("market_leader"),
                "leader_share_pct":   d.get("leader_share_pct"),
                "leader_share_change":d.get("leader_share_change"),
                "second_player":      d.get("second_player"),
                "private_pct":        d.get("private_pct"),
                "lpo_pct":            d.get("lpo_pct"),
                "launch_year":        d.get("launch_year"),
                "atc1_class":         d.get("atc1_class"),
                "atc3_class":         d.get("atc3_class"),
                "atc4_class":         d.get("atc4_class"),
                "cagr_delta":         d.get("cagr_delta"),
                "top3_company_share": d.get("top3_company_share"),
                "upp_manufacturers":  d.get("upp_manufacturers", 0),
                "mohap_manufacturers":d.get("mohap_manufacturers", 0),
            })
            atc1 = d.get("atc1_class") or "Unknown"
            molecules_by_atc1.setdefault(atc1, []).append(mol_name)
            molecule_metrics[mol_name] = {
                "value":              d.get("market_value_aed") or 0,
                "cagr":               d.get("value_cagr_pct"),
                "num_manufacturers":  d.get("num_competitors") or 0,
                "upp_manufacturers":  d.get("upp_manufacturers", 0),
                "mohap_manufacturers":d.get("mohap_manufacturers", 0),
                "private_pct":        d.get("private_pct"),
                "lpo_pct":            d.get("lpo_pct"),
            }

        molecules_data.append(card)

    return {
        "companies":        companies,
        "molecules":        molecules_data,
        "molecules_by_atc1":molecules_by_atc1,
        "molecule_metrics": molecule_metrics,
        "enriched_data":    enriched_data,
        "atc4_context":     atc4_context,
        "stats": {
            "total":          len(lookups),
            "matched_iqvia":  sum(1 for d in lookups.values() if d["in_iqvia"]),
        },
    }


def _extract_text(content: bytes, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in (".csv", ".xlsx", ".xls"):
        import pandas as pd
        buf = io.BytesIO(content)
        df = pd.read_csv(buf) if suffix == ".csv" else pd.read_excel(buf)
        return " ".join(
            df[col].dropna().astype(str).str.cat(sep=" ")
            for col in df.columns if df[col].dtype == object
        )
    text = ""
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(content))
        for page in reader.pages:
            t = page.extract_text()
            if t:
                text += t + " "
    except Exception:
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        text += t + " "
        except Exception:
            pass
    return text


# ─── Phase 2: Scoring stream ─────────────────────────────────────────────────

def score_stream(
    source_name: str,
    companies: list,
    enriched_data: str,
    model_name: str,
    market_context: str,
    atc4_context: str,
    prompts_dir: Path,
) -> Generator[str, None, None]:
    """
    Generator that yields Pass 2 text chunks.
    Uses prompt_scoring.txt unchanged — same .replace() injection as agent.py.
    """
    template = (prompts_dir / "prompt_scoring.txt").read_text(encoding="utf-8")
    companies_summary = "\n".join(
        f"- {c['name']}: {', '.join(c.get('molecules', []))}"
        for c in companies
    )
    prompt = (
        template
        .replace("{country}",           source_name)
        .replace("{companies_summary}", companies_summary)
        .replace("{enriched_data}",     enriched_data)
        .replace("{market_context}",    market_context)
        .replace("{atc4_context}",      atc4_context)
    )

    provider, model_id, _, _ = MODELS.get(model_name, MODELS["gpt-4o-mini"])

    if provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        with client.messages.stream(
            model=model_id, max_tokens=8096,
            messages=[{"role": "user", "content": prompt}],
        ) as s:
            for text in s.text_stream:
                yield text
    else:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
        stream = client.chat.completions.create(
            model=model_id, max_tokens=8096, stream=True,
            messages=[{"role": "user", "content": prompt}],
        )
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


# ─── Manufacturer breakdown for pie chart ────────────────────────────────────

def get_manufacturer_breakdown(molecule: str, df_iqvia) -> dict:
    """Return top manufacturers + value share for a molecule (for pie chart)."""
    df = df_iqvia[df_iqvia["Molecule Combination"].str.upper() == molecule.upper()].copy()
    if df.empty:
        return {"manufacturers": [], "total": 0, "year": ""}

    value_cols = sorted(c for c in df.columns if c.endswith("LC Value"))
    if not value_cols:
        return {"manufacturers": [], "total": 0, "year": ""}

    # years[-2] rule — most recent year is partial
    col = value_cols[-2] if len(value_cols) >= 2 else value_cols[-1]
    agg = df.groupby("Manufacturer")[col].sum().sort_values(ascending=False).head(10)
    total = float(agg.sum())

    return {
        "manufacturers": [
            {"name": mfr, "value": float(val), "share_pct": round(float(val) / total * 100, 1) if total else 0}
            for mfr, val in agg.items()
        ],
        "total": total,
        "year":  col.split(" ")[0],
    }
