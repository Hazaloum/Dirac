"""
supabase_client.py — shared Supabase client for the COMIX OS project.

Every saved record (analysis runs, portfolio, pipeline, outreach) and every
reference dataset (IQVIA, UPP, MOHAP, WHO ATC) lives in Supabase. Configure
with SUPABASE_URL and SUPABASE_KEY (the project's anon key).

The field-force (rep CRM) tables are locked to signed-in reps, so Dirac reads
and manages them with the service-role key (SUPABASE_SERVICE_KEY, server-side
only — never expose it to a frontend).
"""
from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(override=True)

PAGE_SIZE = 1000  # PostgREST's default max rows per request


@lru_cache(maxsize=1)
def get_client() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
    return create_client(url, key)


@lru_cache(maxsize=1)
def get_service_client() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_SERVICE_KEY is not set — the Field force page needs it")
    return create_client(url, key)


def fetch_all(table: str, columns: str = "*", order: str = "id", client: Client | None = None) -> list[dict]:
    """Read every row of a table, paging past the per-request row cap."""
    client = client or get_client()
    rows: list[dict] = []
    start = 0
    while True:
        page = (
            client.table(table).select(columns).order(order)
            .range(start, start + PAGE_SIZE - 1).execute().data
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE
