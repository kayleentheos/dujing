#!/usr/bin/env python3
"""Build the verse alignment between two translations of one book.

Default rule: verses with the same stable id (BOOK.chapter.verse) are paired.
Known versification / textual differences are listed explicitly in
data/alignment/overrides.json and documented there; nothing is guessed.

Usage: build_alignment.py JHN
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
book = sys.argv[1]
zh = json.load(open(f"{ROOT}/public/data/translations/cuv/{book}.json", encoding="utf-8"))
en = json.load(open(f"{ROOT}/public/data/translations/web/{book}.json", encoding="utf-8"))
over = json.load(open(f"{ROOT}/public/data/alignment/overrides.json", encoding="utf-8")).get(book, [])

zh_ids = [v["id"] for c in zh["chapters"].values() for v in c]
en_ids = [v["id"] for c in en["chapters"].values() for v in c]
taken_zh, taken_en = set(), set()
special = {}
for o in over:
    for i in o["web"]:
        special[i] = o
    taken_zh.update(o["cuv"]); taken_en.update(o["web"])

rows, done = [], set()
for i in en_ids:
    if i in special:
        o = special[i]
        if id(o) in done:
            continue
        done.add(id(o))
        rows.append({"web": o["web"], "cuv": o["cuv"], "note": o["note"]})
    elif i in zh_ids and i not in taken_zh:
        rows.append({"web": [i], "cuv": [i]})
        taken_zh.add(i)
    else:
        raise SystemExit(f"WEB verse {i} has no CUV partner and no override")
left = [i for i in zh_ids if i not in taken_zh]
if left:
    raise SystemExit(f"CUV verses without partner: {left}")
out = {"book": book, "pair": ["cuv", "web"], "rows": rows}
json.dump(out, open(f"{ROOT}/public/data/alignment/{book}.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{book}: {len(rows)} aligned rows ({sum(1 for r in rows if r['web'] != r['cuv'])} special)")
