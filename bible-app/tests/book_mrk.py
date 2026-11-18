"""Mark: text, numbering differences, segmentation and pinyin fixes, notes, Aramaic, search, plan, audio, phone."""
import os, asyncio, json, sys
from playwright.async_api import async_playwright
sys.path.insert(0, "tests")
from phase3 import word_el, BASE, vocab_js, VERSE_TEXT
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
cuv = json.load(open(f"{ROOT}/translations/cuv/MRK.json", encoding="utf-8"))
fails, passed = [], []
def check(c, m): (passed if c else fails).append(m)
async def pop_of(page, vid, w):
    el, i = await word_el(page, vid, w); assert i >= 0, (vid, w)
    await el.click(); await page.wait_for_selector(".wordpop"); t = await page.inner_text(".wordpop"); py = await page.inner_text(".wordpop__py")
    await page.keyboard.press("Escape"); return t, py

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        page = await b.new_page(viewport={"width": 1280, "height": 900}); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
        ok, n = True, 0
        for ch in range(1, 17):
            await page.goto(f"{BASE}#read-MRK-{ch}"); await page.wait_for_selector(".verse")
            got = dict(await page.evaluate(VERSE_TEXT, ".flow .verse[data-id]"))
            ok &= got == {v["id"]: v["text"] for v in cuv["chapters"][str(ch)]}; n += len(got)
        check(ok and n == 676, f"Mark 1–16: all {n} CUV verses exactly as the CUV text")
        # numbering differences
        await page.goto(f"{BASE}#read-MRK-7"); await page.wait_for_selector(".verse")
        gap = await page.inner_text('[data-gap="MRK.7.16"]')
        check("16" in gap and "古卷" in gap, "7:16 shown as a labelled gap with the CUV footnote explanation")
        await page.goto(f"{BASE}#read-MRK-9"); await page.wait_for_selector(".verse")
        await page.click('.verse[data-id="MRK.9.44"] .vnum'); await page.wait_for_timeout(300)
        rev = await page.inner_text(".reveal")
        check("cut it off" in rev and "worm" in rev and "verse division" in rev.lower(), "9:43–44: English for both verses with the verse-division note")
        await page.goto(f"{BASE}#read-MRK-15"); await page.wait_for_selector(".verse")
        check(await page.locator('[data-gap="MRK.15.28"]').count() == 1, "15:28 shown as a labelled gap")
        # segmentation + pinyin fixes
        await page.goto(f"{BASE}#read-MRK-5"); await page.wait_for_selector(".verse")
        t, py = await pop_of(page, "MRK.5.41", "大利大"); check("Talitha" in t, "大利大 → Talitha (Aramaic) with note")
        words = await page.evaluate("[...document.querySelectorAll('.verse[data-id=\"MRK.5.38\"] .w')].map(w=>{const c=w.cloneNode(true);c.querySelectorAll('rt').forEach(r=>r.remove());return c.textContent})")
        check("人大" not in words and "大大" in words, f"有人大大地哭泣: no 人大 ‘People’s Congress’ ({words})")
        await page.goto(f"{BASE}#read-MRK-4"); await page.wait_for_selector(".verse")
        _, py = await pop_of(page, "MRK.4.14", "撒"); check("sǎ" in py, "撒种 (sowing): sǎ")
        _, py = await pop_of(page, "MRK.4.4", "尽"); check("jìn" in py, "吃尽: jìn")
        await page.goto(f"{BASE}#read-MRK-12"); await page.wait_for_selector(".verse")
        words = await page.evaluate("[...document.querySelectorAll('.verse[data-id=\"MRK.12.17\"] .w')].map(w=>{const c=w.cloneNode(true);c.querySelectorAll('rt').forEach(r=>r.remove());return c.textContent})")
        check("当归" not in words, "当归给凯撒: not 当归 ‘angelica root’")
        _, py = await pop_of(page, "MRK.12.40", "长"); check("cháng" in py, "很长的祷告: cháng")
        await page.goto(f"{BASE}#read-MRK-8"); await page.wait_for_selector(".verse")
        _, py = await pop_of(page, "MRK.8.34", "背"); check("bēi" in py, "背起十字架: bēi")
        await page.goto(f"{BASE}#read-MRK-9"); await page.wait_for_selector(".verse")
        _, py = await pop_of(page, "MRK.9.44", "只"); check("zhī" in py, "两只手: zhī")
        await page.goto(f"{BASE}#read-MRK-10"); await page.wait_for_selector(".verse")
        t, _ = await pop_of(page, "MRK.10.46", "巴底买"); check("Bartimaeus" in t, "name 巴底买 → Bartimaeus")
        await page.goto(f"{BASE}#read-MRK-6"); await page.wait_for_selector(".verse")
        t, _ = await pop_of(page, "MRK.6.17", "希罗底"); check("Herodias" in t and "Herodium" not in t.split("not the place")[0], "希罗底 → Herodias, not the town Herodium")
        # save from Mark
        el, _ = await word_el(page, "MRK.6.41", "擘"); await el.click(); await page.wait_for_selector(".wordpop")
        check("bāi" in await page.inner_text(".wordpop"), "擘 (break bread): bāi with note")
        await page.click(".wordpop__save"); await page.wait_for_timeout(200); await page.keyboard.press("Escape")
        r = next((x for x in await page.evaluate(vocab_js) if x["word"] == "擘"), None)
        check(r and r["refs"][0]["bookZh"] == "马可福音", "save a word from Mark")
        # search + plan
        for q, want in (("马可福音 10:45", "#read-MRK-10-45"), ("Mark 1:1", "#read-MRK-1-1"), ("可 16:15", "#read-MRK-16-15")):
            await page.goto(f"{BASE}#home"); await page.wait_for_selector(".searchbar input")
            await page.fill(".searchbar input", q); await page.press(".searchbar input", "Enter"); await page.wait_for_timeout(900)
            check(page.url.endswith(want), f"reference search {q}")
        await page.goto(f"{BASE}#plans"); await page.wait_for_selector(".ledger")
        check("The Gospel of Mark in 16 days" in await page.inner_text("body"), "reading plan: Mark in 16 days")
        await page.goto(f"{BASE}#home"); await page.wait_for_selector(".booklist")
        avail = await page.evaluate("[...document.querySelectorAll('a.bookrow.is-available .bookrow__en')].map(e=>e.textContent)")
        check("Mark" in avail, f"library lists Mark ({avail})")
        # audio (every chapter that has been recorded)
        man = json.load(open(f"{ROOT}/audio/azure-yunyang/manifest.json"))["chapters"]
        have = [c for c in range(1, 17) if f"MRK.{c}" in man]
        check(len(have) == 16, f"audio exists for all 16 chapters ({len(have)})")
        await page.goto(f"{BASE}#read-MRK-1"); await page.wait_for_selector(".verse")
        await page.click(".listen-btn"); await page.wait_for_timeout(1500)
        snap = await page.evaluate("globalThis.__dujingAudio && globalThis.__dujingAudio.snapshot()")
        check(snap and snap.get("segment") and snap["segment"]["verseId"].startswith("MRK.1."), "chapter audio plays")
        m = await b.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); await m.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await m.goto(f"{BASE}#read-MRK-4"); await m.wait_for_selector(".verse")
        el, _ = await word_el(m, "MRK.4.3", "撒种"); await el.tap(); await m.wait_for_selector(".wordpop")
        check(await m.evaluate("document.documentElement.scrollWidth") <= 390, "phone: popover on tap, no sideways scroll")
        await m.screenshot(path="build/shot-mrk-mobile.png")
        check(not errs, f"no page errors {errs}")
        await b.close()
    for x in passed: print("ok  ", x)
    for x in fails: print("FAIL", x)
    print(f"{len(passed)} passed, {len(fails)} failed")
asyncio.run(main())
