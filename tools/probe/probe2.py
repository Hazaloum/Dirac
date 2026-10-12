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
        heads = {}
        page.on("request", lambda r: heads.update({r.url: r.headers}) if "/api/api/" in r.url else None)
        await page.goto("https://medikamente.basg.gv.at/de/medicinal-products/", wait_until="networkidle", timeout=90000)
        await page.wait_for_timeout(4000)
        for u, h in list(heads.items())[:3]:
            log(f"  page request {u} headers: {h}")
        h = next(iter(heads.values()), {})
        keep = {k: v for k, v in h.items() if k.lower() not in ("content-length", "host")}
        base = "https://medikamente.basg.gv.at/api/api/v1/medication"
        for typ in ["CSV", "csv"]:
            try:
                r = await ctx.request.post(f"{base}/export?type={typ}", data={}, headers={**keep, "Accept": "text/csv", "Content-Type": "application/json"}, timeout=600000)
                body = await r.body()
                log(f"  export {typ} -> {r.status} {r.headers.get('content-type')} {len(body):,} {body[:1500]!r}")
            except Exception as e:
                log(f"  export failed {type(e).__name__}: {str(e)[:300]}")
        log("######## ae")
        try:
            r = await ctx.request.get("https://shafafiyaportal.doh.gov.ae/dictionary/DrugCoding/Drugs.xlsx", timeout=300000)
            body = await r.body()
            log(f"  Drugs.xlsx -> {r.status} {r.headers.get('content-type')} {len(body):,}")
            import io
            import pandas as pd
            x = pd.read_excel(io.BytesIO(body), sheet_name=None, nrows=5)
            for sh, df in x.items():
                log(f"  sheet {sh}: {list(df.columns)}")
                for _, row in df.head(3).iterrows():
                    log("    " + " | ".join(str(v)[:50] for v in row.values))
        except Exception as e:
            log(f"  Drugs.xlsx failed {type(e).__name__}: {str(e)[:300]}")
        await b.close()


asyncio.run(main())
OUT.write_text("\n".join(lines))
