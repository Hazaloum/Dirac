"""
benchmarks.py
=============
Computes UAE market-level and ATC4-class-level benchmark statistics
from the loaded IQVIA DataFrame. Run once at startup.

Injected into the scoring prompt so the AI has calibrated context
for interpreting molecule-level data points.
"""

import logging
from typing import Optional

import numpy as np
import pandas as pd

from data_processing.iqvia import _flexible_cagr, _get_years

logger = logging.getLogger(__name__)


def _atc4_col(df: pd.DataFrame) -> Optional[str]:
    return next((c for c in df.columns if c.strip() == "ATC4"), None)


def compute_market_benchmarks(df: pd.DataFrame) -> dict:
    """
    UAE-wide market benchmarks. Called once at startup.

    Equations
    ---------
    total_value          = Σ mol_value_end_year  (per-molecule sum of all manufacturer rows)
    total_units          = Σ mol_units_end_year
    market_cagr          = ((Σ value_end / Σ value_first_nonzero)^(1/n_years) − 1) × 100
    private_pct          = Σ private_rows_value / total_value × 100
    avg_competitors      = mean(unique_manufacturers_per_molecule)
    value_percentiles    = quantile(per_molecule_values, [0.25, 0.50, 0.75, 0.90])
    molecule_cagr        = ((mol_value_end / mol_value_start)^(1/n_years) − 1) × 100
    """
    _, end_year = _get_years(df, "Units")
    value_col   = f"{end_year} LC Value"
    units_col   = f"{end_year} Units"

    mol_values = df.groupby("Molecule Combination")[value_col].sum()
    mol_units  = df.groupby("Molecule Combination")[units_col].sum()

    total_value     = mol_values.sum()
    total_units     = mol_units.sum()
    total_molecules = len(mol_values)

    market_cagr = _flexible_cagr(df, "LC Value", 1)

    private_df  = df[df["Market"] == "PRIVATE MARKET"]
    private_pct = round(private_df[value_col].sum() / total_value * 100, 1) if total_value > 0 else 0.0

    pcts = mol_values.quantile([0.25, 0.50, 0.75, 0.90])
    value_percentiles = {
        "p25": round(pcts[0.25], 0),
        "p50": round(pcts[0.50], 0),
        "p75": round(pcts[0.75], 0),
        "p90": round(pcts[0.90], 0),
    }

    top5_value = (
        mol_values.nlargest(5)
        .reset_index()
        .apply(lambda r: f"{r['Molecule Combination']} ({r[value_col]:,.0f} AED)", axis=1)
        .tolist()
    )

    # Per-molecule CAGR using first available year to end_year
    years, _ = _get_years(df, "LC Value")
    start_year = years[0]
    n_years    = end_year - start_year
    mol_start  = df.groupby("Molecule Combination")[f"{start_year} LC Value"].sum()
    # Only molecules with value > 5M AED qualify for top5 growth
    size_mask  = mol_values > 5_000_000
    mask       = (mol_start > 0) & size_mask & (n_years > 0)
    cagr_s     = ((mol_values[mask] / mol_start[mask]) ** (1 / n_years) - 1) * 100

    top5_growth = (
        cagr_s.nlargest(5)
        .reset_index()
        .apply(lambda r: f"{r['Molecule Combination']} ({r.iloc[1]:.1f}%)", axis=1)
        .tolist()
    )

    return {
        "end_year":          end_year,
        "total_value_aed":   round(total_value, 0),
        "total_units":       round(total_units, 0),
        "total_molecules":   total_molecules,
        "market_cagr_pct":   market_cagr,
        "private_pct":       private_pct,
        "value_percentiles": value_percentiles,
        "top5_by_value":     top5_value,
        "top5_by_growth":    top5_growth,
    }


