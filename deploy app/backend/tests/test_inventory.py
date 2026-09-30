import unittest
from unittest.mock import MagicMock, patch

import pandas as pd

import inventory


class InventoryTest(unittest.TestCase):
    def setUp(self):
        base = {"Molecule Combination": "METFORMIN", "ATC4": "A10B"}
        self.frame = pd.DataFrame([
            # Same 500 MG film-coated 30s from two manufacturers, worded differently → one pack.
            {**base, "Manufacturer": "A", "Product": "ALPHA", "Strength": "0500MG", "Pack": "F.C.T.500MG 30", "NFC3": "ABC ORAL S ORD FILM-COATED TABS"},
            {**base, "Manufacturer": "B", "Product": "BETA", "Strength": "0500MG", "Pack": "FILM C.TABS 500 MG 30", "NFC3": "ABC ORAL S ORD FILM-COATED TABS"},
            {**base, "Manufacturer": "A", "Product": "ALPHA", "Strength": "1000MG", "Pack": "F.C.T.1G 30", "NFC3": "ABC ORAL S ORD FILM-COATED TABS"},
            {**base, "Manufacturer": "C", "Product": "GAMMA XR", "Strength": "0500MG", "Pack": "XR TAB 500MG 30", "NFC3": "BAA ORAL S RET TABLETS"},
            {"Molecule Combination": "OTHER", "Manufacturer": "D", "Product": "DELTA", "Strength": "0001MG", "Pack": "TABS 10", "NFC3": "AAA ORAL S ORD TABLETS", "ATC4": "B1"},
        ])

    def test_unique_packs_ignore_manufacturer(self):
        packs = inventory._packs_by_molecule(self.frame, {"METFORMIN"})["METFORMIN"]["packs"].values()
        self.assertEqual(
            {(p["strength"], p["form"], p["pack_size"]) for p in packs},
            {("500 MG", "FILM-COATED TABLETS", "30"), ("1000 MG", "FILM-COATED TABLETS", "30"), ("500 MG", "TABLETS (MR)", "30")},
        )

    def test_unsaved_stock_defaults_to_zero(self):
        client = MagicMock()
        client.table.return_value.select.return_value.execute.return_value.data = [
            {"pack_key": "unknown", "stock_quantity": 7}
        ]
        with patch.object(inventory, "_portfolio_molecules", lambda: {"METFORMIN"}), \
             patch.object(inventory, "get_client", lambda: client):
            result = inventory.list_inventory(self.frame)
        self.assertEqual([m["molecule"] for m in result["molecules"]], ["METFORMIN"])
        self.assertTrue(all(p["stock_quantity"] == 0 for p in result["molecules"][0]["packs"]))
        self.assertEqual(result["unmatched_molecules"], [])


if __name__ == "__main__":
    unittest.main()
