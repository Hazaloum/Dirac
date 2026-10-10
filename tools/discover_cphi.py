"""Probe 4: download the CPHI Milan exhibitor list JSON with plain HTTP (no browser) and save it."""
import json, os, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Referer": "https://exhibitors.cphi.com/cpww26/", "Accept": "application/json, text/plain, */*"}
LIST = ("https://exhibitors.cphi.com/live/search/search_exhibition46json.jsp?site=46&type=company&eventid=626"
        "&facets=newexhibitor,companytype,country,zone,businesstype,distributionarea,certification,category")

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.status, r.read().decode("utf-8", "replace")

os.makedirs("tools/data", exist_ok=True)
status, body = get(LIST)
print("list status", status, "bytes", len(body))
data = json.loads(body.strip())
print("top-level keys:", list(data.keys()))
for k, v in data.items():
    if isinstance(v, list):
        print(k, "len", len(v), "first:", json.dumps(v[0])[:1500] if v else None)
json.dump(data, open("tools/data/cphi_milan_2026_list.json", "w"))
# one full company record
status, body = get("https://exhibitors.cphi.com/46/company/47/68/61/search476861-626_46.json?v=21")
print("company status", status)
open("tools/data/cphi_milan_2026_company_sample.json", "w").write(body)
