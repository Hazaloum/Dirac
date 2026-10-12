"""Open the Austrian and Bahraini registry sites in headless Chromium: capture the API calls (AT) and try the download (BH)."""
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path("tools/data/registries/probe2.txt")
lines = []


def log(s=""):
    print(s, flush=True)
    lines.append(str(s))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
                                  accept_downloads=True, locale="de-AT")
        page = await ctx.new_page()
        reqs = []
        page.on("request", lambda r: reqs.append(f"{r.method} {r.url} {(r.post_data or '')[:300]}") if r.resource_type in ("xhr", "fetch") else None)
        page.on("response", lambda r: log(f"  <- {r.status} {r.url}") if r.request.resource_type in ("xhr", "fetch") else None)
        log("######## at")
        base = "https://medikamente.basg.gv.at/api/api/v1/medication"
        for path, method, body, params in [("/search", "post", {}, {"page": 0, "size": 5}), ("/list", "get", None, {"page": 0, "size": 5}),
                                           ("/export", "post", {}, {"type": "CSV"}), ("/export", "post", {}, {"type": "csv"}),
                                           ("/export", "post", {}, {})]:
            try:
                q = "&".join(f"{k}={v}" for k, v in params.items())
                url = f"{base}{path}" + (f"?{q}" if q else "")
                hdr = {"Accept": "text/csv" if path == "/export" else "application/json", "Accept-Language": "de", "Content-Type": "application/json"}
                r = await (ctx.request.post(url, data=body, headers=hdr, timeout=300000) if method == "post" else ctx.request.get(url, headers=hdr, timeout=120000))
                b = await r.body()
                log(f"  {method.upper()} {url} -> {r.status} {r.headers.get('content-type')} {r.headers.get('content-disposition')} {len(b):,} {b[:700]!r}")
            except Exception as e:
                log(f"  {path} failed: {type(e).__name__}: {str(e)[:300]}")
        log("######## ae")
        import re
        for url in ["https://mohap.gov.ae/en/services/registered-medical-product-directory",
                    "https://mohap.gov.ae/en/open-data/mohap-open-data",
                    "https://mohap.gov.ae/en/open-data",
                    "https://www.doh.gov.ae/en/resources/drug-master",
                    "https://www.doh.gov.ae/en/Shafafiya/dictionary",
                    "https://www.shafafiya.org/dictionary"]:
            try:
                resp = await page.goto(url, wait_until="networkidle", timeout=90000)
                html = await page.content()
                links = sorted(set(re.findall(r"""href=["']([^"']+?\.(?:xlsx?|csv|zip)[^"']*)["']""", html, re.I)))
                log(f"  {url} -> {resp.status if resp else None} title={await page.title()!r} data links: {links[:30]}")
            except Exception as e:
                log(f"  {url} failed: {type(e).__name__}: {str(e)[:200]}")
        for r in reqs:
            if "api" in r.lower() or "drug" in r.lower():
                log("  -> " + r)
        await b.close()


asyncio.run(main())
OUT.write_text("\n".join(lines))
