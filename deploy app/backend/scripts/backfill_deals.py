"""
Open a Deal Tracker card for every molecule already ticked (Pipeline "Yes").

Ticking a molecule now opens its deal automatically; this catches up the ones
ticked before that. Molecules that already have a deal are left alone. Safe to
re-run, but it will re-open deals you deleted for still-ticked molecules.

Usage (from deploy app/backend/, with the Supabase vars in .env):
    python scripts/backfill_deals.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(override=True)

from deals import backfill_from_pipeline  # noqa: E402

if __name__ == "__main__":
    created = backfill_from_pipeline()
    print(f"Opened {len(created)} deal(s)" + (": " + ", ".join(created) if created else ""))
