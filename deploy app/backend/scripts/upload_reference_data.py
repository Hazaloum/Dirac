"""
Upload a reference dataset to Supabase, replacing what is there.

Usage (from deploy app/backend/):
    python scripts/upload_reference_data.py iqvia  path/to/iqvia.csv
    python scripts/upload_reference_data.py upp    path/to/upp.csv
    python scripts/upload_reference_data.py mohap  path/to/mohap.csv
    python scripts/upload_reference_data.py who    path/to/who_atc_hierarchy.json path/to/who_iqvia_crosswalk.json

For a raw IQVIA quarterly .xlsx export use scripts/convert_iqvia_export.py,
which converts and uploads in one step. Restart the backend afterwards — it
reads reference data once at startup.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import reference_data  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", choices=["iqvia", "upp", "mohap", "who"])
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()

    if args.dataset == "who":
        if len(args.paths) != 2:
            parser.error("who needs the hierarchy JSON and the crosswalk JSON")
        hierarchy, crosswalk = (json.loads(p.read_text(encoding="utf-8")) for p in args.paths)
        print(reference_data.upload_who(hierarchy, crosswalk))
        return

    df = pd.read_csv(args.paths[0], encoding="utf-8-sig", low_memory=False)
    upload = {
        "iqvia": reference_data.upload_iqvia,
        "upp":   reference_data.upload_upp,
        "mohap": reference_data.upload_mohap,
    }[args.dataset]
    print(f"Uploaded {upload(df):,} {args.dataset} rows")


if __name__ == "__main__":
    main()
