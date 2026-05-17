# COMIX BD Intelligence — Claude Context

## Business context

COMIX is a Dubai-based pharmaceutical licensing company. They in-license generic molecules from manufacturers globally and commercialise them in the UAE through local distributors. Current focus: CNS. Expanding into cardiovascular, metabolic, oncology. Strong preference for the private market channel (higher margins than LPO/government).

This repo is the **web application** that powers COMIX's BD intelligence workflow. It replaces the old CLI scripts (`agent.py`, `outreach_agent.py`) with a full-stack hosted product.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Plotly |
| Backend | FastAPI (Python), uvicorn |
| Database | SQLite (`data/contacts.db`) — survives Railway restarts via persistent volume |
| Deployment | Frontend → Vercel, Backend → Railway |
| AI | Anthropic Claude (haiku/sonnet) + OpenAI (gpt-4o-mini/gpt-4o) |
| Data | IQVIA, MOHAP, UPP CSVs — loaded once at startup into DataFrames |

---

## Repository layout

```
Claude_App/
├── CLAUDE.md
└── deploy app/
    ├── backend/
    │   ├── main.py                    # FastAPI app — all API endpoints
    │   ├── agent_runner.py            # BD analysis logic (extract, enrich, score)
    │   ├── outreach_runner.py         # Outreach logic (company search, contacts)
    │   ├── DetailedForecast.py        # Y1–Y3 revenue forecasting
    │   ├── store.py                   # SQLite: analysis runs + My Portfolio
    │   ├── db.py                      # SQLite: outreach runs + companies
    │   ├── sheets.py                  # Google Sheets export (optional, no-ops if unconfigured)
    │   ├── data_processing/
    │   │   ├── loader.py              # Load + clean IQVIA/UPP/MOHAP CSVs once
    │   │   ├── iqvia.py               # Per-molecule IQVIA data extraction
    │   │   ├── mohap.py               # MOHAP manufacturer count per molecule
    │   │   ├── upp.py                 # UPP active manufacturer count per molecule
    │   │   ├── benchmarks.py          # Market-level + ATC4 benchmark computation
    │   │   └── molecule_normalizer.py # Strip salt forms, handle combinations
    │   ├── prompts/
    │   │   ├── prompt_scoring.txt     # Pass 2 scoring prompt (uses .replace(), NOT .format())
    │   │   └── prompt_discovery.txt   # Pass 1 country discovery prompt
    │   └── data/
    │       └── contacts.db            # SQLite database (persisted on Railway volume)
    └── frontend/
        ├── src/
        │   ├── app/
        │   │   ├── layout.tsx         # Root layout — wraps all pages in AppShell
        │   │   ├── page.tsx           # / — redirects to /analysis
        │   │   ├── login/page.tsx     # /login — password auth page
        │   │   ├── analysis/page.tsx  # /analysis — main BD analysis agent UI
        │   │   ├── portfolio/page.tsx # /portfolio — My Portfolio management
        │   │   ├── outreach/page.tsx  # /outreach — outreach agent UI
        │   │   └── forecast/page.tsx  # /forecast — Y1–Y3 revenue forecast UI
        │   ├── components/
        │   │   ├── AppShell.tsx       # Sidebar + content layout wrapper
        │   │   ├── Sidebar.tsx        # Fixed left nav (Analysis, Portfolio, Outreach)
        │   │   ├── MoleculeDrawer.tsx # Side drawer — full molecule analytics
        │   │   ├── MoleculeCard.tsx   # Score card per molecule (color-coded 1–10)
        │   │   ├── PortfolioTreemap.tsx # Plotly treemap by ATC1 class
        │   │   └── IQVIACharts.tsx    # Plotly pie — manufacturer distribution
        │   └── lib/
        │       ├── api.ts             # Typed API client — all fetch calls
        │       └── forecastSession.ts # localStorage key + ForecastSession interface
        └── package.json
```

---

## Backend architecture

### Startup (`lifespan` in main.py)
On server start, before accepting requests:
1. `init_db()` — creates SQLite tables if not present
2. `load_data(DATA_DIR)` — reads IQVIA, UPP, MOHAP CSVs into DataFrames stored in `_state["dfs"]`
3. Pre-computes `market_context` string (market-wide benchmarks for scoring prompt)
4. Builds full molecule list from IQVIA for the craft/single-molecule autocomplete

DataFrames live in `_state` for the lifetime of the process. **Never re-read CSVs per request.**

