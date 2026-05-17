"""
Detailed forecasting module for pharmaceutical products.
Provides Y1-Y3 unit and revenue forecasts based on competitor-adjusted penetration.
Ported from Pharmozi — adapted to use COMIX data layer.
"""
import re
import pandas as pd


def _extract_years(df: pd.DataFrame, suffix: str = "Units") -> list[int]:
    """Return sorted list of years extracted from columns like '2024 Units'."""
    pattern = re.compile(rf"^\d{{4}}\s+{re.escape(suffix)}$")
    cols = sorted(c for c in df.columns if pattern.match(c))
    return sorted(int(c.split()[0]) for c in cols)


# ─── Core forecasting routine ────────────────────────────────────────────────

def forecast_molecule_product(
    df: pd.DataFrame,
    molecule_name: str,
    product_name: str,
    growth_rate: float = 0.10,
) -> pd.DataFrame:
    """
    Forecast Y1–Y3 units and revenue for the given molecule/product.

    Penetration is competitor-adjusted:
      1 manufacturer  → 20%
      2–4             → 10%
      5+              →  5%

    Growth: user-selected rate (default 15%)
      Y2 = Y1 × (1 + growth_rate)
      Y3 = Y2 × (1 + growth_rate)

    Combination molecules (e.g. DRUG A + DRUG B) have their units/values
    divided by the number of constituent molecules to avoid double-counting.
    """
    mol  = molecule_name.strip().upper()
    prod = product_name.strip().upper()

    df = df.copy()
    df["Molecule Combination"] = df["Molecule Combination"].str.upper()
    df["Product"] = df["Product"].str.upper()

    years = _extract_years(df, "Units")
    analysis_year = years[-2] if len(years) >= 2 else (years[-1] if years else 2024)
    units_col = f"{analysis_year} Units"
    value_col = f"{analysis_year} LC Value"

    psub = df[(df["Molecule Combination"] == mol) & (df["Product"] == prod)].copy()
    if psub.empty:
        raise KeyError(f"No data for {mol} → {prod}")

    n_mols = mol.count(" + ") + 1
    for col in (units_col, value_col):
        psub[col] = pd.to_numeric(psub[col], errors="coerce").fillna(0) / n_mols

    mol_df = df[df["Molecule Combination"] == mol].copy()
    for col in (units_col, value_col):
        mol_df[col] = pd.to_numeric(mol_df[col], errors="coerce").fillna(0) / n_mols

    total_mol_units = mol_df[units_col].sum()
    total_mol_value = mol_df[value_col].sum()

    num_competitors = mol_df["Manufacturer"].nunique()
    if num_competitors == 1:
        penetration = 0.20
    elif 2 <= num_competitors <= 4:
        penetration = 0.10
    else:
        penetration = 0.05

    packs = (
        psub.groupby(["Manufacturer", "Pack", "Retail Price"], as_index=False)
        .agg(Pack_Units=(units_col, "sum"))
    )
    total_prod_units = packs["Pack_Units"].sum()
    packs["Pack Share"] = packs["Pack_Units"] / (total_prod_units or 1)

    packs["Y1 Units"] = packs["Pack Share"] * total_mol_units * penetration
    packs["Y2 Units"] = packs["Y1 Units"] * (1 + growth_rate)
    packs["Y3 Units"] = packs["Y2 Units"] * (1 + growth_rate)

    packs["CIF Price"]         = (packs["Retail Price"] / 1.4) * 0.4
    packs["Retail Price (USD)"] = packs["Retail Price"] / 3.68
    packs["CIF Price (USD)"]    = packs["CIF Price"] / 3.68

    for y in ("Y1", "Y2", "Y3"):
        packs[f"{y} Revenue"] = packs[f"{y} Units"] * packs["CIF Price"]

    packs["Molecule"]           = mol
    packs["Product"]            = prod
    packs["Total Market Units"] = total_mol_units
    packs["Total Market Value"] = total_mol_value
    packs["Competitors"]        = num_competitors
    packs["Penetration"]        = penetration
    packs["Analysis Year"]      = analysis_year
    packs["Growth Rate"]        = growth_rate

    return packs[[
        "Molecule", "Product", "Manufacturer",
        "Total Market Units", "Total Market Value",
        "Competitors", "Penetration", "Analysis Year", "Growth Rate",
        "Pack", "Pack_Units", "Pack Share",
        "Y1 Units", "Y2 Units", "Y3 Units",
        "Retail Price", "CIF Price",
        "Retail Price (USD)", "CIF Price (USD)",
        "Y1 Revenue", "Y2 Revenue", "Y3 Revenue",
    ]]


