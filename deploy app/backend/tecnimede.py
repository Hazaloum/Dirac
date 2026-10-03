"""
tecnimede.py — pull COMIX's open orders from Tecnimede's supplier portal.

Tecnimede gives no API, so a headless browser logs in as COMIX's portal user
(TECNIMEDE_USERNAME / TECNIMEDE_PASSWORD), opens the "Open Orders" list view
and reads the table. Each line is upserted into Supabase
`supplier_order_lines`; lines that drop off the open list are marked closed.

Run: python scripts/sync_tecnimede.py   (needs `playwright install chromium` once)
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

from supabase_client import fetch_all, get_client

SUPPLIER = "Tecnimede"
PORTAL = "https://tecnimedeimprove.my.site.com"
OPEN_ORDERS = f"{PORTAL}/s/recordlist/Order__c/00BVk00000IfpKLMAZ"

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
  const count = (document.body.innerText.match(/(\\d+)\\+? items?/) || [])[1];
  return {headers, rows, total: count ? Number(count) : null};
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
            page.goto(OPEN_ORDERS, wait_until="domcontentloaded")
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
                if "recordlist" not in page.url:
                    page.goto(OPEN_ORDERS, wait_until="domcontentloaded")

            try:
                page.wait_for_selector("table tbody tr", timeout=45_000)
            except PlaywrightTimeout:
                raise PortalError("The Open Orders table didn't load")

            # Lightning loads long lists as you scroll — scroll until every row is in.
            data = page.evaluate(_READ_TABLE)
            for _ in range(20):
                if not data or data["total"] is None or len(data["rows"]) >= data["total"]:
                    break
                page.locator("table tbody tr").last.scroll_into_view_if_needed()
                page.wait_for_timeout(1500)
                data = page.evaluate(_READ_TABLE)
            if not data:
                raise PortalError("The Open Orders table didn't load")
            return parse_rows(data["headers"], data["rows"])
        finally:
            browser.close()


# ─── Saving ───────────────────────────────────────────────────────────────────

def save(lines: list[dict]) -> dict:
    """Upsert the open lines; anything previously open but no longer listed is closed."""
    client = get_client()
    now = datetime.now(timezone.utc).isoformat()
    if lines:
        client.table("supplier_order_lines").upsert(
            [{**line, "supplier": SUPPLIER, "open": True, "synced_at": now} for line in lines],
            on_conflict="supplier,order_line",
        ).execute()
    seen = {line["order_line"] for line in lines}
    previously_open = [r["order_line"] for r in fetch_all("supplier_order_lines", "order_line, supplier, open", order="id")
                       if r["supplier"] == SUPPLIER and r["open"]]
    closed = [line for line in previously_open if line not in seen]
    if closed:
        client.table("supplier_order_lines").update({"open": False, "synced_at": now}) \
            .eq("supplier", SUPPLIER).in_("order_line", closed).execute()
    return {"open": len(lines), "closed": len(closed)}


def sync(headless: bool = True) -> dict:
    return save(scrape(headless=headless))


def list_lines() -> list[dict]:
    rows = fetch_all("supplier_order_lines", order="id")
    return sorted(rows, key=lambda r: (not r["open"], r["factory_confirmation"] or r["requested_delivery"] or "9999"))
