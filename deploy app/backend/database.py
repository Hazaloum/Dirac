"""PostgreSQL connection and versioned schema migrations for saved application records."""
from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

MIGRATIONS = Path(__file__).parent / "migrations"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is required (postgresql://user:password@host:5432/database)")
    if not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL")
    return url


@contextmanager
def connection():
    with psycopg.connect(database_url(), row_factory=dict_row) as con:
        # Tables live outside public, avoiding accidental Supabase Data API exposure.
        con.execute("SET search_path TO dirac, public")
        yield con


def init_db() -> None:
    """Apply pending SQL migrations transactionally at backend startup."""
    with psycopg.connect(database_url()) as con:
        con.execute("SELECT pg_advisory_xact_lock(74812217)")
        con.execute("CREATE SCHEMA IF NOT EXISTS dirac")
        con.execute("REVOKE ALL ON SCHEMA dirac FROM PUBLIC")
        con.execute("""CREATE TABLE IF NOT EXISTS dirac.schema_migrations (
            version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""")
        for path in sorted(MIGRATIONS.glob("*.sql")):
            done = con.execute("SELECT 1 FROM dirac.schema_migrations WHERE version=%s", (path.stem,)).fetchone()
            if not done:
                con.execute(path.read_text())
                con.execute("INSERT INTO dirac.schema_migrations(version) VALUES (%s)", (path.stem,))
