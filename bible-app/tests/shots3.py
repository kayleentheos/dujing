import asyncio
from playwright.async_api import async_playwright
BASE = "http://127.0.0.1:8765/index.html"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        errs=[]
        ctx = await b.new_context(viewport={"width": 1366, "height": 860}); page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await page.goto(BASE + "#read-JHN-1"); await page.wait_for_selector(".verse")
        w = page.locator('.verse[data-id="JHN.1.4"] .w').first
        await w.hover(); await page.wait_for_timeout(500)
        await page.screenshot(path="shots/d-hover.png")
        await w.click(); await page.wait_for_timeout(200)
        await page.click(".wordpop__save"); await page.wait_for_timeout(400)
        await page.screenshot(path="shots/d-saved.png")
        await page.mouse.click(5, 400); await page.wait_for_timeout(200)
        await page.click('.vnum[data-verse="JHN.1.4"]'); await page.wait_for_timeout(200)
        await page.screenshot(path="shots/d-reveal.png")
        m = await b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True); mp = await m.new_page()
        mp.on("pageerror", lambda e: errs.append(str(e)))
        await mp.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await mp.goto(BASE + "#read-JHN-1"); await mp.wait_for_selector(".verse")
        await mp.locator('.verse[data-id="JHN.1.14"] .w').nth(9).tap(); await mp.wait_for_timeout(400)
        await mp.screenshot(path="shots/m-pop.png")
        print(errs or "no errors")
        await b.close()
asyncio.run(main())
