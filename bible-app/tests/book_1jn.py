"""1 John: reading, words, dictionary, notes, search, library, vocabulary, audio."""
import os, asyncio, json, sys
from playwright.async_api import async_playwright
sys.path.insert(0, "tests")
from phase3 import word_el, BASE, vocab_js, VERSE_TEXT
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
cuv = json.load(open(f"{ROOT}/translations/cuv/1JN.json", encoding="utf-8"))
web = json.load(open(f"{ROOT}/translations/web/1JN.json", encoding="utf-8"))
fails, passed = [], []
def check(c, m): (passed if c else fails).append(m)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        page = await b.new_page(viewport={"width": 1280, "height": 900}); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
        # every verse of every chapter, exactly the CUV text, Chinese only
        allok, n = True, 0
        for ch in range(1, 6):
            await page.goto(f"{BASE}#read-1JN-{ch}"); await page.wait_for_selector(".verse")
            got = dict(await page.evaluate(VERSE_TEXT, ".flow .verse[data-id]"))
            want = {v["id"]: v["text"] for v in cuv["chapters"][str(ch)]}
            n += len(got); allok &= got == want
            allok &= await page.evaluate("document.querySelectorAll('.reveal').length") == 0
        check(allok and n == 105, f"1 John 1–5: all {n} verses shown exactly as the CUV, Chinese only")
        await page.goto(f"{BASE}#read-1JN-1"); await page.wait_for_selector(".verse")
        head = await page.inner_text(".chapter-head")
        check("约翰一书" in head and "1 John" in head, "chapter heading 约翰一书 / 1 John")
        # English on demand
        await page.click('.verse[data-id="1JN.1.5"] .vnum'); await page.wait_for_selector('.reveal[data-reveal="1JN.1.5"]')
        en = await page.inner_text('.reveal[data-reveal="1JN.1.5"]')
        check(web["chapters"]["1"][4]["text"][:40] in en, "tap a verse number: its WEB English appears")
        # dictionary + study note + contextual
        w, _ = await word_el(page, "1JN.1.3", "相交"); await w.click(); await page.wait_for_selector(".wordpop")
        pop = await page.inner_text(".wordpop")
        check("xiāng jiāo" in pop and "fellowship" in pop.lower(), "相交 shows pinyin and the study note (fellowship)")
        await page.keyboard.press("Escape")
        w, _ = await word_el(page, "1JN.1.7", "行"); await w.click(); await page.wait_for_selector(".wordpop")
        check("xíng" in await page.inner_text(".wordpop__py"), "在光明中行: 行 is xíng (walk), not háng")
        # save a word from 1 John; it links back
        await page.click(".wordpop__save"); await page.wait_for_timeout(200)
        recs = await page.evaluate(vocab_js)
        r = next((x for x in recs if x["word"] == "行"), None)
        check(r and r["refs"][0]["verseId"] == "1JN.1.7" and r["refs"][0]["bookZh"] == "约翰一书" and r["refs"][0]["en"].startswith("But if we walk"), "saved word keeps 1 John verse, book name and English")
        await page.keyboard.press("Escape")
        # word pronunciation: a word first recorded for John is found from 1 John
        w, _ = await word_el(page, "1JN.1.1", "生命"); await w.click(); await page.wait_for_selector(".wordpop__speak")
        await page.click(".wordpop__speak"); await page.wait_for_timeout(800)
        wa = await page.evaluate("(() => { const a = globalThis.__dujingWordAudio && globalThis.__dujingWordAudio.el; return a ? { src: a.src, t: a.currentTime } : null; })()")
        check(wa and wa["t"] > 0, f"word pronunciation works in 1 John ({wa})")
        await page.keyboard.press("Escape")
        # search by reference
        for q in ["约翰一书 4:8", "1 John 4:8", "约一 4:8"]:
            await page.goto(f"{BASE}#home"); await page.wait_for_selector(".searchbar input")
            await page.fill(".searchbar input", q); await page.press(".searchbar input", "Enter"); await page.wait_for_timeout(900)
            check(page.url.endswith("#read-1JN-4-8"), f"reference search {q} opens 1 John 4:8 ({page.url.split('#')[1]})")
        await page.goto(f"{BASE}#home"); await page.wait_for_selector(".searchbar input")
        await page.fill(".searchbar input", "神就是爱"); await page.press(".searchbar input", "Enter"); await page.wait_for_timeout(800)
        body = await page.inner_text("body")
        check("4:8" in body and "4:16" in body, "text search finds 神就是爱 in 1 John 4:8 and 4:16")
        # library: available + plan
        await page.goto(f"{BASE}#home"); await page.wait_for_selector(".booklist")
        avail = await page.evaluate("[...document.querySelectorAll('a.bookrow.is-available .bookrow__en')].map(e=>e.textContent)")
        check("John" in avail and "1 John" in avail, f"library lists John and 1 John as available ({avail})")
        check("1 John in 5 days" in await page.inner_text("body"), "reading plan: 1 John in 5 days")
        # audio
        await page.goto(f"{BASE}#read-1JN-1"); await page.wait_for_selector(".verse")
        await page.click(".listen-btn"); await page.wait_for_timeout(1500)
        snap = await page.evaluate("globalThis.__dujingAudio && globalThis.__dujingAudio.snapshot()")
        check(snap and snap.get("segment") and snap["segment"]["verseId"].startswith("1JN.1."), f"chapter audio plays for 1 John 1 ({snap and snap.get('segment')})")
        check(not errs, f"no page errors {errs}")
        await b.close()
    for x in passed: print("ok  ", x)
    for x in fails: print("FAIL", x)
    print(f"{len(passed)} passed, {len(fails)} failed")
asyncio.run(main())
