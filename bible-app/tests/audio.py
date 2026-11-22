"""Audio acceptance tests on the real generated audio of John 1.
Static server on :8765 serving public/."""
import os, asyncio, json, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8765/index.html"
man = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public/data/audio/azure-yunyang/manifest.json"), encoding="utf-8"))
chap1 = man["chapters"]["JHN.1"]
ch1 = {k: {"duration": e - s} for k, (s, e) in chap1["timings"].items()}
fails, passed = [], []
def check(c, m): (passed if c else fails).append(m)

SNAP = "(() => { const s = window.__dujingAudio.snapshot(); return { id: s.segment && s.segment.verseId, playing: s.playing, t: s.time, rate: window.__dujingAudio.audio.playbackRate, idx: s.index, mode: s.mode, hl: [...document.querySelectorAll('.verse.is-playing')].map(e => e.dataset.id), ref: document.querySelector('.abar__ref')?.textContent }; })()"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width": 1280, "height": 860})
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())

        # every clip exists, decodes, and its real length matches the manifest
        res = await page.goto(f"{BASE}#read-JHN-1"); await page.wait_for_selector(".verse")
        total = await page.evaluate("""async (f) => {
          const buf = await (await fetch('data/audio/azure-yunyang/' + f)).arrayBuffer();
          return (await new OfflineAudioContext(1, 1, 24000).decodeAudioData(buf)).duration; }""", chap1["file"])
        last_end = max(e for s_, e in chap1["timings"].values())
        gaps = [k for (k, v), (k2, v2) in zip(list(chap1["timings"].items()), list(chap1["timings"].items())[1:]) if abs(v[1] - v2[0]) > 0.001]
        check(abs(total - last_end) < 0.12 and not gaps, f"chapter file decodes ({total:.2f}s) and verse timings tile it exactly ({last_end:.2f}s, gaps {gaps[:3]})")
        check(list(ch1) == [f"JHN.1.{i}" for i in range(1, 52)], "one clip per verse, in verse order, none missing")

        # availability: John 1 has audio, John 2 not (button disabled, honest)
        check(not await page.evaluate("document.querySelector('.listen-btn').classList.contains('is-unavailable')"), "John 1: Listen available")
        missing = [c for c in range(1, 22) if f"JHN.{c}" not in man["chapters"]]
        if missing:
            await page.goto(f"{BASE}#read-JHN-{missing[0]}"); await page.wait_for_selector(".verse")
            await page.click(".listen-btn"); await page.wait_for_timeout(400)
            msg = await page.inner_text(".toast")
            check("Audio is ready" in msg and not await page.is_visible(".abar"), f"John {missing[0]}: Listen explains which chapters have audio ({msg})")

        # start listening
        await page.goto(f"{BASE}#read-JHN-1"); await page.wait_for_selector(".verse")
        await page.click(".listen-btn"); await page.wait_for_timeout(900)
        s = await page.evaluate(SNAP)
        check(s["playing"] and s["id"] == "JHN.1.1" and s["hl"] == ["JHN.1.1"], f"plays from 1:1 and highlights it {s}")
        check("1:1" in (s["ref"] or ""), f"bar shows the reference {s['ref']}")

        # synchronisation: sample for ~9 s, highlight must always equal the playing verse
        mism, seen = 0, []
        for _ in range(18):
            await page.wait_for_timeout(500)
            s = await page.evaluate(SNAP)
            if s["hl"] != [s["id"]]: mism += 1
            if s["id"] not in seen: seen.append(s["id"])
        check(mism == 0 and len(seen) >= 3, f"highlight follows the audio verse by verse (seen {seen}, mismatches {mism})")

        # pause keeps highlight; resume continues from the same point
        stable = await page.evaluate("""(async () => { const b = document.querySelector('.abar__play'); const a = b.firstElementChild;
          await new Promise(r => setTimeout(r, 600)); return window.__dujingAudio.snapshot().playing && b.firstElementChild === a; })()""")
        check(stable, "while playing, the pause button is not redrawn (a tap on a phone isn't lost)")
        await page.click(".abar__play"); await page.wait_for_timeout(300)
        a = await page.evaluate(SNAP); await page.wait_for_timeout(800); a2 = await page.evaluate(SNAP)
        check(not a["playing"] and a["hl"] == [a["id"]] and abs(a2["t"] - a["t"]) < 0.01, f"pause freezes time and keeps the highlight {a['id']}")
        await page.click(".abar__play"); await page.wait_for_timeout(600)
        r = await page.evaluate(SNAP)
        check(r["playing"] and r["id"] == a["id"] and r["t"] > a["t"], f"resume continues from the paused position ({a['t']:.2f} -> {r['t']:.2f})")

        # next / previous / replay
        await page.click('button[aria-label="Next verse"]'); await page.wait_for_timeout(500)
        n = await page.evaluate(SNAP)
        check(n["idx"] == r["idx"] + 1 and n["hl"] == [n["id"]], f"next verse ({r['id']} -> {n['id']})")
        await page.wait_for_timeout(1600)
        await page.click('button[aria-label="Replay this verse"]'); await page.wait_for_timeout(300)
        rp = await page.evaluate(SNAP)
        check(rp["id"] == n["id"] and rp["t"] < 0.6, f"replay restarts the verse (t={rp['t']:.2f})")
        await page.click('button[aria-label="Previous verse"]'); await page.wait_for_timeout(400)
        pv = await page.evaluate(SNAP)
        check(pv["idx"] == n["idx"] - 1, f"previous verse ({n['id']} -> {pv['id']})")

        # speeds
        rates = []
        for _ in range(5):
            await page.click(".abar__rate"); await page.wait_for_timeout(100)
            rates.append((await page.evaluate(SNAP))["rate"])
        check(sorted(set(rates)) == [0.5, 0.75, 1, 1.25, 1.5], f"speeds 0.5/0.75/1/1.25/1.5 ({rates})")
        while (await page.evaluate(SNAP))["rate"] != 1:
            await page.click(".abar__rate")

        # tap a verse number while listening -> plays from that verse
        await page.click('.vnum[data-verse="JHN.1.29"]'); await page.wait_for_timeout(700)
        s = await page.evaluate(SNAP)
        check(s["id"] == "JHN.1.29" and s["playing"] and s["hl"] == ["JHN.1.29"], f"tap 1:29 plays from it {s['id']}")
        vis = await page.evaluate("(() => { const r = document.querySelector('.verse.is-playing').getBoundingClientRect(); return r.top > 40 && r.bottom < innerHeight; })()")
        check(vis, "the verse being read is scrolled into view")

        # follow-along English
        await page.click(".abar__en"); await page.wait_for_timeout(400)
        rev = await page.evaluate("[...document.querySelectorAll('.reveal')].map(r => r.dataset.reveal)")
        check(rev == ["JHN.1.29"], f"follow-along English shows the verse being read {rev}")
        await page.click(".abar__en"); await page.wait_for_timeout(200)

        # word lookup while listening, then play that verse from the popover
        await page.locator('.verse[data-id="JHN.1.4"] .w').first.click(); await page.wait_for_timeout(200)
        check(await page.is_visible(".wordpop"), "word dictionary still works while listening")
        await page.click(".wordpop >> text=Play verse"); await page.wait_for_timeout(700)
        s = await page.evaluate(SNAP)
        check(s["id"] == "JHN.1.4" and s["playing"], f"Play verse from the popover plays 1:4 ({s['id']})")

        # one-verse mode stops at the verse end
        await page.click(".abar__mode"); await page.click('.vnum[data-verse="JHN.1.2"]')
        await page.wait_for_timeout(int(ch1["JHN.1.2"]["duration"] * 1000) + 1200)
        s = await page.evaluate(SNAP)
        check(s["id"] == "JHN.1.2" and not s["playing"] and s["hl"] == ["JHN.1.2"], f"one-verse mode stops after 1:2 and keeps it highlighted ({s})")
        await page.click(".abar__mode")

        # whole chapter: continuous to the end (start near the end to keep the test short)
        await page.click('.vnum[data-verse="JHN.1.49"]')
        while (await page.evaluate(SNAP))["rate"] != 1.5:
            await page.click(".abar__rate")
        total = (ch1["JHN.1.49"]["duration"] + ch1["JHN.1.50"]["duration"] + ch1["JHN.1.51"]["duration"]) / 1.5
        order = []
        for _ in range(int(total * 2) + 8):
            await page.wait_for_timeout(500)
            s = await page.evaluate(SNAP)
            if s["id"] and (not order or order[-1] != s["id"]): order.append(s["id"])
            if not s["playing"]: break
        check(order == ["JHN.1.49", "JHN.1.50", "JHN.1.51"] and not s["playing"], f"chapter plays continuously to the end ({order})")
        prog = await page.evaluate("parseFloat(document.querySelector('.abar__progress i').style.width)")
        check(prog > 98, f"progress reaches the end ({prog}%)")

        # closing removes highlight; leaving the chapter stops audio
        await page.click(".abar__close"); await page.wait_for_timeout(200)
        check(await page.evaluate("document.querySelectorAll('.verse.is-playing').length") == 0 and not await page.is_visible(".abar"), "closing the player clears the highlight")
        await page.click(".listen-btn"); await page.wait_for_timeout(500)
        await page.goto(f"{BASE}#read-JHN-2"); await page.wait_for_timeout(700)
        check(await page.evaluate("window.__dujingAudio.audio.paused"), "navigating away stops the audio")

        # mobile: bar reachable, tap targets >= 44px, nothing hidden under it at the end
        m = await b.new_context(viewport={"width": 375, "height": 740}, is_mobile=True, has_touch=True)
        mp = await m.new_page(); await mp.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        await mp.goto(f"{BASE}#read-JHN-1"); await mp.wait_for_selector(".verse")
        await mp.locator(".listen-btn").tap(); await mp.wait_for_timeout(700)
        box = await mp.evaluate("(() => { const r = document.querySelector('.abar').getBoundingClientRect(); return [r.left, r.right, r.bottom, r.height, document.querySelector('.appnav').getBoundingClientRect().top]; })()")
        check(box[0] >= 0 and box[1] <= 375 and abs(box[2] - box[4]) < 2 and box[3] < 200, f"mobile bar sits just above the tab bar, compact {box}")
        small = await mp.evaluate("[...document.querySelectorAll('.abar__controls button')].filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(b => b.getAttribute('aria-label') || b.textContent)")
        check(not small, f"all player buttons are at least 44px ({small})")
        await mp.evaluate("scrollTo(0, document.body.scrollHeight)"); await mp.wait_for_timeout(300)
        cover = await mp.evaluate("(() => { const a = document.querySelector('.abar').getBoundingClientRect(); const e = document.querySelector('.attribution').getBoundingClientRect(); return e.bottom <= a.top + 1; })()")
        check(cover, "end of the chapter is not hidden under the bar")
        ow = await mp.evaluate("document.documentElement.scrollWidth - innerWidth")
        check(ow <= 0, f"no horizontal overflow on mobile ({ow})")

        check(not errors, f"no script errors {errors[:3]}")
        await b.close()
    print(f"{len(passed)} passed, {len(fails)} failed")
    for f in fails: print(" FAIL -", f)
    sys.exit(1 if fails else 0)

asyncio.run(main())
