"""In-app backup: everything saved appears in the exported file."""
import asyncio, json, sys
from playwright.async_api import async_playwright
sys.path.insert(0, "tests")
from phase3 import word_el, BASE
async def main():
    ok = []; bad = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = await b.new_context(accept_downloads=True); page = await ctx.new_page()
        await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await page.goto(f"{BASE}#read-JHN-1"); await page.wait_for_selector(".verse")
        for v, w in [("JHN.1.4", "生命"), ("JHN.1.14", "恩典")]:
            el, _ = await word_el(page, v, w); await el.click(); await page.click(".wordpop__save"); await page.keyboard.press("Escape")
        el, _ = await word_el(page, "JHN.1.5", "黑暗"); await el.click(); await page.click('.wordpop__hl .hl-swatch[data-color="green"]'); await page.keyboard.press("Escape")
        await page.goto(f"{BASE}#study-session"); await page.wait_for_selector(".scard"); await page.click(".ans--forgot"); await page.wait_for_timeout(300)
        await page.goto(f"{BASE}#notebook"); await page.wait_for_selector(".ledger")
        (ok if "Back up my data" in await page.inner_text("body") else bad).append("library links to backup")
        await page.goto(f"{BASE}#backup"); await page.wait_for_selector(".backup-list")
        async with page.expect_download() as d: await page.click("text=Download backup file")
        data = json.load(open(await (await d.value).path(), encoding="utf-8"))
        words = {x["data"]["word"] for x in data["collections"]["vocab"]}
        hist = sum(len(x["data"].get("srs", {}).get("history", [])) for x in data["collections"]["vocab"])
        (ok if data["format"] == "dujing-backup" and words == {"生命", "恩典"} else bad).append(f"vocab in backup {words}")
        (ok if hist == 1 else bad).append(f"review history in backup ({hist})")
        (ok if [h["data"]["text"] for h in data["collections"]["highlights"]] == ["黑暗"] else bad).append("highlight in backup")
        (ok if data["docs"]["prefs"]["data"] and data["docs"]["progress"]["data"]["last"]["chapter"] == 1 else bad).append("settings + progress in backup")
        await b.close()
    for x in ok: print("ok  ", x)
    for x in bad: print("FAIL", x)
    print(f"{len(ok)} passed, {len(bad)} failed")
asyncio.run(main())
