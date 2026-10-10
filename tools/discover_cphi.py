"""Probe 5: open the Milan directory in a browser, then fetch the exhibitor-list JSON from inside the page."""
import json, os
from playwright.sync_api import sync_playwright

LIST = ("/live/search/search_exhibition46json.jsp?site=46&type=company&eventid=626"
        "&facets=newexhibitor,companytype,country,zone,businesstype,distributionarea,certification,category")
os.makedirs("tools/data", exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36")
    page.goto("https://exhibitors.cphi.com/cpww26/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(6000)
    body = page.evaluate("async (u) => (await fetch(u, {credentials: 'include'})).text()", LIST)
    print("list bytes", len(body))
    data = json.loads(body.strip())
    print("top-level keys:", list(data.keys()))
    for k, v in data.items():
        if isinstance(v, list):
            print(k, "len", len(v), "first:", json.dumps(v[0])[:1500] if v else None)
    json.dump(data, open("tools/data/cphi_milan_2026_list.json", "w"))
    sample = page.evaluate("async (u) => (await fetch(u)).text()", "/46/company/47/68/61/search476861-626_46.json?v=21")
    open("tools/data/cphi_milan_2026_company_sample.json", "w").write(sample)
    b.close()
