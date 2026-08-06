"""
IQVIA quarterly export → annual iqvia.csv
=========================================
Converts a raw IQVIA "UAE LPO Combined Molecule Quarterly" .xlsx export into the
annual CSV shape that data_processing/loader.py expects.

Three transformations, in order:

1. Coalesce the 'Year to Date' dimension.
   IQVIA splits each product's quarterly series across sibling rows:
     'NOT APPLICABLE' carries Q2, Q3, Q4 of every year
     'YTD Mar YYYY'   carries Q1 of YYYY, and nothing else
   The partition is disjoint, so grouping on the dimension columns and summing
   reunites the full series without double counting. Filtering to
   'NOT APPLICABLE' instead would silently drop Q1 from every year.

2. Roll quarters into calendar years.
   'Q1 2025 LC Value' + ... + 'Q4 2025 LC Value' → '2025 LC Value'.
   Years missing any quarter are dropped, EXCEPT the most recent one, which is
   kept deliberately as a partial: iqvia.py takes end_year = years[-2], so the
   trailing partial year is the sacrificial column that convention expects.

3. Emit loader-compatible headers ('Molecule', '2025 LC Value', ...).

Usage:
    python scripts/convert_iqvia_export.py <export.xlsx> [-o data/iqvia.csv]
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

QUARTER_RE = re.compile(r"^Q([1-4])\s+(\d{4})\s+(LC Value|Units)$")
MEASURES = ("LC Value", "Units")


def _normalise_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Raw headers carry embedded newlines: 'Molecule\\n', 'Q1 2025\\nUnits'."""
    df.columns = [
        re.sub(r"\s+", " ", str(c).replace("\n", " ")).strip() for c in df.columns
    ]
    return df


def _split_columns(df: pd.DataFrame) -> tuple[list[str], dict[tuple[int, str], list[str]]]:
    """Return (dimension columns, {(year, measure): [quarter columns]})."""
    quarters: dict[tuple[int, str], list[str]] = defaultdict(list)
    for col in df.columns:
        match = QUARTER_RE.match(col)
        if match:
            quarters[(int(match.group(2)), match.group(3))].append(col)

    quarter_cols = {c for cols in quarters.values() for c in cols}
    dims = [c for c in df.columns if c not in quarter_cols and c != "Year to Date"]
    return dims, quarters


def convert(src: Path, dest: Path) -> None:
    print(f"Reading {src}")
    df = _normalise_columns(pd.read_excel(src))
    print(f"  {len(df):,} raw rows, {len(df.columns)} columns")

    dims, quarters = _split_columns(df)
    if not quarters:
        sys.exit("No 'Qn YYYY <measure>' columns found — is this a quarterly export?")

    missing_measures = [m for m in MEASURES if not any(k[1] == m for k in quarters)]
    if missing_measures:
        sys.exit(
            f"Export is missing {' and '.join(missing_measures)} columns. "
            "Re-pull from IQVIA with both LC Value and Units — the forecast and "
            "private/LPO split are computed on units."
        )

    # ── 1. Coalesce the Year to Date dimension ────────────────────────────
    if "Year to Date" in df.columns:
        quarter_cols = [c for cols in quarters.values() for c in cols]

        # Guard the disjointness assumption: no quarter may be populated in two
        # sibling rows of the same key, or summing would double count.
        overlap = df.groupby(dims, dropna=False, sort=False)[quarter_cols].apply(
            lambda g: (g.notna().sum() > 1).any()
        )
        if overlap.any():
            sys.exit(
                f"{int(overlap.sum()):,} dimension keys have the same quarter populated "
                "in more than one 'Year to Date' row. Summing would double count — "
                "inspect the export before converting."
            )

        for col in quarter_cols:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.groupby(dims, dropna=False, sort=False, as_index=False)[quarter_cols].sum(
            min_count=1
        )
        print(f"  Coalesced 'Year to Date' rows → {len(df):,} product rows")

    # ── 2. Roll quarters into calendar years ──────────────────────────────
    years = sorted({year for year, _ in quarters})
    complete = [
        y for y in years if all(len(quarters.get((y, m), [])) == 4 for m in MEASURES)
    ]
    if not complete:
        sys.exit("No year in the export has all four quarters for both measures.")

    # Keep one trailing partial year as the sacrificial years[-2] column.
    partial_tail = [y for y in years if y > complete[-1]]
    keep = complete + partial_tail[:1]
    dropped = [y for y in years if y not in keep]

    out = df[dims].copy()
    for year in keep:
        for measure in MEASURES:
            cols = quarters.get((year, measure), [])
            out[f"{year} {measure}"] = (
                df[cols].sum(axis=1, min_count=1) if cols else pd.NA
            )

    print(f"  Complete years: {complete}")
    if partial_tail[:1]:
        print(f"  Partial year kept as trailing column: {partial_tail[0]}")
    if dropped:
        print(f"  Dropped incomplete years: {dropped}")
    print(f"  end_year the app will use: {keep[-2] if len(keep) >= 2 else keep[-1]}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(dest, index=False)
    print(f"Wrote {dest} — {len(out):,} rows, {len(out.columns)} columns")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Raw IQVIA quarterly .xlsx export")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "iqvia.csv",
    )
    args = parser.parse_args()
    convert(args.source, args.output)


if __name__ == "__main__":
    main()
