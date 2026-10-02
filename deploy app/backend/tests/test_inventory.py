import unittest
from unittest.mock import patch

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

    def test_molecules_listed_with_only_carried_skus(self):
        carried = [{"pack_key": "k1", "molecule": "METFORMIN", "strength": "500 MG",
                    "form": "FILM-COATED TABLETS", "pack_size": "30", "stock_quantity": 7}]
        with patch.object(inventory, "_portfolio_molecules", lambda: {"METFORMIN", "UNKNOWN"}), \
             patch.object(inventory, "_carried", lambda molecules=None: carried):
            result = inventory.list_inventory(self.frame)
        metformin = next(m for m in result["molecules"] if m["molecule"] == "METFORMIN")
        self.assertEqual(metformin["option_count"], 3)
        self.assertEqual(metformin["skus"], carried)
        self.assertEqual(result["unmatched_molecules"], ["UNKNOWN"])

    def test_options_grouped_by_form(self):
        with patch.object(inventory, "_carried", lambda molecules=None: []):
            options = inventory.sku_options(self.frame, "metformin")
        self.assertEqual({f["form"]: len(f["packs"]) for f in options["forms"]},
                         {"FILM-COATED TABLETS": 2, "TABLETS (MR)": 1})
        self.assertIsNone(inventory.sku_options(self.frame, "NOT A MOLECULE"))

    def test_pack_size_parsing(self):
        self.assertEqual(inventory._pack_size("FILM C.TABS 500 MG 20"), "20")
        self.assertEqual(inventory._pack_size("SPRAY 1 60 ML"), "60 ML")
        self.assertEqual(inventory._pack_size("SOL.APPLE 4 237 ML"), "4 × 237 ML")
        self.assertEqual(inventory._pack_size("F.C. TABS 100 1000 MG"), "100")

    def test_strength_falls_back_to_pack_text(self):
        self.assertEqual(inventory._strength("0500MG", "F.C. TABS 500 MG 50"), "500 MG")
        self.assertEqual(inventory._strength("0000", "F.C. TABS 100 1000 MG"), "1000 MG")
        self.assertEqual(inventory._strength("0000", "ORAL SOLUT. 100 MG /ML 1 300 ML"), "100 MG/ML")
        self.assertEqual(inventory._strength("0000", "TABS 30"), "")


if __name__ == "__main__":
    unittest.main()
