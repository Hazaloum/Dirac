"""
Data Loader
===========
Loads and cleans all three raw data files once at pipeline startup.
Returns analysis-ready DataFrames to be passed into iqvia.py, upp.py, mohap.py.

Never re-reads files per molecule — load once, query many times.
"""

import logging
import pandas as pd

logger = logging.getLogger(__name__)

# Default paths — overridden by config.py when used in pipeline
DEFAULT_IQVIA_PATH = "data/read/iqvia.csv"
DEFAULT_UPP_PATH   = "data/read/upp.csv"
DEFAULT_MOHAP_PATH = "data/read/mohap.csv"


# ─────────────────────────────────────────────────────────────
# IQVIA
# ─────────────────────────────────────────────────────────────

def load_iqvia(path: str = DEFAULT_IQVIA_PATH) -> pd.DataFrame:
    """
    Load and clean the IQVIA master data CSV.

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
    logger.info(f"Loading IQVIA from {path}")
    df = pd.read_csv(path, low_memory=False)

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

def load_upp(path: str = DEFAULT_UPP_PATH) -> pd.DataFrame:
    """
    Load and clean the UPP drug registry CSV.

    Cleaning steps:
      1. Strip column name whitespace
      2. Uppercase and strip key text fields:
         Package Name, Generic Name, Manufacturer Name, Agent Name, Status
    """
    logger.info(f"Loading UPP from {path}")
    df = pd.read_csv(path, low_memory=False)

    df.columns = df.columns.str.strip()

    for col in ["Package Name", "Generic Name", "Manufacturer Name", "Agent Name", "Status"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.upper()

    logger.info(f"UPP loaded: {len(df):,} rows")
    return df


# ─────────────────────────────────────────────────────────────
# MOHAP
# ─────────────────────────────────────────────────────────────

def load_mohap(path: str = DEFAULT_MOHAP_PATH) -> pd.DataFrame:
    """
    Load and clean the MOHAP price list CSV.

    Cleaning steps:
      1. Strip BOM character and column name whitespace
      2. Normalise column names (strip embedded newlines)
      3. Uppercase and strip: Ingredient, Company, Trade Name
    """
    logger.info(f"Loading MOHAP from {path}")
    df = pd.read_csv(path, encoding="utf-8-sig", low_memory=False)

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

def load_all(
    iqvia_path: str = DEFAULT_IQVIA_PATH,
    upp_path: str   = DEFAULT_UPP_PATH,
    mohap_path: str = DEFAULT_MOHAP_PATH,
) -> dict:
    """
    Load all three data sources and return a dict of DataFrames.

    Usage:
        data = load_all()
        df_iqvia = data["iqvia"]
        df_upp   = data["upp"]
        df_mohap = data["mohap"]

    Raises FileNotFoundError with a clear message if any file is missing.
    """
    results = {}

    for name, path, loader in [
        ("iqvia", iqvia_path, load_iqvia),
        ("upp",   upp_path,   load_upp),
        ("mohap", mohap_path, load_mohap),
    ]:
        try:
            results[name] = loader(path)
        except FileNotFoundError:
            raise FileNotFoundError(
                f"Required data file not found: {path}\n"
                f"Place the {name.upper()} CSV in data/read/ before running."
            )

    return results
