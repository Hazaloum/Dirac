"""Inventory view from IQVIA pack rows, with PostgreSQL stock quantities."""
from __future__ import annotations

import hashlib
import json
import math

from database import connection


def _portfolio_molecules(con) -> set[str]:
    row = con.execute("SELECT result FROM my_portfolio WHERE id=1").fetchone()
    if not row:
        return set()
    return {str(card.get("molecule", "")).strip().upper()
            for card in json.loads(row["result"] or "{}").get("molecules", []) if card.get("molecule")}


def _text(value) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value).strip().upper()


def _pack_rows(df, molecules: set[str]) -> list[dict]:
    if not molecules:
        return []
    subset = df[df["Molecule Combination"].isin(molecules)]
    fields = ("Molecule Combination", "Manufacturer", "Product", "Strength", "Pack")
    rows = {}
    for values in subset.to_dict("records"):
        identity = tuple(_text(values.get(field)) for field in fields)
        key = hashlib.sha256("\x1f".join(identity).encode()).hexdigest()[:24]
        if key not in rows:
            rows[key] = {"pack_key": key, "molecule": identity[0], "manufacturer": identity[1],
                         "product_name": identity[2], "strength": identity[3], "pack_size": identity[4],
                         "classification": next((_text(values.get(field)) for field in ("ATC4", "ATC3", "ATC1") if _text(values.get(field))), "Unclassified")}
    return sorted(rows.values(), key=lambda row: (row["molecule"], row["product_name"], row["strength"], row["pack_size"], row["manufacturer"]))


def list_inventory(df) -> dict:
    with connection() as con:
        molecules = _portfolio_molecules(con)
        items = _pack_rows(df, molecules)
        quantities = {row["pack_key"]: row["stock_quantity"] for row in con.execute("SELECT pack_key, stock_quantity FROM inventory_stock").fetchall()}
    for item in items:
        item["stock_quantity"] = quantities.get(item["pack_key"], 0)
    return {"items": items, "unmatched_molecules": sorted(molecules - {item["molecule"] for item in items})}


def set_stock(df, pack_key: str, quantity: int) -> dict | None:
    with connection() as con:
        items = _pack_rows(df, _portfolio_molecules(con))
        item = next((row for row in items if row["pack_key"] == pack_key), None)
        if item is None:
            return None
        con.execute("""INSERT INTO inventory_stock (pack_key, stock_quantity) VALUES (%s,%s)
            ON CONFLICT (pack_key) DO UPDATE SET stock_quantity=excluded.stock_quantity, updated_at=now()""", (pack_key, quantity))
        return {**item, "stock_quantity": quantity}
