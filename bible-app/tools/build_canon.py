#!/usr/bin/env python3
"""Build public/data/canon.json: the 66-book Protestant canon with names and
chapter counts read from the official eBible USFM zips, plus traditional
categories. Marks which books have been imported (have JSON in translations/).
"""
import json, os, re, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OT = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL".split()
NT = "MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split()
CATS = [
    ("pentateuch", "Pentateuch", "摩西五经", OT[0:5]),
    ("history-ot", "Historical Books", "历史书", OT[5:17]),
    ("wisdom", "Poetry and Wisdom", "诗歌智慧书", OT[17:22]),
    ("major-prophets", "Major Prophets", "大先知书", OT[22:27]),
    ("minor-prophets", "Minor Prophets", "小先知书", OT[27:39]),
    ("gospels", "Gospels", "福音书", NT[0:4]),
    ("history-nt", "History", "历史书", NT[4:5]),
    ("pauline", "Pauline Epistles", "保罗书信", NT[5:18]),
    ("general", "General Epistles", "普通书信", NT[18:26]),
    ("prophecy", "Prophecy", "预言书", NT[26:27]),
]


# standard Chinese abbreviations (和合本 usage), plus the short forms people type; used by reference search
ZH_ABBR = {
    "GEN": ["创", "创世记"], "EXO": ["出", "出埃及记"], "LEV": ["利", "利未记"], "NUM": ["民", "民数记"], "DEU": ["申", "申命记"],
    "JOS": ["书", "约书亚记"], "JDG": ["士", "士师记"], "RUT": ["得", "路得记"], "1SA": ["撒上"], "2SA": ["撒下"],
    "1KI": ["王上"], "2KI": ["王下"], "1CH": ["代上"], "2CH": ["代下"], "EZR": ["拉", "以斯拉记"], "NEH": ["尼", "尼希米记"],
    "EST": ["斯", "以斯帖记"], "JOB": ["伯", "约伯记"], "PSA": ["诗", "诗篇"], "PRO": ["箴", "箴言"], "ECC": ["传", "传道书"],
    "SNG": ["歌", "雅歌"], "ISA": ["赛", "以赛亚书"], "JER": ["耶", "耶利米书"], "LAM": ["哀", "耶利米哀歌"], "EZK": ["结", "以西结书"],
    "DAN": ["但", "但以理书"], "HOS": ["何", "何西阿书"], "JOL": ["珥", "约珥书"], "AMO": ["摩", "阿摩司书"], "OBA": ["俄", "俄巴底亚书"],
    "JON": ["拿", "约拿书"], "MIC": ["弥", "弥迦书"], "NAM": ["鸿", "那鸿书"], "HAB": ["哈", "哈巴谷书"], "ZEP": ["番", "西番雅书"],
    "HAG": ["该", "哈该书"], "ZEC": ["亚", "撒迦利亚书"], "MAL": ["玛", "玛拉基书"],
    "MAT": ["太", "马太", "马太福音"], "MRK": ["可", "马可", "马可福音"], "LUK": ["路", "路加", "路加福音"], "JHN": ["约", "约翰", "约翰福音", "约翰福音书"],
    "ACT": ["徒", "使徒行传"], "ROM": ["罗", "罗马书"], "1CO": ["林前"], "2CO": ["林后"], "GAL": ["加", "加拉太书"], "EPH": ["弗", "以弗所书"],
    "PHP": ["腓", "腓立比书"], "COL": ["西", "歌罗西书"], "1TH": ["帖前"], "2TH": ["帖后"], "1TI": ["提前"], "2TI": ["提后"], "TIT": ["多", "提多书"],
    "PHM": ["门", "腓利门书"], "HEB": ["来", "希伯来书"], "JAS": ["雅", "雅各书"], "1PE": ["彼前"], "2PE": ["彼后"],
    "1JN": ["约一", "约壹", "约翰一书"], "2JN": ["约二", "约贰", "约翰二书"], "3JN": ["约三", "约叁", "约翰三书"], "JUD": ["犹", "犹大书"], "REV": ["启", "启示录"],
}
assert len(ZH_ABBR) == 66


def read_zip(path):
    out = {}
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if not n.endswith(".usfm"):
                continue
            t = z.read(n).decode("utf-8")
            code = re.search(r"\\id (\w+)", t).group(1)
            get = lambda k: (re.search(rf"\\{k} (.*)", t) or [None, ""])[1].strip()
            out[code] = {"h": get("h"), "toc1": get("toc1"), "toc2": get("toc2"),
                         "chapters": len(re.findall(r"\\c \d+", t))}
    return out


zh = read_zip(f"{ROOT}/sources/cmn-cu89s_usfm.zip")
en = read_zip(f"{ROOT}/sources/eng-web_usfm.zip")
books = []
for cat_id, cat_en, cat_zh, codes in CATS:
    for code in codes:
        assert zh[code]["chapters"] == en[code]["chapters"], code
        books.append({
            "code": code,
            "testament": "OT" if code in OT else "NT",
            "category": cat_id,
            "name": {"zh": zh[code]["h"], "en": en[code]["toc2"] or en[code]["h"]},
            "longName": {"zh": zh[code]["toc1"], "en": en[code]["toc1"]},
            "chapters": zh[code]["chapters"],
            "abbr": ZH_ABBR[code],
            "imported": all(os.path.exists(f"{ROOT}/public/data/translations/{t}/{code}.json") for t in ("cuv", "web")),
        })
assert len(books) == 66
canon = {"categories": [{"id": c, "name": {"en": e, "zh": z}, "testament": "OT" if codes[0] in OT else "NT",
                         "books": codes} for c, e, z, codes in CATS],
         "books": books}
json.dump(canon, open(f"{ROOT}/public/data/canon.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("66 books;", "imported:", [b["code"] for b in books if b["imported"]])
print(" ".join(f"{b['code']}={b['name']['zh']}/{b['name']['en']}/{b['chapters']}" for b in books))