### Auth
- Single shared password (`APP_PASSWORD` env var, default `comix2024`)
- Login returns an httpOnly session cookie (`SESSION_TOKEN`)
- Cookie is `samesite=none; secure` in production (Railway), `samesite=lax` locally
- `FRONTEND_URL` env var must be set on Railway — controls CORS `allow_origins`

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Password login → sets session cookie |
| POST | `/api/auth/logout` | Clear session cookie |
| GET | `/api/auth/me` | Returns `{authenticated: bool}` |
| GET | `/api/molecules` | Full IQVIA molecule list for autocomplete |
| POST | `/api/analysis/upload` | Upload catalogue (PDF/CSV/Excel) → extract + enrich |
| POST | `/api/analysis/enrich` | Enrich a typed molecule list (craft/single mode) |
| POST | `/api/analysis/score` | **SSE stream** — Pass 2 AI scoring |
| POST | `/api/analysis/history` | Save an analysis run to SQLite |
| GET | `/api/analysis/history` | List saved analysis runs |
| GET | `/api/analysis/history/{run_id}` | Get full run (result + report) |
| DELETE | `/api/analysis/history/{run_id}` | Delete run |
| POST | `/api/analysis/forecast` | Y1–Y3 forecast for a molecule list |
| GET | `/api/analysis/manufacturers/{molecule}` | IQVIA manufacturer breakdown (pie chart) |
| GET | `/api/portfolio` | Get My Portfolio |
| POST | `/api/portfolio/upload` | Upload catalogue → save as My Portfolio |
| POST | `/api/portfolio/enrich` | Craft molecule list → save as My Portfolio |
| POST | `/api/portfolio/report` | Save AI report text to My Portfolio |
| DELETE | `/api/portfolio` | Clear My Portfolio |
| POST | `/api/outreach/run` | **SSE stream** — outreach agent for a country |
| GET | `/api/outreach/runs` | List outreach run history |
| GET | `/api/outreach/runs/{run_id}` | Get full outreach run with company cards |
| DELETE | `/api/outreach/runs/{run_id}` | Delete outreach run |
| GET | `/api/outreach/company-products` | All MOHAP molecules for a company + IQVIA enrichment |
| POST | `/api/outreach/draft-message` | Generate LinkedIn connection message via AI |

### Streaming (SSE)
Both `/api/analysis/score` and `/api/outreach/run` return `StreamingResponse` with `media_type="text/event-stream"`. Each chunk is `data: {json}\n\n`. The frontend reads these with `fetch` + `ReadableStream`. Streams end with `data: [DONE]\n\n`.

---

## Agent architecture

### Analysis agent (agent_runner.py) — two phases

**Phase 1 — Extract + Enrich** (synchronous, fast)
```
Upload file / molecule list
    → extract_and_enrich() or enrich_molecules()
    → smart_molecule_search()        # 3-pass: exact → combination → salt strip
    → lookup_molecule() × N          # IQVIA + UPP + MOHAP per molecule
    → format_enriched_data()         # structured text block for scoring prompt
    → _build_atc4_context()          # ATC4 benchmarks per unique class
    → returns AnalysisResult JSON
```

**Phase 2 — AI Scoring** (SSE stream)
```
score_stream()
    → loads prompts/prompt_scoring.txt
    → injects {market_context}, {atc4_context}, {enriched_data} via .replace()
    → streams LLM output token-by-token
    → frontend accumulates into reportText
    → auto-saves to SQLite when stream ends
```

**Model routing** — `MODELS` dict in `agent_runner.py` maps model names (`haiku`, `sonnet`, `gpt-4o-mini`, `gpt-4o`) to `(provider, model_id, input_cost, output_cost)`.

### Outreach agent (outreach_runner.py) — single pass (SSE stream)
```
run_outreach_stream(country, model)
    → 3 Tavily web searches for manufacturers in country
    → LLM extracts 5 company profiles as structured JSON
    → per company: check MOHAP + UPP fuzzy match for UAE presence
    → per company: find LinkedIn contacts via Tavily site:linkedin.com
    → yields SSE events: {type: "company", data: {...}} per company
    → main.py saves completed run to outreach_companies table
```

### Forecast (DetailedForecast.py)
```
forecast_top_product(df_iqvia, molecule, growth_rate)
    → identifies top product by units for the molecule
    → competitor-adjusted penetration:
        1 manufacturer  → 20%
        2–4             → 10%
        5+              →  5%
    → Y1 = market_units × pack_share × penetration
    → Y2 = Y1 × (1 + growth_rate)
    → Y3 = Y2 × (1 + growth_rate)
    → CIF price = (retail_price / 1.4) × 0.4
    → revenue = units × CIF price
    → returns per-pack breakdown + molecule summary
```

Growth rate is user-selected via slider (5–30%, default 15%) on the `/forecast` page. Formula is straight compound growth — no hidden multipliers.

---

## Frontend architecture

### Page flows

**Analysis (`/analysis`)**
- Three input modes: `upload` (catalogue file), `craft` (type molecules), `molecule` (single lookup)
- Phase `input` → Phase `portfolio` (after Phase 1) → Phase `report` (after Phase 2)
- Portfolio phase: grid or treemap view, shortlist/disqualify per molecule (CheckCircle2 / XCircle), MOHAP + UPP counts shown on card
- Stats bar buttons: **Save Portfolio** (manual SQLite save), view toggle, Generate AI Report / View Report
- Shortlisted IQVIA molecules → **Generate Forecasts** button → serialises `ForecastSession` to localStorage → `router.push("/forecast")`
- History sidebar: lists saved runs, click to reload

