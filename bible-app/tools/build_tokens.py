#!/usr/bin/env python3
"""Segment a Chinese book into words and attach pinyin, producing
public/data/annotations/cuv/<BOOK>.json.

Sources (all open licensed, see public/data/lexicon/meta.json):
  * jieba (MIT) word segmentation, extended with a biblical word list
  * CC-CEDICT (CC BY-SA 4.0) for word-level readings
  * pypinyin (MIT) for single characters, using the verse as context
  * tools/lexicon/pinyin_overrides.json: reviewed corrections (global words
    and per-occurrence fixes), which always win.

The Scripture text is never changed: tokens of each verse are asserted to
join back to exactly the imported verse text.

Usage: build_tokens.py JHN
"""
import json, os, re, sys, unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.environ.get("VENDOR", "")   # optional; normally jieba/pypinyin are pip-installed (tools/requirements.txt)
sys.path[:0] = [f"{VENDOR}/python-pinyin", f"{VENDOR}/jieba"]
import warnings; warnings.filterwarnings("ignore")
import jieba
from pypinyin import pinyin, Style
from pypinyin.contrib.tone_convert import to_tone

jieba.setLogLevel(60)
BOOK = sys.argv[1]
CEDICT = os.environ.get("CEDICT", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build", "src", "cedict", "cedict_ts.u8"))
LEX = f"{ROOT}/tools/lexicon"

HAN = re.compile(r"[㐀-鿿豈-﫿]")


def num_to_mark(s):
    out = []
    for syl in s.split():
        syl = syl.replace("u:", "ü").replace("v", "ü")
        if syl.lower() == "r5":
            syl = "r"
        out.append(to_tone(syl) if re.search(r"[1-5]$", syl) else syl)
    return " ".join(out)


# ---- CC-CEDICT: simplified -> set of readings (tone marks), lowercase for common words
cedict = defaultdict(list)
for line in open(CEDICT, encoding="utf-8"):
    if line.startswith("#"):
        continue
    m = re.match(r"(\S+) (\S+) \[([^\]]+)\] /", line)
    if m:
        cedict[m[2]].append(m[3])

overrides = json.load(open(f"{LEX}/pinyin_overrides.json", encoding="utf-8"))
words = json.load(open(f"{LEX}/biblical_words.json", encoding="utf-8"))

# names marked \pn in the CUV become dictionary words so they are never split
doc = json.load(open(f"{ROOT}/public/data/translations/cuv/{BOOK}.json", encoding="utf-8"))
names = Counter()
for vs in doc["chapters"].values():
    for v in vs:
        for r in v["runs"]:
            if isinstance(r, list) and "pn" in r[1].split("+"):
                names[r[0]] += 1
for w in list(names) + words["words"] + list(overrides["words"]):
    if HAN.search(w):
        jieba.add_word(w, freq=max(2000, jieba.get_FREQ(w) or 0))
for w in words.get("split", []):
    jieba.del_word(w)
    for part in w:  # make sure the pieces stay available
        pass
for a, b in words.get("force_split", {}).items():
    jieba.suggest_freq(tuple(b.split("|")), True)


# exact segmentations for phrases the general segmenter gets wrong (reviewed; see biblical_words.json "segment")
SEGMENT = {k: v.split("|") for k, v in words.get("segment", {}).items()}
SEG_RE = re.compile("|".join(sorted(map(re.escape, SEGMENT), key=len, reverse=True))) if SEGMENT else None


def segment(text):
    toks, pos = [], 0
    for m in (SEG_RE.finditer(text) if SEG_RE else []):
        toks += list(jieba.cut(text[pos:m.start()], HMM=False)) + SEGMENT[m.group(0)]
        pos = m.end()
    toks += list(jieba.cut(text[pos:], HMM=False))
    return [t for t in toks if t]


CITATION = {"一": "yī", "不": "bù"}


def citation(token, py):
    """Dictionary (citation) tones: undo tone sandhi on 一 and 不."""
    syl = py.split()
    if len(syl) == len(token):
        syl = [CITATION.get(ch, s) for ch, s in zip(token, syl)]
    return " ".join(syl).lower() if syl else py


def pinyin_for(token, ctx_py):
    return citation(token, _pinyin_for(token, ctx_py)) if HAN.search(token) else ""


def _pinyin_for(token, ctx_py):
    if not HAN.search(token):
        return ""
    if token in overrides["words"]:
        return overrides["words"][token]
    readings = [num_to_mark(r) for r in cedict.get(token, [])]
    lower = sorted({r for r in readings if not r[:1].isupper()})
    if len(token) > 1:
        if len(set(readings)) == 1:
            return readings[0]
        if ctx_py in readings:
            return ctx_py
        if len(lower) == 1 and not any(r[:1].isupper() for r in readings):
            return lower[0]
    return ctx_py


out = {"book": BOOK, "translation": "cuv", "verses": {}}
review = defaultdict(list)
POLY = set(overrides.get("review_chars", ""))


def context_pinyin(text):
    """pypinyin over the whole run (so its phrase dictionary sees context),
    mapped back to one reading per character ('' for non-Han)."""
    res = pinyin(text, style=Style.TONE, errors=lambda x: ["\0"] * len(x))
    return [p[0] if HAN.match(ch) else "" for ch, p in zip(text, res)]


def adverbial_de(lst):
    for i, t in enumerate(lst):
        if t[0] == "地" and i > 0:
            prev, prev2 = lst[i - 1][0], (lst[i - 2][0] if i > 1 else "")
            redup = (len(prev) == 2 and prev[0] == prev[1]) or \
                    (len(prev) == 4 and ((prev[0] == prev[1] and prev[2] == prev[3]) or prev[:2] == prev[2:]))
            if redup or prev in ("不住", "无故", "一一", "实实在在", "再三", "何等", "极力", "起誓", "牢牢靠靠", "忧忧愁愁") or (prev == prev2 and HAN.match(prev)):
                t[1] = "de"


for c, vs in doc["chapters"].items():
    for v in vs:
        tokens = []
        for r in v["runs"]:
            if isinstance(r, dict):
                tokens.append({"br": r["br"]})
                continue
            text, style = r
            ctx = context_pinyin(text)
            pos = 0
            for t in segment(text):
                ctx_py = " ".join(x for x in ctx[pos:pos + len(t)] if x)
                tokens.append([t, pinyin_for(t, ctx_py)] + ([style] if style else []))
                pos += len(t)
        lst = [t for t in tokens if isinstance(t, list)]
        adverbial_de(lst)
        # 哪 closing a phrase (看哪，  民哪，) is the particle na (CC-CEDICT 哪[na5]), not nǎ "which"
        for i, t in enumerate(lst):
            if t[0] == "哪" and i + 1 < len(lst) and not HAN.search(lst[i + 1][0]):
                t[1] = "na"
        # 只 right after a number or demonstrative is the measure word zhī (两只手, 一只船), not zhǐ "only"
        for i, t in enumerate(lst):
            if t[0] == "只" and i > 0 and re.search(r"[一二两三四五六七八九十百千几每这那]$", lst[i - 1][0]):
                t[1] = "zhī"
        for idx, t in enumerate(lst):
            key = f"{v['id']}#{idx}"
            if key in overrides["occurrences"]:
                o = overrides["occurrences"][key]
                assert o["w"] == t[0], (key, t[0], o["w"])
                t[1] = o["py"]
            if t[0] in POLY:
                pos = sum(len(x[0]) for x in lst[:idx])
                review[t[0]].append((key, t[1], v["text"][max(0, pos - 6):pos + len(t[0]) + 6]))
        joined = "".join(t[0] for t in lst)
        assert joined == v["text"], (v["id"], joined, v["text"])
        out["verses"][v["id"]] = tokens

# word familiarity bands from jieba's corpus frequencies, for the
# "pinyin over harder words only" reading mode: 1 = very common, 2 = common, 3 = less common
ranked = sorted(jieba.dt.FREQ.items(), key=lambda kv: -kv[1])
rank = {w: i for i, (w, f) in enumerate(ranked) if f > 0}
bands = {}
for toks in out["verses"].values():
    for t in toks:
        if isinstance(t, list) and HAN.search(t[0]) and t[0] not in bands:
            r = rank.get(t[0], 10**9)
            bands[t[0]] = 1 if r < 2500 else 2 if r < 12000 else 3
            if t[0] in names:
                bands[t[0]] = 3
out["bands"] = bands
out["sources"] = ["jieba (MIT)", "CC-CEDICT (CC BY-SA 4.0)", "pypinyin (MIT)", "reviewed overrides: tools/lexicon/pinyin_overrides.json"]
os.makedirs(f"{ROOT}/public/data/annotations/cuv", exist_ok=True)
json.dump(out, open(f"{ROOT}/public/data/annotations/cuv/{BOOK}.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
with open(f"{ROOT}/tools/reports/pinyin_review_{BOOK}.txt", "w", encoding="utf-8") as f:
    for ch, items in sorted(review.items(), key=lambda kv: -len(kv[1])):
        cnt = Counter(p for _, p, _ in items)
        f.write(f"== {ch}  {dict(cnt)}\n")
        for key, p, ctxt in items:
            f.write(f"  {key:14} {p:6} {ctxt}\n")
ntok = sum(len(t) for t in out["verses"].values())
print(f"{BOOK}: {len(out['verses'])} verses, {ntok} tokens; review chars: {len(review)}")
