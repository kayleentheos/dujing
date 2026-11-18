"""Acceptance tests: immersive reader + vocabulary workflow.
Static server on :8765 serving public/."""
import os, asyncio, json, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8765/index.html"
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
cuv = json.load(open(f"{ROOT}/translations/cuv/JHN.json", encoding="utf-8"))
web = json.load(open(f"{ROOT}/translations/web/JHN.json", encoding="utf-8"))
lex = json.load(open(f"{ROOT}/lexicon/JHN.json", encoding="utf-8"))["entries"]
fails, passed = [], []
def check(cond, msg):
    (passed if cond else fails).append(msg)

VERSE_TEXT = """(sel) => [...document.querySelectorAll(sel)].map(el => {
  const c = el.cloneNode(true);
  c.querySelectorAll('.vnum, .fn, rt, .footnotes').forEach(x => x.remove());
  return [el.dataset.id, c.textContent];
})"""
REVEAL_TEXT = """() => [...document.querySelectorAll('.reveal')].map(r => [r.dataset.reveal,
  [...r.querySelectorAll(':scope > span[lang=en]')].map(s => s.textContent).join(' ')])"""
vocab_js = "() => Object.values(JSON.parse(localStorage.getItem('dujing:coll:vocab') || '{}'))"

async def word_el(page, verse, word):
    """the token element for `word` in `verse`"""
    idx = await page.evaluate("""([v, w]) => {
      const els = [...document.querySelectorAll(`.verse[data-id="${v}"] .w`)];
      return els.findIndex(e => e.cloneNode(true).textContent.replace(/[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü ]/g,'') === w);
    }""", [verse, word])
    return page.locator(f'.verse[data-id="{verse}"] .w').nth(idx), idx

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())

        # ===== A. text fidelity, all chapters: Chinese by default, English only on demand
        for c in range(1, 22):
            await page.goto(f"{BASE}#read-JHN-{c}"); await page.wait_for_selector(".verse")
            zh_src = {v["id"]: v["text"] for v in cuv["chapters"][str(c)]}
            zh = dict(await page.evaluate(VERSE_TEXT, ".zh-text .verse[data-id]"))
            ok = set(zh) == set(zh_src) and all(zh[k].replace(" ", "") == zh_src[k].replace(" ", "") for k in zh_src)
            check(ok, f"ch{c}: all CUV verses rendered verbatim ({len(zh)}/{len(zh_src)})")
            en_visible = await page.evaluate("document.querySelectorAll('.reveal').length")
            check(en_visible == 0, f"ch{c}: no English visible by default")
            n_tok = await page.evaluate("document.querySelectorAll('.w.is-tappable').length")
            check(n_tok > 100, f"ch{c}: words are individually interactive ({n_tok})")
            await page.click(".reveal-all"); await page.wait_for_timeout(80)
            rev = dict(await page.evaluate(REVEAL_TEXT))
            en_src = {}
            for v in web["chapters"][str(c)]: en_src[v["id"]] = v["text"]
            joined = " ".join(rev.values())
            missing = [k for k, t in en_src.items() if " ".join(t.split()) not in " ".join(joined.split())]
            check(not missing, f"ch{c}: Reveal all shows every WEB verse verbatim (missing {missing[:3]})")
            label = await page.inner_text(".reveal-all")
            check("Hide all" in label, f"ch{c}: button becomes Hide all English")
            await page.click(".reveal-all"); await page.wait_for_timeout(50)
            check(await page.evaluate("document.querySelectorAll('.reveal').length") == 0, f"ch{c}: Hide all English")

        # ===== B. verse tap reveal: two at once, toggle off
        await page.goto(f"{BASE}#read-JHN-3"); await page.wait_for_selector(".verse")
        await page.click('.vnum[data-verse="JHN.3.16"]'); await page.click('.vnum[data-verse="JHN.3.17"]')
        rev = dict(await page.evaluate(REVEAL_TEXT))
        check("JHN.3.16" in rev and "God so loved the world" in rev["JHN.3.16"] and "JHN.3.17" in rev, "verse taps reveal the exact verses (3:16, 3:17 together)")
        await page.click('.vnum[data-verse="JHN.3.16"]')
        rev = dict(await page.evaluate(REVEAL_TEXT))
        check("JHN.3.16" not in rev and "JHN.3.17" in rev, "second tap hides 3:16, 3:17 stays")
        # word tap must NOT reveal the verse
        w, _ = await word_el(page, "JHN.3.18", "信")
        await w.click(); await page.wait_for_timeout(150)
        check("JHN.3.18" not in dict(await page.evaluate(REVEAL_TEXT)), "word tap and verse translation are separate")
        await page.keyboard.press("Escape")

        # ===== C. the 10-step workflow
        # 1-2 open John 1, tap 生命 in 1:4
        await page.goto(f"{BASE}#read-JHN-1"); await page.wait_for_selector(".verse")
        w, _ = await word_el(page, "JHN.1.4", "生命")
        await w.hover(); await page.wait_for_timeout(800)
        check(not await page.is_visible(".wordpop"), "desktop: hovering a word shows nothing")
        await page.mouse.move(400, 300); await page.mouse.move(700, 500); await page.wait_for_timeout(500)
        check(not await page.is_visible(".wordpop") and not await page.is_visible(".reveal"), "moving the cursor across the text reveals nothing")
        bg = await w.evaluate("e => getComputedStyle(e).backgroundColor")
        check(bg in ("rgba(0, 0, 0, 0)", "transparent"), f"no hover tint on words ({bg})")
        other, _ = await word_el(page, "JHN.1.4", "光")
        await other.click(); await page.wait_for_timeout(100)
        check("光" in await page.inner_text(".wordpop__word"), "click opens the dictionary")
        await page.mouse.click(30, 600); await page.wait_for_timeout(100)
        check(not await page.is_visible(".wordpop"), "clicking outside closes it")
        await other.click(); await page.keyboard.press("Escape"); await page.wait_for_timeout(100)
        check(not await page.is_visible(".wordpop"), "Escape closes it")
        await other.click(); await page.wait_for_timeout(100)
        await w.click(); await page.wait_for_timeout(100)
        # 3 correct dictionary info
        pop = await page.inner_text(".wordpop")
        e = lex["生命|shēng mìng"]
        check("生命" in pop and "shēng mìng" in pop and "life" in pop and "noun" in pop, f"popover shows word, pinyin, definition, part of speech")
        check("1:4" in pop and ("matches" in pop or "Study note" in pop.title() or "STUDY NOTE" in pop.upper()), "popover shows meaning in this verse")
        # 4 save
        await page.click(".wordpop__save"); await page.wait_for_timeout(200)
        toast = await page.inner_text(".toast")
        check("Saved 生命" in toast, f"confirmation shown: {toast}")
        recs = await page.evaluate(vocab_js)
        r = next((x for x in recs if x["word"] == "生命"), None)
        check(r and r["pinyin"] == "shēng mìng" and "life" in r["definition"] and r["pos"] == "noun", "record keeps word, pinyin, definition, part of speech")
        ref = r["refs"][0] if r else {}
        check(ref.get("verseId") == "JHN.1.4" and ref.get("book") == "JHN" and ref.get("chapter") == 1 and ref.get("verse") == 4
              and ref.get("zh") == "生命在他里头，这生命就是人的光。" and ref.get("en") == "In him was life, and the life was the light of men."
              and ref.get("addedAt") and ref.get("contextual"), "record keeps book, chapter, verse, Chinese verse, English verse, date, contextual meaning")
        tinted = await page.evaluate("document.querySelectorAll('.verse[data-id=\"JHN.1.4\"] .w.is-saved').length")
        check(tinted == 2, f"saved word is tinted in the text (both 生命 in 1:4: {tinted})")
        # duplicate prevention: save again from the same verse
        await page.keyboard.press("Escape")
        w2, _ = await word_el(page, "JHN.1.4", "生命")
        await w2.click(); await page.wait_for_timeout(100)
        btn = await page.inner_text(".wordpop__save")
        check("In your vocabulary" in btn, "already-saved word shows 'In your vocabulary', not a second Add")
        await page.keyboard.press("Escape")
        # 5 navigate away; 6 open vocabulary; 7 still there
        await page.goto(f"{BASE}#home"); await page.wait_for_selector(".continue__book")
        await page.reload(); await page.wait_for_selector(".continue__book")
        await page.click('.appnav__item[data-id="notebook"]'); await page.click('a.ledger__item[href="#vocab"]'); await page.wait_for_selector(".vocab-entry")
        entries = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(entries == ["生命"], f"Vocabulary lists the word after leaving and reloading: {entries}")
        txt = await page.inner_text(".vocab-entry")
        check("shēng mìng" in txt and "life" in txt and "约翰福音 1:4" in txt and "生命在他里头" in txt, "entry shows characters, pinyin, definition, reference, verse")

        # multiple verses: save 生命 from 5:26 -> one entry, two refs
        await page.goto(f"{BASE}#read-JHN-5"); await page.wait_for_selector(".verse")
        w, _ = await word_el(page, "JHN.5.26", "生命")
        await w.click(); await page.wait_for_timeout(100)
        btn = await page.inner_text(".wordpop__save")
        check("Add 5:26" in btn, f"saved word from a new verse offers to attach it: {btn}")
        await page.click(".wordpop__save"); await page.wait_for_timeout(200)
        recs = await page.evaluate(vocab_js)
        sm = [x for x in recs if x["word"] == "生命"]
        check(len(sm) == 1 and [r_["verseId"] for r_ in sm[0]["refs"]] == ["JHN.1.4", "JHN.5.26"], f"one entry with two verse references: {[ [r_['verseId'] for r_ in x['refs']] for x in sm]}")
        await page.keyboard.press("Escape")

        # word page: every verse, links back
        await page.goto(f"{BASE}#vocab"); await page.wait_for_selector(".vocab-entry")
        await page.click(".vocab-entry__word"); await page.wait_for_selector(".word-verse")
        verses = await page.evaluate("[...document.querySelectorAll('.word-verse__ref')].map(a=>a.getAttribute('href'))")
        check(verses == ["#read-JHN-1-4", "#read-JHN-5-26"], f"word page lists every verse with links: {verses}")
        both = await page.inner_text(".word-verses")
        check("In him was life" in both and "For as the Father has life in himself" in both, "word page shows Chinese and English of each verse")
        # vocabulary -> verse
        await page.click(".word-verse__ref >> nth=0"); await page.wait_for_timeout(700)
        check(page.url.endswith("#read-JHN-1-4"), f"tapping a reference returns to John 1:4 ({page.url})")
        found = await page.evaluate("document.querySelectorAll('.verse[data-id=\"JHN.1.4\"] .w.is-found').length")
        check(found == 2, f"the word is highlighted in the verse ({found})")

        # 8-9 flashcards (spaced-repetition session with progressive reveal)
        await page.goto(f"{BASE}#study-session"); await page.wait_for_selector(".scard")
        front = await page.inner_text(".scard")
        check("生命" in front and "shēng" not in front and "life" not in front, "card front: word only, no answer")
        for _ in range(3): await page.click(".scard__word"); await page.wait_for_timeout(60)
        back = await page.inner_text(".scard")
        check("shēng mìng" in back and "life" in back and "noun" in back and "生命在他里头" in back and "In him was life" in back and "1:4" in back,
              "card fully revealed: pinyin, definition, part of speech, verse and reference")
        await page.click(".ans--got"); await page.wait_for_timeout(400)
        check("study-summary" in page.url, "session ends with a summary")
        # 10 back to the Bible: still saved
        await page.goto(f"{BASE}#read-JHN-1"); await page.wait_for_selector(".verse")
        tinted = await page.evaluate("document.querySelectorAll('.verse[data-id=\"JHN.1.4\"] .w.is-saved').length")
        check(tinted == 2, "returning to the Bible: word still saved and marked")

        # second word + prev/next + search/sort/filter
        w, _ = await word_el(page, "JHN.1.14", "恩典")
        await w.click(); await page.click(".wordpop__save"); await page.keyboard.press("Escape")
        await page.goto(f"{BASE}#vocab"); await page.wait_for_selector(".vocab-entry")
        await page.click('.vtab[data-tab="notStudied"]'); await page.wait_for_timeout(100)
        ns = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(ns == ["恩典"], f"Not studied tab shows only the unstudied word ({ns})")
        await page.click('.vtab[data-tab="all"]'); await page.wait_for_timeout(100)
        await page.goto(f"{BASE}#vocab"); await page.wait_for_selector(".vocab-entry")
        await page.fill(".vocab-search input", "grace"); await page.wait_for_timeout(250)
        res = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(res == ["恩典"], f"search by English meaning: {res}")
        await page.fill(".vocab-search input", "shengming"); await page.wait_for_timeout(250)
        res = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(res == ["生命"], f"search by pinyin without tones: {res}")
        await page.fill(".vocab-search input", "生命"); await page.wait_for_timeout(250)
        res = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(res == ["生命"], f"search by characters: {res}")
        await page.fill(".vocab-search input", ""); await page.wait_for_timeout(250)
        await page.select_option(".vocab-selects select >> nth=0", "pinyin"); await page.wait_for_timeout(100)
        res = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(res == ["恩典", "生命"], f"alphabetical (pinyin) sort: {res}")
        await page.select_option(".vocab-selects select >> nth=0", "recent"); await page.wait_for_timeout(100)
        res = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(res == ["恩典", "生命"], f"recently-added sort: {res}")
        opts = await page.evaluate("[...document.querySelectorAll('.vocab-selects select')[1].options].map(o=>o.value)")
        check(opts == ["all", "JHN"], f"book filter lists books with saved words: {opts}")

        # removal + undo + removal sticks
        await page.click(".vocab-entry:has-text('恩典') >> text=Remove"); await page.wait_for_timeout(200)
        res = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(res == ["生命"], f"remove a word: {res}")
        await page.click(".undo >> text=Undo"); await page.wait_for_timeout(200)
        res = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(sorted(res) == ["恩典", "生命"], f"undo removal: {res}")
        await page.click(".vocab-entry:has-text('恩典') >> text=Remove"); await page.wait_for_timeout(200)
        await page.reload(); await page.wait_for_selector(".vocab-entry")
        res = await page.evaluate("[...document.querySelectorAll('.vocab-entry__word')].map(e=>e.textContent)")
        check(res == ["生命"], f"removal persists after reload: {res}")
        await page.goto(f"{BASE}#read-JHN-1"); await page.wait_for_selector(".verse")
        t = await page.evaluate("document.querySelectorAll('.verse[data-id=\"JHN.1.14\"] .w.is-saved').length")
        check(t == 0, "removed word is no longer tinted in the text")

        # every word in John has a dictionary record (no missing lookups)
        missing = await page.evaluate("""async () => {
          const ann = await (await fetch('data/annotations/cuv/JHN.json')).json();
          const lex = await (await fetch('data/lexicon/JHN.json')).json();
          const miss = [];
          for (const toks of Object.values(ann.verses)) for (const t of toks)
            if (Array.isArray(t) && /[\\u4e00-\\u9fff]/.test(t[0]) && !lex.entries[t[0]+'|'+t[1]]) miss.push(t[0]);
          return miss; }""")
        check(not missing, f"every word token has a dictionary record ({len(missing)} missing)")
        # 太初有道 segmentation
        seg = await page.evaluate("[...document.querySelectorAll('.verse[data-id=\"JHN.1.1\"] .w')].slice(0,3).map(w=>{const c=w.cloneNode(true);c.querySelectorAll('rt').forEach(r=>r.remove());return c.textContent})")
        check(seg == ["太初", "有", "道"], f"太初有道 segmented in context: {seg}")

        # ===== D. mobile: tap opens, tap outside closes, popover fits, no overflow
        m = await b.new_context(viewport={"width": 375, "height": 740}, is_mobile=True, has_touch=True)
        mp = await m.new_page(); await mp.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        mp.on("pageerror", lambda e: errors.append("mobile: " + str(e)))
        await mp.goto(f"{BASE}#read-JHN-1"); await mp.wait_for_selector(".verse")
        w, _ = await word_el(mp, "JHN.1.12", "权柄")
        await w.tap(); await mp.wait_for_timeout(250)
        box = await mp.evaluate("(() => { const r = document.querySelector('.wordpop').getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom, r.height]; })()")
        check(box[0] >= 0 and box[1] <= 375 and box[4] <= 740 * 0.6, f"mobile popover fits and leaves the page visible {box}")
        await mp.locator(".wordpop__save").tap(); await mp.wait_for_timeout(200)
        recs = await mp.evaluate(vocab_js)
        check(any(x["word"] == "权柄" for x in recs), "mobile: Add to Vocabulary works by tap")
        box = await mp.evaluate("(() => { const r = document.querySelector('.wordpop').getBoundingClientRect(); return [r.top, r.bottom]; })()")
        y = box[0] - 30 if box[0] > 120 else box[1] + 30          # a point clearly outside the popover
        await mp.touchscreen.tap(6, y); await mp.wait_for_timeout(250)
        check(not await mp.is_visible(".wordpop"), "mobile: tap outside closes the popover")
        await mp.locator('.vnum[data-verse="JHN.1.12"]').tap(); await mp.wait_for_timeout(150)
        check(await mp.evaluate("!!document.querySelector('.reveal[data-reveal=\"JHN.1.12\"]')"), "mobile: verse-number tap reveals English")
        for route in ("#read-JHN-6", "#vocab", "#study-session", "#home"):
            await mp.goto(BASE + route); await mp.wait_for_timeout(500)
            ow = await mp.evaluate("document.documentElement.scrollWidth - innerWidth")
            check(ow <= 0, f"mobile {route}: no horizontal overflow ({ow})")

        check(not errors, f"no script errors {errors[:3]}")
        await b.close()
    print(f"{len(passed)} passed, {len(fails)} failed")
    for f in fails: print(" FAIL -", f)
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    asyncio.run(main())
