"""
tecnimede.py — pull COMIX's open orders from Tecnimede's supplier portal.

Tecnimede gives no API, so a headless browser logs in as COMIX's portal user
(TECNIMEDE_USERNAME / TECNIMEDE_PASSWORD), opens the "All Orders" list view
and reads the table. Each line is upserted into Supabase `supplier_order_lines`.
An order = one customer reference (COMIX's PO number); it can have several lines.

Run: python scripts/sync_tecnimede.py   (needs `playwright install chromium` once)
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

from supabase_client import fetch_all, get_client

SUPPLIER = "Tecnimede"
DUBAI = timezone(timedelta(hours=4))
PORTAL = "https://tecnimedeimprove.my.site.com"
ALL_ORDERS = f"{PORTAL}/s/recordlist/Order__c/00BVk00000IfpKLMAZ?Order__c-filterId=My_Orders"

# The portal's statuses, in order. A line moves left to right.
STAGES = [
    "Order Registered",
    "Order Placed to Factory",
    "Order with Logistics Operator",
    "Completed (Order Available for Pickup)",
]
DONE = STAGES[-1]

# Table header → our column.
COLUMNS = {
    "Order Name": "order_line",
    "Customer Reference": "customer_reference",
    "Item Description": "item_description",
    "Order Quantity": "order_quantity",
    "Pending Quantity": "pending_quantity",
    "Order Status": "status",
    "Factory Order Number": "factory_order_number",
    "Acceptance Order Date": "accepted_at",
    "Requested Delivery Date": "requested_delivery",
    "Factory Confirmation Date": "factory_confirmation",
}


class PortalError(RuntimeError):
    pass


# ─── Parsing ──────────────────────────────────────────────────────────────────

def _int(text: str) -> int | None:
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


def _date(text: str) -> str | None:
    """'09/10/2026' (day first) → '2026-10-09'."""
    m = re.match(r"\s*(\d{1,2})/(\d{1,2})/(\d{4})", text or "")
    return f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}" if m else None


def _timestamp(text: str) -> str | None:
    """'28/11/2025, 15:21' → ISO timestamp (portal shows Dubai time)."""
    m = re.match(r"\s*(\d{1,2})/(\d{1,2})/(\d{4}),?\s*(\d{1,2}):(\d{2})", text or "")
    if not m:
        return None
    return f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}T{int(m[4]):02d}:{m[5]}:00+04:00"


def order_ref(text: str | None) -> str:
    """COMIX's PO number, tidied: 'P - 0362026' / 'P-036/2026' / '036/2026' → 'P-036/2026'."""
    raw = (text or "").strip()
    m = re.match(r"^P?\s*-?\s*(\d{2,3})\s*/?\s*(20\d{2})?\s*$", raw, re.IGNORECASE)
    if not m:
        return raw or "(no reference)"
    return f"P-{m[1].zfill(3)}" + (f"/{m[2]}" if m[2] else "")


def parse_rows(headers: list[str], rows: list[list[str]]) -> list[dict]:
    """Table cells → supplier_order_lines rows (keyed by header, so column order doesn't matter)."""
    index = {name: headers.index(name) for name in COLUMNS if name in headers}
    missing = {"Order Name", "Item Description"} - set(index)
    if missing:
        raise PortalError(f"The portal table changed — missing columns: {', '.join(sorted(missing))}")

    out = []
    for cells in rows:
        cell = lambda name: cells[index[name]].strip() if name in index and index[name] < len(cells) else ""
        if not cell("Order Name"):
            continue
        out.append({
            "order_line": cell("Order Name"),
            "customer_reference": cell("Customer Reference") or None,
            "item_description": cell("Item Description"),
            "order_quantity": _int(cell("Order Quantity")),
            "pending_quantity": _int(cell("Pending Quantity")),
            "status": cell("Order Status") or None,
            "factory_order_number": cell("Factory Order Number") or None,
            "accepted_at": _timestamp(cell("Acceptance Order Date")),
            "requested_delivery": _date(cell("Requested Delivery Date")),
            "factory_confirmation": _date(cell("Factory Confirmation Date")),
        })
    return out


# ─── Scraping ─────────────────────────────────────────────────────────────────

_READ_TABLE = """() => {
  const table = document.querySelector('table');
  if (!table) return null;
  const headers = [...table.querySelectorAll('thead th')]
    .map(th => (th.getAttribute('title') || th.innerText || '').trim().split('\\n')[0]);
  const rows = [...table.querySelectorAll('tbody tr')]
    .map(tr => [...tr.querySelectorAll('th, td')].map(c => c.innerText.trim()));
  const count = document.body.innerText.match(/(\\d+)(\\+?) items?/);
  return {headers, rows, total: count ? Number(count[1]) : null, more: !!(count && count[2])};
}"""


