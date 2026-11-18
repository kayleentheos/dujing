#!/usr/bin/env python3
"""QA for an imported book: verify both translations against the independent
eBible VPL files, check completeness, duplicates and CUV/WEB alignment.

Usage: verify_import.py <cuv_vpl.txt> <web_vpl.txt> [BOOK]     (BOOK defaults to JHN)
"""
import json, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK = sys.argv[3] if len(sys.argv) > 3 else "JHN"
# eBible VPL files use their own book codes where they differ from USFM
VPL_CODE = {"MRK": "MAR", "JHN": "JOH", "PHP": "PHI", "JAS": "JAM", "1JN": "1JO", "2JN": "2JO", "3JN": "3JO",
            "SNG": "SOL", "EZK": "EZE", "JOL": "JOE", "NAM": "NAH"}.get(BOOK, BOOK)
cuv = json.load(open(f"{ROOT}/public/data/translations/cuv/{BOOK}.json", encoding="utf-8"))
web = json.load(open(f"{ROOT}/public/data/translations/web/{BOOK}.json", encoding="utf-8"))
align = json.load(open(f"{ROOT}/public/data/alignment/{BOOK}.json", encoding="utf-8"))
fail = 0


def vpl(path, code=VPL_CODE):
    out = {}
    for line in open(path, encoding="utf-8"):
        m = re.match(rf"{code} (\d+):(\d+) (.*)$", line.rstrip("\n"))
        if m:
            out[(int(m[1]), int(m[2]))] = m[3]
    return out


def check(name, doc, ref, norm):
    global fail
    mine = {(int(c), v["v"]): v["text"] for c, vs in doc["chapters"].items() for v in vs}
    # a line/paragraph break kept inside a verse is a single space in VPL
    withbr = {(int(c), v["v"]): "".join(r[0] if isinstance(r, list) else " " for r in v["runs"])
              for c, vs in doc["chapters"].items() for v in vs}
    ids = [v["id"] for vs in doc["chapters"].values() for v in vs]
    dup = len(ids) - len(set(ids))
    missing_vs_vpl = sorted(set(ref) - set(mine))
    extra_vs_vpl = sorted(set(mine) - set(ref))
    diffs = [(k, mine[k], ref[k]) for k in sorted(set(mine) & set(ref)) if norm(withbr[k]) != norm(ref[k])]
    print(f"[{name}] chapters={len(doc['chapters'])} verses={len(mine)} duplicates={dup} "
          f"missing_vs_VPL={missing_vs_vpl} extra_vs_VPL={extra_vs_vpl} text_mismatches={len(diffs)}")
    for k, a, b in diffs[:10]:
        print("   ", k, "\n     mine:", a, "\n     vpl :", b)
    fail += dup + len(missing_vs_vpl) + len(extra_vs_vpl) + len(diffs)
    return mine


# VPL renders \add as [..] and drops the leading ideographic space on a line. Chinese is
# never typeset with ASCII spaces; a few in the eBible source are digitisation slips
# (e.g. Mark 7:22 "谤 、"), and the importer drops ASCII whitespace in Chinese text, so the
# comparison ignores them too (U+3000, the honorific space before 神, is kept and compared).
zh_norm = lambda s: s.replace("[", "").replace("]", "").replace(" ", "").strip("　")
en_norm = lambda s: re.sub(r"\s+", " ", s.replace("[", "").replace("]", "")).strip()
c = check("CUV vs eBible VPL", cuv, vpl(sys.argv[1]), zh_norm)
w = check("WEB vs eBible VPL", web, vpl(sys.argv[2]), en_norm)

# expected chapter lengths (standard English versification) for books checked by hand
EXPECTED = {"JHN": [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
            "1JN": [10, 29, 24, 21, 21],
            "MRK": [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20]}
for ch, n in enumerate(EXPECTED.get(BOOK, []), 1):
    got = max(v for (cc, v) in w if cc == ch)
    if got != n or len([1 for (cc, v) in w if cc == ch]) != n:
        print("WEB chapter length wrong", ch, got, n); fail += 1

# alignment: every WEB verse and every CUV verse is covered exactly once
covered_w, covered_c = [], []
for row in align["rows"]:
    covered_w += row["web"]; covered_c += row["cuv"]
    for i in row["web"]:
        assert i in {f"{BOOK}.{a}.{b}" for a, b in w}, i
    for i in row["cuv"]:
        assert i in {f"{BOOK}.{a}.{b}" for a, b in c}, i
wset = {f"{BOOK}.{a}.{b}" for a, b in w}; cset = {f"{BOOK}.{a}.{b}" for a, b in c}
problems = []
if sorted(covered_w) != sorted(wset) or len(covered_w) != len(set(covered_w)):
    problems.append("WEB coverage")
if sorted(covered_c) != sorted(cset) or len(covered_c) != len(set(covered_c)):
    problems.append("CUV coverage")
non_one_to_one = [r for r in align["rows"] if r["web"] != r["cuv"]]
print(f"[Alignment] rows={len(align['rows'])} WEB covered={len(set(covered_w))}/{len(wset)} "
      f"CUV covered={len(set(covered_c))}/{len(cset)} problems={problems}")
for r in non_one_to_one:
    print("   non 1:1:", r)
fail += len(problems)

# sanity: Chinese text contains no Latin letters / markup, English no CJK
for (k, t) in c.items():
    if re.search(r"[A-Za-z\\|]", t):
        print("Latin/markup in CUV", k, t); fail += 1
for (k, t) in w.items():
    if re.search(r"[一-鿿\\|]", t):
        print("CJK/markup in WEB", k, t); fail += 1

print("RESULT:", "PASS" if fail == 0 else f"FAIL ({fail})")
sys.exit(1 if fail else 0)
