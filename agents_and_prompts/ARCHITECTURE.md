# COMIX BD App — Architecture & Data Flow

## File Structure

```
comix-bd-lean/
│
├── agents_and_prompts/            # CLI agents + all prompts (this folder)
│   ├── agent.py                   # CLI two-pass BD scoring agent
│   ├── outreach_agent.py          # CLI outreach agent
│   ├── prompt.txt                 # Legacy single-pass prompt (unused)
│   ├── prompt_discovery.txt       # Pass 1 prompt — extract companies + molecules as JSON
│   └── prompt_scoring.txt         # Pass 2 prompt — scoring rules + output format
│
├── deploy app/
│   ├── frontend/                  # Next.js app (what the user sees)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── analysis/page.tsx    # Portfolio scoring UI
│   │       │   ├── outreach/page.tsx    # Outreach agent UI
│   │       │   └── login/page.tsx
│   │       ├── components/
│   │       │   ├── MoleculeCard.tsx     # Individual molecule display card
│   │       │   ├── IQVIACharts.tsx      # Manufacturer pie charts
│   │       │   └── PortfolioTreemap.tsx # ATC1-grouped treemap
│   │       └── lib/api.ts              # All frontend → backend HTTP calls
│   │
│   └── backend/                   # FastAPI server (the brain)
│       ├── main.py                # All API endpoints + auth middleware
│       ├── agent_runner.py        # Analysis logic: molecule lookup, enrichment, scoring stream
│       ├── outreach_runner.py     # Outreach logic: web search, company profiles, contacts
│       ├── store.py               # Analysis history persistence (JSON file)
│       ├── sheets.py              # Google Sheets integration (outreach runs)
│       ├── data_processing/       # UAE market data extractors
│       │   ├── loader.py          # Loads all 3 CSVs once at startup
│       │   ├── iqvia.py           # Per-molecule IQVIA metrics
│       │   ├── mohap.py           # MOHAP registered product lookup
│       │   ├── upp.py             # UPP manufacturer lookup
│       │   ├── benchmarks.py      # Market-wide + ATC4 class benchmarks
│       │   └── molecule_normalizer.py
│       ├── prompts/
│       │   ├── prompt_scoring.txt # Pass 2 prompt (backend copy)
│       │   └── prompt_discovery.txt
│       ├── data/
│       │   ├── iqvia.csv          # UAE market sales data (12MB)
│       │   ├── mohap.csv          # MOHAP registered products (2.3MB)
│       │   ├── upp.csv            # UPP manufacturer list (6.8MB)
│       │   └── analyses.json      # Saved analysis runs (auto-created)
│       └── .env                   # API keys (never commit)
```

---

## Architecture

```
Browser (Next.js — port 3000)
        ↕  REST + Server-Sent Events (SSE)
FastAPI Backend (port 8000)
        ↕
  3 CSVs loaded once into memory at startup:
  IQVIA · MOHAP · UPP
        ↕
  External APIs called on demand:
  OpenAI / Anthropic  →  scoring + outreach profiles + message drafting
  Tavily Search       →  web discovery of manufacturers
  Hunter.io           →  BD contact email lookup (optional)
```

**Key architectural points:**
- Frontend and backend are completely separate — they talk only through `api.ts`
- CSVs are loaded once into memory at startup — every request reads from RAM, not disk
- LLM calls are the only slow part — all data lookups are fast pandas operations
- SSE (Server-Sent Events) is used for streaming — scoring and outreach stream token-by-token to the browser
- Auth is a single session cookie with a fixed token set in `.env`

---

## Data Flow

### Analysis Agent (portfolio scoring)

```
1. Upload file (PDF/CSV/Excel) or pick molecules manually
         ↓
2. Backend extracts molecule names from the file
         ↓
3. For each molecule, parallel lookup across 3 sources:
   IQVIA  → market value (AED), value CAGR, unit CAGR, num competitors,
             market leader + share, private %, ATC class, fragmentation signals
   MOHAP  → number of registered manufacturers in UAE
   UPP    → number of registered manufacturers in UAE
         ↓
4. Compute market-wide benchmarks (once) + ATC4 class benchmarks
         ↓
5. Frontend shows enriched molecule cards (portfolio grid / treemap)
         ↓
6. "Generate AI Report" → backend injects all enriched data into
   prompt_scoring.txt and streams to LLM (GPT-4o-mini or Claude)
         ↓
7. LLM streams scored markdown back → appears in real time in the browser
         ↓
8. Report complete → auto-saved to analyses.json (history)
```

### Outreach Agent

```
1. Enter a target country
         ↓
2. Tavily runs 3 web searches:
   "top generic pharma manufacturers [country] export"
   "[country] pharmaceutical company Middle East"
   "[country] CDMO API manufacturer GMP"
         ↓
3. LLM reads search results → generates 5 company profiles
   (name, website, overview, regulatory standing)
         ↓
4. For each company (streamed one by one):
   a. Fuzzy match (rapidfuzz, threshold 80) against MOHAP + UPP
      → UAE presence check + distributor names
   b. Hunter.io domain search → BD contact emails (if key set)
   c. Tavily site:linkedin.com search → LLM parses BD contacts
         ↓
5. "View Registered Products" button (UAE-present companies only)
   → MOHAP lookup for all molecules under that company
   → IQVIA enrichment per molecule
         ↓
6. "Draft LinkedIn Message" button (per contact)
   → LLM writes personalised 300-char connection note
   → Copy to clipboard
```

---

## LLM Models Used

| Task | Default Model | Notes |
|------|--------------|-------|
| Pass 2 scoring | `gpt-4o-mini` | Streams to browser via SSE |
| Outreach profiles | `claude-haiku-4-5` | Fast, cheap |
| LinkedIn contact parsing | `claude-haiku-4-5` | Short snippets only |
| Message drafting | `gpt-4o-mini` | 300 char output |

All models are configurable per-run from the UI.

---

## API Keys Required

| Key | Used for |
|-----|---------|
| `ANTHROPIC_API_KEY` | Claude models (Haiku, Sonnet) |
| `OPENAI_API_KEY` | GPT-4o-mini, GPT-4o |
| `TAVILY_API_KEY` | Web search (outreach discovery + LinkedIn) |
| `HUNTER_API_KEY` | Email lookup (optional) |
| `GOOGLE_SPREADSHEET_ID` | Outreach history in Sheets (optional) |
| `SESSION_TOKEN` | Fixed auth token — set in .env to avoid re-login on restart |
