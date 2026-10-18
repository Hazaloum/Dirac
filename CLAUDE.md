# COMIX BD Intelligence — Claude Context

## Business context

COMIX is a Dubai-based pharmaceutical licensing company. They in-license generic molecules from manufacturers globally and commercialise them in the UAE through local distributors. Current focus: CNS. Expanding into cardiovascular, metabolic, oncology. Strong preference for the private market channel (higher margins than LPO/government).

This repo holds two apps sharing one Supabase database:
- **Dirac** (`deploy app/`) — the BD intelligence web app (desktop, COMIX team).
- **Curie** (`rep-app/`) — the mobile CRM for COMIX's medical reps (see "Field force" below).

Dirac powers COMIX's BD intelligence workflow. It replaces the old CLI scripts (`agent.py`, `outreach_agent.py`) with a full-stack hosted product.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Plotly |
| Backend | FastAPI (Python), uvicorn |
| Database | Supabase project **COMIX OS** (`xgaomspclfexhkdfgwgv`), accessed with `supabase-py` + the anon key (`SUPABASE_URL` / `SUPABASE_KEY`) |
| Deployment | Frontend → Vercel, Backend → Railway |
| AI | Anthropic Claude (haiku/sonnet) + OpenAI (gpt-4o-mini/gpt-4o) |
| Data | IQVIA, MOHAP, UPP, WHO ATC — Supabase tables, loaded once at startup into DataFrames. No local data files. |

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
    │   ├── store.py                   # Supabase: analysis runs, My Portfolio, pipeline
    │   ├── db.py                      # Supabase: outreach runs + companies
    │   ├── inventory.py               # Inventory view + stock quantities (Supabase)
    │   ├── deals.py                   # Deal Tracker: stages/triggers config, deals, documents (Supabase)
    │   ├── field_force.py             # Rep CRM setup (reps, areas, accounts) + dashboard — service-role client
    │   ├── supabase_client.py         # Shared Supabase client + paging fetch_all()
    │   ├── reference_data.py          # Read/write IQVIA, UPP, MOHAP, WHO tables in Supabase
    │   ├── sheets.py                  # Google Sheets export (optional, no-ops if unconfigured)
    │   ├── data_processing/
    │   │   ├── loader.py              # Load + clean IQVIA/UPP/MOHAP from Supabase once
    │   │   ├── iqvia.py               # Per-molecule IQVIA data extraction
    │   │   ├── mohap.py               # MOHAP manufacturer count per molecule
    │   │   ├── upp.py                 # UPP active manufacturer count per molecule
    │   │   ├── benchmarks.py          # Market-level + ATC4 benchmark computation
    │   │   ├── market_discovery.py    # ATC1→ATC4→molecule→company drilldown
    │   │   ├── who_crosswalk.py       # Merge WHO ATC classes into Market Discovery
    │   │   └── molecule_normalizer.py # Strip salt forms, handle combinations
    │   ├── prompts/
    │   │   ├── prompt_scoring.txt     # Pass 2 scoring prompt (uses .replace(), NOT .format())
    │   │   └── prompt_discovery.txt   # Pass 1 country discovery prompt
    │   └── scripts/                   # Data refresh: IQVIA converter, UPP/MOHAP upload, WHO crosswalk
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
1. `load_data()` — reads IQVIA, UPP, MOHAP from Supabase (`reference_data.py`) into DataFrames stored in `_state["dfs"]` (~20 s)
2. Loads the WHO hierarchy + crosswalk from Supabase (cached in `who_crosswalk._assets`)
3. Pre-computes `market_context` string (market-wide benchmarks for scoring prompt)
4. Builds full molecule list from IQVIA for the craft/single-molecule autocomplete

DataFrames live in `_state` for the lifetime of the process. **Never re-read reference data per request.**

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
| POST | `/api/analysis/upload-stream` | **SSE stream** — used by Analysis: AI reading with keyword fallback. `{stage: "reading", pages, image_pages}`, `{molecule, count}` per molecule found (the "Found N molecules" pop-up), `{stage: "fallback", reason}`, `{stage: "registry"}`, then `{result}` |
| POST | `/api/registry/uploaded` | Review panel → add confirmed catalogue products to the `uploaded` registry |
| POST | `/api/analysis/enrich` | Enrich a typed molecule list (craft/single mode) |
| POST | `/api/analysis/score` | **SSE stream** — Pass 2 AI scoring |
| POST | `/api/analysis/history` | Save an analysis run to Supabase (with `run_id`: update that run) |
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
    → auto-saves to Supabase when stream ends
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
- Stats bar buttons: **Save Portfolio** (manual Supabase save), view toggle, Generate AI Report / View Report — the AI evaluation (Phase 2) never starts on its own after an upload/enrich, only from Generate AI Report
- Shortlisted IQVIA molecules → **Generate Forecasts** button → serialises `ForecastSession` to localStorage → `router.push("/forecast")`
- History sidebar: lists saved runs, click to reload. **Every upload / crafted list is saved to History automatically** (not single-molecule lookups); the same run is then updated (`POST /api/analysis/history` with `run_id`) when the AI report finishes, molecules are added to registries, or Save is pressed — one History entry per catalogue.
- The working state (result, company, report) is kept in localStorage (`src/lib/analysisSession.ts`, key `comix_analysis_session`) so leaving the page or reloading brings the last catalogue back; "New analysis" (reset) clears it. A finished report restored this way isn't saved to history again.

