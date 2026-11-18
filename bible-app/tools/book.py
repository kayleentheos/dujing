#!/usr/bin/env python3
"""One-command book pipeline for 读经.

    python3 tools/book.py status                     what is imported, recorded, published
    python3 tools/book.py prepare BOOK               text → alignment → checks → words → dictionary → review packet
    python3 tools/book.py rebuild                    after editing tools/lexicon/*.json: rebuild every imported book,
                                                     show what changed compared with the last commit
    python3 tools/book.py audio BOOK [--check] [--chapters 1,2]
                                                     record chapters (voice only unless --check) + word pronunciations
    python3 tools/book.py redo BOOK CH[:V,V] ...     re-record whole chapters (after fixing a reading)
    python3 tools/book.py test BOOK                  the generic browser test for a book (+ --all for every suite)
    python3 tools/book.py publish-list               files under public/ changed since the last publish (JSON for publish_files)
    python3 tools/book.py mark-published             record the current public/ state as published

Nothing here ever changes Scripture text: importing verifies against eBible's
independent VPL files, and every token list is asserted to join back to the verse.
Secrets (Azure key/region) are read from $SECRETS (default /home/claude/.secrets),
never from the repository.
"""
import hashlib, json, os, re, subprocess, sys, zipfile
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = f"{ROOT}/public/data"
SRC = f"{ROOT}/build/src"
PUBLISHED = f"{ROOT}/published.json"
HAN = re.compile(r"[㐀-鿿豈-﫿]")
VPL_CODE = {"MRK": "MAR", "JHN": "JOH", "PHP": "PHI", "JAS": "JAM", "1JN": "1JO", "2JN": "2JO", "3JN": "3JO",
            "SNG": "SOL", "EZK": "EZE", "JOL": "JOE", "NAM": "NAH"}


def sh(*args, check=True, env=None, capture=False):
    e = dict(os.environ, **(env or {}))
    r = subprocess.run(list(args), cwd=ROOT, env=e, text=True, capture_output=capture)
    if check and r.returncode != 0:
        if capture: print(r.stdout[-3000:], r.stderr[-3000:])
        raise SystemExit(f"step failed: {' '.join(args)}")
    return r


def py(script, *args, **kw): return sh(sys.executable, f"tools/{script}", *args, **kw)


def canon(): return json.load(open(f"{DATA}/canon.json", encoding="utf-8"))
def imported(): return [b["code"] for b in canon()["books"] if b.get("imported")]
def book_info(code): return next(b for b in canon()["books"] if b["code"] == code)


# ---------------------------------------------------------------- sources
def extract_sources(code=None):
    """Unpack what is needed from sources/*.zip into build/src (verified against sources/SHA256SUMS)."""
    os.makedirs(SRC, exist_ok=True)
    sums = dict(reversed(l.split()) for l in open(f"{ROOT}/sources/SHA256SUMS") if l.strip())
    for name, want in sums.items():
        got = hashlib.sha256(open(f"{ROOT}/sources/{name}", "rb").read()).hexdigest()
        if got != want: raise SystemExit(f"source archive changed: {name}")
    def take(zipname, member_pred, dest):
        with zipfile.ZipFile(f"{ROOT}/sources/{zipname}") as z:
            for n in z.namelist():
                if member_pred(n) and not os.path.exists(f"{dest}/{n}"):
                    os.makedirs(dest, exist_ok=True); z.extract(n, dest)
    take("cedict_1_0_ts_utf-8_mdbg.zip", lambda n: n == "cedict_ts.u8", f"{SRC}/cedict")
    take("cmn-cu89s_vpl.zip", lambda n: n.endswith("_vpl.txt"), f"{SRC}/vpl")
    take("eng-web_vpl.zip", lambda n: n.endswith("_vpl.txt"), f"{SRC}/vpl")
    if code:
        take("cmn-cu89s_usfm.zip", lambda n: re.match(rf"\d+-{code}cmn", n), f"{SRC}/cuv")
        take("eng-web_usfm.zip", lambda n: re.match(rf"\d+-{code}eng", n), f"{SRC}/web")


def usfm(code, tr):
    d = f"{SRC}/{tr}"
    return f"{d}/" + next(f for f in os.listdir(d) if re.match(rf"\d+-{code}(cmn|eng)", f))


