# COMIX BD Lean — Claude Context

## Project purpose

COMIX is a Dubai-based pharmaceutical licensing company. They in-license generic molecules from manufacturers globally and commercialise them in the UAE through local distributors. Current focus: CNS. Expanding into cardiovascular, metabolic, oncology. Strong preference for the private market channel (higher margins than LPO/government).

This repo is the BD intelligence tool used by the COMIX team to:
1. Evaluate manufacturer catalogues (PDF/CSV/Excel) for molecules worth licensing
2. Discover potential manufacturer partners by country
3. Find BD contacts at those manufacturers for outreach

The data layer (IQVIA, MOHAP, UPP CSVs + extractors) lives in the sibling repo `comix-bd-intelligence/` and is imported at runtime via `sys.path`.

---

## Architecture overview

Two entry points, one shared data layer:

```
comix-bd-lean/
├── agent.py           # Catalogue scoring + country discovery (two-pass)
└── outreach_agent.py  # Company profiling + contact finding (single-pass)

comix-bd-intelligence/   ← imported at runtime, not installed as a package
└── data_processing_extraction/
    ├── loader.py
    ├── iqvia.py
    ├── upp.py
    ├── mohap.py
    ├── molecule_normalizer.py
    └── benchmarks.py
```

`agent.py` and `outreach_agent.py` are independent — they share the MODELS dict pattern and API key config but do not call each other.

Both scripts add `comix-bd-intelligence/` to `sys.path` at startup so the data extractors are importable without installation.

---

## Two-pass pipeline (agent.py)

### Pass 1 — Discovery / Extraction
- **Model:** Haiku (cheap, fast). Default `--pass1 haiku`.
- **PDF mode:** Extract raw text from file → `smart_molecule_search()` → match against known IQVIA molecules
- **Country mode:** Tavily web search (3 queries) → `prompt_discovery.txt` → LLM returns JSON `{company, molecules[], portfolio_found}`
- Output: list of `(company, molecule)` pairs

### Python enrichment (between passes)
- `load_data()` loads all three CSVs once at startup via `load_all()`
- `lookup_molecule()` calls `get_iqvia_data()`, `get_upp_data()`, `get_mohap_data()` per molecule
- `compute_market_benchmarks()` runs once on full IQVIA
- `_build_atc4_context()` runs `compute_atc4_benchmarks()` per unique ATC4 class in the portfolio
- Result: structured enrichment block + market context + ATC4 context ready for injection

### Pass 2 — Scoring
- **Model:** gpt-4o-mini default. Override with `--pass2`. Use Anthropic models only on paid tier (30k token/min limit on free tier).
- Loads `prompt_scoring.txt`, injects `{market_context}`, `{atc4_context}`, `{companies_summary}`, `{enriched_data}` via `.replace()` (not `.format()` — prompt contains JSON braces)
- Streams output to terminal
- Output: markdown tables grouped by ATC1 therapeutic area, final ranked list, assessment paragraph

---

## Data flows

### PDF / Catalogue scan
```
--pdf file + --company name
    → extract_text_from_file()          # PyPDF2 / pdfplumber / pandas
    → smart_molecule_search()           # 3-pass: exact → combination → salt strip
    → lookup_molecule() × N             # IQVIA + UPP + MOHAP per molecule
    → compute_market_benchmarks()       # once, full IQVIA
    → _build_atc4_context()             # per unique ATC4 class
    → score()                           # Pass 2 streamed to terminal
```

### Country discovery
```
--country name
    → run_tavily_searches()             # 3 Tavily queries
    → Pass 1 LLM (prompt_discovery.txt) # returns JSON companies + molecules
    → lookup_molecule() × N             # enrichment
    → compute_market_benchmarks()
    → _build_atc4_context()
    → score()                           # Pass 2 streamed to terminal
```

### Outreach flow (outreach_agent.py)
```
--country name
    → run_searches()                    # 3 Tavily queries
    → call_llm(PROMPT)                  # Haiku: returns 5 company profiles as markdown
    → load_uae_data()                   # MOHAP + UPP DataFrames
    → parse_company_names()             # extract ## headers
    → append_uae_flags()                # per company:
        → check_uae_presence()          #   fuzzy match vs MOHAP + UPP names
        → lookup_emails_hunter()        #   Hunter.io if key set
        → find_linkedin_contacts()      #   Tavily site:linkedin.com + Haiku parse
    → save_to_csv()                     # append to "BD contacts.csv"
    → print formatted output
```

---

## Key files

| File | Responsibility |
|------|---------------|
| `agent.py` | Two-pass BD scoring agent — both PDF and country modes |
| `outreach_agent.py` | Outreach intelligence — profiles 5 companies, checks UAE presence, finds BD contacts |
| `prompt_discovery.txt` | Pass 1 prompt — instructs LLM to extract companies + molecules as JSON |
| `prompt_scoring.txt` | Pass 2 prompt — data field reference table + scoring rules + output format |
| `prompt.txt` | Legacy single-pass prompt — unused, kept for reference |
| `requirements.txt` | Python dependencies |
| `.env` | API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, TAVILY_API_KEY, HUNTER_API_KEY |
| `.gitignore` | Excludes .env, __pycache__, .DS_Store |
| `BD contacts.csv` | Appended on every outreach_agent.py run — one row per BD contact found |
| `catalogues/` | Drop PDFs, CSVs, Excel files here for scanning |
| `catalogues/Tecnimed shortlist.xlsx` | Tecnimed portfolio — primary test file |
| `catalogues/Adalvo.pdf` | Adalvo catalogue |

