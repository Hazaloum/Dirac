import unittest
from unittest.mock import patch

import pandas as pd

import inventory


class FakeConnection:
    def execute(self, sql, params=None):
        class Result:
            def fetchone(self):
                return {"result": '{"molecules": [{"molecule": "METFORMIN"}]}'}
            def fetchall(self):
                return [{"pack_key": "unknown", "stock_quantity": 7}]
        return Result()


class ConnectionContext:
    def __enter__(self):
        return FakeConnection()
    def __exit__(self, *args):
        pass


class InventoryTest(unittest.TestCase):
    def setUp(self):
        self.frame = pd.DataFrame([
            {"Molecule Combination": "METFORMIN", "Manufacturer": "A", "Product": "ALPHA", "Strength": "500 MG", "Pack": "30 TABS", "ATC4": "A10B"},
            {"Molecule Combination": "METFORMIN", "Manufacturer": "A", "Product": "ALPHA", "Strength": "500 MG", "Pack": "30 TABS", "ATC4": "A10B"},
            {"Molecule Combination": "METFORMIN", "Manufacturer": "A", "Product": "ALPHA", "Strength": "1000 MG", "Pack": "30 TABS", "ATC4": "A10B"},
            {"Molecule Combination": "OTHER", "Manufacturer": "B", "Product": "BETA", "Strength": "1 MG", "Pack": "10 TABS", "ATC4": "B1"},
        ])

    def test_distinct_packs_for_portfolio_molecule(self):
        rows = inventory._pack_rows(self.frame, {"METFORMIN"})
        self.assertEqual(len(rows), 2)
        self.assertEqual({r["strength"] for r in rows}, {"500 MG", "1000 MG"})
        self.assertEqual(len({r["pack_key"] for r in rows}), 2)

    def test_unsaved_stock_defaults_to_zero(self):
        with patch.object(inventory, "connection", lambda: ConnectionContext()):
            result = inventory.list_inventory(self.frame)
        self.assertEqual(len(result["items"]), 2)
        self.assertTrue(all(item["stock_quantity"] == 0 for item in result["items"]))
        self.assertEqual(result["unmatched_molecules"], [])


if __name__ == "__main__":
    unittest.main()
