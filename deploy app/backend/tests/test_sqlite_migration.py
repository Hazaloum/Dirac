import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from migrate_sqlite_to_postgres import _same_values


class MigrationComparisonTest(unittest.TestCase):
    def test_json_formatting_does_not_create_conflict(self):
        columns = ("run_id", "stats", "result")
        source = ("abc", '{"total": 1}', '{"molecules": []}')
        existing = {"run_id": "abc", "stats": '{"total":1}', "result": '{"molecules":[]}' }
        self.assertTrue(_same_values(columns, source, existing))

    def test_changed_record_is_conflict(self):
        self.assertFalse(_same_values(("run_id", "report"), ("abc", "old"),
                                      {"run_id": "abc", "report": "new"}))


if __name__ == "__main__":
    unittest.main()
