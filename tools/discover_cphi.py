"""One-off: find how CPHI serves its exhibitor lists (pages + JSON calls). Prints a report."""
import json, re, sys
from playwright.sync_api import sync_playwright

START = [
    "https://www.cphi.com/middle-east/en/home.html",
    "https://www.cphi.com/middle-east/en/exhibitor-list.html",
    "https://exhibitors.cphi.com/",
]
seen_json = []

def on_response(resp):
    ct = resp.headers.get("content-type", "")
    if "json" in ct and len(seen_json) < 60:
        try:
            body = resp.text()[:600]
        except Exception:
            body = "<unreadable>"
        seen_json.append({"url": resp.url, "status": resp.status, "body": body})

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36")
    page.on("response", on_response)
    links = set()
    for url in START:
        try:
            r = page.goto(url, wait_until="networkidle", timeout=60000)
            print(f"\n=== {url} -> {r.status if r else None} | final {page.url} | title: {page.title()}")
            for a in page.eval_on_selector_all("a[href]", "els => els.map(e => [e.href, e.innerText.trim()])"):
                if re.search(r"exhibit", a[0] + a[1], re.I):
                    links.add((a[0], a[1][:60]))
        except Exception as e:
            print(f"\n=== {url} FAILED: {e}")
    print("\n### Links mentioning 'exhibit':")
    for h, t in sorted(links)[:80]:
        print(f"  {t!r:62} {h}")
    # Follow the most likely directory links
    for h, _ in sorted(links)[:8]:
        if "exhibitors.cphi.com" in h or "exhibitor-list" in h or "directory" in h.lower():
            try:
                r = page.goto(h, wait_until="networkidle", timeout=60000)
                for _ in range(3):
                    page.mouse.wheel(0, 20000); page.wait_for_timeout(1500)
                text = page.inner_text("body")[:1500].replace("\n", " | ")
                print(f"\n=== FOLLOWED {h} -> {r.status if r else None} | {page.title()}\n  text: {text}")
            except Exception as e:
                print(f"\n=== FOLLOWED {h} FAILED: {e}")
    b.close()

print("\n### JSON responses seen:")
for j in seen_json:
    print(f"\n- {j['status']} {j['url']}\n  {j['body']!r}")
