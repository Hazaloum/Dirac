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
        try:
            await page.goto("https://medikamente.basg.gv.at/de/medicinal-products/", wait_until="networkidle", timeout=90000)
            await page.wait_for_timeout(5000)
            buttons = await page.locator("button").all_inner_texts()
            log(f"  buttons: {buttons[:40]}")
            for label in ["Suchen", "Suche", "Export", "CSV", "Exportieren"]:
                loc = page.get_by_role("button", name=label)
                if await loc.count():
                    log(f"  clicking {label}")
                    try:
                        async with page.expect_download(timeout=60000) as dl:
                            await loc.first.click()
                        d = await dl.value
                        log(f"  download: {d.url} {d.suggested_filename}")
                    except Exception as e:
                        log(f"  no download after {label}: {type(e).__name__}")
                    await page.wait_for_timeout(4000)
        except Exception as e:
            log(f"  at failed: {type(e).__name__}: {e}")
        for r in reqs:
            log("  -> " + r)
        reqs.clear()
        log("######## bh")
        for url in ["https://www.nhra.bh/Departments/PPR/?page=102",
                    "https://www.nhra.bh/Departments/PPR/MediaHandler/GenericHandler/documents/departments/PPR/Medicines/List/PPR_LISTS_Registered%20Medicine%20Price%20List_20260614.xlsx"]:
            try:
                resp = await page.goto(url, timeout=90000)
                log(f"  goto {url} -> {resp.status if resp else None}")
                log("  title: " + (await page.title()))
                log("  body: " + (await page.content())[:600].replace("\n", " "))
            except Exception as e:
                log(f"  goto {url} failed: {type(e).__name__}: {str(e)[:300]}")
            try:
                r = await ctx.request.get(url, timeout=90000)
                log(f"  request {url} -> {r.status} {r.headers.get('content-type')} {len(await r.body()):,}")
            except Exception as e:
                log(f"  request failed {e}")
        await b.close()


asyncio.run(main())
OUT.write_text("\n".join(lines))
