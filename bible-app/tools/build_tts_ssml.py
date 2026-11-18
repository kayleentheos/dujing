#!/usr/bin/env python3
"""Prepare per-verse SSML for text-to-speech.

The spoken text is exactly the stored CUV verse, with two non-wording changes:
  * the honorific blank before 神 (U+3000) is dropped for speech (it is
    typographic, not spoken);
  * words whose reading was reviewed as context-dependent (tools/lexicon/
    pinyin_overrides.json: word overrides and per-occurrence fixes) are wrapped
    in <phoneme alphabet="sapi"> with the reviewed pinyin, tone sandhi inside the
    word applied (3+3 -> 2+3, 一/不 rules), so the voice cannot misread them.
Everything else is left to the voice so natural connected speech is kept.

Usage: build_tts_ssml.py JHN 1 [2 ...] > out.json
"""
import json, os, re, sys, unicodedata
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TONE = {}
for base, marks in {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}.items():
    for t, m in enumerate(marks, 1): TONE[m] = (base, t)


def numbered(syl):
    """'chāi' -> ('chai', 1); neutral -> 5"""
    tone, out = 5, ""
    for ch in syl:
        if ch in TONE: b, tone = TONE[ch]; out += b
        else: out += ch
    return out.replace("ü", "v"), tone


def sandhi(word, syls):
    nums = [numbered(s) for s in syls]
    t = [n[1] for n in nums]
    for i in range(len(t) - 1):
        if t[i] == 3 and t[i + 1] == 3: t[i] = 2
        if word[i] == "不" and t[i + 1] == 4: t[i] = 2
        if word[i] == "一" and t[i + 1] in (1, 2, 3): t[i] = 4
        if word[i] == "一" and t[i + 1] == 4: t[i] = 2
    return " - ".join(f"{n[0]} {tt}" for n, tt in zip(nums, t))



if __name__ == "__main__":
    book, chapters = sys.argv[1], [int(x) for x in sys.argv[2:]]
    cuv = json.load(open(f"{ROOT}/public/data/translations/cuv/{book}.json", encoding="utf-8"))
    ann = json.load(open(f"{ROOT}/public/data/annotations/cuv/{book}.json", encoding="utf-8"))
    ov = json.load(open(f"{ROOT}/tools/lexicon/pinyin_overrides.json", encoding="utf-8"))
    FORCE_WORDS = set(ov["words"])
    FORCE_OCC = set(ov["occurrences"])
    
    out = {"book": book, "voiceNote": "spoken text = stored verse; U+3000 removed; reviewed phonemes", "verses": {}}
    for c in chapters:
        for v in cuv["chapters"][str(c)]:
            toks = [t for t in ann["verses"][v["id"]] if isinstance(t, list)]
            parts, forced = [], []
            for i, t in enumerate(toks):
                w, py = t[0], t[1]
                text = w.replace("　", "")
                if not text:
                    continue
                key = f"{v['id']}#{i}"
                erhua = any(sy == "r" for sy in py.split())     # SAPI notation has no erhua form; the voice reads 儿化 naturally
                if py and not erhua and (w in FORCE_WORDS or key in FORCE_OCC) and len(py.split()) == len(w):
                    ph = sandhi(w, py.split())
                    parts.append(f'<phoneme alphabet="sapi" ph="{ph}">{escape(text)}</phoneme>')
                    forced.append(f"{w}={py}")
                else:
                    parts.append(escape(text))
            spoken = "".join(re.sub(r"<[^>]+>", "", p) for p in parts)
            assert spoken == v["text"].replace("　", ""), v["id"]
            out["verses"][v["id"]] = {"ssml": "".join(parts), "forced": forced, "chars": len(spoken)}
    json.dump(out, sys.stdout, ensure_ascii=False)
    