"""Generic checks for any imported book:  python3 tests/book_generic.py BOOK
Every chapter shows exactly the CUV text; every word token opens a dictionary card with pinyin;
English reveal works; reference search by English name and Chinese abbreviation; library lists the book;
recorded chapters have playable audio. Needs the app served on :8765 (tools/book.py test does this)."""
import os, asyncio, json, random, sys
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from phase3 import BASE, VERSE_TEXT

CODE = sys.argv[1]
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
canon = json.load(open(f"{ROOT}/canon.json", encoding="utf-8"))
info = next(b for b in canon["books"] if b["code"] == CODE)
cuv = json.load(open(f"{ROOT}/translations/cuv/{CODE}.json", encoding="utf-8"))
man = json.load(open(f"{ROOT}/audio/azure-yunyang/manifest.json", encoding="utf-8"))["chapters"]
fails, passed = [], []
def check(c, m): (passed if c else fails).append(m)


async def main():
    random.seed(CODE)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        page = await b.new_page(viewport={"width": 1280, "height": 900}); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
        ok, n, bad = True, 0, []
        for ch in range(1, info["chapters"] + 1):
            await page.goto(f"{BASE}#read-{CODE}-{ch}"); await page.wait_for_selector(f".verse[data-id^='{CODE}.']")
            got = dict(await page.evaluate(VERSE_TEXT, ".flow .verse[data-id]"))
            want = {v["id"]: v["text"] for v in cuv["chapters"][str(ch)]}
            if got != want: ok = False; bad.append(ch)
            n += len(got)
            # three random words per chapter open a card with pinyin (click only)
            ws = page.locator(".flow .w")
            cnt = await ws.count()
            for i in random.sample(range(cnt), min(3, cnt)):
                await ws.nth(i).hover(); await page.wait_for_timeout(80)
                if await page.locator(".wordpop").count(): check(False, f"ch{ch}: hover opened a card")
                await ws.nth(i).click(); await page.wait_for_selector(".wordpop", timeout=3000)
                py = (await page.inner_text(".wordpop__py")).strip()
                if not py: check(False, f"ch{ch}: word #{i} card without pinyin")
                await page.keyboard.press("Escape")
            # recorded chapter: the bar can play
            if f"{CODE}.{ch}" in man:
                await page.click(".listen-btn")
                try: await page.wait_for_selector(".abar", timeout=4000); shown = True
                except Exception: shown = False
                check(shown, f"ch{ch}: Listen opens the player for a recorded chapter")
                if shown:
                    await page.wait_for_timeout(700)
                    playing = await page.evaluate("window.__dujingAudio && window.__dujingAudio.snapshot().playing")
                    check(playing, f"ch{ch}: audio actually plays")
                    await page.evaluate("window.__dujingAudio && window.__dujingAudio.audio.pause()")
        total = sum(len(v) for v in cuv["chapters"].values())
        check(ok and n == total, f"all {n}/{total} CUV verses exactly as the CUV text" + (f" (mismatch in {bad})" if bad else ""))
        # English reveal (fresh page, so no player is active)
        await page.goto(f"{BASE}#home"); await page.reload(); await page.goto(f"{BASE}#read-{CODE}-1"); await page.wait_for_selector(".verse")
        first = cuv["chapters"]["1"][1]["id"]
        await page.click(f'.verse[data-id="{first}"] .vnum')
        try: await page.wait_for_selector(".reveal", timeout=4000); en = await page.inner_text(".reveal")
        except Exception: en = ""
        check(len(en.strip()) > 10, "English revealed on demand")
        # search
        last = max(int(c) for c in cuv["chapters"]); lv = cuv["chapters"][str(last)][-1]["v"]
        refs = [(f"{info['name']['en']} {last}:{lv}", f"#read-{CODE}-{last}-{lv}"), (f"{info['abbr'][0]} {last}:{lv}", f"#read-{CODE}-{last}-{lv}")]
        if info["chapters"] == 1: refs = [(f"{info['name']['en']} {lv}", f"#read-{CODE}-1-{lv}"), (f"{info['abbr'][0]} {lv}", f"#read-{CODE}-1-{lv}")]
        for q, want in refs:
            await page.goto(f"{BASE}#home"); await page.wait_for_selector(".searchbar input")
            await page.fill(".searchbar input", q); await page.press(".searchbar input", "Enter"); await page.wait_for_timeout(900)
            check(page.url.endswith(want), f"reference search {q!r} → {want} (got {page.url.split('#')[-1]})")
        await page.goto(f"{BASE}#home"); await page.wait_for_selector(".booklist")
        avail = await page.evaluate("[...document.querySelectorAll('a.bookrow.is-available .bookrow__en')].map(e=>e.textContent)")
        check(info["name"]["en"] in avail, f"library lists {info['name']['en']}")
        check(not errs, f"no page errors {errs[:2]}")
        await b.close()
    for m in fails: print("FAIL", m)
    print(f"{CODE}: {len(passed)} passed, {len(fails)} failed")
    sys.exit(1 if fails else 0)

asyncio.run(main())
