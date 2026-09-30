"""Inventory view: the unique packs of each My Portfolio molecule, with stock
quantities stored in Supabase.

A pack is identified by molecule + strength + dosage form + pack size, taken
from IQVIA and normalised so the same pack sold by several manufacturers (each
wording IQVIA's free-text "Pack" differently) appears once.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone

from supabase_client import get_client

# NFC3 words that describe route / release class rather than the form itself.
_NFC3_NOISE = {"ORAL", "S", "L", "ORD", "PARENT"}
_NFC3_WORDS = {"TABS": "TABLETS", "CAPS": "CAPSULES", "CTD": "COATED", "EFFERV": "EFFERVESCENT"}


def _portfolio_molecules() -> set[str]:
    rows = get_client().table("my_portfolio").select("result").eq("id", 1).execute().data
    if not rows:
        return set()
    row = rows[0]
    return {str(card.get("molecule", "")).strip().upper()
            for card in json.loads(row["result"] or "{}").get("molecules", []) if card.get("molecule")}


def _text(value) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value).strip().upper()


def _strength(value) -> str:
    """'0500MG' → '500 MG'; '0000' (not stated) → ''."""
    match = re.fullmatch(r"0*(\d+(?:\.\d+)?)?\s*(\D*)", _text(value))
    if not match or not match.group(1):
        return ""
    return f"{match.group(1)} {match.group(2)}".strip()


def _form(nfc3) -> str:
    """'ABC ORAL S ORD FILM-COATED TABS' → 'FILM-COATED TABLETS'; RET → '(MR)'."""
    words = _text(nfc3).split()[1:]  # drop the NFC code
    modified = "RET" in words
    words = [_NFC3_WORDS.get(w, w) for w in words if w not in _NFC3_NOISE and w != "RET"]
    return " ".join(words) + (" (MR)" if modified else "")


def _pack_size(pack) -> str:
    """Trailing count of IQVIA's free-text pack, e.g. 'FILM C.TABS 500 MG 20' → '20'."""
    text = _text(pack)
    match = re.search(r"(\d+)\s*$", text)
    return match.group(1) if match else text


def _packs_by_molecule(df, molecules: set[str]) -> dict[str, dict]:
    if not molecules:
        return {}
    subset = df[df["Molecule Combination"].isin(molecules)]
    grouped: dict[str, dict] = {}
    for values in subset.to_dict("records"):
        molecule = _text(values.get("Molecule Combination"))
        strength, form, size = _strength(values.get("Strength")), _form(values.get("NFC3")), _pack_size(values.get("Pack"))
        key = hashlib.sha256("\x1f".join((molecule, strength, form, size)).encode()).hexdigest()[:24]
        entry = grouped.setdefault(molecule, {
            "molecule": molecule,
            "classification": next((_text(values.get(f)) for f in ("ATC4", "ATC3", "ATC1") if _text(values.get(f))), "Unclassified"),
            "packs": {},
        })
        entry["packs"].setdefault(key, {"pack_key": key, "strength": strength, "form": form, "pack_size": size})
    return grouped


def _size_order(size: str) -> tuple[int, str]:
    return (int(size), "") if size.isdigit() else (10**9, size)


def list_inventory(df) -> dict:
    molecules = _portfolio_molecules()
    grouped = _packs_by_molecule(df, molecules)
    stock = get_client().table("inventory_stock").select("pack_key, stock_quantity").execute().data
    quantities = {row["pack_key"]: row["stock_quantity"] for row in stock}

    result = []
    for molecule in sorted(grouped):
        entry = grouped[molecule]
        packs = sorted(
            entry["packs"].values(),
            key=lambda p: (p["form"], float(re.match(r"[\d.]*", p["strength"]).group() or 0), _size_order(p["pack_size"])),
        )
        for pack in packs:
            pack["stock_quantity"] = quantities.get(pack["pack_key"], 0)
        result.append({"molecule": molecule, "classification": entry["classification"], "packs": packs})
    return {"molecules": result, "unmatched_molecules": sorted(molecules - set(grouped))}


def set_stock(df, pack_key: str, quantity: int) -> dict | None:
    grouped = _packs_by_molecule(df, _portfolio_molecules())
    for entry in grouped.values():
        pack = entry["packs"].get(pack_key)
        if pack:
            break
    else:
        return None
    get_client().table("inventory_stock").upsert(
        {"pack_key": pack_key, "stock_quantity": quantity, "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="pack_key",
    ).execute()
    return {**pack, "molecule": entry["molecule"], "stock_quantity": quantity}
