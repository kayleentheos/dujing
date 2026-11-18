import asyncio
from playwright.async_api import async_playwright
BASE = "http://127.0.0.1:8765/index.html"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        for name, vp in [("d", {"width": 1366, "height": 860}), ("m", {"width": 390, "height": 844})]:
            ctx = await b.new_context(viewport=vp); page = await ctx.new_page()
            await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
            await page.goto(BASE + "#read-JHN-1"); await page.wait_for_selector(".verse")
            await page.click(".listen-btn"); await page.wait_for_timeout(600)
            await page.click('.vnum[data-verse="JHN.1.4"]'); await page.wait_for_timeout(1500)
            await page.screenshot(path=f"shots/{name}-audio.png")
            await ctx.close()
        await b.close()
asyncio.run(main())
