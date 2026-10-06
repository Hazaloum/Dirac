import json
import unittest
from unittest import mock

import pandas as pd

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
        self.assertEqual(deals.STAGE_KEYS[0], "shortlisted")
        self.assertEqual(deals.STAGE_KEYS[-1], "launched")

    def test_removed_sourced_stage_shows_as_shortlisted(self):
        self.assertEqual(deals._normalise({"stage": "sourced"})["stage"], "shortlisted")
        self.assertEqual(deals._normalise({"stage": "terms"})["stage"], "terms")

    def test_dirac_values_from_market_data(self):
        v = deals.dirac_values("Lacosamide", {}, LIVE)
        self.assertEqual(v["market_value"], "AED 12.4M")
        self.assertEqual(v["cagr"], "+8.2% value / -1.5% units")
        self.assertEqual(v["private_lpo"], "71% private / 29% LPO")
        self.assertEqual(v["registrations"], "3 MOHAP / 2 UPP")
        self.assertEqual(v["ai_score"], "8/10")
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
        self.assertEqual(filled["shortlisted"], 7)    # market facts, AI score, forecast
        self.assertEqual(filled["awaiting_response"], 0)
        self.assertEqual(filled["engaged"], 1)
        self.assertEqual(filled["due_diligence"], 1)
        self.assertEqual(filled["launch_prep"], 1)     # first PO, no stock yet
        self.assertEqual(filled["launched"], 0)


class AddToPortfolioTest(unittest.TestCase):
    DFS = {"iqvia": pd.DataFrame({"Molecule Combination": ["LACOSAMIDE", "PREGABALIN"]})}
    PORTFOLIO = {"company_name": "COMIX", "result": {"molecules": [{"molecule": "PREGABALIN"}]}}

    def run_add(self, molecule, portfolio):
        with mock.patch("store.get_my_portfolio", return_value=portfolio), \
             mock.patch("store.save_my_portfolio") as save, \
             mock.patch("agent_runner.enrich_molecules", side_effect=lambda mols, co, dfs: {"molecules": mols}) as enrich, \
             mock.patch("deals.get_client"):
            return deals.add_to_portfolio(1, molecule, self.DFS), save, enrich

    def test_adds_to_existing_portfolio(self):
        result, save, enrich = self.run_add("Lacosamide", self.PORTFOLIO)
        self.assertEqual(result, "added")
        enrich.assert_called_once_with(["PREGABALIN", "Lacosamide"], "COMIX", self.DFS)
        save.assert_called_once_with("COMIX", {"molecules": ["PREGABALIN", "Lacosamide"]})

    def test_starts_portfolio_when_empty(self):
        result, save, _ = self.run_add("LACOSAMIDE", None)
        self.assertEqual(result, "added")
        save.assert_called_once_with("My Portfolio", {"molecules": ["LACOSAMIDE"]})

    def test_already_in_portfolio(self):
        result, save, _ = self.run_add("pregabalin", self.PORTFOLIO)
        self.assertEqual(result, "already")
        save.assert_not_called()

    def test_not_in_iqvia(self):
        result, save, _ = self.run_add("NEWMOL", self.PORTFOLIO)
        self.assertEqual(result, "not_in_iqvia")
        save.assert_not_called()


class EnsureDealTest(unittest.TestCase):
    def client_with(self, existing):
        client = mock.MagicMock()
        client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = existing
        return client

    def test_creates_deal_in_shortlisted(self):
        with mock.patch("deals.get_client", return_value=self.client_with([])), \
             mock.patch("deals.create_deal") as create:
            self.assertTrue(deals.ensure_deal(" lacosamide ", "Tecnimede"))
        create.assert_called_once_with("LACOSAMIDE", "Tecnimede", "shortlisted")

    def test_leaves_existing_deal_alone(self):
        with mock.patch("deals.get_client", return_value=self.client_with([{"id": 4}])), \
             mock.patch("deals.create_deal") as create:
            self.assertFalse(deals.ensure_deal("LACOSAMIDE"))
        create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
