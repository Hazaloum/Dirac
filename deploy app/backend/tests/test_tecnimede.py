import unittest

import tecnimede

HEADERS = ["Item Number", "Account", "Order Name", "Customer Reference", "Item Description", "Order Quantity",
           "Pending Quantity", "Order Status", "Factory Order Number", "Acceptance Order Date",
           "Requested Delivery Date", "Factory Confirmation Date", "Action"]
ROW = ["", "COMIX MIDDLE EAST FZ-LLC", "9820264846 | 10", "P - 034/2025", "COMPIFY 1MG/ML SOLUTION 150ML BOTTLE",
       "8,400", "8,400", "Order Placed to Factory", "5500028612", "28/11/2025, 15:21", "29/05/2026", "09/10/2026",
       "Show Actions"]


class ParseTest(unittest.TestCase):
    def test_row_from_the_portal(self):
        [line] = tecnimede.parse_rows(HEADERS, [ROW])
        self.assertEqual(line, {
            "order_line": "9820264846 | 10",
            "customer_reference": "P - 034/2025",
            "item_description": "COMPIFY 1MG/ML SOLUTION 150ML BOTTLE",
            "order_quantity": 8400,
            "pending_quantity": 8400,
            "status": "Order Placed to Factory",
            "factory_order_number": "5500028612",
            "accepted_at": "2025-11-28T15:21:00+04:00",
            "requested_delivery": "2026-05-29",
            "factory_confirmation": "2026-10-09",
        })

    def test_blank_dates_and_reordered_columns(self):
        headers = ["Item Description", "Order Name", "Factory Confirmation Date"]
        [line] = tecnimede.parse_rows(headers, [["COMPIFY 15MG 28 TABLETS", "9820269308 | 20", ""]])
        self.assertEqual((line["order_line"], line["factory_confirmation"], line["order_quantity"]),
                         ("9820269308 | 20", None, None))

    def test_changed_table_is_reported(self):
        with self.assertRaises(tecnimede.PortalError):
            tecnimede.parse_rows(["Something else"], [["x"]])


if __name__ == "__main__":
    unittest.main()