# ---------------------------------------------------------------- prepare
def prepare(code):
    extract_sources(code)
    info = book_info(code)
    print(f"== {code} {info['name']['zh']} / {info['name']['en']} ({info['chapters']} chapters)")
    py("import_usfm.py", usfm(code, "cuv"), "cuv", "zh", f"public/data/translations/cuv/{code}.json")
    py("import_usfm.py", usfm(code, "web"), "web", "en", f"public/data/translations/web/{code}.json")
    r = py("build_alignment.py", code, check=False, capture=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print(r.stderr.strip() or r.stdout.strip())
        numbering_report(code)
        raise SystemExit("ALIGNMENT: add documented entries for this book to public/data/alignment/overrides.json, then run prepare again.")
    r = py("verify_import.py", f"{SRC}/vpl/cmn-cu89s_vpl.txt", f"{SRC}/vpl/eng-web_vpl.txt", code, check=False, capture=True)
    print("\n".join(l for l in r.stdout.splitlines() if l.startswith(("[", "RESULT", "   non"))))
    if r.returncode != 0:
        print(r.stdout[-4000:]); raise SystemExit("VERIFY FAILED — do not continue until the text matches eBible's VPL.")
    py("build_canon.py", capture=True)
    rebuild(quiet_book=code)
    review_packet(code)


def numbering_report(code):
    zh = json.load(open(f"{DATA}/translations/cuv/{code}.json", encoding="utf-8"))
    en = json.load(open(f"{DATA}/translations/web/{code}.json", encoding="utf-8"))
    for ch in zh["chapters"]:
        a = {v["v"]: v for v in zh["chapters"][ch]}; b = {v["v"]: v for v in en["chapters"].get(ch, [])}
        if set(a) != set(b):
            print(f"  chapter {ch}: CUV-only {sorted(set(a)-set(b))} WEB-only {sorted(set(b)-set(a))}")
            for v in sorted(set(a) ^ set(b)):
                for nm, d in (("CUV", a), ("WEB", b)):
                    if v in d: print(f"    {nm} {ch}:{v} {d[v]['text'][:90]} notes={[n['text'][:80] for n in d[v].get('notes', [])]}")


# ---------------------------------------------------------------- rebuild + diffs
def head_json(path):
    r = subprocess.run(["git", "show", f"HEAD:bible-app/{path}"], cwd=ROOT, capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else None


def rebuild(quiet_book=None):
    """Rebuild tokens and dictionaries of every imported book; report changes in books other than quiet_book."""
    extract_sources()
    books = imported()
    for b in books:
        out = py("build_tokens.py", b, capture=True).stdout.strip().splitlines()
        print(out[-1] if out else b)
    for b in books:
        out = py("build_lexicon.py", b, capture=True).stdout.strip().splitlines()
        print(out[-1] if out else b)
    for b in books:
        if b == quiet_book: continue
        old = head_json(f"public/data/annotations/cuv/{b}.json")
        if not old: continue
        new = json.load(open(f"{DATA}/annotations/cuv/{b}.json", encoding="utf-8"))
        ch = [k for k in new["verses"] if old["verses"].get(k) != new["verses"][k]]
        for k in ch[:40]:
            a = [f"{t[0]}/{t[1]}" for t in old["verses"].get(k, []) if isinstance(t, list)]
            c = [f"{t[0]}/{t[1]}" for t in new["verses"][k] if isinstance(t, list)]
            import difflib
            print(f"  CHANGED {k}:", [x for x in difflib.ndiff(a, c) if x[0] in "+-"])
        if ch: print(f"  {b}: {len(ch)} verses changed vs last commit (audio for those verses may need redo if a reading changed)")


# ---------------------------------------------------------------- review packet
SAFE_MAJORITY = {"了": "le", "和": "hé", "那": "nà", "都": "dōu", "着": "zhe"}
RISKY = re.compile(r"(不了|了不|了得|明了|受不|得了|着急|睡着|找着|摸着|寻不着|得着)")
SUSPICIOUS = re.compile(r"\(Tw\)|abbr|surname|computing|Internet|dialect|slang|\(name\)|company|brand|Bank|province|county|city|stock|Congress|abortion|missile|propaganda|technical")


def review_packet(code):
    out = []
    w = out.append
    info = book_info(code)
    ann = json.load(open(f"{DATA}/annotations/cuv/{code}.json", encoding="utf-8"))["verses"]
    lex = json.load(open(f"{DATA}/lexicon/{code}.json", encoding="utf-8"))["entries"]
    web = json.load(open(f"{DATA}/translations/web/{code}.json", encoding="utf-8"))
    en = {v["id"]: v["text"] for vs in web["chapters"].values() for v in vs}
    others = set()
    for b in imported():
        if b != code:
            for v in json.load(open(f"{DATA}/annotations/cuv/{b}.json", encoding="utf-8"))["verses"].values():
                others |= {t[0] for t in v if isinstance(t, list)}
    ced = defaultdict(list)
    for line in open(f"{SRC}/cedict/cedict_ts.u8", encoding="utf-8"):
        m = re.match(r"(\S+) (\S+) \[([^\]]+)\] /(.*)/", line)
        if m: ced[m[2]].append((m[3], m[4]))
    def gloss(word):
        e = ced.get(word)
        if not e: return None
        low = [x for x in e if not x[0][:1].isupper()] or e
        return low[0][1].split("/")[0]
    def ctx(vid, pos, n):
        s = "".join(t[0] for t in ann[vid] if isinstance(t, list)); return s[max(0, pos - 6):pos + n + 6]

    w(f"# Review packet — {code} {info['name']['zh']} / {info['name']['en']}\n")
    w("Format: verseId#tokenIndex  reading  …context…   Fix readings in tools/lexicon/pinyin_overrides.json "
      "(occurrences: \"VID#i\": {w, py, reviewed, why}; words: global), segmentation in tools/lexicon/biblical_words.json "
      "(words / split / force_split / segment), then `python3 tools/book.py rebuild`.\n")

    # 1. multi-reading characters
    poly = set(json.load(open(f"{ROOT}/tools/lexicon/pinyin_overrides.json", encoding="utf-8"))["review_chars"])
    occ = defaultdict(list)
    for vid, toks in ann.items():
        lst = [t for t in toks if isinstance(t, list)]; pos = 0
        for i, t in enumerate(lst):
            if t[0] in poly: occ[t[0]].append((vid, i, t[1], ctx(vid, pos, len(t[0]))))
            pos += len(t[0])
    w("## 1. Characters with several readings\n")
    for ch, items in sorted(occ.items(), key=lambda kv: -len(kv[1])):
        counts = Counter(x[2] for x in items)
        show = items
        if ch in SAFE_MAJORITY:
            show = [x for x in items if x[2] != SAFE_MAJORITY[ch] or RISKY.search(x[3])]
        w(f"### {ch} {dict(counts)}" + (f" — showing {len(show)} unusual of {len(items)}" if len(show) != len(items) else ""))
        for vid, i, p, c in show: w(f"    {vid}#{i}  {p}  …{c}…")
    # 2. new words
    w("\n## 2. Words new in this book (not in other imported books)\n")
    seen, sus, plain = set(), [], []
    for vid, toks in ann.items():
        s = "".join(t[0] for t in toks if isinstance(t, list))
        for t in toks:
            if isinstance(t, list) and len(t[0]) >= 2 and HAN.search(t[0]) and t[0] not in others and t[0] not in seen:
                seen.add(t[0]); g = gloss(t[0]); i = s.find(t[0])
                line = f"    {vid}  {t[0]}  {t[1]}  [{(g or '—')[:40]}]  …{s[max(0, i-6):i+len(t[0])+6]}…"
                (sus if (g is None or SUSPICIOUS.search(g or "") or len(t[0]) >= 4) else plain).append(line)
    w(f"### Suspicious ({len(sus)}): no dictionary entry, odd gloss, or 4+ characters — check the split\n"); out.extend(sus)
    w(f"\n### Other new words ({len(plain)})\n"); out.extend(plain)
    # 3. names and dictionary oddities
    w("\n## 3. Names without an English note (write translit notes in tools/lexicon/study_notes.json)\n")
    for k, e in lex.items():
        if e["kind"] == "name":
            vid = next((v for v, toks in ann.items() if any(isinstance(t, list) and f"{t[0]}|{t[1]}" == k for t in toks)), None)
            w(f"    {k}  ({e.get('count')}×)  {vid}: {en.get(vid, '')[:110]}")
    w("\n## 4. Dictionary entries needing a look\n")
    for k, e in lex.items():
        if e["kind"] == "other-reading": w(f"    other-reading {k}: {e.get('alt')}")
        elif e["kind"] == "dictionary" and e.get("senses") and SUSPICIOUS.search(e["senses"][0]): w(f"    odd first sense {k}: {e['senses'][:2]}")
    os.makedirs(f"{ROOT}/build/review", exist_ok=True)
    path = f"{ROOT}/build/review/{code}.md"
    open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
    stats = Counter(e["kind"] for e in lex.values())
    print(f"REVIEW PACKET: {path}  ({sum(len(v) for v in occ.values())} multi-reading occurrences, {len(sus)} suspicious + {len(plain)} other new words, "
          f"{stats.get('name', 0)} names without notes; dictionary {dict(stats)})")


# ---------------------------------------------------------------- audio
def audio(code, check=False, chapters=None):
    chs = chapters or list(range(1, book_info(code)["chapters"] + 1))
    env = {} if check else {"NO_STT": "1"}
    r = sh("bash", "tools/generate_book.sh", code, *map(str, chs), env=dict(env, BUDGET=os.environ.get("BUDGET", "100000")))
    words(code)


def words(code):
    py("generate_word_audio.py", code, "--new-only")


def redo(code, specs):
    """Re-record whole chapters (e.g. after locking a reading): drops their bundles and regenerates."""
    chs = sorted({int(s.split(":")[0]) for s in specs})
    man_path = f"{DATA}/audio/azure-yunyang/manifest.json"
    man = json.load(open(man_path, encoding="utf-8"))
    checked = all(man["chapters"].get(f"{code}.{c}", {}).get("check", {}).get("checked", True) for c in chs)
    for c in chs:
        man["chapters"].pop(f"{code}.{c}", None)
        b = f"{ROOT}/build/audio_{code}_{c}.json"
        if os.path.exists(b): os.remove(b)
    json.dump(man, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    audio(code, check=checked and "--check" in sys.argv, chapters=chs)


# ---------------------------------------------------------------- publish bookkeeping
def hashes():
    out = {}
    for d, _, fs in os.walk(f"{ROOT}/public"):
        for f in fs:
            p = os.path.join(d, f); rel = os.path.relpath(p, f"{ROOT}/public")
            out[rel] = hashlib.sha256(open(p, "rb").read()).hexdigest()
    return out


def publish_list():
    old = json.load(open(PUBLISHED)) if os.path.exists(PUBLISHED) else {}
    cur = hashes()
    changed = sorted(k for k, v in cur.items() if old.get(k) != v)
    removed = sorted(k for k in old if k not in cur)
    print(json.dumps([{"as": k, "path": f"{ROOT}/public/{k}"} for k in changed], ensure_ascii=False))
    print(f"# {len(changed)} changed/new, {len(removed)} removed since last publish", file=sys.stderr)
    if removed: print("# removed:", removed, file=sys.stderr)


def mark_published():
    json.dump(hashes(), open(PUBLISHED, "w"), indent=0, sort_keys=True)
    print("recorded", PUBLISHED)


def status():
    man = json.load(open(f"{DATA}/audio/azure-yunyang/manifest.json", encoding="utf-8"))["chapters"]
    for b in canon()["books"]:
        if not b.get("imported"): continue
        rec = [k for k in man if k.split(".")[0] == b["code"]]
        unchecked = [k for k in rec if man[k].get("check", {}).get("checked") is False]
        print(f"{b['code']:4} {b['name']['zh']:6} {b['chapters']:3} ch  audio {len(rec)}/{b['chapters']}"
              + (f"  ({len(unchecked)} not checked)" if unchecked else ""))
    print("not imported:", " ".join(b["code"] for b in canon()["books"] if not b.get("imported")))


def test(code, all_suites=False):
    srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765"], cwd=f"{ROOT}/public", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import time; time.sleep(1)
        suites = [("book_generic.py", code)] + ([(s, None) for s in ("phase3.py", "audio.py", "srs_ui.py", "highlights.py", "backup.py", "nav.py", "book_1jn.py", "book_2_3jn.py", "book_mrk.py")] if all_suites else [])
        bad = 0
        for s, arg in suites:
            r = subprocess.run([sys.executable, f"tests/{s}"] + ([arg] if arg else []), cwd=ROOT, capture_output=True, text=True)
            lines = [l for l in r.stdout.splitlines() if l.startswith(("FAIL", "ok")) or "passed" in l]
            print(f"--- {s}: " + (lines[-1] if lines else r.stderr[-500:]))
            for l in lines:
                if l.startswith("FAIL"): print("   ", l); bad += 1
        if bad: raise SystemExit(f"{bad} failing checks")
    finally:
        srv.terminate()


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a: print(__doc__); sys.exit(0)
    cmd = a[0]
    if cmd == "status": status()
    elif cmd == "prepare": prepare(a[1])
    elif cmd == "rebuild": rebuild()
    elif cmd == "review": extract_sources(); review_packet(a[1])
    elif cmd == "audio":
        chs = [int(x) for x in a[a.index("--chapters") + 1].split(",")] if "--chapters" in a else None
        audio(a[1], check="--check" in a, chapters=chs)
    elif cmd == "words": words(a[1])
    elif cmd == "redo": redo(a[1], a[2:])
    elif cmd == "test": test(a[1], all_suites="--all" in a)
    elif cmd == "publish-list": publish_list()
    elif cmd == "mark-published": mark_published()
    else: print(__doc__); sys.exit(1)