def compute_atc4_benchmarks(df: pd.DataFrame, atc4_val: str) -> Optional[dict]:
    """
    ATC4 class-level benchmarks for a specific ATC4 code+description.

    Equations
    ---------
    class_value              = Σ mol_value_end_year within class
    class_units              = Σ mol_units_end_year within class
    private_pct              = Σ private_rows_value_in_class / class_value × 100
    mean_mol_value           = mean(per_molecule_values_in_class)
    median_mol_value         = median(per_molecule_values_in_class)
    value_percentiles        = quantile(per_molecule_values_in_class, [0.25,0.50,0.75,0.90])
    top3_company_share       = Σ top_3_company_values / class_value × 100
    avg_competitors_per_mol  = mean(unique_manufacturers_per_molecule_in_class)
    class_value_cagr         = _flexible_cagr on class rows, "LC Value"
    class_units_cagr         = _flexible_cagr on class rows, "Units"
    cagr_delta               = class_value_cagr − class_units_cagr
    per_mol_cagr             = ((mol_value_end / mol_value_start)^(1/n_years) − 1) × 100
    cagr_mean                = mean(per_mol_cagrs_in_class)
    cagr_3sigma              = cagr_mean + 3 × std(per_mol_cagrs_in_class)
    recent_entrants          = count(molecules where min(Launch Year) >= end_year − 3)
    """
    col = _atc4_col(df)
    if not col:
        return None

    normalised = df[col].astype(str).str.split().str.join(" ")
    class_df   = df[normalised == atc4_val]
    if class_df.empty:
        return None

    _, end_year = _get_years(df, "Units")
    value_col   = f"{end_year} LC Value"
    units_col   = f"{end_year} Units"

    mol_values = class_df.groupby("Molecule Combination")[value_col].sum()
    mol_units  = class_df.groupby("Molecule Combination")[units_col].sum()

    class_value    = mol_values.sum()
    class_units    = mol_units.sum()
    molecule_count = len(mol_values)

    private_df  = class_df[class_df["Market"] == "PRIVATE MARKET"]
    private_pct = round(private_df[value_col].sum() / class_value * 100, 1) if class_value > 0 else 0.0

    mean_mol_value   = round(mol_values.mean(),   0)
    median_mol_value = round(mol_values.median(), 0)

    pcts = mol_values.quantile([0.25, 0.50, 0.75, 0.90])
    value_percentiles = {
        "p25": round(pcts[0.25], 0),
        "p50": round(pcts[0.50], 0),
        "p75": round(pcts[0.75], 0),
        "p90": round(pcts[0.90], 0),
    }

    value_leader_mol = mol_values.idxmax() if len(mol_values) > 0 else None
    units_leader_mol = mol_units.idxmax()  if len(mol_units)  > 0 else None

    company_values     = class_df.groupby("Manufacturer")[value_col].sum()
    leading_company    = company_values.idxmax() if len(company_values) > 0 else None
    top3_company_share = round(company_values.nlargest(3).sum() / class_value * 100, 1) if class_value > 0 else 0.0

    avg_competitors_per_mol = round(
        class_df.groupby("Molecule Combination")["Manufacturer"].nunique().mean(), 1
    )

    class_value_cagr = _flexible_cagr(class_df, "LC Value", 1)

    years, _ = _get_years(df, "LC Value")
    start_year = years[0]
    n_years    = end_year - start_year
    mol_start  = class_df.groupby("Molecule Combination")[f"{start_year} LC Value"].sum()
    mask       = (mol_start > 0) & (mol_values > 0) & (n_years > 0)

    if mask.sum() >= 2:
        cagr_s      = ((mol_values[mask] / mol_start[mask]) ** (1 / n_years) - 1) * 100
        cagr_mean   = round(float(cagr_s.mean()),  2)
        cagr_3sigma = round(cagr_mean + 3 * float(cagr_s.std()), 2)
    else:
        cagr_mean   = None
        cagr_3sigma = None

    recent_entrants = 0
    if "Launch Year" in class_df.columns:
        launch_years    = class_df.groupby("Molecule Combination")["Launch Year"].min()
        recent_entrants = int((launch_years >= end_year - 3).sum())

    return {
        "atc4":                     atc4_val,
        "class_value_aed":          round(class_value, 0),
        "class_units":              round(class_units, 0),
        "molecule_count":           molecule_count,
        "class_value_cagr_pct":     class_value_cagr,
        "private_pct":              private_pct,
        "mean_mol_value_aed":       mean_mol_value,
        "median_mol_value_aed":     median_mol_value,
        "value_percentiles":        value_percentiles,
        "value_leader_mol":         value_leader_mol,
        "units_leader_mol":         units_leader_mol,
        "leading_company":          leading_company,
        "top3_company_share_pct":   top3_company_share,
        "avg_competitors_per_mol":  avg_competitors_per_mol,
        "per_mol_cagr_mean_pct":    cagr_mean,
        "per_mol_cagr_3sigma_pct":  cagr_3sigma,
        "recent_entrants_3y":       recent_entrants,
    }


def format_market_context(b: dict) -> str:
    p = b["value_percentiles"]
    return (
        f"UAE MARKET CONTEXT ({b['end_year']} data)\n"
        f"  Total market value:    {b['total_value_aed']:,.0f} AED\n"
        f"  Total units:           {b['total_units']:,.0f}\n"
        f"  Total molecules:       {b['total_molecules']}\n"
        f"  Market CAGR:           {b['market_cagr_pct']:.1f}%\n"
        f"  Private market share:  {b['private_pct']}%\n"
        f"  Molecule value bands:  P25={p['p25']:,.0f} | P50={p['p50']:,.0f} | "
        f"P75={p['p75']:,.0f} | P90={p['p90']:,.0f} AED\n"
        f"  Top 5 by value:        {', '.join(b['top5_by_value'])}\n"
        f"  Top 5 by growth:       {', '.join(b['top5_by_growth'])}"
    )


def format_atc4_context(b: dict) -> str:
    p = b["value_percentiles"]
    return (
        f"ATC4 CLASS CONTEXT: {b['atc4']}\n"
        f"  Class value:            {b['class_value_aed']:,.0f} AED  |  "
        f"Class CAGR: {b['class_value_cagr_pct']:.1f}%  |  "
        f"Private: {b['private_pct']}%\n"
        f"  Molecules in class:     {b['molecule_count']}\n"
        f"  Mol value — mean: {b['mean_mol_value_aed']:,.0f} | median: {b['median_mol_value_aed']:,.0f} | "
        f"P25={p['p25']:,.0f} | P75={p['p75']:,.0f} | P90={p['p90']:,.0f} AED\n"
        f"  Value leader (mol):     {b['value_leader_mol']}\n"
        f"  Units leader (mol):     {b['units_leader_mol']}\n"
        f"  Leading company:        {b['leading_company']}\n"
        f"  Top-3 company share:    {b['top3_company_share_pct']}%\n"
        f"  Avg competitors/mol:    {b['avg_competitors_per_mol']}\n"
        f"  Per-mol CAGR — mean: {b['per_mol_cagr_mean_pct']}%  |  "
        f"3σ outlier threshold: {b['per_mol_cagr_3sigma_pct']}%\n"
        f"  Recent entrants (3yr):  {b['recent_entrants_3y']}"
    )
