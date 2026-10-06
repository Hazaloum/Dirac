import json
import unittest

import deals

FACTS = {
    "molecule": "LACOSAMIDE", "in_iqvia": True, "market_value_aed": 12_400_000,
    "value_cagr_pct": 8.24, "unit_cagr_pct": -1.5, "num_competitors": 4,
    "private_pct": 71.2, "lpo_pct": 28.8, "mohap_manufacturers": 3, "upp_manufacturers": 2,
    "atc1_class": "N NERVOUS SYSTEM",
    "forecast": {
        "summary": {"total_y1_revenue": 450_000, "total_y2_revenue": 517_500, "total_y3_revenue": 595_125},
        "packs": [{"pack": "50MG 14", "pack_units": 10, "retail_price": 80.0},
                  {"pack": "100MG 56", "pack_units": 30, "retail_price": 210.5}],
    },
}
LIVE = {
    "pipeline": {"LACOSAMIDE": {"decision": "yes", "snapshot": json.dumps({"ai_score": 8})}},
    "po": {"LACOSAMIDE": ["P-036/2026"]},
    "stock": {},
}


class DealsTest(unittest.TestCase):
    def setUp(self):
        deals._iqvia_cache.clear()
        deals._iqvia_cache["LACOSAMIDE"] = FACTS

    def test_stage_and_field_keys_are_unique(self):
        self.assertEqual(len(deals.STAGE_KEYS), len(set(deals.STAGE_KEYS)))
        keys = [f[0] for s in deals.STAGES for f in s["fields"]]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(deals.STAGE_KEYS[-1], "launched")

    def test_dirac_values_from_market_data(self):
        v = deals.dirac_values("Lacosamide", {}, LIVE)
        self.assertEqual(v["market_value"], "AED 12.4M")
        self.assertEqual(v["cagr"], "+8.2% value / -1.5% units")
        self.assertEqual(v["private_lpo"], "71% private / 29% LPO")
        self.assertEqual(v["registrations"], "3 MOHAP / 2 UPP")
        self.assertEqual(v["ai_score"], "8/10")
        self.assertEqual(v["pipeline_decision"], "Yes")
        self.assertEqual(v["forecast_retail"], "AED 210.50 (100MG 56)")  # top pack by units
        self.assertTrue(v["forecast"].startswith("AED 450.0K · AED 517.5K · AED 595.1K"))
        self.assertEqual(v["first_po"], "P-036/2026")
        self.assertIsNone(v["stock"])

    def test_not_in_iqvia_leaves_market_fields_empty(self):
        deals._iqvia_cache["NEWMOL"] = {"molecule": "NEWMOL", "in_iqvia": False}
        v = deals.dirac_values("newmol", {}, {"pipeline": {}, "po": {}, "stock": {}})
        self.assertIsNone(v["market_value"])
        self.assertIsNone(v["forecast"])
        self.assertEqual(v["registrations"], "0 MOHAP / 0 UPP")

    def test_filled_counts_entered_and_dirac_fields(self):
        dirac = deals.dirac_values("LACOSAMIDE", {}, LIVE)
        filled = deals._filled({"cda_signed": "2026-09-01", "ctd_modules": "1–5"}, dirac)
        self.assertEqual(filled["sourced"], 7)
        self.assertEqual(filled["engaged"], 1)
        self.assertEqual(filled["due_diligence"], 2)   # ctd + forecast
        self.assertEqual(filled["launch_prep"], 1)     # first PO, no stock yet
        self.assertEqual(filled["launched"], 0)


if __name__ == "__main__":
    unittest.main()
