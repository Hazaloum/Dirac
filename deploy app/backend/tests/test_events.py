import json
import unittest
from unittest import mock

import events


def row(i, name, zone, markets=()):
    return {"id": i, "event_key": "e", "external_id": str(i), "name": name, "zone": zone,
            "org_types": "[]", "business_activities": "[]", "markets": json.dumps(list(markets)),
            "certifications": "[]", "categories": "[]"}


class EventsTest(unittest.TestCase):
    def test_groups_by_zone_in_order_and_sorts_names(self):
        client = mock.MagicMock()
        client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{"key": "e", "name": "E"}]
        rows = [row(1, "zeta", "API"), row(2, "Alpha", "Finished Dosage & Formulation"),
                row(3, "beta", "Finished Dosage & Formulation", ["Middle East Region (e.g. UAE)"]),
                row(4, "Odd", "Space Pharma"), row(5, "Blank", "")]
        with mock.patch("events.get_client", return_value=client), mock.patch("events._exhibitors", return_value=rows):
            ev = events.get_event("e")
        self.assertEqual([z["zone"] for z in ev["zones"]], ["Finished Dosage & Formulation", "API", "Other", "Space Pharma"])
        self.assertEqual([e["name"] for e in ev["zones"][0]["exhibitors"]], ["Alpha", "beta"])
        self.assertEqual(ev["zones"][0]["exhibitors"][1]["markets"], ["Middle East Region (e.g. UAE)"])
        self.assertNotIn("event_key", ev["zones"][0]["exhibitors"][0])

    def test_unknown_event(self):
        client = mock.MagicMock()
        client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        with mock.patch("events.get_client", return_value=client):
            self.assertIsNone(events.get_event("nope"))


if __name__ == "__main__":
    unittest.main()