**Forecast (`/forecast`)**
- Reads `ForecastSession` from localStorage on mount
- Auto-triggers forecast on load; growth rate slider (5–30%) + Regenerate button
- Expandable per-molecule rows showing pack-level table: Manufacturer, Pack, Retail (AED), CIF (AED), Share, Y1/Y2/Y3 Units, Y1/Y2/Y3 Rev
- **Export XLSX** — two sheets: "Forecast" (pack detail with top product/manufacturer/market totals) and "Summary" (one row per molecule). All numeric columns use Excel number formats (`#,##0`, `#,##0.00`, `0.0"%"`).

**Outreach (`/outreach`)**
- Input: country name + model selector
- Streams company cards as they arrive (SSE)
- Each card: company overview, UAE presence (MOHAP/UPP match), distributor names, BD contacts
- History panel: past runs with expandable company cards
- LinkedIn message drafting per contact

**Portfolio (`/portfolio`)**
- Singleton: one saved portfolio at a time (id=1 in SQLite)
- Same upload/craft input modes as Analysis
- Persists across Railway restarts (SQLite)

### State passing between pages
`ForecastSession` (molecule cards + ATC1 groupings) is serialised to `localStorage` under key `comix_forecast_session` before navigating to `/forecast`. The forecast page reads it back on mount. Both pages import the key/type from `src/lib/forecastSession.ts` — not from the page file (Next.js forbids named exports from page components).

### API client (api.ts)
Single `api` object with typed methods. All calls go to `NEXT_PUBLIC_API_URL` (set as Vercel env var). Credentials included on every request (`credentials: "include"`) for session cookie.

---

## Persistence (SQLite)

Database: `backend/data/contacts.db` — mounted as a persistent volume on Railway.

| Table | Contents |
|-------|----------|
| `analysis_runs` | Saved analysis runs — source name/type, model, stats JSON, full result JSON, report text. Max 100 rows (oldest pruned). |
| `my_portfolio` | Single row (id=1) — company name, result JSON, report text. Upserted on save. |
| `outreach_runs` | One row per outreach run — country, model, date, company/contact counts. |
| `outreach_companies` | One row per company per run — overview, UAE MOHAP/UPP status, agents, contacts JSON. |

---

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `APP_PASSWORD` | Railway | Login password (default: `comix2024`) |
| `SESSION_TOKEN` | Railway | Override session token (auto-generated if unset) |
| `FRONTEND_URL` | Railway | Comma-separated Vercel URLs for CORS — **must be set** |
| `ANTHROPIC_API_KEY` | Railway | Claude API key |
| `OPENAI_API_KEY` | Railway | OpenAI API key |
| `TAVILY_API_KEY` | Railway | Web search for outreach agent |
| `NEXT_PUBLIC_API_URL` | Vercel | Backend Railway URL (e.g. `https://xxx.railway.app`) |

---

## Constraints — never change without discussion

1. **Prompt injection uses `.replace()` not `.format()`** — `prompt_scoring.txt` and `prompt_discovery.txt` contain JSON braces `{}` that break `.format()`. Never switch.

2. **`load_all()` called once at startup** — DataFrames live in `_state`. Never re-read CSVs per request.

3. **IQVIA end_year = `years[-2]`** — most recent year is partial data. Do not change to `years[-1]`.

4. **Combination molecule division** — all value/unit aggregations divided by `num_molecules` to correct IQVIA double-counting. Never remove.

5. **Hard disqualifiers in scoring prompt** — `num_competitors > 10` → max score 5; `market_value < 5M AED AND value_cagr < 10%` → max score 4. Deliberate COMIX policy.

6. **No named exports from Next.js page files** — only `export default function PageName()` is allowed. Constants and interfaces shared across pages must live in `src/lib/`.

7. **SQLite over JSON files** — Railway containers wipe the filesystem on restart. The `data/` directory is a persistent volume. Do not write ephemeral state to JSON files.

8. **Forecast formula** — `Y2 = Y1 × (1 + growth_rate)`, `Y3 = Y2 × (1 + growth_rate)`. Growth rate is user-chosen (default 15%). No hidden ramp multipliers.

---

## Known issues / fragile areas

- **LinkedIn contact quality is poor** — Tavily snippets are truncated; Haiku occasionally returns empty arrays or hallucinated profiles. No fix without a proper LinkedIn API.
- **CORS** — `FRONTEND_URL` must include all Vercel preview URLs if those are used. Forgetting this causes silent "failed to fetch" errors.
- **Anthropic free tier** — 30k token/min limit. Use `gpt-4o-mini` for Pass 2 on free tier to avoid 429s.
- **Forecast requires IQVIA match** — molecules not in IQVIA (`in_iqvia: false`) are silently skipped. Only shortlist IQVIA-matched molecules before navigating to `/forecast`.
