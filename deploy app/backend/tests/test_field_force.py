import itertools
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pandas as pd

import field_force


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload, self.filters = db, table, None, None, []

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        match = lambda r: all(r.get(c) == v for c, v in self.filters)
        if self.op == "insert":
            new = [dict(p) for p in (self.payload if isinstance(self.payload, list) else [self.payload])]
            for row in new:
                row.setdefault("id", next(self.db.ids))
            rows.extend(new)
            return type("R", (), {"data": new})
        if self.op == "update":
            hit = [r for r in rows if match(r)]
            for r in hit:
                r.update(self.payload)
            return type("R", (), {"data": hit})
        hit = [r for r in rows if match(r)]
        self.db.tables[self.table] = [r for r in rows if not match(r)]
        return type("R", (), {"data": hit})


class FakeDB:
    def __init__(self, **tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.ids = itertools.count(1000)

    def table(self, name):
        return _Query(self, name)

    def fetch_all(self, table, columns="*", order="id", client=None):
        if table == "account_status":
            return self.account_status()
        return [dict(r) for r in self.tables.get(table, [])]

    def account_status(self):
        out = []
        for a in self.tables.get("accounts", []):
            visits = sorted((v for v in self.tables.get("visits", []) if v["account_id"] == a["id"]),
                            key=lambda v: v["visited_at"], reverse=True)
            cadence = a.get("visit_every_days") or (14 if a["type"] == "pharmacy" else 28)
            last = visits[0]["visited_at"] if visits else None
            due = (datetime.fromisoformat(last).date() + timedelta(days=cadence)) if last else date.today()
            area = next((x["name"] for x in self.tables.get("areas", []) if x["id"] == a.get("area_id")), None)
            out.append({**a, "area_name": area, "last_visited_at": last, "last_note": None,
                        "cadence_days": cadence, "due_on": due.isoformat()})
        return out


def _patched(db):
    return patch.multiple(field_force, _db=lambda: db, fetch_all=db.fetch_all)


class ImportTest(unittest.TestCase):
    def test_import_creates_areas_assigns_reps_and_links_hospitals(self):
        db = FakeDB(reps=[{"id": "r1", "name": "Rep One", "email": "one@comix.ae", "active": True}],
                    areas=[{"id": 1, "name": "Dubai South"}], accounts=[])
        csv = pd.DataFrame([
            {"Type": "Hospital", "Name": "City Hospital", "Area": "dubai south", "Rep": ""},
            {"Type": "doctor", "Name": "Dr Sara", "Area": "Sharjah", "Rep": "ONE@comix.ae", "Hospital": "City Hospital"},
            {"Type": "clinic", "Name": "Bad row", "Area": "", "Rep": ""},
            {"Type": "pharmacy", "Name": "Al Manara", "Area": "Dubai South", "Rep": "ghost@comix.ae"},
        ]).to_csv(index=False).encode()
        with _patched(db):
            result = field_force.import_accounts(csv, "list.csv")
            again = field_force.import_accounts(csv, "list.csv")

        self.assertEqual(result["created"], 3)
        self.assertEqual(len(result["errors"]), 2)  # bad type + unknown rep email
        self.assertEqual(again["created"], 0)
        self.assertEqual(again["skipped"], 3)
        accounts = {a["name"]: a for a in db.tables["accounts"]}
        self.assertEqual(accounts["City Hospital"]["area_id"], 1)  # matched case-insensitively
        self.assertEqual(accounts["Dr Sara"]["assigned_rep_id"], "r1")
        self.assertEqual(accounts["Dr Sara"]["parent_id"], accounts["City Hospital"]["id"])
        self.assertIsNone(accounts["Al Manara"]["assigned_rep_id"])
        self.assertIn("Sharjah", {a["name"] for a in db.tables["areas"]})

    def test_import_requires_type_and_name(self):
        with _patched(FakeDB()), self.assertRaises(ValueError):
            field_force.import_accounts(b"foo,bar\n1,2\n", "x.csv")


class DashboardTest(unittest.TestCase):
    def test_coverage_samples_alerts_and_orders(self):
        now = datetime.now(timezone.utc)
        recent, old = (now - timedelta(days=2)).isoformat(), (now - timedelta(days=60)).isoformat()
        db = FakeDB(
            reps=[{"id": "r1", "name": "Rep One", "email": "a", "active": True},
                  {"id": "r2", "name": "Rep Two", "email": "b", "active": True}],
            rep_areas=[{"rep_id": "r1", "area_id": 1}, {"rep_id": "r2", "area_id": 2}],
            areas=[{"id": 1, "name": "North"}, {"id": 2, "name": "South"}],
            accounts=[
                {"id": 1, "type": "doctor", "name": "Dr North", "area_id": 1, "assigned_rep_id": None},
                {"id": 2, "type": "pharmacy", "name": "Pharm North", "area_id": 1, "assigned_rep_id": None},
                {"id": 3, "type": "doctor", "name": "Dr South", "area_id": 2, "assigned_rep_id": "r1"},  # override
            ],
            visits=[{"id": 10, "rep_id": "r1", "account_id": 1, "visited_at": recent},
                    {"id": 11, "rep_id": "r1", "account_id": 2, "visited_at": recent},
                    {"id": 12, "rep_id": "r1", "account_id": 2, "visited_at": old}],
            sample_drops=[{"visit_id": 10, "pack_key": "p1", "sku_label": "ARI 10 MG", "quantity": 2}],
            shelf_checks=[{"visit_id": 12, "pack_key": "p1", "sku_label": "ARI 10 MG", "status": "out"},
                          {"visit_id": 11, "pack_key": "p1", "sku_label": "ARI 10 MG", "status": "low"}],
            orders=[{"id": 20, "rep_id": "r1", "account_id": 2, "visit_id": 11, "status": "sent", "created_at": recent}],
            order_lines=[{"order_id": 20, "pack_key": "p1", "sku_label": "ARI 10 MG", "quantity": 50}],
        )
        with _patched(db):
            d = field_force.dashboard(30)

        one = next(r for r in d["reps"] if r["name"] == "Rep One")
        two = next(r for r in d["reps"] if r["name"] == "Rep Two")
        self.assertEqual(one["accounts"], 3)       # 2 in North + 1 assigned override
        self.assertEqual(one["on_track"], 2)       # Dr South never visited
        self.assertEqual(one["visits"], 2)         # the 60-day-old visit is outside the window
        self.assertEqual(one["samples"], 2)
        self.assertEqual(two["accounts"], 0)       # Dr South is overridden away from Rep Two
        self.assertEqual([a["status"] for a in d["stock_alerts"]], ["low"])  # latest check wins
        self.assertEqual(d["orders_by_sku"], [{"sku": "ARI 10 MG", "quantity": 50}])
        self.assertEqual([a["name"] for a in d["overdue"]], ["Dr South"])


if __name__ == "__main__":
    unittest.main()
