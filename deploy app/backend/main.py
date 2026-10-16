"""
main.py — COMIX BD Intelligence Web API
Run from backend/: uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
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
from pydantic import BaseModel, Field

load_dotenv(override=True)

# ─── Paths ───────────────────────────────────────────────────────────────────
BACKEND_DIR  = Path(__file__).parent
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
    from data_processing.who_crosswalk import _assets as load_who_assets
    print("Loading UAE market data from Supabase (IQVIA / UPP / MOHAP / WHO ATC)...")
    _state["dfs"], _state["market_context"] = load_data()
    load_who_assets()
    _state["molecules"] = sorted(
        _state["dfs"]["iqvia"]["Molecule Combination"].dropna().unique().tolist()
    )
    print(f"  Ready — {len(_state['molecules'])} molecules loaded.")
    from tecnimede import daily_sync
    from registry_review import review_after_refresh
    daily = asyncio.create_task(daily_sync())
    review = asyncio.create_task(review_after_refresh())
    yield
    daily.cancel()
    review.cancel()

app = FastAPI(title="COMIX BD API", lifespan=lifespan)

FRONTEND_URL = os.getenv("FRONTEND_URL", "")
origins = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001"]  # 3001 = rep app
if FRONTEND_URL:
    origins.extend([u.strip() for u in FRONTEND_URL.split(",") if u.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # Any Vercel deployment (Dirac, the rep app, previews) — saves listing every URL in FRONTEND_URL.
    allow_origin_regex=r"https://[a-z0-9-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Auth middleware ──────────────────────────────────────────────────────────
PUBLIC_PATHS = {"/", "/api/auth/login", "/api/auth/logout", "/docs", "/openapi.json", "/redoc"}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
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


# ─── Market Discovery — segmented IQVIA/EphMRA hierarchy ───────────────────
@app.get("/api/market-discovery")
def market_discovery(level: str = "ATC1", parent: Optional[str] = None, source: str = "IQVIA"):
    """Return value/units/growth/company-share metrics for an ATC level.

    ``parent`` accepts an ATC code (``N05A``) or the full IQVIA label.  Each
    node includes child labels for the next drill level.
    """
    from data_processing.market_discovery import build_market_discovery
    from data_processing.who_crosswalk import build_who_response, enrich_iqvia_response
    try:
        df_iqvia = _state["dfs"]["iqvia"]
        if source.upper() == "WHO" and parent:
            return build_who_response(df_iqvia, level.upper(), parent)
        response = build_market_discovery(df_iqvia, level, parent)
        return enrich_iqvia_response(response, level.upper(), parent)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=503, detail="Market data is not loaded") from exc


@app.get("/api/market-discovery/molecules")
def market_discovery_molecules(atc4: str, source: str = "IQVIA"):
    """Return individual molecules within an IQVIA ATC4 class."""
    from data_processing.market_discovery import build_market_molecules
    from data_processing.who_crosswalk import build_who_molecules_response, enrich_molecule_response
    try:
        df_iqvia = _state["dfs"]["iqvia"]
        if source.upper() == "WHO":
            return build_who_molecules_response(df_iqvia, atc4)
        return enrich_molecule_response(build_market_molecules(df_iqvia, atc4), atc4)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=503, detail="Market data is not loaded") from exc


@app.get("/api/market-discovery/competitors")
def market_discovery_competitors(atc4: str, molecule: str):
    """Return manufacturer shares for a molecule within its selected ATC4."""
    from data_processing.market_discovery import build_market_competitors
    try:
        return build_market_competitors(_state["dfs"]["iqvia"], atc4, molecule)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=503, detail="Market data is not loaded") from exc


# ─── Analysis — Phase 1 ───────────────────────────────────────────────────────
@app.post("/api/analysis/upload")
async def analysis_upload(file: UploadFile = File(...), company: str = Form(...),
                          company_id: Optional[int] = Form(None), whole_group: bool = Form(True)):
    """Upload a catalogue (PDF/CSV/Excel) → keyword extraction + enrich. With a registry company: a read-only check
    of the molecules against its registry portfolio. (Analysis uses /upload-stream, which reads with AI first.)"""
    from agent_runner import extract_and_enrich
    content = await file.read()
    try:
        result = extract_and_enrich(content, file.filename or "upload", company, _state["dfs"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    result["extraction"] = {"method": "keyword"}
    if company_id:
        from registry import check_catalogue
        try:
            check_catalogue(result, company_id, whole_group)
        except Exception as e:
            result["registry_check"] = {"error": str(e)}
    return result


@app.post("/api/analysis/upload-stream")
async def analysis_upload_stream(file: UploadFile = File(...), company: str = Form(...),
                                 company_id: Optional[int] = Form(None), whole_group: bool = Form(True)):
    """Upload a catalogue as SSE, for the progress pop-up. Claude reads the products first (catalogue_ai); if that
    fails, keyword matching (extract_and_enrich_steps) takes over. Events: {stage: "reading", pages, image_pages},
    {molecule, count} per molecule found, {stage: "fallback", reason}, {stage: "registry"}, then {result}.
    The registry check is read-only; the review screen writes via POST /api/registry/uploaded. Ends with [DONE]."""
    from agent_runner import ai_extract_and_enrich_steps, extract_and_enrich_steps
    content = await file.read()
    filename = file.filename or "upload"
    send = lambda obj: f"data: {json.dumps(obj)}\n\n"

    def generate():
        try:
            result, count = None, 0
            try:
                for kind, data in ai_extract_and_enrich_steps(content, filename, company, _state["dfs"]):
                    if kind == "pages":
                        yield send({"stage": "reading", **data})
                    elif kind == "molecule":
                        count += 1
                        yield send({"molecule": data, "count": count})
                    else:
                        result = data
            except Exception as e:
                reason = str(e) or type(e).__name__
                print(f"AI catalogue reading failed, using keyword matching: {reason}")
                yield send({"stage": "fallback", "reason": reason})
                result, count = None, 0
                for kind, data in extract_and_enrich_steps(content, filename, company, _state["dfs"]):
                    if kind == "molecule":
                        count += 1
                        yield send({"molecule": data, "count": count})
                    else:
                        result = data
                result["extraction"] = {"method": "keyword", "reason": reason}
            if company_id:
                from registry import check_catalogue
                yield send({"stage": "registry"})
                try:
                    check_catalogue(result, company_id, whole_group)
                except Exception as e:
                    result["registry_check"] = {"error": str(e)}
            yield send({"result": result})
        except Exception as e:
            yield send({"error": str(e)})
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


class UploadedItem(BaseModel):
    name: str
    form: Optional[str] = None
    strengths: Optional[str] = None
    catalogue_status: Optional[str] = None


class UploadedRequest(BaseModel):
    company_id: int
    source: str = ""
    items: list[UploadedItem]


@app.post("/api/registry/uploaded")
def registry_add_uploaded(body: UploadedRequest):
    """Review screen → add the confirmed catalogue products to the 'uploaded' registry under the company."""
    from registry import add_uploaded
    if not body.items:
        raise HTTPException(status_code=422, detail="Nothing selected")
    return add_uploaded(body.company_id, [i.model_dump() for i in body.items], body.source)


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
    model:         str = "gpt-5.6-luna"
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
    run_id:      Optional[str] = None   # update this run instead of adding one

@app.post("/api/analysis/history")
def save_analysis(body: SaveAnalysisRequest):
    from store import save_analysis as _save
    run_id = _save(
        source_name=body.source_name,
        source_type=body.source_type,
        result=body.result,
        report=body.report,
        model=body.model,
        run_id=body.run_id,
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


# ─── Forecast — Y1-Y3 revenue for shortlisted molecules ──────────────────────

class ForecastRequest(BaseModel):
    molecules:   list[str]
    growth_rate: float = 0.10

@app.post("/api/analysis/forecast")
def forecast_molecules(body: ForecastRequest):
    """Generate Y1-Y3 revenue forecasts for a list of IQVIA-matched molecules."""
    from DetailedForecast import forecast_top_product
    df_iqvia = _state["dfs"]["iqvia"]
    results, errors = [], []
    for mol in body.molecules:
        try:
            results.append(forecast_top_product(df_iqvia, mol, body.growth_rate))
        except Exception as e:
            errors.append({"molecule": mol, "error": str(e)})
    return {"forecasts": results, "errors": errors, "growth_rate": body.growth_rate}


# ─── Yearly slice cube (molecule dashboard) ───────────────────────────────────
@app.get("/api/analysis/trend/{molecule}")
def get_trend(molecule: str, nfc3: str | None = None, strength: str | None = None):
    from agent_runner import get_molecule_slices
    try:
        return get_molecule_slices(molecule.upper(), _state["dfs"]["iqvia"], nfc3=nfc3, strength=strength)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── ATC lineage (class-position cascade) ─────────────────────────────────────
@app.get("/api/analysis/lineage/{molecule}")
def get_lineage(molecule: str):
    from agent_runner import get_molecule_lineage
    try:
        return get_molecule_lineage(molecule.upper(), _state["dfs"]["iqvia"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    model:            str = "gpt-5.6-luna"

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
        provider, model_id, _, _ = MODELS.get(body.model, MODELS["gpt-5.6-luna"])
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
                model=model_id, max_completion_tokens=200,
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
    """Stream outreach run progress + results via SSE, then save to PostgreSQL."""
    from outreach_runner import run_outreach_stream
    from db import save_outreach_run

    def generate():
        companies = []
        try:
            for event in run_outreach_stream(body.country, body.model, _state["dfs"]):
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


# ─── My Portfolio ────────────────────────────────────────────────────────────

@app.get("/api/portfolio")
def get_portfolio():
    from store import get_my_portfolio
    return {"portfolio": get_my_portfolio()}


@app.get("/api/portfolio/hierarchy")
def portfolio_hierarchy():
    """IQVIA ATC1→ATC4→molecule tree for the portfolio builder (built once, cached)."""
    if "portfolio_hierarchy" not in _state:
        from data_processing.market_discovery import build_portfolio_hierarchy
        _state["portfolio_hierarchy"] = build_portfolio_hierarchy(_state["dfs"]["iqvia"])
    return _state["portfolio_hierarchy"]


@app.post("/api/portfolio/upload")
async def save_portfolio_upload(file: UploadFile = File(...), company: str = Form(...)):
    from agent_runner import extract_and_enrich
    from store import save_my_portfolio
    content = await file.read()
    try:
        result = extract_and_enrich(content, file.filename or "upload", company, _state["dfs"])
        save_my_portfolio(company, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SavePortfolioEnrichRequest(BaseModel):
    molecules: list[str]
    company:   str = "My Portfolio"

@app.post("/api/portfolio/enrich")
def save_portfolio_enrich(body: SavePortfolioEnrichRequest):
    from agent_runner import enrich_molecules
    from store import save_my_portfolio
    try:
        result = enrich_molecules(body.molecules, body.company, _state["dfs"])
        save_my_portfolio(body.company, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SavePortfolioReportRequest(BaseModel):
    report: str

@app.post("/api/portfolio/report")
def save_portfolio_report(body: SavePortfolioReportRequest):
    from store import save_my_portfolio_report
    save_my_portfolio_report(body.report)
    return {"ok": True}


@app.delete("/api/portfolio")
def clear_portfolio():
    from store import delete_my_portfolio
    delete_my_portfolio()
    return {"ok": True}



# ─── Inventory ──────────────────────────────────────────────────────────────

class StockUpdateRequest(BaseModel):
    stock_quantity: int = Field(ge=0, le=2147483647)


@app.get("/api/inventory")
def get_inventory():
    from inventory import list_inventory
    return list_inventory(_state["dfs"]["iqvia"])


@app.get("/api/inventory/options/{molecule}")
def get_inventory_options(molecule: str):
    from inventory import sku_options
    options = sku_options(_state["dfs"]["iqvia"], molecule)
    if options is None:
        raise HTTPException(status_code=404, detail="No IQVIA packs for this molecule")
    return options


class SkuSelectionRequest(BaseModel):
    pack_keys: list[str]


@app.put("/api/inventory/skus/{molecule}")
def set_inventory_skus(molecule: str, body: SkuSelectionRequest):
    from inventory import set_skus
    options = set_skus(_state["dfs"]["iqvia"], molecule, body.pack_keys)
    if options is None:
        raise HTTPException(status_code=404, detail="No IQVIA packs for this molecule")
    return options


class OrderLine(BaseModel):
    pack_key: str
    quantity: int = Field(gt=0, le=10_000_000)


class OrderCreateRequest(BaseModel):
    party:      str                 # supplier for a PO, customer for an SO
    order_date: str | None = None   # YYYY-MM-DD, defaults to today
    note:       str | None = None
    lines:      list[OrderLine]


def _order_kind(kind: str) -> str:
    if kind not in ("purchase", "sales"):
        raise HTTPException(status_code=404, detail="Unknown order type")
    return kind


@app.get("/api/po-tracker")
def get_po_tracker():
    """Tecnimede orders grouped by COMIX PO number (synced by scripts/sync_tecnimede.py)."""
    from tecnimede import list_orders
    return list_orders()


class OrderMoleculeBody(BaseModel):
    ref: str
    molecule: Optional[str] = None


@app.put("/api/po-tracker/molecule")
def set_po_molecule(body: OrderMoleculeBody):
    """Link a PO Tracker order to a portfolio molecule (molecule null = unlink)."""
    from tecnimede import link_molecule
    link_molecule(body.ref, body.molecule)
    return {"ref": body.ref, "molecule": body.molecule.strip().upper() if body.molecule else None}


@app.post("/api/po-tracker/sync")
async def sync_po_tracker():
    """Pull the latest orders from the Tecnimede portal now (~30–60 s)."""
    import tecnimede
    try:
        return await asyncio.to_thread(tecnimede.run_sync, "button")
    except tecnimede.PortalError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Sync failed: {str(e).splitlines()[0][:300]}")


@app.get("/api/inventory/orders")
def get_inventory_orders():
    from inventory import list_orders
    return list_orders()


@app.post("/api/inventory/orders/{kind}")
def create_inventory_order(kind: str, body: OrderCreateRequest):
    from inventory import create_order
    lines = [line.model_dump() for line in body.lines]
    return _field_force(lambda: create_order(_order_kind(kind), body.party, body.order_date, body.note, lines))


@app.post("/api/inventory/orders/{kind}/{order_id}/close")
def close_inventory_order(kind: str, order_id: int):
    """Receive a PO / deliver an SO — moves stock."""
    from inventory import close_order
    _field_force(lambda: close_order(_order_kind(kind), order_id))
    return {"ok": True}


@app.post("/api/inventory/orders/{kind}/{order_id}/cancel")
def cancel_inventory_order(kind: str, order_id: int):
    from inventory import cancel_order
    _field_force(lambda: cancel_order(_order_kind(kind), order_id))
    return {"ok": True}


@app.put("/api/inventory/{pack_key}")
def update_inventory_stock(pack_key: str, body: StockUpdateRequest):
    from inventory import set_stock
    item = set_stock(pack_key, body.stock_quantity)
    if item is None:
        raise HTTPException(status_code=404, detail="This SKU is not in inventory")
    return item


# ─── Field force (medical rep CRM) ───────────────────────────────────────────
# Reps use the separate rep app; these endpoints are COMIX's setup + dashboard.

def _field_force(call):
    """Run a field_force call, mapping a missing service key to a clear 503."""
    try:
        return call()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.get("/api/field-force/setup")
def field_force_setup():
    from field_force import list_setup
    return _field_force(list_setup)


class RepCreateRequest(BaseModel):
    name:     str
    email:    str
    password: str = Field(min_length=8)
    role:     str = "rep"
    area_ids: list[int] = Field(default_factory=list)


@app.post("/api/field-force/reps")
def field_force_create_rep(body: RepCreateRequest):
    if body.role not in {"rep", "manager"}:
        raise HTTPException(status_code=422, detail="Role must be rep or manager")
    from field_force import create_rep
    try:
        return _field_force(lambda: create_rep(body.name, body.email, body.password, body.role, body.area_ids))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not create rep: {e}")


class RepUpdateRequest(BaseModel):
    name:     Optional[str] = None
    role:     Optional[str] = None
    active:   Optional[bool] = None
    area_ids: Optional[list[int]] = None
    password: Optional[str] = Field(default=None, min_length=8)


@app.put("/api/field-force/reps/{rep_id}")
def field_force_update_rep(rep_id: str, body: RepUpdateRequest):
    if body.role is not None and body.role not in {"rep", "manager"}:
        raise HTTPException(status_code=422, detail="Role must be rep or manager")
    from field_force import update_rep
    _field_force(lambda: update_rep(rep_id, body.name, body.role, body.active, body.area_ids, body.password))
    return {"ok": True}


class AreaCreateRequest(BaseModel):
    name:    str
    emirate: Optional[str] = None


@app.post("/api/field-force/areas")
def field_force_create_area(body: AreaCreateRequest):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Area name is required")
    from field_force import create_area
    return _field_force(lambda: create_area(body.name, body.emirate))


@app.delete("/api/field-force/areas/{area_id}")
def field_force_delete_area(area_id: int):
    from field_force import delete_area
    _field_force(lambda: delete_area(area_id))
    return {"ok": True}


@app.get("/api/field-force/accounts")
def field_force_accounts():
    from field_force import list_accounts
    return {"accounts": _field_force(list_accounts)}


@app.put("/api/field-force/accounts/{account_id}")
def field_force_update_account(account_id: int, body: dict):
    from field_force import update_account
    _field_force(lambda: update_account(account_id, body))
    return {"ok": True}


@app.post("/api/field-force/accounts/import")
async def field_force_import_accounts(file: UploadFile = File(...)):
    from field_force import import_accounts
    content = await file.read()
    return _field_force(lambda: import_accounts(content, file.filename or "upload.xlsx"))


@app.get("/api/field-force/dashboard")
def field_force_dashboard(days: int = 30):
    from field_force import dashboard
    return _field_force(lambda: dashboard(max(1, min(days, 365))))


# ─── Rep app: molecule research cards ────────────────────────────────────────

def _rep_call(call):
    """Run a rep-app call so every failure comes back as JSON with a message.

    An unhandled exception becomes a bare 500 without CORS headers, which the
    browser reports only as "Load failed" — hiding the actual cause.
    """
    try:
        return _field_force(call)
    except HTTPException:
        raise
    except Exception as e:
        print(f"Rep app call failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {str(e).splitlines()[0][:300] if str(e) else ''}")


@app.post("/api/rep/research/{molecule}/refresh")
async def rep_research_refresh(molecule: str, request: Request):
    """Pull recent PubMed papers for a molecule and rewrite its research cards (~30 s)."""
    import research
    import voice_notes

    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sign in first")

    def run():
        try:
            voice_notes.rep_for_token(token)
        except voice_notes.NotARep as e:
            raise HTTPException(status_code=401, detail=str(e))
        return research.refresh(molecule)

    return await asyncio.to_thread(_rep_call, run)


# ─── Rep app: voice notes ────────────────────────────────────────────────────
# Called by the rep app with the rep's Supabase session (Bearer token), not
# Dirac's cookie. Returns the transcript + form fields; nothing is saved here.

MAX_VOICE_NOTE_BYTES = 20 * 1024 * 1024  # OpenAI's limit is 25 MB


@app.post("/api/rep/voice-note")
async def rep_voice_note(request: Request, account_id: int = Form(...), audio: UploadFile = File(...)):
    import voice_notes

    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to use voice notes")
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=422, detail="The recording is empty")
    if len(content) > MAX_VOICE_NOTE_BYTES:
        raise HTTPException(status_code=413, detail="The recording is too long — keep it under a few minutes")

    def run():
        try:
            voice_notes.rep_for_token(token)
        except voice_notes.NotARep as e:
            raise HTTPException(status_code=401, detail=str(e))
        return voice_notes.process(content, audio.filename or "note.webm",
                                   audio.content_type or "audio/webm", account_id)

    return await asyncio.to_thread(_rep_call, run)


# ─── Evaluation pipeline ────────────────────────────────────────────────────

class PipelineDecisionRequest(BaseModel):
    molecule:    str
    decision:    str
    source_name: str = ""
    snapshot:    dict = Field(default_factory=dict)


@app.get("/api/pipeline")
def get_pipeline():
    from store import list_pipeline_decisions
    return {"decisions": list_pipeline_decisions()}


@app.put("/api/pipeline")
def set_pipeline_decision(body: PipelineDecisionRequest):
    if body.decision not in {"yes", "maybe", "no"}:
        raise HTTPException(status_code=422, detail="Decision must be yes, maybe, or no")
    if not body.molecule.strip():
        raise HTTPException(status_code=422, detail="Molecule is required")
    from store import save_pipeline_decision
    saved = save_pipeline_decision(
        molecule=body.molecule.strip(),
        decision=body.decision,
        source_name=body.source_name.strip(),
        snapshot=body.snapshot,
    )
    # A shortlisted (✓) molecule gets a Deal Tracker card; the catalogue's company is the partner.
    saved["deal_created"] = False
    if body.decision == "yes":
        from deals import ensure_deal
        try:
            partner = body.source_name.strip()
            saved["deal_created"] = ensure_deal(body.molecule, "" if partner in {"Catalogue", "Portfolio"} else partner)
        except Exception as e:
            print(f"Deal Tracker: couldn't open a deal for {body.molecule}: {e}")
    return saved


@app.delete("/api/pipeline/{molecule}")
def remove_pipeline_decision(molecule: str):
    from store import delete_pipeline_decision
    delete_pipeline_decision(molecule)
    return {"ok": True}


# ─── Deal Tracker ─────────────────────────────────────────────────────────────
class DealCreateRequest(BaseModel):
    molecule: str
    partner:  str = ""
    stage:    str = "shortlisted"


class DealUpdateRequest(BaseModel):
    partner:       Optional[str] = None
    mah:           Optional[str] = None
    status:        Optional[str] = None
    status_reason: Optional[str] = None
    notes:         Optional[str] = None
    info:          Optional[dict[str, Optional[str]]] = None


class DealMoveRequest(BaseModel):
    stage: str


def _deal_or_404(deal_id: int) -> dict:
    from deals import get_deal
    deal = get_deal(deal_id, _state["dfs"])
    if deal is None:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal


@app.get("/api/deals")
def list_deals():
    from deals import list_deals as _list
    return _list(_state["dfs"])


@app.post("/api/deals")
def create_deal(body: DealCreateRequest):
    from deals import create_deal as _create
    try:
        row = _create(body.molecule, body.partner, body.stage)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _deal_or_404(row["id"])


@app.get("/api/deals/by-molecule/{molecule}")
def deal_by_molecule(molecule: str):
    from deals import deal_for_molecule
    return {"deal": deal_for_molecule(molecule)}


@app.get("/api/deals/{deal_id}")
def get_deal(deal_id: int):
    return _deal_or_404(deal_id)


@app.patch("/api/deals/{deal_id}")
def update_deal(deal_id: int, body: DealUpdateRequest):
    from deals import update_deal as _update
    try:
        if _update(deal_id, body.model_dump(exclude_unset=True)) is None:
            raise HTTPException(status_code=404, detail="Deal not found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _deal_or_404(deal_id)


@app.post("/api/deals/{deal_id}/move")
def move_deal(deal_id: int, body: DealMoveRequest):
    """Move a deal; reaching Launched also adds the molecule to My Portfolio."""
    from deals import add_to_portfolio, move_deal as _move
    try:
        row = _move(deal_id, body.stage)
        if row is None:
            raise HTTPException(status_code=404, detail="Deal not found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    portfolio = None
    if body.stage == "launched":
        try:
            portfolio = add_to_portfolio(deal_id, row["molecule"], _state["dfs"])
        except Exception as e:
            portfolio = f"failed: {e}"
    return {**_deal_or_404(deal_id), "portfolio": portfolio}


@app.delete("/api/deals/{deal_id}")
def delete_deal(deal_id: int):
    from deals import delete_deal as _delete
    if not _delete(deal_id):
        raise HTTPException(status_code=404, detail="Deal not found")
    return {"ok": True}


@app.post("/api/deals/{deal_id}/documents")
async def upload_deal_document(deal_id: int, stage: str = Form(...), file: UploadFile = File(...)):
    from deals import add_document
    data = await file.read()
    try:
        add_document(deal_id, stage, file.filename or "file", file.content_type or "", data)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _deal_or_404(deal_id)


@app.get("/api/deals/documents/{doc_id}")
def download_deal_document(doc_id: int):
    from urllib.parse import quote
    from deals import read_document
    found = read_document(doc_id)
    if not found:
        raise HTTPException(status_code=404, detail="Document not found")
    doc, data = found
    return Response(content=data, media_type=doc["content_type"], headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(doc['file_name'])}",
    })


@app.delete("/api/deals/documents/{doc_id}")
def delete_deal_document(doc_id: int):
    from deals import delete_document
    if not delete_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


# ─── Events (CPHI exhibitor lists) ────────────────────────────────────────────
@app.get("/api/events")
def get_events():
    from events import list_events
    return {"events": list_events()}


@app.get("/api/registry/companies")
def registry_companies(q: str = ""):
    from registry import search_companies
    return search_companies(q)


@app.get("/api/registry/molecules")
def registry_molecules(q: str = ""):
    from registry import search_molecules
    return search_molecules(q)


@app.get("/api/registry/company-portfolio/{company_id}")
def registry_company_portfolio(company_id: int, whole_group: bool = True):
    from registry import company_portfolio
    return company_portfolio(company_id, _state.get("dfs"), whole_group)


@app.get("/api/registry/registries")
def registry_list():
    from registry import list_registries
    return list_registries()


@app.get("/api/registry/search")
def registry_search(registry: str, q: str = "", status: str = "active", offset: int = 0, limit: int = 50):
    from registry import search_registry
    return search_registry(registry, q, status, offset, limit)


@app.get("/api/registry/review")
def registry_review_overview():
    from registry_review import review_overview
    return review_overview()


@app.post("/api/registry/review/run")
def registry_review_run():
    from registry_review import start_review
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(400, "ANTHROPIC_API_KEY is not set on the backend")
    return {"started": start_review("manual")}


class CompanyDecision(BaseModel):
    a: int
    b: int
    verdict: str


@app.post("/api/registry/review/company")
def registry_review_company(body: CompanyDecision):
    from registry_review import decide_company_pair
    try:
        return decide_company_pair(body.a, body.b, body.verdict)
    except ValueError as e:
        raise HTTPException(400, str(e))


class DoctorAdd(BaseModel):
    area_id: Optional[int] = None


@app.get("/api/doctors/facets")
def doctors_facets():
    import doctors
    return doctors.facets()


@app.get("/api/doctors")
def doctors_search(q: str = "", profession: Optional[str] = None, specialty: Optional[str] = None,
                   grade: Optional[str] = None, with_contact: bool = False, offset: int = 0, limit: int = 50):
    import doctors
    return doctors.search(q, profession, specialty, grade, with_contact, offset, limit)


@app.get("/api/doctors/{dha_id}")
def doctors_detail(dha_id: str):
    import doctors
    d = doctors.detail(dha_id)
    if not d:
        raise HTTPException(404, "Not found")
    return d


@app.post("/api/doctors/{dha_id}/field-force")
def doctors_add(dha_id: str, body: DoctorAdd):
    import doctors
    try:
        return doctors.add_to_field_force(dha_id, body.area_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


class GroupDecision(BaseModel):
    cluster_id: int
    groups: list[dict]          # [{name, member_ids}]; [] = none of these belong together


@app.post("/api/registry/review/group")
def registry_review_group(body: GroupDecision):
    from registry_review import decide_group
    return decide_group(body.cluster_id, body.groups)


class MoleculeDecision(BaseModel):
    alias: str
    inn: Optional[str] = None


@app.post("/api/registry/review/molecule")
def registry_review_molecule(body: MoleculeDecision):
    from registry_review import decide_molecule
    try:
        return decide_molecule(body.alias, body.inn)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/registry/runs/{run_id}/changes")
def registry_run_changes(run_id: int, kind: Optional[str] = None):
    from registry_review import run_changes
    return run_changes(run_id, kind)


@app.get("/api/registry/molecule-companies")
def registry_molecule_companies(molecule: str):
    from registry import molecule_companies
    return molecule_companies(molecule)


@app.get("/api/events/exhibitors/{exhibitor_id}/portfolio")
def get_exhibitor_portfolio(exhibitor_id: int):
    from events import exhibitor_portfolio
    result = exhibitor_portfolio(exhibitor_id, _state.get("dfs"))
    if result is None:
        raise HTTPException(status_code=404, detail="Exhibitor not found")
    return result


@app.get("/api/events/{key}")
def get_event(key: str):
    from events import get_event as _get
    event = _get(key)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/")
def health():
    return {"status": "ok", "molecules_loaded": len(_state.get("molecules", []))}
