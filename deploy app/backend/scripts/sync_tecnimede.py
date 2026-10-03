"""
Pull COMIX's open orders from Tecnimede's supplier portal into Supabase.

Usage (from deploy app/backend/, with TECNIMEDE_USERNAME / TECNIMEDE_PASSWORD
and the Supabase vars in .env):
    python scripts/sync_tecnimede.py          # headless
    python scripts/sync_tecnimede.py --show   # watch the browser (debugging)
    python scripts/sync_tecnimede.py --dry-run

First time only: playwright install chromium
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
import tecnimede  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--show", action="store_true", help="show the browser window")
    parser.add_argument("--dry-run", action="store_true", help="scrape and print, don't save")
    args = parser.parse_args()

    try:
        lines = tecnimede.scrape(headless=not args.show)
    except tecnimede.PortalError as e:
        sys.exit(f"Tecnimede sync failed: {e}")
    for line in lines:
        eta = line["factory_confirmation"] or line["requested_delivery"] or "—"
        print(f"{line['customer_reference'] or '':<14} {line['item_description']:<45} "
              f"{line['pending_quantity'] or 0:>7,}  {line['status'] or '':<30} ETA {eta}")
    if args.dry_run:
        print(f"\n{len(lines)} open lines (dry run, nothing saved)")
        return
    result = tecnimede.save(lines)
    print(f"\nSaved {result['open']} open lines; {result['closed']} lines no longer open.")


if __name__ == "__main__":
    main()
