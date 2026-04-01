"""
main.py — COMIX BD Intelligence Web API
Run from backend/: uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import json
import os
import secrets
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv(override=True)

# ─── Paths ───────────────────────────────────────────────────────────────────
BACKEND_DIR  = Path(__file__).parent
DATA_DIR     = BACKEND_DIR / "data"
PROMPTS_DIR  = BACKEND_DIR / "prompts"
sys.path.insert(0, str(BACKEND_DIR))

# ─── Auth config ─────────────────────────────────────────────────────────────
APP_PASSWORD  = os.getenv("APP_PASSWORD", "comix2024")
# Single session token — same for all users, generated once per server start
SESSION_TOKEN = os.getenv("SESSION_TOKEN", secrets.token_hex(32))

# ─── App state ───────────────────────────────────────────────────────────────
_state: dict = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    from agent_runner import load_data
    from db import init_db
    init_db()
    print("Loading UAE market data (IQVIA / UPP / MOHAP)...")
    _state["dfs"], _state["market_context"] = load_data(DATA_DIR)
    _state["molecules"] = sorted(
        _state["dfs"]["iqvia"]["Molecule Combination"].dropna().unique().tolist()
    )
    print(f"  Ready — {len(_state['molecules'])} molecules loaded.")
    yield

app = FastAPI(title="COMIX BD API", lifespan=lifespan)

FRONTEND_URL = os.getenv("FRONTEND_URL", "")
origins = ["http://localhost:3000"]
if FRONTEND_URL:
    origins.extend([u.strip() for u in FRONTEND_URL.split(",") if u.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Auth middleware ──────────────────────────────────────────────────────────
PUBLIC_PATHS = {"/", "/api/auth/login", "/api/auth/logout", "/docs", "/openapi.json", "/redoc"}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.url.path in PUBLIC_PATHS or request.method == "OPTIONS":
        return await call_next(request)
    token = request.cookies.get("session")
    if token != SESSION_TOKEN:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return await call_next(request)


# ─── Auth endpoints ───────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    password: str

@app.post("/api/auth/login")
def login(body: LoginRequest, response: Response):
    if body.password != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    is_production = bool(os.getenv("RAILWAY_ENVIRONMENT"))
    response.set_cookie(
        "session", SESSION_TOKEN,
        httponly=True,
        samesite="none" if is_production else "lax",
        secure=is_production,
        max_age=86400 * 7,
    )
    return {"ok": True}

@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}

@app.get("/api/auth/me")
def me(request: Request):
    return {"authenticated": request.cookies.get("session") == SESSION_TOKEN}


# ─── Molecule list ────────────────────────────────────────────────────────────
@app.get("/api/molecules")
def molecules():
    return {"molecules": _state.get("molecules", [])}


# ─── Analysis — Phase 1 ───────────────────────────────────────────────────────
@app.post("/api/analysis/upload")
async def analysis_upload(file: UploadFile = File(...), company: str = Form(...)):
    """Upload a catalogue (PDF/CSV/Excel) → extract molecules + enrich."""
    from agent_runner import extract_and_enrich
    content = await file.read()
    try:
        return extract_and_enrich(content, file.filename or "upload", company, _state["dfs"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class EnrichRequest(BaseModel):
    molecules: list[str]
    company: Optional[str] = "Portfolio"

@app.post("/api/analysis/enrich")
def analysis_enrich(body: EnrichRequest):
    """Enrich a list of molecules — craft portfolio or single molecule modes."""
    from agent_runner import enrich_molecules
    try:
        return enrich_molecules(body.molecules, body.company or "Portfolio", _state["dfs"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Analysis — Phase 2 (SSE streaming) ──────────────────────────────────────
class ScoreRequest(BaseModel):
    companies:     list[dict]
    enriched_data: str
    source_name:   str
    model:         str = "gpt-4o-mini"
    market_context:str = ""
    atc4_context:  str = ""

@app.post("/api/analysis/score")
def analysis_score(body: ScoreRequest):
    """Stream Pass 2 scoring output via SSE."""
    from agent_runner import score_stream

    def generate():
        try:
            for chunk in score_stream(
                source_name=body.source_name,
                companies=body.companies,
                enriched_data=body.enriched_data,
                model_name=body.model,
                market_context=body.market_context or _state.get("market_context", ""),
                atc4_context=body.atc4_context,
                prompts_dir=PROMPTS_DIR,
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── Analysis history ────────────────────────────────────────────────────────
class SaveAnalysisRequest(BaseModel):
    source_name: str
    source_type: str = "upload"
    model:       str = ""
    result:      dict
    report:      str = ""

@app.post("/api/analysis/history")
def save_analysis(body: SaveAnalysisRequest):
    from store import save_analysis as _save
    run_id = _save(
        source_name=body.source_name,
        source_type=body.source_type,
        result=body.result,
        report=body.report,
        model=body.model,
    )
    return {"run_id": run_id}

@app.get("/api/analysis/history")
def list_history():
    from store import list_analyses
    return {"runs": list_analyses()}

@app.get("/api/analysis/history/{run_id}")
def get_history_run(run_id: str):
    from store import get_analysis
    entry = get_analysis(run_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Run not found")
    return entry

@app.delete("/api/analysis/history/{run_id}")
def delete_history_run(run_id: str):
    from store import delete_analysis
    if not delete_analysis(run_id):
        raise HTTPException(status_code=404, detail="Run not found")
    return {"ok": True}


# ─── Manufacturer breakdown (pie chart data) ──────────────────────────────────
@app.get("/api/analysis/manufacturers/{molecule}")
def get_manufacturers(molecule: str):
    from agent_runner import get_manufacturer_breakdown
    try:
        return get_manufacturer_breakdown(molecule.upper(), _state["dfs"]["iqvia"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Outreach — registered products for a UAE-present company ────────────────
@app.get("/api/outreach/company-products")
def company_products(mohap_name: str):
    """Return all MOHAP-registered molecules for a company, enriched with IQVIA data."""
    from agent_runner import lookup_molecule
    try:
        df_mohap = _state["dfs"]["mohap"]
        # Normalise column name (may have newline suffix)
        ingredient_col = next(c for c in df_mohap.columns if "Ingredient" in c)
        company_col    = next(c for c in df_mohap.columns if "Company"    in c)

        mask        = df_mohap[company_col].str.upper() == mohap_name.upper()
        ingredients = df_mohap.loc[mask, ingredient_col].dropna().str.upper().unique().tolist()

        molecules = []
        for ing in sorted(ingredients):
            data = lookup_molecule(ing, _state["dfs"])
            molecules.append(data)

        return {"molecules": molecules, "total": len(molecules)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Outreach — draft LinkedIn message ───────────────────────────────────────
class DraftMessageRequest(BaseModel):
    contact_name:     str
    contact_title:    str
    company_name:     str
    company_overview: str = ""
    model:            str = "gpt-4o-mini"

DRAFT_PROMPT = """You are drafting a LinkedIn connection request message on behalf of Yahya Khaled, Business Development at COMIX Pharmaceuticals — a Dubai-based company that in-licenses generic molecules from manufacturers globally and commercialises them in the UAE through local distributors. COMIX focuses on CNS and is expanding into cardiovascular, metabolic, and oncology.

