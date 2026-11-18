#!/usr/bin/env python3
"""Import generated verse audio and check it against the text.

Input: a bundle JSON from the generator: { verseId: {mp3 (base64), duration,
       stt: {lexical, display}} }.
Writes: public/data/audio/<set>/<BOOK>/<ch>/<verseId>.mp3 and updates
        public/data/audio/<set>/manifest.json, plus tools/reports/audio_<set>_<BOOK>_<ch>.txt

The check: Azure speech-to-text transcribes each clip; the transcript's
pinyin (with tones) is aligned with the reviewed pinyin of the verse.
  exact      transcript characters = verse characters
  homophone  different characters, identical pinyin and tones (e.g. 他/它, 差/拆)
  FLAG       a syllable or tone differs, or text is missing/extra -> listen
Tone-sandhi is not a mismatch (both sides are compared in citation tones).
This cannot prove every tone is right — a recogniser may 'hear' the expected
word — so chapters stay "not-reviewed" until a Mandarin speaker signs off.

Usage: import_audio.py <bundle.json> <set> <BOOK> <chapter> <voice> <provider>
"""
import base64, difflib, json, os, re, sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.environ.get("VENDOR", "")   # optional; normally jieba/pypinyin are pip-installed (tools/requirements.txt)
sys.path[:0] = [f"{VENDOR}/python-pinyin"]
from pypinyin import pinyin, Style

bundle_path, SET, BOOK, CH, VOICE, PROVIDER = sys.argv[1:7]

STRIP = str.maketrans("āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ", "aaaaeeeeiiiioooouuuuüüüü")
def toneless(s): return s.translate(STRIP)
def neutral(s): return s == toneless(s)
def same_sound(ch, expected, heard):
    """Same syllable; tones equal, or a neutral tone on either side (the
    transcript carries no tone of its own), or the regular sandhi of 一/不."""
    if toneless(expected) != toneless(heard): return False
    if expected == heard or neutral(expected) or neutral(heard): return True
    if ch == "一" and expected in ("yī", "yí", "yì") and heard in ("yī", "yí", "yì"): return True
    if ch == "不" and {expected, heard} <= {"bù", "bú"}: return True
    return False
CH = int(CH)
bundle = json.load(open(bundle_path, encoding="utf-8"))
cuv = json.load(open(f"{ROOT}/public/data/translations/cuv/{BOOK}.json", encoding="utf-8"))
ann = json.load(open(f"{ROOT}/public/data/annotations/cuv/{BOOK}.json", encoding="utf-8"))
HAN = re.compile(r"[㐀-鿿]")

outdir = f"{ROOT}/public/data/audio/{SET}/{BOOK}/{CH}"
os.makedirs(outdir, exist_ok=True)
man_path = f"{ROOT}/public/data/audio/{SET}/manifest.json"
man = json.load(open(man_path, encoding="utf-8")) if os.path.exists(man_path) else {
    "set": SET, "label": f"{PROVIDER} — {VOICE}", "kind": "synthesized", "provider": PROVIDER, "voice": VOICE,
    "license": "Generated with Microsoft Azure AI Speech (prebuilt neural voice) for this app.",
    "textRule": "Spoken text is the stored CUV verse with the honorific blank before 神 removed; reviewed pinyin applied with SSML phonemes only to words listed in tools/lexicon/pinyin_overrides.json.",
    "chapters": {}}

