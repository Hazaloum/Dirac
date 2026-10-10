"""Probe 6: fetch every Milan exhibitor's detail record (booth, description, ...) from inside the page."""
import json, os
from playwright.sync_api import sync_playwright

ids = [r["id"] for r in json.load(open("tools/data/cphi_milan_2026_list.json"))["results"]]
JS = """async (ids) => {
  const path = id => { const s = String(id).padStart(6, '0'); return `/46/company/${s.slice(0,2)}/${s.slice(2,4)}/${s.slice(4,6)}/search${id}-626_46.json?v=21`; };
  const out = {}; let i = 0;
  async function worker() { while (i < ids.length) { const id = ids[i++];
    try { const r = await fetch(path(id)); out[id] = r.ok ? (await r.json()).result : {error: r.status}; } catch (e) { out[id] = {error: String(e)}; } } }
  await Promise.all(Array.from({length: 16}, worker));
  return out;
}"""
KEEP = ["title", "country", "isocode", "standno", "zone", "companyTypes", "categories", "desc", "fulldesc", "url",
        "logo", "newexhibitor", "noOfYears", "noOfEmployees", "noOfCertificates", "phone", "featured", "verified", "founded"]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36")
    page.goto("https://exhibitors.cphi.com/cpww26/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(6000)
    page.set_default_timeout(600000)
    raw = page.evaluate(JS, ids)
    b.close()
details = {k: ({f: v.get(f) for f in KEEP} if "error" not in v else v) for k, v in raw.items()}
print("fetched", len(details), "errors", sum(1 for v in details.values() if "error" in v))
json.dump(details, open("tools/data/cphi_milan_2026_details.json", "w"))
