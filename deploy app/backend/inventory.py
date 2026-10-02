"""Inventory: the SKUs COMIX carries for each My Portfolio molecule, with stock.

SKU options come from IQVIA: molecule + strength + dosage form + pack size,
normalised so the same pack sold by several manufacturers (each wording
IQVIA's free-text "Pack" differently) appears once. A row in the Supabase
`inventory_stock` table means that SKU is carried; it stores the SKU's
description alongside the stock quantity.
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


_DOSE = r"(\d+(?:\.\d+)?)\s*(MCG|MG|G|IU|%)(?:\s*/\s*(ML|G))?"


def _strength(value, pack=None) -> str:
    """Strength from IQVIA's Strength column, else from the pack text.

    '0500MG' → '500 MG'. Most rows leave the column as '0000' and only state
    the dose in the pack text: 'F.C. TABS 500 MG 50' → '500 MG',
    'ORAL SOLUT. 100 MG /ML 1 300 ML' → '100 MG/ML'.
    """
    match = re.fullmatch(r"0*(\d+(?:\.\d+)?)?\s*(\D*)", _text(value))
    if match and match.group(1):
        return f"{match.group(1)} {match.group(2)}".strip()
    dose = re.search(_DOSE, _text(pack))
    if not dose:
        return ""
    amount, unit, per = dose.groups()
    return f"{amount} {unit}" + (f"/{per}" if per else "")


def _form(nfc3) -> str:
    """'ABC ORAL S ORD FILM-COATED TABS' → 'FILM-COATED TABLETS'; RET → '(MR)'."""
    words = _text(nfc3).split()[1:]  # drop the NFC code
    modified = "RET" in words
    words = [_NFC3_WORDS.get(w, w) for w in words if w not in _NFC3_NOISE and w != "RET"]
    return " ".join(words) + (" (MR)" if modified else "")


def _pack_size(pack) -> str:
    """Pack size from IQVIA's free-text pack.

    'FILM C.TABS 500 MG 20' → '20'; 'F.C. TABS 100 1000 MG' → '100';
    'SPRAY 1 60 ML' → '60 ML'; 'SOL.APPLE 4 237 ML' → '4 × 237 ML'.
    """
    text = _text(pack)
    measured = re.search(r"(\d+)\s+(\d+(?:\.\d+)?)\s*(ML|L|G|KG|OZ|LB)$", text)
    if measured:
        count, size, unit = measured.groups()
        return f"{size} {unit}" if count == "1" else f"{count} × {size} {unit}"
    # Count written before the dose: 'F.C. TABS 100 1000 MG'.
    count_first = re.search(r"(\d+)\s+\d+(?:\.\d+)?\s*(?:MCG|MG|IU)$", text)
    if count_first:
        return count_first.group(1)
    counted = re.search(r"(\d+)\s*$", text)
    return counted.group(1) if counted else text


def _packs_by_molecule(df, molecules: set[str]) -> dict[str, dict]:
    if not molecules:
        return {}
    subset = df[df["Molecule Combination"].isin(molecules)]
    grouped: dict[str, dict] = {}
    for values in subset.to_dict("records"):
        molecule = _text(values.get("Molecule Combination"))
        strength, form, size = _strength(values.get("Strength"), values.get("Pack")), _form(values.get("NFC3")), _pack_size(values.get("Pack"))
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


def _sku_order(sku: dict) -> tuple:
    strength = re.match(r"[\d.]*", sku.get("strength") or "").group().rstrip(".")
    return (sku.get("form") or "", float(strength or 0), _size_order(sku.get("pack_size") or ""))


def _carried(molecules: set[str] | None = None) -> list[dict]:
    query = get_client().table("inventory_stock").select("pack_key, molecule, strength, form, pack_size, stock_quantity")
    if molecules is not None:
        query = query.in_("molecule", sorted(molecules))
    return query.execute().data


def list_inventory(df) -> dict:
    """Every portfolio molecule with the SKUs carried (possibly none yet)."""
    molecules = _portfolio_molecules()
    available = _packs_by_molecule(df, molecules)
    carried: dict[str, list[dict]] = {}
    for row in _carried(molecules) if molecules else []:
        carried.setdefault(row["molecule"], []).append(row)

    result = [
        {
            "molecule": molecule,
            "option_count": len(available[molecule]["packs"]) if molecule in available else 0,
            "skus": sorted(carried.get(molecule, []), key=_sku_order),
        }
        for molecule in sorted(molecules)
    ]
    return {"molecules": result, "unmatched_molecules": sorted(molecules - set(available))}


def sku_options(df, molecule: str) -> dict | None:
    """SKU options for one molecule, grouped by dosage form, with carried flags."""
    molecule = molecule.strip().upper()
    entry = _packs_by_molecule(df, {molecule}).get(molecule)
    if entry is None:
        return None
    carried = {row["pack_key"] for row in _carried({molecule})}
    forms: dict[str, list[dict]] = {}
    for pack in sorted(entry["packs"].values(), key=_sku_order):
        forms.setdefault(pack["form"], []).append({**pack, "carried": pack["pack_key"] in carried})
    return {
        "molecule": molecule,
        "forms": [{"form": form, "packs": packs} for form, packs in sorted(forms.items())],
    }


def set_skus(df, molecule: str, pack_keys: list[str]) -> dict | None:
    """Make ``pack_keys`` the carried SKUs for ``molecule``.

    New SKUs start at zero stock; SKUs already carried keep their stock;
    SKUs no longer selected are removed along with their stock.
    """
    molecule = molecule.strip().upper()
    entry = _packs_by_molecule(df, {molecule}).get(molecule)
    if entry is None:
        return None
    wanted = [key for key in dict.fromkeys(pack_keys) if key in entry["packs"]]
    client = get_client()
    remove = client.table("inventory_stock").delete().eq("molecule", molecule)
    (remove.not_.in_("pack_key", wanted) if wanted else remove).execute()

    existing = {row["pack_key"] for row in _carried({molecule})}
    new_rows = [
        {**{k: entry["packs"][key][k] for k in ("pack_key", "strength", "form", "pack_size")},
         "molecule": molecule, "stock_quantity": 0,
         "updated_at": datetime.now(timezone.utc).isoformat()}
        for key in wanted if key not in existing
    ]
    if new_rows:
        client.table("inventory_stock").insert(new_rows).execute()
    return sku_options(df, molecule)


def set_stock(pack_key: str, quantity: int) -> dict | None:
    """Update stock for a carried SKU; None if the SKU is not carried."""
    rows = get_client().table("inventory_stock").update(
        {"stock_quantity": quantity, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("pack_key", pack_key).execute().data
    return rows[0] if rows else None