**Molecule search (`/search`)**
- Header card from `GET /api/analysis/trend/{molecule}` → `profile` (`agent_runner._molecule_profile`, whole molecule, unfiltered): **leading brand** (highest end-year value) with manufacturer · parent (MIDAS Corporation) and its % of the molecule's value, **first launch** (earliest IQVIA Launch Date, MM/YYYY; its corporation = originator), **first generic** (earliest launch by another corporation, or "No generic yet"); and the market in plain text: value + CAGR, units + CAGR, competitors on IQVIA (manufacturer count = `num_competitors`, plus how many sold in the end year), private / LPO % by value and by units. The verdict chips were removed (end year = `years[-2]`).
- **Competition** panel below Market breakdown (`components/CompetitionPanel.tsx`, `profile.competition` from `agent_runner._competition`, whole molecule): HHI (sum of squared value shares; > 2,500 concentrated), top-3 share, generics' share (generic = not the first launch's corporation), exits (sales in the first year, none in the end year, "of N generics ever"), the top 3 manufacturers as cards (main product, launch, share, CAGR over the full window or "New" if launched in the last two years, private %), a Pareto chart (share bars + cumulative line, "N manufacturers = 80%") and the list of products that stopped selling.
- **Add to Deal Tracker** (`components/AddToDeal.tsx`): `GET /api/deals/by-molecule/{molecule}` (`deals.deal_for_molecule`) → if the molecule has a deal, a link "In Deal Tracker · <stage>" to `/deal-tracker?deal=<id>` (opens its drawer); else the button asks for an optional partner and creates it in Shortlisted (`POST /api/deals`).
- Market breakdown chart (`MarketBreakdownChart`, bar stacks) below, with **NFC3 and strength filters** that apply in every lens, including By competitor (`?nfc3=&strength=` on the trend endpoint; `options` lists the forms, and the strengths within the chosen form). The ATC cascade visual was removed.

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
- Singleton: one saved portfolio at a time (id=1 in Supabase)
- Same upload/craft input modes as Analysis
- Persists across Railway restarts (Supabase)

### Field force (rep CRM)
- **Rep app** (`rep-app/`, Next.js 14 + supabase-js, mobile-first, installable): named **Curie**. Tabs: Today (clients due a visit, "+ New visit" → pick a client) → Clients (search/add, `/clients`) → Molecules (`/molecules` → `/molecules/[molecule]`: packs + **Latest research** cards) → My week; plus the visit screen. The visit screen starts with the **outcome** (doctor/hospital: Met / Not available / Cancelled; pharmacy: Order taken / No order / Not available), which decides what else shows: Met → molecules discussed + the **doctor's stance** per molecule (Prescribing / Will try / Not interested, with a reason only when not interested: price, efficacy, side effects, uses competitor, not stocked nearby) + samples; Not available → samples left; pharmacy → shelf check (in/low/out) and, for Order taken, order lines. Samples and orders pick a molecule from Dirac's inventory, then its strength/pack. The screen shows each molecule's last stance for that client, and molecules the doctor said they'd try are pre-selected so the rep asks again. **Research cards:** a molecule's page reads `molecule_research` (5 cards: study, finding, a line to say, a caution, PubMed link). If empty, or on Refresh, it calls `POST /api/rep/research/{molecule}/refresh` (`research.py`, rep Bearer token): PubMed E-utilities → the 5 most recent trials / meta-analyses / systematic reviews with abstracts (by publication date) → `gpt-5.6-luna` (strict JSON) writes a card for each from the abstract only (flagging formulations COMIX doesn't sell in the caution); PMIDs it didn't get are dropped. Not yet reviewed by regulatory — off-label findings carry a caution.

**Voice notes:** "Record visit" on the visit screen sends audio to Dirac's backend (`POST /api/rep/voice-note`, `voice_notes.py`, authorised by the rep's Supabase session as a Bearer token). It transcribes with OpenAI `gpt-4o-transcribe`, then `gpt-5.6-luna` fills the structured fields (strict JSON schema: outcome, molecules, stance + reason, samples, shelf, order, next visit) and writes a short summary into the note. Every value is filtered against the allowed options and carried SKUs. The rep reviews the pre-filled form and saves; the transcript goes to `visit_voice_notes` and shows at the bottom of the visit report. Tapping a past visit on a client's page opens that report (`/clients/[id]/visits/[visitId]`). The UI says "clients"; the database tables keep the name `accounts`. Apart from voice notes the rep app has no backend: RLS + `save_visit` do the work. Deployed as a second Vercel project with root directory `rep-app`.
- **Dirac `/field-force`**: Setup (create rep logins with a starting password, areas, import account list CSV/Excel, area/rep overrides) and Dashboard (coverage per rep, visits and % that reached the client, doctor feedback per molecule with reasons, samples and orders by SKU, shelf alerts, overdue accounts). Endpoints `/api/field-force/*` in `main.py` → `field_force.py`.
- Orders are only those reps capture; direct distributor orders are not tracked yet.

### Inventory
The `/inventory` page lists My Portfolio molecules with only the SKUs COMIX carries. Clicking a molecule opens a picker: dosage forms as boxes → strength / pack-size options → select. Options come from IQVIA, normalised to molecule + strength + form (NFC3) + pack size so the same pack from several manufacturers shows once. A row in Supabase `inventory_stock` = a carried SKU (with its description and stock in packs); `PUT /api/inventory/skus/{molecule}` sets the selection, `PUT /api/inventory/{pack_key}` sets stock.

**Purchase and sales orders.** "+ Purchase order" (COMIX → supplier) and "+ Sales order" (customer → COMIX) on the Inventory page create open orders (`purchase_orders`/`sales_orders` + `_lines`). Stock moves only when a PO is marked **Received** (`receive_purchase_order`, stock up) or an SO **Delivered** (`deliver_sales_order`, stock down; refused if any SKU is short). Open orders show per SKU as "+X on order" / "Y committed". Endpoints: `GET /api/inventory/orders`, `POST /api/inventory/orders/{purchase|sales}`, `POST …/{id}/close`, `POST …/{id}/cancel`. Rep-app orders (`orders` table) are separate and don't move stock.

