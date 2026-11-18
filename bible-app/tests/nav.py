"""App navigation: sidebar on wide screens, bottom tab bar on phones."""
import os, asyncio, sys
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from phase3 import BASE
fails, passed = [], []
def check(c, m): (passed if c else fails).append(m)
ACTIVE = "document.querySelector('.appnav__item.is-active')?.dataset.id"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        errs = []
        # ---- desktop
        d = await b.new_page(viewport={"width": 1280, "height": 820}); d.on("pageerror", lambda e: errs.append(str(e)))
        await d.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await d.goto(f"{BASE}#home"); await d.wait_for_selector(".booklist")
        box = await d.locator(".appnav").bounding_box()
        check(box and box["x"] == 0 and box["height"] >= 800 and box["width"] > 200, f"desktop: sidebar on the left ({box})")
        main_x = (await d.locator(".appmain").bounding_box())["x"]
        check(main_x >= box["width"] - 1, "desktop: content sits beside the sidebar")
        for route, want in (("#home", "bible"), ("#read-JHN-3", "bible"), ("#book-MRK", "bible"), ("#plans", "plans"), ("#notebook", "notebook"),
                            ("#vocab", "notebook"), ("#highlights", "notebook"), ("#backup", "notebook"), ("#search", "bible")):
            await d.goto(f"{BASE}{route}"); await d.wait_for_timeout(400)
            check(await d.evaluate(ACTIVE) == want, f"{route} highlights {want}")
        await d.click('.appnav__item[data-id="plans"]'); await d.wait_for_selector(".ledger")
        t = await d.inner_text("main")
        check("Reading Plans" in t and "Gospel of John in 21 days" in t and "Continue Reading" not in t, "Plans page shows only the plans")
        await d.click('.appnav__item[data-id="notebook"]'); await d.wait_for_timeout(500)
        t = await d.inner_text("main")
        check("My Notebook" in t and "Flashcards" in t and "Highlights" in t and "Back up my data" in t, "Notebook page: Flashcards, highlights, backup")
        first = await d.evaluate("document.querySelector('main .folio').nextElementSibling.className")
        check("fc-panel" in first, f"Flashcards come first on the Notebook page ({first})")
        order = await d.evaluate("[...document.querySelectorAll('.appnav__item')].map(a=>a.dataset.id)")
        check(order == ["bible", "notebook", "plans"], f"Notebook is the middle item ({order})")
        await d.click('.appnav__item[data-id="bible"]'); await d.wait_for_selector(".booklist")
        t = await d.inner_text("main")
        check("Browse the Bible" in t and "Reading Plans" not in t, "Bible page: library without plans/notebook")
        await d.goto(f"{BASE}#read-MRK-2"); await d.wait_for_selector(".verse"); await d.goto(f"{BASE}#home"); await d.wait_for_timeout(500)
        check("马可福音 2" in await d.inner_text(".appnav__recent"), "sidebar shows the recent chapter")
        await d.click(".appnav__collapse"); await d.wait_for_timeout(300)
        w = (await d.locator(".appnav").bounding_box())["width"]
        check(w < 100, f"collapse makes an icon rail ({w}px)")
        await d.reload(); await d.wait_for_selector(".booklist"); await d.wait_for_timeout(300)
        check((await d.locator(".appnav").bounding_box())["width"] < 100, "collapsed state remembered")
        await d.click(".appnav__collapse"); await d.wait_for_timeout(300)
        check((await d.locator(".appnav").bounding_box())["width"] > 200, "expand again")
        # ---- phone
        ph = await b.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); ph.on("pageerror", lambda e: errs.append(str(e)))
        await ph.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await ph.goto(f"{BASE}#home"); await ph.wait_for_selector(".booklist")
        nb = await ph.locator(".appnav").bounding_box()
        check(nb and nb["y"] + nb["height"] >= 843 and nb["height"] < 90 and nb["width"] >= 389, f"phone: tab bar along the bottom ({nb})")
        labels = await ph.evaluate("[...document.querySelectorAll('.appnav__item')].map(a=>a.innerText.trim())")
        check(labels == ["Bible", "Notebook", "Plans"], f"phone tab labels {labels}")
        await ph.tap('.appnav__item[data-id="plans"]'); await ph.wait_for_selector(".ledger")
        check(await ph.evaluate(ACTIVE) == "plans", "tap Plans tab")
        await ph.goto(f"{BASE}#read-JHN-1"); await ph.wait_for_selector(".verse"); await ph.click(".listen-btn"); await ph.wait_for_selector(".abar"); await ph.wait_for_timeout(400)
        ab = await ph.locator(".abar").bounding_box()
        check(ab["y"] + ab["height"] <= nb["y"] + 1, f"phone: audio player sits above the tab bar ({ab['y']+ab['height']} ≤ {nb['y']})")
        await ph.evaluate("window.__dujingAudio && window.__dujingAudio.audio.pause()")
        await ph.goto(f"{BASE}#study-session"); await ph.wait_for_timeout(700)
        check(not await ph.is_visible(".appnav"), "phone: flashcard session is full-screen (no tab bar)")
        await ph.goto(f"{BASE}#vocab"); await ph.wait_for_timeout(500)
        check(await ph.is_visible(".appnav"), "tab bar returns after the session")
        check(not errs, f"no page errors {errs[:2]}")
        await b.close()
    for m in fails: print("FAIL", m)
    print(f"{len(passed)} passed, {len(fails)} failed")
    sys.exit(1 if fails else 0)

asyncio.run(main())
