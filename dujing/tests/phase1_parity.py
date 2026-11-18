"""Phase 1: the new Next.js reader renders the same Chinese text, words, pinyin and
verse numbers as the current app, for all 21 chapters, on desktop and phone."""
import asyncio
from playwright.async_api import async_playwright
OLD = "http://127.0.0.1:8765/index.html#read-JHN-{}"
NEW = "http://127.0.0.1:3100/read/JHN/{}"
SIG = """() => [...document.querySelectorAll('.flow .verse[data-id]')].map(v => ({
  id: v.dataset.id,
  text: [...v.querySelectorAll('[data-o]')].map(t => { const c = t.cloneNode(true); c.querySelectorAll('rt').forEach(r => r.remove()); return c.textContent; }).join(''),
  words: [...v.querySelectorAll('.w')].map(w => [w.dataset.o, w.dataset.n, [...w.querySelectorAll('rt')].map(r => r.textContent).join(' '), w.classList.contains('is-hard')]),
  num: v.querySelector('.vnum').textContent }))"""
async def main():
    ok, bad = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        page = await b.new_page(); await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        same = 0; verses = 0
        for ch in range(1, 22):
            await page.goto(OLD.format(ch)); await page.wait_for_selector(".flow .verse"); old = await page.evaluate(SIG)
            await page.goto(NEW.format(ch)); await page.wait_for_selector(".flow .verse"); new = await page.evaluate(SIG)
            verses += len(new)
            if old == new: same += 1
            else: bad.append(f"chapter {ch} differs")
        (ok if same == 21 else bad).append(f"all 21 chapters identical to the current app: text, word boundaries, pinyin, hard-word marks, verse numbers ({verses} verses)")
        hidden = await page.evaluate("[...document.querySelectorAll('.w:not(.is-hard) rt')].every(r => getComputedStyle(r).display === 'none')")
        (ok if hidden else bad).append("pinyin shown only over harder words (default setting)")
        en = await page.evaluate("document.querySelectorAll('[lang=en].verse, .reveal').length")
        (ok if en == 0 else bad).append("Chinese-only by default: no English on the page")
        await page.set_viewport_size({"width": 1280, "height": 900}); await page.goto(NEW.format(3)); await page.wait_for_timeout(300)
        await page.screenshot(path="/home/claude/dujing/tests/shot-new-desktop.png")
        await page.goto(OLD.format(3)); await page.wait_for_selector(".flow .verse"); await page.wait_for_timeout(300)
        await page.screenshot(path="/home/claude/dujing/tests/shot-old-desktop.png")
        m = await b.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); await m.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await m.goto(NEW.format(3)); await m.wait_for_timeout(300)
        w = await m.evaluate("document.documentElement.scrollWidth")
        (ok if w <= 390 else bad).append(f"phone: no sideways scrolling ({w}px)")
        await m.screenshot(path="/home/claude/dujing/tests/shot-new-mobile.png")
        await m.goto("http://127.0.0.1:3100/"); n = await m.locator(".p1-chapters a").count()
        (ok if n == 21 else bad).append(f"home lists John's 21 chapters ({n})")
        await b.close()
    for x in ok: print("ok  ", x)
    for x in bad: print("FAIL", x)
    print(f"{len(ok)} passed, {len(bad)} failed")
asyncio.run(main())