def scrape(headless: bool = True) -> list[dict]:
    from playwright.sync_api import TimeoutError as PlaywrightTimeout, sync_playwright

    username, password = os.getenv("TECNIMEDE_USERNAME"), os.getenv("TECNIMEDE_PASSWORD")
    if not username or not password:
        raise PortalError("Set TECNIMEDE_USERNAME and TECNIMEDE_PASSWORD in the backend .env")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page()
        try:
            page.goto(ALL_ORDERS, wait_until="domcontentloaded")
            # Not signed in → the portal shows its login form.
            password_box = page.locator("input[type=password]")
            try:
                password_box.wait_for(timeout=20_000)
                logged_out = True
            except PlaywrightTimeout:
                logged_out = False
            if logged_out:
                page.locator("input[type=email], input[type=text]").first.fill(username)
                password_box.fill(password)
                password_box.press("Enter")
                try:
                    page.wait_for_url(lambda url: "login" not in url.lower(), timeout=30_000)
                except PlaywrightTimeout:
                    raise PortalError("Login didn't go through — check the username/password "
                                      "(or the portal now asks for a verification code)")
                if "My_Orders" not in page.url:
                    page.goto(ALL_ORDERS, wait_until="domcontentloaded")

            try:
                page.wait_for_selector("table tbody tr", timeout=45_000)
            except PlaywrightTimeout:
                raise PortalError("The All Orders table didn't load")

            # Lightning loads long lists 50 rows at a time as you scroll ("50+ items").
            data = page.evaluate(_READ_TABLE)
            for _ in range(40):
                if not data or (not data["more"] and data["total"] is not None and len(data["rows"]) >= data["total"]):
                    break
                before = len(data["rows"])
                page.locator("table tbody tr").last.scroll_into_view_if_needed()
                page.wait_for_timeout(2000)
                data = page.evaluate(_READ_TABLE)
                if len(data["rows"]) == before and not data["more"]:
                    break
            if not data:
                raise PortalError("The All Orders table didn't load")
            return parse_rows(data["headers"], data["rows"])
        finally:
            browser.close()


# ─── Saving ───────────────────────────────────────────────────────────────────

def track_stage(previous: dict | None, status: str | None, today: str, first_sync: bool) -> dict:
    """The line's stage_seen map, with today's date added if it just reached a new status.

    The portal gives no date for each status change, so we note the day a sync
    first sees it. Lines already at a status on the very first sync get no date
    (we don't know when they got there).
    """
    seen = dict((previous or {}).get("stage_seen") or {})
    if not status or status in seen:
        return seen
    moved = previous is not None and previous.get("status") != status
    new_line = previous is None and not first_sync
    if moved or new_line:
        seen[status] = today
    return seen


def save(lines: list[dict]) -> dict:
    """Upsert every line; `open` = not yet completed. Lines no longer listed are closed."""
    client = get_client()
    now = datetime.now(timezone.utc)
    today = now.astimezone(DUBAI).date().isoformat()
    existing = {r["order_line"]: r for r in fetch_all("supplier_order_lines", "order_line, supplier, status, open, stage_seen", order="id")
                if r["supplier"] == SUPPLIER}
    first_sync = not existing
    if lines:
        client.table("supplier_order_lines").upsert(
            [{**line, "supplier": SUPPLIER, "open": line["status"] != DONE, "synced_at": now.isoformat(),
              "stage_seen": track_stage(existing.get(line["order_line"]), line["status"], today, first_sync)}
             for line in lines],
            on_conflict="supplier,order_line",
        ).execute()
    seen = {line["order_line"] for line in lines}
    open_count = sum(line["status"] != DONE for line in lines)
    closed = [key for key, row in existing.items() if row["open"] and key not in seen]
    if closed:
        client.table("supplier_order_lines").update({"open": False, "synced_at": now.isoformat()}) \
            .eq("supplier", SUPPLIER).in_("order_line", closed).execute()
    return {"lines": len(lines), "open": open_count, "closed": len(closed)}


def sync(headless: bool = True) -> dict:
    return save(scrape(headless=headless))


def list_orders() -> dict:
    """Lines grouped into orders by customer reference, open orders first (earliest requested date first)."""
    rows = [r for r in fetch_all("supplier_order_lines", order="id") if r["supplier"] == SUPPLIER]
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        stage = STAGES.index(row["status"]) if row["status"] in STAGES else None
        grouped.setdefault(order_ref(row["customer_reference"]), []).append({**row, "stage": stage})

    orders = []
    for ref, lines in grouped.items():
        lines.sort(key=lambda l: l["order_line"])
        stages = [l["stage"] for l in lines if l["stage"] is not None]
        requested = [l["requested_delivery"] for l in lines if l["requested_delivery"]]
        accepted = [l["accepted_at"] for l in lines if l["accepted_at"]]
        orders.append({
            "ref": ref,
            "items": sorted({l["item_description"] for l in lines}),
            "accepted_at": min(accepted) if accepted else None,
            "requested_delivery": min(requested) if requested else None,
            "stage": min(stages) if stages else None,          # the furthest-behind line
            "completed": all(l["status"] == DONE for l in lines),
            "lines": lines,
        })
    open_orders = sorted((o for o in orders if not o["completed"]), key=lambda o: o["requested_delivery"] or "9999")
    done = sorted((o for o in orders if o["completed"]), key=lambda o: o["accepted_at"] or "", reverse=True)
    orders = open_orders + done
    synced = max((r["synced_at"] for r in rows), default=None)
    return {"stages": STAGES, "synced_at": synced, "orders": orders}
