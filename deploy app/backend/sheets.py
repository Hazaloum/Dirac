"""
sheets.py — Google Sheets integration.
Writes outreach results to two sheets: Outreach Runs + Outreach Results.
Gracefully no-ops if GOOGLE_SPREADSHEET_ID is not configured.
"""
from __future__ import annotations

import os
import uuid
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SPREADSHEET_ID          = os.getenv("GOOGLE_SPREADSHEET_ID", "")
GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "service_account.json")

SHEET_RUNS    = "Outreach Runs"
SHEET_RESULTS = "Outreach Results"

RUNS_HEADERS = ["run_id", "run_date", "country", "companies_found", "contacts_found"]
RESULTS_HEADERS = [
    "run_id", "run_date", "country", "company", "company_website",
    "uae_presence", "uae_distributor", "contact_name", "contact_title",
    "contact_email", "contact_linkedin", "status",
]


def _configured() -> bool:
    return bool(SPREADSHEET_ID)


def _get_client():
    import gspread
    from google.oauth2.service_account import Credentials

    creds_path = Path(GOOGLE_CREDENTIALS_FILE)
    if not creds_path.is_absolute():
        creds_path = Path(__file__).parent / creds_path

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = Credentials.from_service_account_file(str(creds_path), scopes=scopes)
    return gspread.authorize(creds)


def _get_or_create_sheet(spreadsheet, title: str, headers: list):
    try:
        return spreadsheet.worksheet(title)
    except Exception:
        ws = spreadsheet.add_worksheet(title=title, rows=2000, cols=len(headers))
        ws.append_row(headers)
        return ws


def append_run(country: str, contacts_found: int) -> str:
    """Record a completed run. Returns run_id."""
    if not _configured():
        return "no-sheets-configured"

    run_id = str(uuid.uuid4())[:8]
    today  = date.today().isoformat()

    gc          = _get_client()
    spreadsheet = gc.open_by_key(SPREADSHEET_ID)
    ws          = _get_or_create_sheet(spreadsheet, SHEET_RUNS, RUNS_HEADERS)
    ws.append_row([run_id, today, country, "5", str(contacts_found)])
    return run_id


def append_results(run_id: str, rows: list):
    """Append contact rows to Outreach Results sheet."""
    if not _configured() or not rows:
        return

    today       = date.today().isoformat()
    gc          = _get_client()
    spreadsheet = gc.open_by_key(SPREADSHEET_ID)
    ws          = _get_or_create_sheet(spreadsheet, SHEET_RESULTS, RESULTS_HEADERS)

    for row in rows:
        uae_parts  = []
        dist_parts = []
        if row.get("mohap_match"):
            uae_parts.append(f"MOHAP: {row['mohap_match']}")
        if row.get("upp_match"):
            uae_parts.append(f"UPP: {row['upp_match']}")
        if row.get("mohap_dist"):
            dist_parts.append(row["mohap_dist"])
        if row.get("upp_dist"):
            dist_parts.append(row["upp_dist"])

        ws.append_row([
            run_id,
            today,
            row.get("country",       ""),
            row.get("company",       ""),
            row.get("website",       ""),
            " | ".join(uae_parts),
            " | ".join(dist_parts),
            row.get("contact_name",  ""),
            row.get("contact_title", ""),
            row.get("contact_email", ""),
            row.get("linkedin_url",  ""),
            "",  # status — blank for team to fill
        ])


def get_runs() -> list:
    """Return all rows from Outreach Runs sheet."""
    if not _configured():
        return []
    gc          = _get_client()
    spreadsheet = gc.open_by_key(SPREADSHEET_ID)
    ws          = _get_or_create_sheet(spreadsheet, SHEET_RUNS, RUNS_HEADERS)
    return ws.get_all_records()


def get_run_results(run_id: str) -> list:
    """Return all contact rows for a specific run_id."""
    if not _configured():
        return []
    gc          = _get_client()
    spreadsheet = gc.open_by_key(SPREADSHEET_ID)
    ws          = _get_or_create_sheet(spreadsheet, SHEET_RESULTS, RESULTS_HEADERS)
    return [r for r in ws.get_all_records() if str(r.get("run_id", "")) == str(run_id)]
