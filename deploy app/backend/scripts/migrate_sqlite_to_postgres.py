"""Copy legacy saved records into PostgreSQL without overwriting existing rows."""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from database import connection, init_db  # noqa: E402

TABLES = {
    "outreach_runs": ("run_id", "country", "model", "run_date", "companies_found", "contacts_found"),
    "outreach_companies": ("id", "run_id", "company", "website", "overview", "uae_mohap", "uae_upp", "mohap_agents", "upp_agents", "contacts"),
    "analysis_runs": ("run_id", "source_name", "source_type", "model", "saved_at", "stats", "result", "report", "has_report"),
    "my_portfolio": ("id", "company_name", "result", "report", "saved_at"),
    "pipeline_decisions": ("molecule", "decision", "source_name", "snapshot", "updated_at"),
}
PRIMARY_KEYS = {"outreach_runs": "run_id", "outreach_companies": "id", "analysis_runs": "run_id",
                "my_portfolio": "id", "pipeline_decisions": "molecule"}
JSON_COLUMNS = {"mohap_agents", "upp_agents", "contacts", "stats", "result", "snapshot"}


def _same_values(columns, source, existing):
    for index, column in enumerate(columns):
        left, right = source[index], existing[column]
        if column in JSON_COLUMNS:
            left, right = json.loads(left or "null"), json.loads(right or "null")
        if left != right:
            return False
    return True


def migrate(path: Path, analyses_json: Path | None = None) -> dict[str, int]:
    if not path.is_file():
        raise FileNotFoundError(path)
    source = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        found = {r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        counts = {table: source.execute(f"SELECT count(*) FROM {table}").fetchone()[0] if table in found else 0 for table in TABLES}
        legacy_analyses = []
        if analyses_json is not None:
            legacy_analyses = json.loads(analyses_json.read_text())
            if not isinstance(legacy_analyses, list):
                raise ValueError("Legacy analyses JSON must contain a list")
        init_db()
        with connection() as target:
            # Serialise imports; a conflicting key aborts the entire transaction.
            target.execute("SELECT pg_advisory_xact_lock(74812218)")
            for table, columns in TABLES.items():
                if table not in found:
                    continue
                names = ", ".join(columns)
                placeholders = ", ".join(["%s"] * len(columns))
                primary_key = PRIMARY_KEYS[table]
                for row in source.execute(f"SELECT {names} FROM {table}"):
                    existing = target.execute(
                        f"SELECT {names} FROM {table} WHERE {primary_key}=%s", (row[primary_key],)
                    ).fetchone()
                    if existing:
                        if not _same_values(columns, row, existing):
                            raise RuntimeError(f"Conflicting {table} row with {primary_key}={row[primary_key]!r}; import rolled back")
                        continue
                    target.execute(f"INSERT INTO {table} ({names}) VALUES ({placeholders})", tuple(row))
            for entry in legacy_analyses:
                columns = TABLES["analysis_runs"]
                values = (entry["run_id"], entry["source_name"], entry.get("source_type", "upload"),
                          entry.get("model", ""), entry["saved_at"], json.dumps(entry.get("stats", {})),
                          json.dumps(entry.get("result", {})), entry.get("report", ""), int(bool(entry.get("report"))))
                existing = target.execute("SELECT * FROM analysis_runs WHERE run_id=%s", (entry["run_id"],)).fetchone()
                if existing:
                    if not _same_values(columns, values, existing):
                        raise RuntimeError(f"Conflicting legacy analysis {entry['run_id']!r}; import rolled back")
                    continue
                target.execute("""INSERT INTO analysis_runs
                    (run_id, source_name, source_type, model, saved_at, stats, result, report, has_report)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""", values)
                counts["legacy_analyses_json"] = counts.get("legacy_analyses_json", 0) + 1
            target.execute("SELECT setval(pg_get_serial_sequence('dirac.outreach_companies', 'id'), COALESCE((SELECT max(id) FROM outreach_companies), 1), (SELECT count(*) > 0 FROM outreach_companies))")
        return counts
    finally:
        source.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sqlite_path", type=Path, help="Path to the old contacts.db")
    parser.add_argument("--analyses-json", type=Path, help="Optional legacy analyses.json archive")
    args = parser.parse_args()
    print(migrate(args.sqlite_path, args.analyses_json))
