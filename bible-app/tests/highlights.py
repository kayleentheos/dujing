"""Highlighting: selection toolbar, word-snapping, multi-verse, recolour/remove, popover controls,
coexistence with audio + English reveal, persistence after reload, mobile."""
import asyncio, sys
from playwright.async_api import async_playwright
sys.path.insert(0, "tests")
from phase3 import word_el, BASE
fails, passed = [], []
def check(c, m): (passed if c else fails).append(m)
HL = "() => Object.values(JSON.parse(localStorage.getItem('dujing:coll:highlights') || '{}')).sort((a,b)=>a.verseId.localeCompare(b.verseId)||a.start-b.start)"

SELECT = """([v1, i1, v2, i2, c1, c2]) => {
  // select from character c1 of token i1 in verse v1 to character c2 of token i2 in verse v2 (base text nodes, not pinyin)
  const tok = (v, i) => document.querySelectorAll(`.verse[data-id="${v}"] .w`)[i];
  const textNodes = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('rt') ? 2 : 1 }); const out = []; while (w.nextNode()) out.push(w.currentNode); return out; };
  const a = textNodes(tok(v1, i1)), b = textNodes(tok(v2, i2));
  const r = document.createRange();
  r.setStart(a[Math.min(c1, a.length - 1)], c1 >= a.length ? 1 : 0);
  const bn = b[Math.min(c2, b.length - 1)]; r.setEnd(bn, Math.min(1, bn.length));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.querySelector('.flow').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page(); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(f"{BASE}#read-JHN-3"); await page.wait_for_selector(".verse")
        check(not await page.is_visible(".hltool"), "palette is not shown until text is selected")
        # select inside 神爱世人 … (3:16), starting halfway through a word -> snaps to whole words
        _, i_shen = await word_el(page, "JHN.3.16", "爱")
        _, i_shi = await word_el(page, "JHN.3.16", "世人")
        await page.evaluate(SELECT, ["JHN.3.16", i_shen, "JHN.3.16", i_shi, 0, 0]); await page.wait_for_timeout(200)
        check(await page.is_visible(".hltool") and await page.locator(".hltool .hl-swatch").count() == 6, "desktop: selecting text shows a toolbar with six colours")
        check(not await page.is_visible(".hltool__remove"), "no Remove button when nothing is highlighted yet")
        check(not await page.is_visible(".wordpop.is-pinned"), "selecting does not open the dictionary")
        await page.click('.hltool .hl-swatch[data-color="yellow"]'); await page.wait_for_timeout(150)
        recs = await page.evaluate(HL)
        check(len(recs) == 1 and recs[0]["text"] == "爱世人" and recs[0]["color"] == "yellow" and recs[0]["verseId"] == "JHN.3.16"
              and recs[0]["book"] == "JHN" and recs[0]["chapter"] == 3 and recs[0]["verse"] == 16, f"stored with book, chapter, verse, position and text: {recs and recs[0]['text']}")
        cls = await page.evaluate("[...document.querySelectorAll('.verse[data-id=\"JHN.3.16\"] .hl-yellow')].map(e=>e.textContent.replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü ]/g,'')).join('')")
        check(cls == "爱世人", f"highlight painted on whole words ({cls})")
        check(not await page.is_visible(".hltool"), "toolbar closes after choosing a colour")
        # multi-verse selection 3:16 -> 3:17
        _, i_a = await word_el(page, "JHN.3.16", "叫")
        _, i_b = await word_el(page, "JHN.3.17", "定")
        await page.evaluate(SELECT, ["JHN.3.16", i_a, "JHN.3.17", i_b, 0, 0]); await page.wait_for_timeout(200)
        await page.click('.hltool .hl-swatch[data-color="green"]'); await page.wait_for_timeout(150)
        recs = await page.evaluate(HL)
        g = [r for r in recs if r["color"] == "green"]
        check(len(g) == 2 and g[0]["groupId"] and g[0]["groupId"] == g[1]["groupId"] and {r["verseId"] for r in g} == {"JHN.3.16", "JHN.3.17"}, "selection across two verses: one highlight per verse, linked")
        check(not any(r["text"].startswith(("，", "。")) or r["text"].endswith(("，", "：")) for r in recs), "highlights don't start or end on punctuation")
        # popover on a highlighted word: recolour + remove
        w, _ = await word_el(page, "JHN.3.16", "世人")
        await w.click(); await page.wait_for_selector(".wordpop__hl")
        check(await page.get_attribute('.wordpop__hl .hl-swatch[data-color="yellow"]', "aria-pressed") == "true", "word popover shows the word's highlight colour")
        check("世人" in await page.inner_text(".wordpop__word") and await page.is_visible(".wordpop__save"), "dictionary popover still works on a highlighted word")
        await page.click('.wordpop__hl .hl-swatch[data-color="purple"]'); await page.wait_for_timeout(150)
        recs = await page.evaluate(HL)
        check(any(r["text"] == "爱世人" and r["color"] == "purple" for r in recs), "change colour from the popover")
        await page.click(".wordpop__hl .hl-remove"); await page.wait_for_timeout(150)
        recs = await page.evaluate(HL)
        check(not any(r["text"] == "爱世人" for r in recs), "remove a highlight from the popover")
        await page.keyboard.press("Escape")
        # select over an existing highlight -> Remove appears; partial remove keeps the rest
        _, i_c = await word_el(page, "JHN.3.17", "神")
        await page.evaluate(SELECT, ["JHN.3.17", i_c, "JHN.3.17", i_c, 0, 0]); await page.wait_for_timeout(200)
        check(await page.is_visible(".hltool__remove"), "Remove appears when the selection overlaps a highlight")
        await page.click(".hltool__remove"); await page.wait_for_timeout(150)
        recs = await page.evaluate(HL)
        t17 = [r for r in recs if r["verseId"] == "JHN.3.17"]
        check(t17 and all("神" not in r["text"][:1] for r in t17) and len(t17) >= 1, f"removing part of a highlight keeps the rest ({[r['text'] for r in t17]})")
        # highlight a single word by tapping it
        w, _ = await word_el(page, "JHN.3.3", "重生")
        await w.click(); await page.click('.wordpop__hl .hl-swatch[data-color="pink"]'); await page.keyboard.press("Escape"); await page.wait_for_timeout(100)
        check(any(r["text"] == "重生" and r["color"] == "pink" for r in await page.evaluate(HL)), "tap a word → highlight it from the popover")
        # verse via the English reveal
        await page.click('.verse[data-id="JHN.3.1"] .vnum'); await page.wait_for_selector('.reveal[data-reveal="JHN.3.1"]')
        await page.click('.reveal[data-reveal="JHN.3.1"] .reveal__hl .linkish')
        await page.click('.reveal[data-reveal="JHN.3.1"] .hl-swatch[data-color="blue"]'); await page.wait_for_timeout(150)
        v1 = [r for r in await page.evaluate(HL) if r["verseId"] == "JHN.3.1"]
        check(v1 and v1[0]["color"] == "blue" and v1[0]["text"].startswith("有一个法利赛人"), "highlight a whole verse from its English panel")
        reveal_ok = await page.is_visible('.reveal[data-reveal="JHN.3.1"]')
        check(reveal_ok, "English reveal still open after highlighting")
        # audio: playing verse marked with an underline, highlight colour still visible
        await page.click(".listen-btn"); await page.wait_for_timeout(800)
        await page.evaluate("document.querySelector('.verse[data-id=\"JHN.3.16\"] .vnum').click()"); await page.wait_for_timeout(900)
        styles = await page.evaluate("""() => { const v = document.querySelector('.verse.is-playing'); if (!v) return null;
          const hl = v.querySelector('.hl'); return { id: v.dataset.id, bg: getComputedStyle(v).backgroundImage, hl: hl && getComputedStyle(hl).backgroundColor }; }""")
        check(styles and styles["id"] == "JHN.3.16" and "linear-gradient" in styles["bg"] and styles["hl"] and styles["hl"] != "rgba(0, 0, 0, 0)",
              f"audio and highlights coexist: playing verse underlined, highlight colour visible ({styles})")
        await page.screenshot(path="build/shot-hl-desktop.png", clip={"x": 0, "y": 0, "width": 1280, "height": 900})
        # persistence across reload and chapters
        before = await page.evaluate(HL)
        await page.goto(f"{BASE}#read-JHN-1"); await page.wait_for_selector(".verse")
        await page.reload(); await page.goto(f"{BASE}#read-JHN-3"); await page.wait_for_selector(".verse")
        after = await page.evaluate(HL); painted = await page.evaluate("document.querySelectorAll('.flow .hl').length")
        check(after == before and painted > 0, f"highlights survive reload and changing chapter ({len(after)} records, {painted} painted words)")

        # notebook list
        await page.goto(f"{BASE}#notebook"); await page.wait_for_selector(".ledger")
        nb = await page.inner_text(".ledger >> nth=-1"); check("Highlights" in nb and f"{len(after)} passage" in nb.lower(), f"Library notebook counts highlights ({nb[-160:]!r})")
        await page.goto(f"{BASE}#highlights"); await page.wait_for_selector(".hl-row")
        rows = await page.locator(".hl-row").count()
        check(rows == len(after), f"Highlights page lists every highlight ({rows})")
        await page.click(".hl-row__text >> nth=0"); await page.wait_for_selector(".verse")
        check("#read-JHN-3-" in page.url, "a highlight links back to its verse")
        # word pronunciation from the popover
        w, _ = await word_el(page, "JHN.3.16", "世人"); await w.click(); await page.wait_for_selector(".wordpop__speak")
        await page.click(".wordpop__speak"); await page.wait_for_timeout(700)
        wa = await page.evaluate("(() => { const a = globalThis.__dujingWordAudio && globalThis.__dujingWordAudio.el; return a ? { src: a.src, t: a.currentTime } : null; })()")
        check(wa and wa["src"].startswith("blob:") and wa["t"] > 0, f"word pronunciation plays from the popover ({wa})")

        # ---- mobile
        m = await b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        mp = await m.new_page(); await mp.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await mp.goto(f"{BASE}#read-JHN-1"); await mp.wait_for_selector(".verse")
        w, _ = await word_el(mp, "JHN.1.4", "光"); await w.tap(); await mp.wait_for_selector(".wordpop__hl")
        sw = await mp.locator('.wordpop__hl .hl-swatch').first.bounding_box()
        check(sw and sw["width"] >= 28, f"mobile: popover colours are finger-sized ({sw and sw['width']})")
        await mp.locator('.wordpop__hl .hl-swatch[data-color="orange"]').tap(); await mp.wait_for_timeout(150)
        check(any(r["text"] == "光" and r["color"] == "orange" for r in await mp.evaluate(HL)), "mobile: tap a word → highlight")
        _, i1 = await word_el(mp, "JHN.1.5", "光"); _, i2 = await word_el(mp, "JHN.1.5", "黑暗")
        await mp.evaluate(SELECT.replace("new MouseEvent('mouseup', { bubbles: true })", "new Event('selectionchange')"), ["JHN.1.5", i1, "JHN.1.5", i2, 0, 0])
        await mp.evaluate("document.dispatchEvent(new Event('selectionchange'))"); await mp.wait_for_timeout(600)
        tb = await mp.locator(".hltool").bounding_box()
        check(tb and tb["x"] >= 0 and tb["x"] + tb["width"] <= 390, "mobile: long-press selection shows the toolbar on screen")
        await mp.locator('.hltool .hl-swatch[data-color="blue"]').tap(); await mp.wait_for_timeout(150)
        check(any(r["verseId"] == "JHN.1.5" and r["color"] == "blue" for r in await mp.evaluate(HL)), "mobile: highlight a selection")
        await mp.screenshot(path="build/shot-hl-mobile.png")
        check(not errs, f"no page errors {errs}")
        await b.close()
    for x in passed: print("ok  ", x)
    for x in fails: print("FAIL", x)
    print(f"{len(passed)} passed, {len(fails)} failed")
asyncio.run(main())
