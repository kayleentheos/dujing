"""2 John and 3 John: text, numbering difference, words, notes, names, search, audio, phone."""
import os, asyncio, json, sys
from playwright.async_api import async_playwright
sys.path.insert(0, "tests")
from phase3 import word_el, BASE, vocab_js, VERSE_TEXT
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
fails, passed = [], []
def check(c, m): (passed if c else fails).append(m)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        page = await b.new_page(viewport={"width": 1280, "height": 900}); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
        for code, n, zh in (("2JN", 13, "约翰二书"), ("3JN", 15, "约翰三书")):
            cuv = json.load(open(f"{ROOT}/translations/cuv/{code}.json", encoding="utf-8"))
            await page.goto(f"{BASE}#read-{code}-1"); await page.wait_for_selector(f'.verse[data-id^="{code}."]')
            got = dict(await page.evaluate(VERSE_TEXT, ".flow .verse[data-id]"))
            check(got == {v["id"]: v["text"] for v in cuv["chapters"]["1"]} and len(got) == n, f"{zh}: all {len(got)} verses exactly as the CUV")
            check(zh in await page.inner_text(".chapter-head") and await page.evaluate("document.querySelectorAll('.reveal').length") == 0, f"{zh}: heading shown, Chinese only")
            await page.click(".listen-btn"); await page.wait_for_timeout(1500)
            snap = await page.evaluate("globalThis.__dujingAudio && globalThis.__dujingAudio.snapshot()")
            check(snap and snap.get("segment") and snap["segment"]["verseId"].startswith(code), f"{zh}: chapter audio plays")
            await page.click(".listen-btn")
        # 3 John 14–15: one English verse covers two CUV verses
        await page.goto(f"{BASE}#read-3JN-1"); await page.wait_for_selector(".verse")
        await page.click('.verse[data-id="3JN.1.15"] .vnum'); await page.wait_for_timeout(300)
        rev = await page.inner_text(".reveal")
        check("Peace be to you" in rev and "Greet the friends by name" in rev, "3 John 15 → the English of WEB 14 (which includes the greeting) is shown")
        check("15" in rev or "numbers" in rev.lower() or "verse 15" in rev, f"numbering difference is explained ({rev[-120:]!r})")
        # names and notes
        w, _ = await word_el(page, "3JN.1.1", "该犹"); await w.click(); await page.wait_for_selector(".wordpop")
        pop = await page.inner_text(".wordpop")
        check("Gaius" in pop and "gāi yóu" in pop, "name 该犹 shows Gaius and pinyin")
        await page.keyboard.press("Escape")
        w, _ = await word_el(page, "3JN.1.9", "好"); await w.click(); await page.wait_for_selector(".wordpop")
        check("hào" in await page.inner_text(".wordpop__py"), "好为首: 好 is hào (loves to)")
        await page.keyboard.press("Escape")
        w, _ = await word_el(page, "3JN.1.5", "客旅"); await w.click(); await page.wait_for_selector(".wordpop")
        check("strangers" in (await page.inner_text(".wordpop")).lower(), "客旅 note: strangers / travellers")
        await page.click(".wordpop__save"); await page.wait_for_timeout(200); await page.keyboard.press("Escape")
        r = next((x for x in await page.evaluate(vocab_js) if x["word"] == "客旅"), None)
        check(r and r["refs"][0]["verseId"] == "3JN.1.5" and r["refs"][0]["bookZh"] == "约翰三书", "save a word from 3 John")
        await page.goto(f"{BASE}#read-2JN-1"); await page.wait_for_selector(".verse")
        w, _ = await word_el(page, "2JN.1.6", "行"); await w.click(); await page.wait_for_selector(".wordpop")
        check("xíng" in await page.inner_text(".wordpop__py"), "照他的命令行: 命令 + 行 (xíng), not ‘command line’")
        await page.keyboard.press("Escape")
        w, _ = await word_el(page, "2JN.1.1", "太太"); await w.click(); await page.wait_for_selector(".wordpop")
        check("lady" in (await page.inner_text(".wordpop")).lower(), "太太 note: ‘the chosen lady’")
        await page.click(".wordpop__speak"); await page.wait_for_timeout(800)
        wa = await page.evaluate("(() => { const a = globalThis.__dujingWordAudio && globalThis.__dujingWordAudio.el; return a ? a.currentTime : 0; })()")
        check(wa > 0, "word pronunciation plays")
        await page.keyboard.press("Escape")
        # search
        for q, want in (("约翰二书 6", "#read-2JN-1-6"), ("3 John 4", "#read-3JN-1-4"), ("约三 1:11", "#read-3JN-1-11"), ("2 John 1:5", "#read-2JN-1-5")):
            await page.goto(f"{BASE}#home"); await page.wait_for_selector(".searchbar input")
            await page.fill(".searchbar input", q); await page.press(".searchbar input", "Enter"); await page.wait_for_timeout(900)
            check(page.url.endswith(want), f"reference search {q} → {want} ({page.url.split('#')[1]})")
        await page.goto(f"{BASE}#home"); await page.wait_for_selector(".booklist")
        avail = await page.evaluate("[...document.querySelectorAll('a.bookrow.is-available .bookrow__en')].map(e=>e.textContent)")
        check(all(x in avail for x in ["John", "1 John", "2 John", "3 John"]), f"library lists John and his letters ({avail})")
        # phone
        m = await b.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); await m.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await m.goto(f"{BASE}#read-3JN-1"); await m.wait_for_selector(".verse")
        w, _ = await word_el(m, "3JN.1.2", "兴盛"); await w.tap(); await m.wait_for_selector(".wordpop")
        check(await m.evaluate("document.documentElement.scrollWidth") <= 390, "phone: no sideways scrolling, popover opens on tap")
        await m.screenshot(path="build/shot-3jn-mobile.png")
        check(not errs, f"no page errors {errs}")
        await b.close()
    for x in passed: print("ok  ", x)
    for x in fails: print("FAIL", x)
    print(f"{len(passed)} passed, {len(fails)} failed")
asyncio.run(main())
