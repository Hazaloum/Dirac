"""
Data Loader
===========
Loads the IQVIA, UPP and MOHAP reference tables from Supabase once at startup
and cleans them. Returns analysis-ready DataFrames to be passed into iqvia.py,
upp.py, mohap.py.

Never re-reads per request — load once, query many times.
"""

import logging
import pandas as pd

import reference_data

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# IQVIA
# ─────────────────────────────────────────────────────────────

def load_iqvia() -> pd.DataFrame:
    """
    Load and clean the IQVIA master data (Supabase `iqvia_sales`).

    Cleaning steps:
      1. Strip newlines and extra spaces from column names
         (raw headers have embedded \\n e.g. '2024\\nLC Value' → '2024 LC Value')
      2. Uppercase and strip: Molecule, Product, Manufacturer, Market, ATC columns
      3. Convert year value/unit columns to numeric
      4. Convert Launch Year to int
      5. Create 'Molecule Combination' column that groups combination products
         (e.g. a product with AMLODIPINE + VALSARTAN gets one combination label)

    Returns:
        Cleaned DataFrame with a 'Molecule Combination' column added.
    """
    logger.info("Loading IQVIA from Supabase")
    df = reference_data.fetch_iqvia()

    # 1. Clean column names
    df.columns = (
        df.columns
        .str.replace("\n", " ", regex=False)
        .str.replace("  ", " ", regex=False)
        .str.strip()
    )

    # 2. Normalise text columns
    for col in ["Molecule", "Product", "Manufacturer", "Corporation",
                "MIDAS Corporation", "Market", "ATC1", "ATC2", "ATC3", "ATC4"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.upper()

    # 3. Convert year columns to numeric
    for col in df.columns:
        if any(suffix in col for suffix in ["LC Value", "Units"]):
            df[col] = pd.to_numeric(
                df[col].astype(str).str.replace(",", "").str.strip(),
                errors="coerce",
            )

    # 4. Launch Year
    if "Launch Year" in df.columns:
        df["Launch Year"] = pd.to_numeric(df["Launch Year"], errors="coerce")

    # 5. Build Molecule Combination column
    # Maps each Product to the sorted set of molecules it contains.
    # This is the canonical key used for all molecule lookups.
    df["Molecule"] = df["Molecule"].astype(str).str.strip().str.upper()
    df["Product"]  = df["Product"].astype(str).str.strip().str.upper()

    product_molecule_map = (
        df.groupby("Product")["Molecule"]
        .unique()
        .apply(lambda mols: " + ".join(sorted(set(mols))))
        .to_dict()
    )
    df["Molecule Combination"] = df["Product"].map(product_molecule_map)

    logger.info(f"IQVIA loaded: {len(df):,} rows, {df['Molecule Combination'].nunique():,} unique molecules")
    return df


# ─────────────────────────────────────────────────────────────
# UPP
# ─────────────────────────────────────────────────────────────

def load_upp() -> pd.DataFrame:
    """
    Load and clean the UPP drug registry (Supabase `upp_drugs`).

    Cleaning steps:
      1. Strip column name whitespace
      2. Uppercase and strip key text fields:
         Package Name, Generic Name, Manufacturer Name, Agent Name, Status
    """
    logger.info("Loading UPP from Supabase")
    df = reference_data.fetch_upp()

    df.columns = df.columns.str.strip()

    for col in ["Package Name", "Generic Name", "Manufacturer Name", "Agent Name", "Status"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.upper()

    logger.info(f"UPP loaded: {len(df):,} rows")
    return df


# ─────────────────────────────────────────────────────────────
# MOHAP
# ─────────────────────────────────────────────────────────────

def load_mohap() -> pd.DataFrame:
    """
    Load and clean the MOHAP price list (Supabase `mohap_prices`).

    Cleaning steps:
      1. Strip column name whitespace
      2. Normalise column names (strip embedded newlines)
      3. Uppercase and strip: Ingredient, Company, Trade Name
    """
    logger.info("Loading MOHAP from Supabase")
    df = reference_data.fetch_mohap()

    df.columns = (
        df.columns
        .str.replace("\n", " ", regex=False)
        .str.strip()
    )

    for col in ["Ingredient", "Company", "Trade Name"]:
        if col in df.columns:
            df[col] = (
                df[col].astype(str)
                .str.replace("\n", " ", regex=False)   # e.g. "DAPAGLIFLOZIN (AS\nPROPANEDIOL)"
                .str.replace("  ", " ", regex=False)
                .str.strip()
                .str.upper()
            )

    logger.info(f"MOHAP loaded: {len(df):,} rows")
    return df


# ─────────────────────────────────────────────────────────────
# Master loader
# ─────────────────────────────────────────────────────────────

def load_all() -> dict:
    """
    Load all three reference datasets from Supabase and return a dict of DataFrames.

    Usage:
        data = load_all()
        df_iqvia = data["iqvia"]
        df_upp   = data["upp"]
        df_mohap = data["mohap"]
    """
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            "iqvia": pool.submit(load_iqvia),
            "upp":   pool.submit(load_upp),
            "mohap": pool.submit(load_mohap),
        }
        return {name: future.result() for name, future in futures.items()}
