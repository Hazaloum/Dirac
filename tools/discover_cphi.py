"""One-off probe #2: CPHI Middle East 2026 exhibitor list (biomiddleeast.com page + Swapcard event app)."""
import json, re
from playwright.sync_api import sync_playwright

LIST = "https://biomiddleeast.com/exhibitor-list-2026"
APP = "https://app.cphibio-middleeast.com/event/cphi-bio-middle-east-2026/exhibitors"
gql = []

def on_request(req):
    if "graphql" in req.url and req.method == "POST" and len(gql) < 25:
        gql.append({"url": req.url, "body": (req.post_data or "")[:900]})

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36")
    # 1) Public exhibitor list page
    page.goto(LIST, wait_until="domcontentloaded", timeout=60000); page.wait_for_timeout(6000)
    html = page.content()
    print("=== LIST", page.url, "| html bytes", len(html))
    links = page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
    prof = sorted({l for l in links if re.search(r"exhibitor|company|profile", l, re.I)})
    print("profile-like links:", len(prof)); print("\n".join(prof[:15]))
    pager = sorted({l for l in links if re.search(r"page=|\\?p=", l)})
    print("pager links:", pager[:10])
    # one exhibitor card's HTML
    m = re.search(r"AAtek GmbH", html)
    if m: print("card html:", html[max(0, m.start()-1200):m.start()+400].replace("\n", " "))
    for _ in range(6):
        page.mouse.wheel(0, 30000); page.wait_for_timeout(1500)
    body = page.inner_text("body")
    print("booth-like codes on page after scroll:", len(re.findall(r"\b(?:H\d|B\d|SU)\.[A-Z0-9]+\b", body)))
    # 2) Swapcard event app exhibitors
    page.on("request", on_request)
    try:
        page.goto(APP, wait_until="domcontentloaded", timeout=60000); page.wait_for_timeout(10000)
        print("\n=== APP", page.url, "|", page.title())
        print("text:", page.inner_text("body")[:800].replace("\n", " | "))
    except Exception as e:
        print("APP FAILED", e)
    b.close()
print("\n### GraphQL requests:")
for g in gql: print("-", g["url"], "\n ", g["body"])