Write a short, professional LinkedIn connection request to {contact_name}, {contact_title} at {company_name}.

Company context: {company_overview}

Rules:
- Maximum 300 characters (LinkedIn connection note limit)
- Mention COMIX and the UAE/Gulf market opportunity
- Reference their role specifically (BD, licensing, export, etc.)
- Sound warm and human — not like a template
- No subject line, no sign-off, just the message body
- Do not mention specific molecules or products

Return only the message text. Nothing else."""

@app.post("/api/outreach/draft-message")
def draft_message(body: DraftMessageRequest):
    from agent_runner import MODELS, ANTHROPIC_API_KEY, OPENAI_API_KEY
    try:
        provider, model_id, _, _ = MODELS.get(body.model, MODELS["gpt-4o-mini"])
        prompt = (DRAFT_PROMPT
            .replace("{contact_name}",     body.contact_name or "there")
            .replace("{contact_title}",    body.contact_title or "your role")
            .replace("{company_name}",     body.company_name)
            .replace("{company_overview}", body.company_overview or body.company_name))

        if provider == "anthropic":
            import anthropic
            client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp   = client.messages.create(
                model=model_id, max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            )
            message = resp.content[0].text.strip()
        else:
            from openai import OpenAI
            client  = OpenAI(api_key=OPENAI_API_KEY)
            resp    = client.chat.completions.create(
                model=model_id, max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            )
            message = resp.choices[0].message.content.strip()

        return {"message": message}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Outreach (SSE streaming) ─────────────────────────────────────────────────
class OutreachRequest(BaseModel):
    country: str
    model:   str = "haiku"

@app.post("/api/outreach/run")
def outreach_run(body: OutreachRequest):
    """Stream outreach run progress + results via SSE, then save to contacts.db."""
    from outreach_runner import run_outreach_stream
    from db import save_outreach_run

    def generate():
        companies = []
        try:
            for event in run_outreach_stream(body.country, body.model):
                if event["type"] == "company":
                    companies.append(event["data"])
                yield f"data: {json.dumps(event)}\n\n"

            if companies:
                run_id = save_outreach_run(body.country, body.model, companies)
                yield f"data: {json.dumps({'type': 'saved', 'run_id': run_id})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/outreach/runs")
def outreach_runs():
    from db import list_outreach_runs
    return {"runs": list_outreach_runs()}


@app.get("/api/outreach/runs/{run_id}")
def outreach_run_results(run_id: str):
    from db import get_outreach_run
    entry = get_outreach_run(run_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Run not found")
    return entry


@app.delete("/api/outreach/runs/{run_id}")
def delete_outreach_run(run_id: str):
    from db import delete_outreach_run as _delete
    if not _delete(run_id):
        raise HTTPException(status_code=404, detail="Run not found")
    return {"ok": True}


# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/")
def health():
    return {"status": "ok", "molecules_loaded": len(_state.get("molecules", []))}
