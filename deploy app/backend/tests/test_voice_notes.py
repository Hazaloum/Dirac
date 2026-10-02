import unittest
from datetime import datetime

import voice_notes

SKUS = [
    {"pack_key": "a10", "molecule": "ARIPIPRAZOLE", "strength": "10 MG", "form": "TABLETS", "pack_size": "30"},
    {"pack_key": "a10b", "molecule": "ARIPIPRAZOLE", "strength": "10 MG", "form": "TABLETS", "pack_size": "28"},
    {"pack_key": "q25", "molecule": "QUETIAPINE", "strength": "25 MG", "form": "TABLETS", "pack_size": "60"},
]


class CleanTest(unittest.TestCase):
    def test_clinic_keeps_only_carried_molecules_skus_and_allowed_options(self):
        raw = {
            "outcome": "met",
            "molecules_discussed": ["aripiprazole", "Made Up Drug"],
            "feedback": [
                {"molecule": "Quetiapine", "stance": "not_interested", "reason": "price"},
                {"molecule": "ARIPIPRAZOLE", "stance": "will_try", "reason": "price"},  # reason dropped
                {"molecule": "ARIPIPRAZOLE", "stance": "loves_it", "reason": None},     # bad stance ignored
            ],
            "samples": [{"pack_key": "a10", "quantity": 2}, {"pack_key": "ghost", "quantity": 5},
                        {"pack_key": "q25", "quantity": 0}],
            "shelf": [{"pack_key": "a10", "status": "out"}],  # pharmacy-only
            "order": [{"pack_key": "a10", "quantity": 10}],
            "next_visit_on": "2026-10-16",
        }
        out = voice_notes.clean(raw, "clinic", SKUS)
        self.assertEqual(out["outcome"], "met")
        self.assertEqual(out["molecules"], ["ARIPIPRAZOLE", "QUETIAPINE"])
        self.assertEqual(out["feedback"], [
            {"molecule": "QUETIAPINE", "stance": "not_interested", "reason": "price"},
            {"molecule": "ARIPIPRAZOLE", "stance": "will_try", "reason": None},
        ])
        self.assertEqual(out["samples"], [{"molecule": "ARIPIPRAZOLE", "pack_key": "a10", "quantity": 2}])
        self.assertEqual((out["shelf"], out["order"]), ([], []))
        self.assertEqual(out["next_visit_on"], "2026-10-16")

    def test_pharmacy_rejects_clinic_outcome_and_bad_values(self):
        raw = {"outcome": "met", "molecules_discussed": ["ARIPIPRAZOLE"], "feedback": [],
               "samples": [{"pack_key": "a10", "quantity": 2}],
               "shelf": [{"pack_key": "a10", "status": "empty"}, {"pack_key": "q25", "status": "low"}],
               "order": [{"pack_key": "q25", "quantity": 12}], "next_visit_on": "next week"}
        out = voice_notes.clean(raw, "pharmacy", SKUS)
        self.assertIsNone(out["outcome"])
        self.assertEqual((out["molecules"], out["samples"]), ([], []))
        self.assertEqual(out["shelf"], [{"pack_key": "q25", "status": "low"}])
        self.assertEqual(out["order"], [{"molecule": "QUETIAPINE", "pack_key": "q25", "quantity": 12}])
        self.assertIsNone(out["next_visit_on"])

    def test_unclear_pack_keeps_molecule_and_quantity(self):
        raw = {"outcome": "met", "molecules_discussed": [], "feedback": [],
               "samples": [{"molecule": "Aripiprazole", "pack_key": None, "quantity": 20},
                           {"molecule": "Aripiprazole", "pack_key": None, "quantity": 3},   # duplicate
                           {"molecule": "Unknown", "pack_key": None, "quantity": 5}],
               "shelf": [], "order": [], "next_visit_on": None}
        out = voice_notes.clean(raw, "clinic", SKUS)
        self.assertEqual(out["samples"], [{"molecule": "ARIPIPRAZOLE", "pack_key": None, "quantity": 20}])
        self.assertEqual(out["molecules"], ["ARIPIPRAZOLE"])  # sampled → discussed

    def test_molecule_wide_shelf_status_covers_each_pack(self):
        raw = {"outcome": "no_order", "molecules_discussed": [], "feedback": [], "samples": [], "order": [],
               "shelf": [{"molecule": "ARIPIPRAZOLE", "pack_key": None, "status": "out"},
                         {"molecule": "ARIPIPRAZOLE", "pack_key": "a10b", "status": "low"}],
               "next_visit_on": None}
        out = voice_notes.clean(raw, "pharmacy", SKUS)
        self.assertEqual(sorted((l["pack_key"], l["status"]) for l in out["shelf"]), [("a10", "out"), ("a10b", "low")])

    def test_prompt_lists_skus_and_today(self):
        prompt = voice_notes._prompt("clinic", "saw her", SKUS, datetime(2026, 10, 2))
        self.assertIn("a10: ARIPIPRAZOLE 10 MG tablets pack of 30", prompt)
        self.assertIn("2026-10-02", prompt)


if __name__ == "__main__":
    unittest.main()