### Deal Tracker (`/deal-tracker`, Deals)
A kanban board for in-licensing deals: **one card per molecule** (unique), **columns = stages**. Eleven stages, defined once in `deals.py` `STAGES` and served to the page: **Shortlisted · Interested** (key `interested`: picked in the app with no supplier yet — molecule search "Add to Deal Tracker", "+ New deal", a ✓ in a typed list / single lookup; holds the IQVIA market fields; moves on when found in a supplier's portfolio) → **Shortlisted · In portfolio** (key `shortlisted`: ✓ in an uploaded catalogue, the catalogue's company as partner; an Interested deal ticked in a catalogue moves here automatically and takes that partner if it had none) (moves on when the forecast is sent to the company; "Generate forecast" in the drawer shows the Y1–Y3 forecast inline (`components/InlineForecast.tsx`: growth slider, pack table, Export XLSX, "Attach XLSX to this deal"; formatting + XLSX export shared with `/forecast` via `src/lib/forecastExport.ts`)) → Awaiting response (moves on when the company replies) → Partner engaged → Due diligence → Negotiating terms → Preparing submission → MOHAP registration → MOHAP pricing → Launch prep → Launched. Each stage has a **trigger** (the event that moves the deal on, e.g. "CDA / NDA signed") and the fields that trigger asks for.
- **Never blocked:** a deal moves to any stage (drag the card, or "Move to …" in the drawer) with fields empty. Cards show the current stage's filled count and "N gaps earlier".
- **Fields:** entered ones (text / date / longtext / choice) are stored in `deals.info` (JSON string, field key → value); `dirac` ones are computed on read from IQVIA + MOHAP/UPP (`lookup_molecule`, cached per process), the 15%-growth forecast, `pipeline_decisions` (AI score), PO Tracker links (`supplier_order_molecules`) and `inventory_stock`.
- Per deal: partner, marketing authorisation holder (COMIX / partner's local agent / not decided — varies per deal), status active / on hold / dropped + reason, notes. Stage and status changes are logged in `deal_events`.
- **Documents are optional**, any stage: uploaded through the backend into the private Supabase Storage bucket `deal-documents`; listed in `deal_documents`; downloaded via `GET /api/deals/documents/{id}`. Max 20 MB.
- Endpoints: `GET/POST /api/deals`, `GET/PATCH/DELETE /api/deals/{id}`, `POST /api/deals/{id}/move` `{stage}`, `POST /api/deals/{id}/documents` (form: stage, file), `GET/DELETE /api/deals/documents/{doc_id}`.
- **✓ on a catalogue → deal:** shortlisting a molecule (Catalogues ✓, saved as a `pipeline_decisions` "yes" via `PUT /api/pipeline` with `source_type` = the Analysis mode) opens its deal via `deals.ensure_deal`: uploaded catalogue → In portfolio with the catalogue's company as partner; typed list / single lookup → Interested, no partner. An existing deal is left where it is; un-ticking never removes a deal. `scripts/backfill_deals.py` opens deals for molecules ticked before this existed.
- There is no Sourced stage (removed: every catalogue molecule would sit there). Deals still stored as `sourced` show in Shortlisted (`LEGACY_STAGES`) and are saved there when next moved.
- **Launched → My Portfolio:** moving a deal to Launched (`deals.add_to_portfolio`) re-saves My Portfolio with the molecule added (via `enrich_molecules`, which also clears the portfolio's AI report, like any portfolio edit). Molecules not in IQVIA can't be added; already-present ones are left alone; moving back out of Launched does not remove it. The page shows the outcome.

### Events (`/events`, Deals)
Plan trade shows (CPHI) from the organiser's exhibitor list. One button per event; picking one lists its exhibitors **grouped by the organiser's zone** (Finished Dosage & Formulation first, then Integrated Pharma, CMO, API, …), each zone collapsible, with search and an "Active in the Middle East only" filter. A row shows name, country, booth, org types and badges (New, Active in Middle East); expanding shows description, categories, business activity, markets, certifications and the CPHI Online link.
- Tables `events` (key, name, city, venue, dates, source_url, exhibitor_count, synced_at) and `event_exhibitors` (one row per exhibitor; list fields are JSON strings). `events.py`; `GET /api/events`, `GET /api/events/{key}`.
- **Where the data comes from (CPHI Europe directory):** `exhibitors.cphi.com/<code>/` (Milan 2026 = `cpww26`, eventid 626; Frankfurt 2027 not published yet). `/live/search/search_exhibition46json.jsp?site=46&type=company&eventid=<id>&facets=…` returns every exhibitor's id + name + a `filterVal` bitmask over the facets (org type, country, zone, business activity, markets, certifications, category); `/46/company/AA/BB/CC/search<id>-<eventid>_46.json` gives booth (`standno`), description, zone, categories. Both answer **403 to plain HTTP** — fetch them from inside a loaded browser page. CPHI Middle East (Riyadh) is a different site: `biomiddleeast.com/exhibitor-list-2026`, server-rendered HTML.
- Milan 2026 (2,990 exhibitors) was loaded once. A scheduled sync isn't built yet (it needs a browser; Railway has none).
- **Portfolios:** exhibitors matched to a master-registry company (`event_exhibitors.company_id`, `company_match` = alias / normalised / core / ai) get a **Portfolio** button on their card that opens a pop-up (`GET /api/events/exhibitors/{id}/portfolio` → `events.exhibitor_portfolio`, the whole company group's registrations): molecules (or combinations) grouped by **WHO ATC1** (from the registry ATC code, else WHO by INN), each with its **UAE IQVIA market value** (`iqvia_market_values`: latest full year = years[-2], combinations ÷ molecule count, cached per process; registry key `amlodipine+valsartan` → IQVIA `AMLODIPINE + VALSARTAN`), the countries it is registered in and whether it is in the UAE; "Not registered in the UAE only" filter. Page filter "With a registry portfolio only". Milan: 329 of 2,990 matched (most exhibitors are API/CMO/packaging firms with no finished-product registrations).

### Master registry (Supabase)
One standard table of drug registrations across registries, plus canonical molecules and companies. Built and loaded by GitHub Actions on branch `claude/cool-allen-cg9oit` (`tools/registries/build.py` downloads + normalises, `load.py` loads via the `registry_*` SQL functions; repo secrets `SUPABASE_URL`/`SUPABASE_KEY`). Loaded: AE (from `mohap_prices`), NL, PL, RO, HU, ES, CZ, SK, SE, US, IT, FR, IE, BG, OM, BE, AT, plus three **uploaded files** in `tools/data/registries/manual/<folder>/` on the data branch (newest file by name is used): `bh_nhra` (NHRA Bahrain price list, 5.4k products, company = MAH NAME; NHRA refuses every non-Bahrain request), `ae_doh` (DoH Abu Dhabi drug-list snapshot, JSON lines, 20k products after collapsing packs, company = manufacturer, Deleted → withdrawn; country AE, so it counts as UAE) and `uk_mhra` (GB — MHRA additional-monitoring list only, ~500 newer medicines, **not** the full UK register) (~320k products). The three files came from the Pharma Outreach and Analysis Agent project. Not yet: Saudi, Qatar, Kuwait. A big **new** registry can outlast the API gateway on `registry_sync_apply` (504, then lock timeouts on retry) while still finishing in the database — check `registry_runs` before re-running. How each is fetched: plain file downloads, except BE (the site's JSON API, an HS256 `xsrf-token` signed with the key from `/api/config`, 20 rows per page, rate-limited) and AT (headless Chromium opens the site to get its Bearer token, then POSTs `{"nameAuthNumber":"*"}` to `/api/api/v1/medication/export?type=CSV`). UAE MOHAP and DoH Shafafiya (`Drugs.xlsx`) reset connections from outside the UAE, so AE stays on the manual `mohap_prices` upload.
- `registrations` — one row per product × strength × form per registry (packs collapsed; EU pack numbers `EU/1/15/1029/025` → `EU/1/15/1029`): registry, country, registration_no, product_name, company_raw, molecule_raw, strength_raw, form_raw, atc, status (active/withdrawn/unknown), `combo_key` (sorted INNs joined by `+`, set when every ingredient matched), company_id.
- `registration_molecules` — one row per ingredient (combinations have 2+); `molecule_id` → `molecules` (INN, seeded from WHO ATC5 names). Matching (`find_molecule`): exact → `molecule_aliases` → `ingredient_translations` (Latin/Czech → English from SÚKL + manual synonyms) → salt/ester stripping → spelling variants; single-ingredient products fall back to their ATC5 code. 76–89% of products fully matched per registry.
- `companies` (one per company group; `merged_into` set on merged rows, never deleted) and `company_aliases` (lower-cased raw spelling → company, method `normalised` or `ai_merge`) — **the raw name → company map that all future matching reuses** (view `company_name_map`; CSV backup `tools/data/companies/company_name_map.csv`). 4,536 companies from ~8,000 spellings. Look-alike pairs were judged by Haiku (`company_merge_candidates`, applied by `apply_company_merges` via `tools/companies/sync.py` in Actions).
- **Company groups** (`company_groups`, `companies.group_id`; view `company_group_of` gives every company a `group_key`/`group_name`, a company with no group being its own group). Merging = the same legal entity spelt differently (look-alike pairs also compare names with country/place words removed, `company_place_free`, so "Adalvo Limited Malta" meets "Adalvo Limited"). Grouping = one parent and its subsidiaries (Pfizer Hellas, Pfizer Romania … → Pfizer); nothing is merged. Candidates: one brand cluster per brand word (`company_brand`) shared by 2+ companies (`registry_build_group_candidates` → `company_group_candidates`, re-queued when its members change); Haiku splits each cluster into groups (Merck KGaA ≠ MSD), applied by `registry_apply_groups` when every group is ≥ 0.8 confident, else `unsure` for the Review page. Groups only cover companies that share a brand word (Hexal/Sandoz-style parents aren't linked).
- **Lookups in the app** (`registry.py`): `GET /api/registry/companies?q=` (SQL `registry_search_companies`) feeds the company picker on Analysis → Upload catalogue (`components/CompanyPicker.tsx`, SQL `registry_search_company_groups_v4`: keeps the 40 best name matches before counting registrations so short searches stay under the anon 3 s timeout, names starting with the search first; results are company groups, ▸ lists a group's companies, each pickable; shown as a chip; required; a company in no registry can still be used via "Use … as a new company"). `GET /api/registry/molecule-companies?molecule=` (SQL `registry_molecule_holders_g2` — containment test on a GIN index of the combo parts, ~0.2 s; the old `_g` scanned every registration and hit the 3 s anon timeout — rolled up to one row per company group with its companies under ▸; IQVIA-style name → `registry_molecule_key` → `combo_key`, active registrations only) feeds "Companies holding it (registries)" in the molecule drawer, in two tabs: **This molecule** (same molecule / same combination) and **In combinations** (combinations that contain it, e.g. amlodipine → amlodipine + valsartan, listing which ones). Each company shows its countries, product count and whether it is registered in the UAE, with a "Not registered in the UAE only" filter.
- **Upload catalogue: AI reading → review → registries.** `POST /api/analysis/upload-stream` first has Claude read the catalogue (`catalogue_ai.py`, `claude-haiku-5-5`, strict JSON schema, effort low): PDFs page by page with pdfplumber, a page with < 100 characters of text sent as an image (covers, scans; max 40), Excel/CSV as text parts; text pages grouped (≤ 8 pages / 12k chars), each image page its own call, 4 calls in parallel. One entry per ingredients × dosage form: ingredients (combinations kept together), brand, form, strengths, countries, approved / submitted, expected date (only if the catalogue states one), page and a short `source` quote. A text-page product whose quote isn't on its page is dropped (invented); image-page products are marked "read from image". `agent_runner.ai_extract_and_enrich_steps` maps ingredients to IQVIA names (salt / "base" stripping, else the registry INN via `registry_resolve_inns`), enriches as before and adds `catalogue` to each card: strengths vs UAE IQVIA packs (`strength_key`: doses order-free, IQVIA "Y" = mcg, % → mg/g, pack size and IU ignored) and `uae_only` strengths. **Each chunk's AI result is cached** in `catalogue_ai_cache` (key = sha256 of model + prompt + schema + company + the chunk's pages), so re-uploading the same file after a dropped connection or a backend redeploy reuses the chunks already read at no API cost; a dropped stream tells the user to upload again. **If the AI step fails for any reason (no key, API error, nothing found) the old keyword matching runs instead** (`extraction.method = "keyword"` with the reason, shown on the page). Then `registry.check_catalogue` (SQL `registry_check_upload`, read-only) tags each card in_registry / already_uploaded / new / unmatched against the picked company (group pick = the whole group, filed under its biggest company; ▸ member pick = that company; "Use … as a new company" = no check). **Nothing is written on upload:** the review panel above the cards (`components/CatalogueReview.tsx`) lists new / unmatched molecules (submitted and unmatched start unticked; after a keyword fallback all do) and "Add to registries" calls `POST /api/registry/uploaded` → SQL `registry_add_uploaded`: registry `uploaded` (country `Uploaded`, status active, `record_key` = company_id:combo_key so re-adding updates strengths / form / `catalogue_status`). Uploaded rows show in the company's portfolio and in molecule holders. The molecule index refreshes in the background after an add. (`registry_upload_portfolio`, the old auto-add, is no longer called.)
- The Supabase connector asks the user to confirm SQL that replaces or drops objects: create new functions (rename old ones to `_vN`) instead of `create or replace`/`drop`.

### Registries (`/registries`, Data)
The **Data** tab (next to Deals and Operations) holds the Registries page. At the top, **Search all registries** (`components/AllRegistriesSearch.tsx`), By company / By molecule: a company (group, or one company under ▸) → its portfolio across every registry (`GET /api/registry/company-portfolio/{company_id}?whole_group=`, `events.company_portfolio`, shown by `components/RegistryPortfolio.tsx` — the same view as the CPHI Portfolio pop-up: ATC1 groups, UAE IQVIA value, countries, UAE status); a molecule or combination (suggestions from `GET /api/registry/molecules?q=`, SQL `registry_search_molecules` over the small table `registry_molecule_index` — combo key, products, companies, countries, in UAE — rebuilt by `registry_refresh_molecule_index` at the end of each AI review) → the companies holding it (`components/RegistryHolders.tsx`, the molecule drawer's list: This molecule / In combinations). Below, **Browse one registry**: one button per loaded registry (country + product count), grouped GCC / EU / USA & UK / Other (uploaded catalogues); the two UAE registries say MOHAP / DoH Abu Dhabi and the UK one "Partial list", then a search box (every word must match product, company, molecule, ATC or registration number) and an Active / Withdrawn / All toggle ("Active" includes `unknown`, shown as "listed"). Results are paged 50 at a time: product, molecule (the matched INNs, or the raw text marked "unmatched"), strength / form, company (canonical name, with the raw spelling under it when different), ATC, registration number, status. The line under the buttons gives the registry's name, update date, which field is the company, and a link to the source. `GET /api/registry/registries` (table `registries`), `GET /api/registry/search?registry=&q=&status=&offset=&limit=` (SQL `registry_search`), both in `registry.py`.

### Doctors (`/doctors`, Data)
The DHA (Dubai) register of licensed health professionals, for finding leads for the medical reps: 103,644 people (24k physicians, 7.8k dentists, 34k allied health incl. pharmacists, 36k nurses), snapshot 22/09/26, ~21k with an email and ~20k with a phone. Table `hcp_professionals` (key `dha_id`; profession / grade / specialty parsed from the directory category, e.g. "Physician-Specialist Internal Medicine" → Physician / Specialist / Internal Medicine; facility, licences, experience, education, languages, contacts; `account_id` once added to Field force). **Holds personal contact data: RLS on with no policies and no anon/authenticated grants** — read only by the backend with the service-role key (`doctors.py`; SQL `hcp_search`, `hcp_facets`, execute granted to service_role only). Anyone logged into Dirac can see a profile's contacts (owner's decision). Page: profession buttons, specialty / grade filters, "With contact details only", search (name, facility, specialty, DHA ID); click a row for the profile (contacts, licensed facilities, experience, qualifications, DHA link) and **Add to field force** (`POST /api/doctors/{dha_id}/field-force` `{area_id}` → an `accounts` doctor with specialty, phone, facility as address, hospital parent if a hospital client has that name; a pharmacist adds their pharmacy instead). Endpoints `GET /api/doctors/facets`, `GET /api/doctors?q=&profession=&specialty=&grade=&with_contact=&offset=`, `GET /api/doctors/{dha_id}`. Loaded once by `tools/doctors/import_dha.py` (data branch, Actions) from xlsx files put in the private Storage bucket `imports`, through the security-definer `hcp_import_chunk`, open only while `import_switches.hcp_dha` is in date — closed after the load. Dubai only; Abu Dhabi (DoH) and the northern emirates (MOHAP) aren't in it.

### Monthly refresh + review (`/data-review`, Data → Review)
- **Diff, not reload.** `.github/workflows/registries-monthly.yml` (on main, because schedules only run from the default branch) runs on the 1st of each month: it checks out the data branch `claude/cool-allen-cg9oit`, builds every registry (`tools/registries/build.py`), commits the chunks there and runs `load.py`, which calls `registry_sync_begin` → `registry_sync_part` (chunks into `registry_incoming_parts`) → `registry_sync_apply` per registry. Apply compares by `record_key`: new rows inserted, changed fields updated (company/molecule changes re-matched), rows gone from the file marked **withdrawn** (never deleted), every change logged in `registration_changes` (kind new / changed / withdrawn / reactivated, with old → new values), a summary row in `registry_runs`. **Guard:** if the download has fewer than half the products on file, the run is `skipped` and nothing changes. Run by hand: Actions → registries-monthly → Run workflow (optional registry keys).
- New companies from a run get look-alike pairs (`company_candidates_for_new`) in `company_merge_candidates`.
- **AI review in the backend** (`registry_review.py`, `ANTHROPIC_API_KEY`, model `claude-haiku-5-5`, structured JSON output): after each refresh — `review_after_refresh` (started in `lifespan`) checks hourly whether a `registry_runs` row finished after the last review started, or a queue still has unjudged items (e.g. a review cut short by a restart), then works the queues until empty — company pairs, brand clusters, ingredients — and on demand (`POST /api/registry/review/run`). Company pairs (`registry_company_pairs`): confident same → `apply_company_merges`; confident different → saved; below 0.8 → `unsure`. Unmatched ingredients (queue `ingredient_review_queue`, rebuilt by `registry_refresh_ingredient_queue` at the start of each review): Haiku gives the English INN; if it exists in `molecules` and confidence ≥ 0.8 → `registry_apply_alias` (method `ai`); otherwise the attempt is kept in `molecule_ai_attempts` (not_inn / no_inn / combination / unsure) so it isn't asked again. Each review is logged in `registry_review_log`. Uses the service-role client (the queue scan and merges exceed the anon role's 8 s limit).
- **Review page** (`app/data-review/page.tsx`), three tabs: **Company review** (Same company? — unsure pairs, Same company / Different → `POST /api/registry/review/company`; Same group? — unsure brand clusters, tick members + name → `POST /api/registry/review/group` `{cluster_id, groups:[{name, member_ids}]}`, or the AI's split, or Not one company), **Molecule review** (ingredients, below) and **Monthly updates**; queue counts, last review, Run review now. **Monthly registry updates** table (`registry_runs`, click a row for its new / changed / withdrawn products via `GET /api/registry/runs/{id}/changes`); **Ingredients to check** (type the INN or Not a molecule → `POST /api/registry/review/molecule`). `GET /api/registry/review` feeds it.
- **Bahrain** has no automatic download: upload NHRA's price list to `tools/data/registries/manual/bh/` on the data branch (last file by name is used).
- The data branch has `vercel.json` with deployments off in both app folders, so data commits don't use Vercel's daily build quota.

### PO Tracker (`/po-tracker`, Operations)
Tecnimede gives no API, so `scripts/sync_tecnimede.py` (`tecnimede.py`) drives a headless Chromium (Playwright): logs in with `TECNIMEDE_USERNAME`/`TECNIMEDE_PASSWORD`, reads the portal's **All Orders** list view (scrolling past the 50-row pages), and upserts every line into `supplier_order_lines` (`open` = not completed). Runs **every day at 09:00 Dubai** inside the backend (`tecnimede.daily_sync`, started in `lifespan`; off if the Tecnimede vars aren't set) and **on demand** from the PO Tracker's Sync button (`POST /api/po-tracker/sync`, one at a time; the latest attempt's failure shows on the page). By hand: `python scripts/sync_tecnimede.py` (`--show` to watch, `--dry-run` to only print; locally needs `playwright install chromium` once).

**The backend deploys from `deploy app/backend/Dockerfile`** (Playwright's official Python image, Chromium included) so the sync can run on Railway.

- **An order = one Customer Reference** (COMIX's PO number), tidied by `order_ref()` (`P - 0362026` → `P-036/2026`). Order lines (`… | 10`, `… | 20`) are its lines.
- **Portal statuses, in order:** Order Registered → Order Placed to Factory → Order with Logistics Operator → Completed (Order Available for Pickup).
- **Dates:** Acceptance Order Date = when COMIX placed the order; Requested Delivery Date = when COMIX wants it **in Dubai** (Tecnimede asks for ~6 months lead time); Factory Confirmation Date = batch release (a prediction while the line is open). The portal gives no date for reaching the factory, so the sync notes the day it first sees each status (`stage_seen`, from 04/10/26). Each line shows **two timelines on one date axis** (shared by the order's lines): **Expected** = ordered → requested in Dubai; **Actual** = ordered → at factory (if seen) → batch release → in Dubai ≈ release + 30 days (`TRANSIT_DAYS`, dotted). The gap between requested and arrival is shaded red (late) or green (early) and labelled; a badge gives the delay. Open lines draw the factory part dashed and say "pred."; a grey "today" line marks now. Lines with no factory date show "Awaiting factory date". An open order past its requested date shows "Overdue by N days".
- **Molecule link:** each order card has a dropdown of My Portfolio molecules; orders are then grouped under their molecule (A–Z, unlinked last); the choice is saved in `supplier_order_molecules` (ref → molecule), separate from the scraped lines so syncs never overwrite it (`PUT /api/po-tracker/molecule`, `{ref, molecule}`; null unlinks).
- **Delivery strip** (top of the page, `components/DeliveryStrip.tsx`, computed in the browser from the same orders): estimated arrival in Dubai = an order's latest factory confirmation + 30 days (`TRANSIT_DAYS`; no actual arrival date is recorded), compared with the requested delivery date (= when COMIX wants it in Dubai). Shows avg days late, on-time count, order→Dubai lead time vs planned, open orders heading late, a per-order bar chart and a per-molecule breakdown, filterable by linked molecule. Orders without a factory date are left out.
- `GET /api/po-tracker` → `tecnimede.list_orders()` (orders with their `molecule`, plus `portfolio` for the dropdown). Not linked to stock yet (deliberately).

### State passing between pages
`ForecastSession` (molecule cards + ATC1 groupings) is serialised to `localStorage` under key `comix_forecast_session` before navigating to `/forecast`. The forecast page reads it back on mount. Both pages import the key/type from `src/lib/forecastSession.ts` — not from the page file (Next.js forbids named exports from page components).

### API client (api.ts)
Single `api` object with typed methods. All calls go to `NEXT_PUBLIC_API_URL` (set as Vercel env var). Credentials included on every request (`credentials: "include"`) for session cookie.

---

## Persistence (Supabase)

Everything lives in the Supabase project **COMIX OS**, `public` schema. All tables have RLS on with an open `anon`/`authenticated` policy — deliberate: the anon key has full read/write. `supabase_client.py` holds the shared client and a paging `fetch_all()` (PostgREST caps responses at 1000 rows).

**Saved records** (`store.py`, `db.py`, `inventory.py`):

| Table | Contents |
|-------|----------|
| `analysis_runs` | Saved analysis runs — source name/type, model, stats JSON, full result JSON, report text. Max 100 rows (oldest pruned). |
| `my_portfolio` | Single row (id=1) — company name, result JSON, report text. Upserted on save. |
| `outreach_runs` | One row per outreach run — country, model, date, company/contact counts. |
| `outreach_companies` | One row per company per run — overview, UAE MOHAP/UPP status, agents, contacts JSON. |
| `pipeline_decisions` | Yes/Maybe/No (✓ / ? / ✗) per molecule across catalogues — restores ticks on Catalogues and feeds the Deal Tracker. There is no Pipeline page any more (the Deal Tracker replaced it). |
| `inventory_stock` | One row per carried SKU — pack key, molecule, strength, form, pack size, stock quantity. |
| `purchase_orders` / `purchase_order_lines` | POs to suppliers; open → received (adds stock) or cancelled. Shown as PO-0001. |
| `supplier_order_lines` | Order lines scraped from supplier portals (Tecnimede): COMIX PO ref, item, ordered/pending qty, status, factory confirmation date, `open` flag. |
| `supplier_order_molecules` | PO Tracker order (COMIX PO number) → linked portfolio molecule. |
| `deals` | Deal Tracker — one row per molecule: partner, MAH, stage, status + reason, entered fields (`info` JSON), notes. |
| `deal_events` / `deal_documents` | Deal stage/status history; optional uploaded files (bytes in Storage bucket `deal-documents`). |
| `sales_orders` / `sales_order_lines` | Sales orders from customers; open → delivered (removes stock) or cancelled. Shown as SO-0001. |

**Field force / rep CRM** (RLS-locked: anon gets nothing; reps see their own territory; Dirac uses the service-role key):

| Table | Contents |
|-------|----------|
| `reps` | id = Supabase Auth user id, name, email, role `rep`/`manager`, active |
| `areas`, `rep_areas` | Named areas and which reps cover them |
| `accounts` | Doctor / pharmacy / hospital, area, optional `assigned_rep_id` override, `parent_id` (doctor's hospital) |
| `visits` | Rep × account × time, `outcome` (met / not_available / cancelled / order_taken / no_order), molecules discussed, note, next visit date |
| `molecule_research` | Research cards per molecule (PubMed paper + AI summary: finding, say, caution); replaced on refresh; reps read only |
| `visit_voice_notes` | Transcript of the rep's voice note, one per visit |
| `visit_feedback` | Doctor's stance per molecule on a visit (prescribing / will_try / not_interested) + reason when not interested |
| `sample_drops`, `shelf_checks`, `orders`, `order_lines` | What happened on a visit; reference `inventory_stock.pack_key` with a `sku_label` snapshot |
| view `account_status` | Accounts + last visit that reached the client (not_available/cancelled don't count), last note, cadence (doctor/hospital 28d, pharmacy 14d) and `due_on` |

`save_visit(...)` (Postgres function, runs as the rep) writes a visit with its outcome, feedback, samples, shelf checks and order in one transaction and deducts samples from `inventory_stock` (floored at 0). A rep sees accounts assigned to them, created by them, or unassigned in their areas; managers see all.

JSON payloads are stored as JSON strings in `text` columns.

**Reference data** (`reference_data.py`, read once at startup, written only by the refresh scripts):

| Table | Contents |
|-------|----------|
| `iqvia_sales` | One row per product/pack/market. Yearly `"YYYY LC Value"` / `"YYYY Units"` live in the `sales` jsonb column so a new year needs no schema change. |
| `upp_drugs` | UPP registry, original column names. |
| `mohap_prices` | MOHAP price list, original column names. |
| `who_atc_classes` / `who_atc_molecules` / `who_iqvia_crosswalk` | WHO ATC 2026 hierarchy, ATC5 molecules, reviewed WHO→IQVIA mapping. |

Refresh: `scripts/convert_iqvia_export.py` (IQVIA xlsx), `scripts/upload_reference_data.py upp|mohap <csv>`, `scripts/build_who_crosswalk_assets.py` (WHO). Each replaces the whole table (not atomic — re-run on failure), then restart the backend.

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
| `SUPABASE_URL` | Railway | `https://xgaomspclfexhkdfgwgv.supabase.co` |
| `SUPABASE_KEY` | Railway | COMIX OS anon key (Supabase → Project Settings → API) |
| `SUPABASE_SERVICE_KEY` | Railway | COMIX OS service-role key — Field force page only. Server-side, never in a frontend. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel (rep app) | Rep app talks to Supabase directly as the signed-in rep |
| `TECNIMEDE_USERNAME` / `TECNIMEDE_PASSWORD` | Railway + backend `.env` | Tecnimede portal login for the PO Tracker sync (09:00 daily + Sync button) |
| `NEXT_PUBLIC_API_URL` | Vercel (rep app) | Railway backend URL, for voice notes. CORS already allows any `*.vercel.app` origin. |

---

## Constraints — never change without discussion

1. **Prompt injection uses `.replace()` not `.format()`** — `prompt_scoring.txt` and `prompt_discovery.txt` contain JSON braces `{}` that break `.format()`. Never switch.

2. **`load_all()` called once at startup** — DataFrames live in `_state`. Never re-read reference data per request.

3. **IQVIA end_year = `years[-2]`** — most recent year is partial data. Do not change to `years[-1]`. The converter deliberately keeps one trailing partial year so this convention holds.

4. **Combination molecule division** — all value/unit aggregations divided by `num_molecules` to correct IQVIA double-counting. Never remove.

5. **Hard disqualifiers in scoring prompt** — `num_competitors > 10` → max score 5; `market_value < 5M AED AND value_cagr < 10%` → max score 4. Deliberate COMIX policy.

6. **No named exports from Next.js page files** — only `export default function PageName()` is allowed. Constants and interfaces shared across pages must live in `src/lib/`.

7. **Supabase for all data** — Railway containers wipe local files on restart, and reference data must not ship as files. Saved records and reference datasets both live in Supabase.

8. **Forecast formula** — `Y2 = Y1 × (1 + growth_rate)`, `Y3 = Y2 × (1 + growth_rate)`. Growth rate is user-chosen (default 15%). No hidden ramp multipliers.


9. **Dates display as DD/MM/YY** (times DD/MM/YY HH:MM) everywhere — Dirac uses `ddmmyy()` / `ddmmyyTime()` from `src/lib/dates.ts`, the rep app `shortDate()` / `dayAndDate()` from `src/lib/format.ts`. Never `toLocaleDateString` with month names.

---

## Updating the IQVIA dataset

IQVIA is **never uploaded through the app**. It lives in the Supabase `iqvia_sales` table and is read once at startup. To refresh it (from `deploy app/backend/`, with `.env` holding the Supabase vars):

```bash
python scripts/convert_iqvia_export.py "~/Downloads/UAE_LPO_COM_MOL_<date>.xlsx"
```

The converter uploads straight to Supabase (`--dry-run` to only convert, `--csv out.csv` to keep a copy). Then restart the backend. `Molecule Combination` and the `num_molecules` divisor rebuild from scratch on every boot.

The raw IQVIA export is **quarterly** and needs three transformations, all handled by the converter:

1. **Coalesce the `Year to Date` dimension.** IQVIA splits each product's series across sibling rows: `NOT APPLICABLE` holds Q2–Q4 of every year, and each `YTD Mar YYYY` row holds *only* Q1 of that year. The partition is disjoint, so grouping on the dimension columns and summing reunites the series. **Filtering to `NOT APPLICABLE` would silently drop Q1 from every year** (~25% of each annual total). The converter asserts disjointness and aborts if any quarter is populated in two sibling rows.
2. **Roll quarters into calendar years.** Incomplete years are dropped, except the most recent, kept as the sacrificial `years[-2]` column.
3. **Normalise headers** to `Molecule`, `2025 LC Value`, `2025 Units`, …

Requirements for the export: both **LC Value and Units** per quarter (units drive the forecast, unit CAGR, and the private/LPO split — a value-only export makes those go dark), plus `Molecule`, `Product`, `Manufacturer`, `Market`, `ATC1`–`ATC4`, `Launch Year`, `Retail Price`, `Pack`.

**Changing the year window shifts every CAGR.** `_flexible_cagr` anchors on the first non-zero year, so a shorter or later-starting window rebases growth. The Jul-2026 export (2022 base) roughly halved market-wide CAGRs versus the previous file (2020 base, COVID-depressed) — which moved more molecules across the `value_cagr < 10%` hard disqualifier. Expect scores to shift after a refresh; old saved runs in `analysis_runs` were scored on the old basis and are not comparable.

---

## Known issues / fragile areas

- **LinkedIn contact quality is poor** — Tavily snippets are truncated; Haiku occasionally returns empty arrays or hallucinated profiles. No fix without a proper LinkedIn API.
- **CORS** — `FRONTEND_URL` must include all Vercel preview URLs if those are used. Forgetting this causes silent "failed to fetch" errors.
- **Anthropic free tier** — 30k token/min limit. Use `gpt-4o-mini` for Pass 2 on free tier to avoid 429s.
- **Forecast requires IQVIA match** — molecules not in IQVIA (`in_iqvia: false`) are silently skipped. Only shortlist IQVIA-matched molecules before navigating to `/forecast`.