verses = cuv["chapters"][str(CH)]
lines, flagged, counts = [], [], {"exact": 0, "homophone": 0, "flag": 0, "unchecked": 0}
chap = {"verses": {}, "review": {"status": "not-reviewed"}, "generated": str(date.today())}
for v in verses:
    vid = v["id"]
    r = bundle.get(vid)
    if not r:
        flagged.append(vid); lines.append(f"{vid}: MISSING AUDIO"); continue
    data = base64.b64decode(r["mp3"])
    fname = f"{BOOK}/{CH}/{vid}.mp3"
    open(f"{ROOT}/public/data/audio/{SET}/{fname}", "wb").write(data)
    chap["verses"][vid] = {"file": fname, "duration": round(r["duration"], 3), "bytes": len(data)}

    if (r.get("stt") or {}).get("skipped"):
        counts["unchecked"] += 1; lines.append(f"{vid}: not checked"); continue
    # expected: Han characters with reviewed pinyin from the annotation tokens
    exp_chars, exp_py = [], []
    for t in ann["verses"][vid]:
        if isinstance(t, list) and HAN.search(t[0]):
            syl = t[1].split()
            chars = [c for c in t[0] if HAN.match(c)]
            if len(syl) != len(chars): syl = [p[0] for p in pinyin(chars, style=Style.TONE)]
            exp_chars += chars; exp_py += syl
    heard = re.sub(r"\s+", "", (r.get("stt") or {}).get("lexical", ""))
    heard_chars = [c for c in heard if HAN.match(c)]
    heard_py = [p[0] for p in pinyin("".join(heard_chars), style=Style.TONE)] if heard_chars else []
    heard_all = [set(p) for p in pinyin("".join(heard_chars), style=Style.TONE, heteronym=True)] if heard_chars else []
    if "".join(heard_chars) == "".join(exp_chars):
        counts["exact"] += 1; lines.append(f"{vid}: exact"); continue
    # 1) align characters: identical characters carry no evidence of a misreading
    # 2) where characters differ, compare sounds (pinyin + tone, leniently as above)
    issues = []
    sm = difflib.SequenceMatcher(a=exp_chars, b=heard_chars, autojunk=False)
    for op, a1, a2, b1, b2 in sm.get_opcodes():
        if op == "equal": continue
        ok = op == "replace" and (a2 - a1) == (b2 - b1)
        if ok:
            for k in range(a2 - a1):
                ec, ep, hc = exp_chars[a1 + k], exp_py[a1 + k], heard_chars[b1 + k]
                opts = {"yī"} if hc == "一" and ec != "一" else heard_all[b1 + k] | {heard_py[b1 + k]}
                particle = ec == "哪" and ep == "na" and hc == "啊"          # 哪 na = 啊 after -n
                nxt = exp_py[a1 + k + 1] if a1 + k + 1 < len(exp_py) else ""
                sandhi3 = ep.translate(STRIP) != ep and any(m in ep for m in "ǎěǐǒǔǚ") and any(m in nxt for m in "ǎěǐǒǔǚ")
                if sandhi3:   # 3rd tone before 3rd tone is spoken as 2nd tone
                    opts = opts | {o for o in opts if toneless(o) == toneless(ep)} | {ep}
                    opts = opts | {x for x in opts}
                if not (particle or any(same_sound(ec, ep, o) for o in opts) or (sandhi3 and any(toneless(o) == toneless(ep) and any(m in o for m in "áéíóúǘ") for o in opts))):
                    ok = False; break
        if not ok:
            issues.append(f"{op}: expected {''.join(exp_chars[a1:a2])}[{' '.join(exp_py[a1:a2])}] heard {''.join(heard_chars[b1:b2])}[{' '.join(heard_py[b1:b2])}]")
    if not issues:
        counts["homophone"] += 1
        diff = [f"{a}->{b}" for a, b in zip(exp_chars, heard_chars) if a != b] if len(exp_chars) == len(heard_chars) else []
        lines.append(f"{vid}: homophone only {' '.join(diff)}")
    else:
        counts["flag"] += 1; flagged.append(vid)
        lines.append(f"{vid}: FLAG " + "; ".join(issues))

checked = counts["unchecked"] < len(chap["verses"])
chap["check"] = {"method": "Azure speech-to-text round trip, pinyin+tone comparison" if checked else "not checked yet (voice generated without the speech-to-text check)",
                 "checked": checked, "counts": counts, "flagged": flagged}
total = sum(x["duration"] for x in chap["verses"].values())
chap["duration"] = round(total, 2)
man["chapters"][f"{BOOK}.{CH}"] = chap
json.dump(man, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
os.makedirs(f"{ROOT}/tools/reports", exist_ok=True)
open(f"{ROOT}/tools/reports/audio_{SET}_{BOOK}_{CH}.txt", "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"{BOOK} {CH}: {len(chap['verses'])}/{len(verses)} clips, {total/60:.1f} min;", counts, "flagged:", flagged)
