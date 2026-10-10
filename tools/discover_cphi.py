"""One-off probe #3: CPHI Europe directory (Frankfurt 2027, Milan 2026 fallback) — how exhibitors load."""
import re
from playwright.sync_api import sync_playwright

CANDIDATES = ["https://exhibitors.cphi.com/cpww27/", "https://exhibitors.cphi.com/cpww26/"]
calls = []

def on_response(resp):
    u = resp.url
    if "exhibitors.cphi.com" in u and resp.request.resource_type in ("xhr", "fetch", "document") and len(calls) < 30:
        try:
            body = resp.text()
        except Exception:
            body = ""
        calls.append((resp.request.method, resp.status, u, resp.headers.get("content-type", ""),
                      (resp.request.post_data or "")[:300], len(body), body[:700].replace("\n", " ")))

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36")
    page.on("response", on_response)
    for url in CANDIDATES:
        try:
            r = page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(8000)
            print(f"\n=== {url} -> {r.status if r else None} | final {page.url} | {page.title()}")
            text = page.inner_text("body")
            m = re.search(r"Show \((\d+)\) results", text); print("result count:", m.group(1) if m else None)
            print("text sample:", text[:900].replace("\n", " | "))
            links = page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
            prof = [l for l in links if re.search(r"exhibitor|company|eventid|exh", l, re.I)]
            print("profile-like links:", len(prof)); print("\n".join(sorted(set(prof))[:12]))
            btn = page.get_by_text("SHOW MORE RESULTS", exact=False)
            if btn.count():
                btn.first.click(); page.wait_for_timeout(5000); print("clicked SHOW MORE")
            if "cpww27" in page.url and m:
                break
        except Exception as e:
            print(f"\n=== {url} FAILED: {e}")
    # one profile page
    try:
        first = next((l for l in prof if re.search(r"exhibitor|exh", l, re.I) and l.rstrip('/') not in [c.rstrip('/') for c in CANDIDATES]), None)
        if first:
            page.goto(first, wait_until="domcontentloaded", timeout=60000); page.wait_for_timeout(5000)
            print(f"\n=== PROFILE {first} | {page.title()}\n", page.inner_text("body")[:1500].replace("\n", " | "))
    except Exception as e:
        print("PROFILE FAILED", e)
    b.close()

print("\n### Requests to exhibitors.cphi.com:")
for c in calls:
    print(f"\n- {c[0]} {c[1]} {c[2]}\n  type={c[3]} post={c[4]!r} len={c[5]}\n  {c[6]!r}")
