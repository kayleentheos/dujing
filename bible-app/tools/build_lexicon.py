#!/usr/bin/env python3
"""Build the dictionary for one book: public/data/lexicon/<BOOK>.json

For every distinct (word, pinyin) in the segmented CUV text it records:
  * CC-CEDICT senses for the entry whose reading matches the pinyin used in
    context (so 得 dé "obtain" and 得 de particle are different entries);
  * part of speech from jieba's tagged dictionary, mapped to plain English,
    dropping proper-noun tags that are wrong for common words, and replaced by
    a reviewed value where tools/lexicon/study_notes.json gives one;
  * for words CC-CEDICT does not list: their dictionary parts (nothing invented);
  * an editorial study note for key theological words, after checking that
    every quoted Chinese phrase occurs in John (CUV) and every quoted English
    rendering occurs in John (WEB).

Usage: build_lexicon.py JHN
"""
import json, os, re, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.environ.get("VENDOR", "")   # optional; normally jieba/pypinyin are pip-installed (tools/requirements.txt)
CEDICT = os.environ.get("CEDICT", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build", "src", "cedict", "cedict_ts.u8"))
sys.path[:0] = [f"{VENDOR}/python-pinyin", f"{VENDOR}/jieba"]
import warnings; warnings.filterwarnings("ignore")
import jieba, jieba.posseg
from pypinyin.contrib.tone_convert import to_tone

jieba.setLogLevel(60)
BOOK = sys.argv[1]
HAN = re.compile(r"[㐀-鿿]")


def marks(numbered):
    out = []
    for s in numbered.split():
        s = s.replace("u:", "ü").replace("U:", "Ü")
        if s.lower() == "r5": s = "r"
        out.append(to_tone(s) if re.search(r"[1-5]$", s) else s)
    return " ".join(out)


def key(py): return py.lower().replace(" ", "").replace("ü", "v")

TONELESS = str.maketrans("āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ", "aaaaeeeeiiiioooouuuuüüüü")


def same_reading(a, b):
    """Equal, or equal except that one side has a neutral tone where the other has a tone."""
    if key(a) == key(b): return True
    sa, sb = a.lower().split(), b.lower().split()
    if len(sa) != len(sb): return False
    for x, y in zip(sa, sb):
        if x == y: continue
        if x.translate(TONELESS) != y.translate(TONELESS): return False
        if x != x.translate(TONELESS) and y != y.translate(TONELESS): return False   # both toned, different tones
    return True


def clean_sense(s):
    # 條|条[tiao2] -> 条 (tiáo)
    s = re.sub(r"(\S+?)\|(\S+?)\[([^\]]+)\]", lambda m: f"{m[2]} ({marks(m[3])})", s)
    s = re.sub(r"(\S+?)\[([^\]]+)\]", lambda m: f"{m[1]} ({marks(m[2])})", s)
    return s.strip()


# ---- CC-CEDICT
cedict = defaultdict(list)          # simplified -> [(trad, pinyin marks, [senses])]
for line in open(CEDICT, encoding="utf-8"):
    if line.startswith("#"): continue
    m = re.match(r"(\S+) (\S+) \[([^\]]+)\] /(.*)/\s*$", line)
    if m:
        cedict[m[2]].append((m[1], marks(m[3]), [x for x in m[4].split("/") if x]))


def entry_senses(raw):
    senses, cl = [], []
    for s in raw:
        if s.startswith("CL:"):
            cl.append(clean_sense(s[3:])); continue
        m = re.search(r"\s*\(CL:([^)]*)\)", s)
        if m:
            cl.append(clean_sense(m[1])); s = s[:m.start()] + s[m.end():]
        senses.append(clean_sense(s))
    useful = [s for s in senses if not re.match(r"(old |archaic |erroneous )?variant of|see |also written|Taiwan pr\.|surname |also pr\. |\((Internet )?slang\)|abbr\. for |.*online chat", s)]
    return (useful or senses), cl


def lookup(word, py):
    """CC-CEDICT entries whose reading equals the in-context pinyin."""
    cands = cedict.get(word, [])
    exact = [c for c in cands if same_reading(c[1], py)]
    if not exact:   # e.g. 谁 [shei2] "also pr. [shui2]"
        exact = [c for c in cands if any(re.search(r"also pr\. \[([^\]]+)\]", x) and same_reading(marks(re.search(r"also pr\. \[([^\]]+)\]", x)[1]), py) for x in c[2])]
    return exact, cands


# ---- jieba POS (dictionary tags)
TAGS = {"n": "noun", "ng": "noun", "nr": None, "nrt": None, "nrfg": None, "ns": None, "nt": None, "nz": None,
        "v": "verb", "vg": "verb", "vd": "verb", "vn": "verb / noun", "vi": "verb", "vq": "verb",
        "a": "adjective", "ag": "adjective", "an": "adjective / noun", "ad": "adverb", "z": "adjective",
        "b": "attributive", "d": "adverb", "dg": "adverb", "p": "preposition", "c": "conjunction",
        "u": "particle", "ud": "particle", "ug": "particle", "uj": "particle", "ul": "particle", "uv": "particle", "uz": "particle",
        "y": "modal particle", "e": "interjection", "o": "onomatopoeia", "r": "pronoun", "rr": "pronoun", "rz": "pronoun", "rg": "pronoun",
        "m": "numeral", "mq": "numeral + measure word", "q": "measure word", "f": "locative (position word)",
        "t": "time word", "tg": "time word", "s": "place word", "i": "idiom", "l": "set phrase", "j": "abbreviation"}
tagtab = jieba.posseg.dt.word_tag_tab

# ---- inputs
ann = json.load(open(f"{ROOT}/public/data/annotations/cuv/{BOOK}.json", encoding="utf-8"))
cuv = json.load(open(f"{ROOT}/public/data/translations/cuv/{BOOK}.json", encoding="utf-8"))
web = json.load(open(f"{ROOT}/public/data/translations/web/{BOOK}.json", encoding="utf-8"))
overrides_words = set(json.load(open(f"{ROOT}/tools/lexicon/pinyin_overrides.json", encoding="utf-8"))["words"])
notes = {n.get("w", w.split("@")[0]): n for w, n in json.load(open(f"{ROOT}/tools/lexicon/study_notes.json", encoding="utf-8"))["notes"].items() if n.get("book", "JHN") == BOOK}
cuv_all = "".join(v["text"] for vs in cuv["chapters"].values() for v in vs)
web_all = " ".join(v["text"] for vs in web["chapters"].values() for v in vs).lower()

# verify every note's quotations before using them
problems = []
for w, n in notes.items():
    texts = [n["note"]] + list(n.get("verses", {}).values())
    for t in texts:
        for q in re.findall(r"‘([^’]*[一-鿿][^’]*)’", t):
            if q.replace("　", "") not in cuv_all.replace("　", ""):
                problems.append(f"{w}: Chinese quote not in CUV {BOOK}: {q}")
        for q in re.findall(r"WEB “([^”]+)”", t):
            if q.lower() not in web_all:
                problems.append(f"{w}: WEB quote not in WEB {BOOK}: {q}")
        for q in re.findall(r"WEB “([^”]+)”, “([^”]+)”", t):
            for x in q:
                if x.lower() not in web_all: problems.append(f"{w}: WEB quote not in WEB {BOOK}: {x}")
    if w not in {t[0] for vs in ann["verses"].values() for t in vs if isinstance(t, list)}:
        problems.append(f"{w}: study note for a word that never occurs as a token")
if problems:
    print("\n".join(problems)); sys.exit("study note verification failed")

# ---- collect words
occ = defaultdict(int)
pn_words = set()
for vid, toks in ann["verses"].items():
    for t in toks:
        if isinstance(t, list) and HAN.search(t[0]):
            occ[(t[0], t[1])] += 1
            if len(t) > 2 and "pn" in t[2].split("+"):
                pn_words.add(t[0])

entries, stats = {}, defaultdict(int)
for (w, py), n in sorted(occ.items(), key=lambda kv: -kv[1]):
    e = {"w": w, "py": py, "count": n}
    exact, cands = lookup(w, py)
    is_name = w in pn_words
    if w in notes and notes[w].get("translit") and notes[w].get("override_dictionary"):
        # reviewed: the dictionary entry is for a different referent (e.g. 希罗底 'Herodium' vs the person Herodias)
        e.update(kind="transliteration")
        stats["transliteration"] += 1
    elif exact:
        # prefer the capitalised (proper-name) entry for CUV-marked names, else the common one
        exact.sort(key=lambda c: (c[1][:1].isupper() != is_name, len(c[2]) * -1))
        senses, cl = [], []
        for c in exact:
            s, l = entry_senses(c[2])
            for x in s:
                if x not in senses: senses.append(x)
            cl += [x for x in l if x not in cl]
        # an entry that is only "variant of …" can sort first; real senses come before it
        senses = [x for x in senses if not re.match(r"(old |archaic |erroneous )?variant of", x)] or senses
        # a reviewed note may bring the sense used in the CUV to the front (never adds a sense)
        pref = notes.get(w, {}).get("prefer_senses", [])
        senses = [x for x in senses if any(p in x for p in pref)] + [x for x in senses if not any(p in x for p in pref)]
        e.update(kind="dictionary", trad=exact[0][0], senses=senses[:8], cl=cl or None)
        stats["dictionary"] += 1
    elif cands:
        # the word exists but not with this reading: show what the dictionary has, flagged
        e.update(kind="other-reading", alt=[{"py": c[1], "senses": entry_senses(c[2])[0][:4]} for c in cands[:3]])
        stats["other-reading"] += 1
    elif w in notes and notes[w].get("translit"):
        e.update(kind="transliteration")
        stats["transliteration"] += 1
    elif is_name:
        # a transliterated name the dictionary does not list: say so, never decompose it
        e.update(kind="name")
        stats["name"] += 1
    else:
        # not a dictionary word: break into dictionary words, aligned with the syllables
        syl = py.split()
        parts, i = [], 0
        chars = list(w)
        while i < len(chars):
            for L in range(min(4, len(chars) - i), 0, -1):
                piece = "".join(chars[i:i + L])
                ppy = " ".join(syl[i:i + L]) if len(syl) == len(chars) else ""
                ex, cs = lookup(piece, ppy) if ppy else ([], cedict.get(piece, []))
                if ex or (L == 1 and cs) or L == 1:
                    # common-word readings first; capitalised readings are proper nouns (Yi4 'Italy' vs yi4 'righteousness')
                    src = sorted(ex or cs, key=lambda c: c[1][:1].isupper() != (piece == "神"))   # 神 in the CUV is God
                    merged = []
                    for c in src:
                        for x in entry_senses(c[2])[0]:
                            if x not in merged and not re.match(r"(old |archaic )?variant of|surname ", x): merged.append(x)
                    parts.append({"w": piece, "py": ppy or (src[0][1] if src else ""), "senses": merged[:3]})
                    i += L
                    break
        e.update(kind="parts", parts=parts)
        stats["parts"] += 1
    # part of speech
    pos, pos_src = None, None
    if w in notes and notes[w].get("pos"):
        pos, pos_src = notes[w]["pos"], "reviewed"
    elif w in notes and notes[w].get("translit"):
        e.update(kind="transliteration")
        stats["transliteration"] += 1
    elif is_name:
        pos, pos_src = "proper name", "CUV name mark"
    else:
        tag = tagtab.get(w)
        if tag and TAGS.get(tag):
            pos, pos_src = TAGS[tag], "jieba"
        gloss = e.get("senses", [])[:3]
        if gloss:
            verbish = gloss[0].startswith("to ")
            particle = any("particle" in g for g in gloss[:1])
            classifier = gloss[0].startswith("classifier")
            dict_pos = "verb" if verbish else "particle" if particle else "measure word" if classifier else None
            if dict_pos and (pos is None or (dict_pos not in pos)):
                pos, pos_src = dict_pos, "CC-CEDICT gloss"
    e["pos"] = pos
    e["posSource"] = pos_src
    if is_name: e["name"] = True
    # was the pinyin confirmed by the dictionary or by review? (names/parts use character readings)
    e["pyChecked"] = e["kind"] == "dictionary" or w in overrides_words
    e["count"] = n
    if w in notes:
        e["note"] = {"text": notes[w]["note"], "verses": notes[w].get("verses", {})}
    entries[f"{w}|{py}"] = {k: v for k, v in e.items() if v is not None}

out = {
    "book": BOOK,
    "sources": {
        "dictionary": "CC-CEDICT (mdbg.net), CC BY-SA 4.0 — release of 2026-11-16, sha256 6c3476ad7465738e…",
        "pos": "jieba dictionary tags (MIT), reviewed; proper-noun tags kept only for names marked in the CUV",
        "notes": "Study notes written for this app; quotations verified against the CUV and WEB text of this book",
    },
    "entries": entries,
}
os.makedirs(f"{ROOT}/public/data/lexicon", exist_ok=True)
json.dump(out, open(f"{ROOT}/public/data/lexicon/{BOOK}.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{BOOK}: {len(entries)} word entries", dict(stats),
      "| no POS:", sum(1 for e in entries.values() if "pos" not in e),
      "| notes:", sum(1 for e in entries.values() if "note" in e))