---

## How to run

```bash
cd ~/Desktop/COMIXBusinessDevelopment/comix-bd-lean

# PDF / catalogue scan
python agent.py --pdf "catalogues/Tecnimed shortlist.xlsx" --company "Tecnimed"
python agent.py --pdf "catalogues/Adalvo.pdf" --company "Adalvo" --pass2 sonnet

# Country discovery
python agent.py --country "Portugal"
python agent.py --country "India" --pass1 haiku --pass2 gpt-4o-mini

# Outreach (company profiles + UAE presence + BD contacts → BD contacts.csv)
python outreach_agent.py --country "Portugal"
python outreach_agent.py --country "India" --model gpt-4o-mini
```

**Model guidance:**
- Pass 1 default: `haiku` — keep it, cheap and the task is simple extraction
- Pass 2 default: `gpt-4o-mini` — use unless on paid Anthropic tier (free tier hits 30k token/min limit)
- `sonnet` for Pass 2 gives best reasoning but costs ~25× more than gpt-4o-mini
- `outreach_agent.py` defaults to `haiku` — fine, profile generation is straightforward

---

## Current state and known issues

**Working:**
- PDF, CSV, and Excel catalogue ingestion
- Three-pass molecule extraction (exact → combination → salt form)
- Full IQVIA/UPP/MOHAP enrichment per molecule
- ATC3 + ATC4 class benchmarks injected into scoring prompt
- Market-wide benchmarks injected into scoring prompt
- Fragmentation signals (leader CAGR, second player CAGR, leader share change)
- UAE presence check in outreach_agent (MOHAP + UPP fuzzy match)
- Distributor lookup from MOHAP Agent and UPP Agent Name columns
- CSV export of BD contacts (append mode)
- Token + cost tracking on every run

**Fragile:**
- **LinkedIn contact quality is poor.** `find_linkedin_contacts()` runs a Tavily `site:linkedin.com` search and passes snippets to Haiku for parsing — but Tavily snippets are often truncated or off-target, and Haiku occasionally returns empty arrays or hallucinated profiles. No clean fix without a proper LinkedIn API.
- Hunter.io email lookup is wired but requires a paid Hunter key in `.env`. Not tested in production.
- Country mode Pass 1 can return `portfolio_found: false` for companies with no public web presence — correct behaviour (anti-hallucination guard), not a bug.
- Anthropic free tier will 429 on large Pass 2 runs. Use OpenAI for Pass 2 on free tier.

**Deferred — do not implement without discussion:**
- Google Sheets integration (CSV is current approach)
- Outreach email drafting per contact
- Recent generic entrant performance tracking (time-series per manufacturer)
- Dataset-wide benchmark calibration file

---

## Constraints — never change without discussion

1. **Hard disqualifiers in scoring prompt** — `num_competitors > 10` → max score 5; `market_value < 5M AED AND value_cagr < 10%` → max score 4. Deliberate COMIX policy.

2. **Prompt injection uses `.replace()` not `.format()`** — `prompt_discovery.txt` and `prompt_scoring.txt` contain JSON braces `{}` that break `.format()`. Never switch to f-strings or `.format()`.

3. **CSV append behaviour** — `save_to_csv()` appends to `BD contacts.csv` on every run. Header written only if file does not exist. Do not overwrite.

4. **Scoring output grouped by ATC1** — one markdown table per ATC1 therapeutic area, not per company. Intentional for COMIX's review workflow.

5. **`load_all()` called once at startup** — DataFrames are loaded once and passed as arguments throughout. Never re-read CSVs per molecule.

6. **Combination molecule division** — all value/unit aggregations divided by `num_molecules` to correct IQVIA double-counting. Never remove.

7. **IQVIA end_year = `years[-2]`** — most recent year is partial data. Do not change to `years[-1]`.

---

## Terminology glossary

**Pass 1** — The cheap first LLM call. In country mode: extracts company names and molecules from web search results as JSON. In PDF mode: `smart_molecule_search()` handles extraction without an LLM; "Pass 1" refers to this extraction step.

**Pass 2** — The quality scoring LLM call. Receives fully enriched molecule data + market benchmarks + ATC4 benchmarks. Streams scored output grouped by ATC1 therapeutic area.

**Catalogue scan** — PDF mode operation. A manufacturer's product catalogue (PDF, CSV, or Excel) is uploaded, molecules extracted via `smart_molecule_search()`, and the portfolio scored. Preferred over country discovery because web search returns snippets, not full portfolios.

**Fragmentation signal** — Indicators that a market leader is losing grip: `leader_units_cagr` negative while market grows, `second_value_cagr` >> `leader_value_cagr`, `leader_share_change` consistently negative, `top3_company_share` declining. COMIX targets these markets as entry opportunities.

**cagr_delta** — `value_cagr − unit_cagr`. Positive = prices rising (good margin signal). Negative = price compression / commoditisation. Molecule-level only.

**UAE presence check** — Fuzzy match (rapidfuzz `token_set_ratio`, threshold 80) of a company name against MOHAP `Company` and UPP `Manufacturer Name` columns. Returns matched canonical name + associated distributor names from MOHAP `Agent` and UPP `Agent Name` columns.

**BD contacts** — Business development, licensing, partnerships, export, commercial, or international sales contacts at a target manufacturer. Found via Hunter.io domain search (structured) or Tavily `site:linkedin.com` search + Haiku parse (fallback). Saved to `BD contacts.csv`.