def _get_top_product(df: pd.DataFrame, molecule_name: str) -> str:
    """Return the product name with the highest units for the given molecule."""
    mol = molecule_name.strip().upper()
    mol_df = df[df["Molecule Combination"].str.upper() == mol].copy()
    if mol_df.empty:
        raise ValueError(f"Molecule '{molecule_name}' not found in IQVIA data")

    years = _extract_years(df, "Units")
    analysis_year = years[-2] if len(years) >= 2 else (years[-1] if years else 2024)
    units_col = f"{analysis_year} Units"

    mol_df[units_col] = pd.to_numeric(mol_df[units_col], errors="coerce").fillna(0)
    mol_df["Product"] = mol_df["Product"].str.upper()
    return mol_df.groupby("Product")[units_col].sum().idxmax()


def forecast_top_product(
    df: pd.DataFrame,
    molecule_name: str,
    growth_rate: float = 0.10,
) -> dict:
    """
    Generate a Y1-Y3 forecast for the top-selling product of the given molecule.
    Returns a JSON-serialisable dict matching the Pharmozi API response shape.
    """
    top_product  = _get_top_product(df, molecule_name)
    forecast_df  = forecast_molecule_product(df, molecule_name, top_product, growth_rate)

    packs   = forecast_df.to_dict(orient="records")
    first   = forecast_df.iloc[0]

    return {
        "molecule":           first["Molecule"],
        "product":            first["Product"],
        "competitors":        int(first["Competitors"]),
        "penetration":        float(first["Penetration"]),
        "penetration_pct":    f"{first['Penetration'] * 100:.0f}%",
        "analysis_year":      int(first["Analysis Year"]),
        "growth_rate":        float(first["Growth Rate"]),
        "total_market_units": float(first["Total Market Units"]),
        "total_market_value": float(first["Total Market Value"]),
        "summary": {
            "total_y1_units":   float(forecast_df["Y1 Units"].sum()),
            "total_y2_units":   float(forecast_df["Y2 Units"].sum()),
            "total_y3_units":   float(forecast_df["Y3 Units"].sum()),
            "total_y1_revenue": float(forecast_df["Y1 Revenue"].sum()),
            "total_y2_revenue": float(forecast_df["Y2 Revenue"].sum()),
            "total_y3_revenue": float(forecast_df["Y3 Revenue"].sum()),
        },
        "packs": [
            {
                "manufacturer":    p["Manufacturer"],
                "pack":            p["Pack"],
                "pack_units":      float(p["Pack_Units"]),
                "pack_share":      float(p["Pack Share"]),
                "y1_units":        float(p["Y1 Units"]),
                "y2_units":        float(p["Y2 Units"]),
                "y3_units":        float(p["Y3 Units"]),
                "retail_price":    float(p["Retail Price"]),
                "cif_price":       float(p["CIF Price"]),
                "retail_price_usd": float(p["Retail Price (USD)"]),
                "cif_price_usd":   float(p["CIF Price (USD)"]),
                "y1_revenue":      float(p["Y1 Revenue"]),
                "y2_revenue":      float(p["Y2 Revenue"]),
                "y3_revenue":      float(p["Y3 Revenue"]),
            }
            for p in packs
        ],
    }
