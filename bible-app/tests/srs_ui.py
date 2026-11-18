"""Spaced-repetition study: session flow, Forgot re-queue, summary, persistence after reload, mobile swipe."""
import asyncio, sys
from playwright.async_api import async_playwright
sys.path.insert(0, "tests")
from phase3 import word_el, BASE, vocab_js
fails, passed = [], []
def check(c, m): (passed if c else fails).append(m)

async def save(page, verse, word):
    w, i = await word_el(page, verse, word)
    assert i >= 0, (verse, word)
    await w.click(); await page.click(".wordpop__save"); await page.keyboard.press("Escape"); await page.wait_for_timeout(80)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page(); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(f"{BASE}#read-JHN-1"); await page.wait_for_selector(".verse")
        for v, w in [("JHN.1.4", "生命"), ("JHN.1.14", "恩典"), ("JHN.1.14", "真理"), ("JHN.1.5", "黑暗")]:
            await save(page, v, w)
        await page.goto(f"{BASE}#vocab"); await page.wait_for_selector(".study-hero")
        hero = await page.inner_text(".study-hero")
        check("4 cards ready" in hero and "4 new" in hero, f"Vocabulary shows what's ready to study ({hero!r})")
        tabs = await page.evaluate("Object.fromEntries([...document.querySelectorAll('.vtab')].map(t=>[t.dataset.tab, +t.querySelector('b').textContent]))")
        check(tabs == {"study": 4, "review": 0, "strong": 0, "weak": 0, "notStudied": 4, "all": 4}, f"category counts before studying {tabs}")

        await page.click(".study-btn"); await page.wait_for_selector(".scard")
        order = []
        # flashcard: front = word; one flip shows everything; grades only after flipping
        check(await page.is_visible(".ans--flip") and not await page.is_visible(".ans--got"), "front: Flip button, no grades yet")
        await page.click(".scard"); await page.wait_for_timeout(500)
        back = await page.inner_text(".scard__back")
        check("Dictionary entry" in back and await page.is_visible(".ans--forgot") and await page.is_visible(".ans--got") and not await page.is_visible(".ans--flip"),
              "one flip shows pinyin, meaning, verse and dictionary link, then Forgot / Almost / Got it")
        await page.click(".scard"); await page.wait_for_timeout(500)
        check(await page.get_attribute(".scard", "aria-pressed") == "false" and await page.is_visible(".ans--flip"), "tap again flips back to the front")
        await page.keyboard.press("3"); await page.wait_for_timeout(200)
        check(await page.get_attribute(".scard", "aria-pressed") == "false", "grading keys do nothing before the card is flipped")
        answers = ["forgot", "almost", "got", "got"]
        for a in answers:
            order.append(await page.inner_text(".scard__front .scard__word"))
            await page.keyboard.press(" "); await page.wait_for_timeout(120)
            await page.click(f".ans--{a}"); await page.wait_for_timeout(260)
        # forgotten word comes back once
        check(await page.is_visible(".scard") and await page.inner_text(".scard__front .scard__word") == order[0], f"forgotten word {order[0]} returns before the session ends")
        await page.keyboard.press(" "); await page.wait_for_timeout(120); await page.keyboard.press("3"); await page.wait_for_timeout(300)
        check("study-summary" in page.url, "summary after the last card")
        chips = await page.evaluate("Object.fromEntries([...document.querySelectorAll('.sum-chip')].map(c=>[c.dataset.cat, +c.querySelector('b').textContent]))")
        check(chips == {"new": 4, "got": 2, "almost": 1, "forgot": 1, "notStudied": 0, "all": 4}, f"summary counts {chips}")
        await page.click('.sum-chip[data-cat="forgot"]')
        rows = await page.evaluate("[...document.querySelectorAll('.sum-row__word')].map(e=>e.textContent)")
        check(rows == [order[0]], f"summary filter shows forgotten word ({rows})")

        # persistence after reload
        await page.reload(); await page.goto(f"{BASE}#vocab"); await page.wait_for_selector(".vtab")
        tabs = await page.evaluate("Object.fromEntries([...document.querySelectorAll('.vtab')].map(t=>[t.dataset.tab, +t.querySelector('b').textContent]))")
        check(tabs["review"] == 1 and tabs["weak"] >= 2 and tabs["notStudied"] == 0, f"after reload: Review list and Weak kept {tabs}")
        recs = {r["word"]: r for r in await page.evaluate(vocab_js)}
        h = recs[order[0]]["srs"]["history"]
        check([x["result"] for x in h] == ["forgot", "got"] and recs[order[0]]["srs"]["inReview"], f"review history saved ({[x['result'] for x in h]})")
        check(all(recs[w]["srs"]["due"] for w in order), "every studied word has a next review date")
        await page.click('.vtab[data-tab="review"]')
        rv = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(rv == [order[0]], f"Review tab lists the forgotten word ({rv})")
        # word page history + bulk
        await page.click(".vocab-entry__word"); await page.wait_for_selector(".word-history")
        wh = await page.inner_text(".word-progress")
        check("Forgot" in wh and "Got it" in wh, "word page shows review history")
        await page.goto(f"{BASE}#vocab"); await page.wait_for_selector(".vtab")
        await page.click('.vtab[data-tab="all"]'); await page.click("text=Select"); await page.click("text=Select all shown")
        await page.click("text=Reset progress"); await page.wait_for_timeout(200)
        tabs = await page.evaluate("Object.fromEntries([...document.querySelectorAll('.vtab')].map(t=>[t.dataset.tab, +t.querySelector('b').textContent]))")
        check(tabs["notStudied"] == 4, f"bulk reset progress ({tabs})")

        # mobile swipe
        m = await b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        await m.add_init_script("")
        mp = await m.new_page(); await mp.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await mp.goto(f"{BASE}#read-JHN-1"); await mp.wait_for_selector(".verse")
        w, _ = await word_el(mp, "JHN.1.4", "生命"); await w.tap(); await mp.click(".wordpop__save"); await mp.wait_for_timeout(100)
        w, _ = await word_el(mp, "JHN.1.14", "恩典"); await mp.keyboard.press("Escape"); await w.tap(); await mp.click(".wordpop__save"); await mp.wait_for_timeout(100)
        await mp.goto(f"{BASE}#study-session"); await mp.wait_for_selector(".scard")
        await mp.tap(".scard"); await mp.wait_for_timeout(500)
        vis = await mp.evaluate("(() => { const r = document.querySelector('.ans--got').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })()")
        check(vis, "mobile: after a tap flips the card, answer buttons visible without scrolling")
        async def swipe(dx):
            box = await mp.locator(".scard").bounding_box(); x, y = box["x"] + box["width"] / 2, box["y"] + 80
            await mp.evaluate("""([x,y,dx]) => { const el = document.querySelector('.scard');
              const ev = (t, cx) => el.dispatchEvent(new PointerEvent(t, {pointerId: 7, pointerType: 'touch', clientX: cx, clientY: y, bubbles: true}));
              ev('pointerdown', x); for (let i = 1; i <= 6; i++) ev('pointermove', x + dx * i / 6); ev('pointerup', x + dx); }""", [x, y, dx])
            await mp.wait_for_timeout(350)
        first = await mp.inner_text(".scard__front .scard__word"); await swipe(-160)
        second = await mp.inner_text(".scard__front .scard__word"); await swipe(160)
        check(await mp.inner_text(".scard__front .scard__word") == second, "mobile: no swiping away a card you haven't flipped")
        await mp.tap(".scard"); await mp.wait_for_timeout(500); await swipe(160)
        again = await mp.inner_text(".scard__front .scard__word")
        check(first != second and again == first, f"mobile: swipe left = Forgot (word repeats), swipe right = Got it ({first},{second},{again})")
        recs = {r["word"]: r for r in await mp.evaluate(vocab_js)}
        check(recs[first]["srs"]["history"][0]["result"] == "forgot" and recs[second]["srs"]["history"][0]["result"] == "got", "mobile: swipes recorded")
        await mp.screenshot(path="build/shot-study-mobile.png")
        check(not errs, f"no page errors {errs}")
        await b.close()
    for x in passed: print("ok  ", x)
    for x in fails: print("FAIL", x)
    print(f"{len(passed)} passed, {len(fails)} failed")
asyncio.run(main())
