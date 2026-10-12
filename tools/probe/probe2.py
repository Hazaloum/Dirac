"""Open the Austrian and Bahraini registry sites in headless Chromium: capture the API calls (AT) and try the download (BH)."""
import asyncio
NL = bytes([10])
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
        heads, posts = {}, []
        page.on("request", lambda r: (heads.update({"h": r.headers}), posts.append((r.url, r.post_data))) if "/api/api/" in r.url else None)
        await page.goto("https://medikamente.basg.gv.at/de/medicinal-products/", wait_until="networkidle", timeout=90000)
        await page.wait_for_timeout(3000)
        inputs = page.locator("input")
        log(f"  inputs: {await inputs.count()} placeholders: {[await inputs.nth(i).get_attribute('placeholder') for i in range(min(await inputs.count(), 8))]}")
        try:
            await inputs.first.fill("*")
            await page.get_by_role("button", name="Suche").first.click()
            await page.wait_for_timeout(8000)
        except Exception as e:
            log(f"  search click failed {e}")
        for u, d in posts:
            if d:
                log(f"  POST {u} body={d[:1500]}")
        search_body = next((d for u, d in posts if "/search" in u and d), None)
        keep = {k: v for k, v in heads.get("h", {}).items() if k.lower() not in ("content-length", "host")}
        if search_body:
            import json as _j
            r = await ctx.request.post("https://medikamente.basg.gv.at/api/api/v1/medication/export?type=CSV", data=_j.loads(search_body),
                                       headers={**keep, "Accept": "text/csv", "Content-Type": "application/json"}, timeout=600000)
            body = await r.body()
            log(f"  export with search body -> {r.status} {len(body):,} lines={body.count(NL):,} {body[600:1600]!r}")
        await b.close()


asyncio.run(main())
OUT.write_text("\n".join(lines))
