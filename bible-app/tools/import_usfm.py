#!/usr/bin/env python3
"""Import one book from an official eBible.org USFM file into the app's JSON format.

Usage: import_usfm.py <usfm-file> <translation-id> <lang: zh|en> <out.json>

The importer never edits wording. It only:
  * removes USFM markup (keeping the marked words),
  * moves footnotes / cross-references out of the verse text into `notes`,
  * joins source line breaks (Chinese: removed; English: single space).
Character styles (words of Jesus, supplied words, proper names) are kept as runs.
"""
import json, re, sys

PARA = {"p", "m", "nb", "q1", "q2", "q3", "pi", "pi1", "pi2", "li", "li1", "li2", "pc", "pmo", "mi", "b"}
HEAD = {"r", "s", "s1", "s2", "ms", "mr", "d", "sp"}
META = {"id", "ide", "h", "toc1", "toc2", "toc3", "mt", "mt1", "mt2", "mt3", "rem", "usfm", "sts"}
CHAR = {"wj", "add", "pn", "nd", "qs", "tl", "it", "bk", "fv"}

TOKEN = re.compile(r"\\(\+?)([a-z]+\d*)(\*?)")
ASCII_WS = re.compile(r"[ \t\r\n]+")  # never touches U+3000 (ideographic space)


def strip_word_attrs(t):
    # \w word|strong="G1234"\w*  ->  word   (WEB carries Strong's numbers)
    return re.sub(r"\\(\+?)w ([^|\\]*?)\|[^\\]*?\\\+?w\*", r"\2", t)


def parse(path, lang):
    raw = open(path, encoding="utf-8").read()
    t = strip_word_attrs(raw)
    book = {"meta": {}, "chapters": {}}
    ch = None
    verse = None
    styles = []           # active character styles in verse text
    pending_para = None   # paragraph marker waiting for next verse
    pending_head = []     # headings waiting for next verse
    mode = "text"         # text | meta | head | note
    meta_key = None
    head_buf = None
    note = None

    def sep(s):
        if lang == "zh":
            return ASCII_WS.sub("", s)
        return ASCII_WS.sub(" ", s)

    def emit(s):
        nonlocal head_buf
        if mode == "meta":
            book["meta"][meta_key] = (book["meta"].get(meta_key, "") + s)
        elif mode == "head":
            head_buf["text"] += s
        elif mode == "note":
            if note["field"] in ("ft", "xt", "fv", "fq", "fqa", "fk"):
                note["text"] += s
            elif note["field"] in ("fr", "xo"):
                note["ref"] += s
        else:
            if verse is None:
                if s.strip():
                    raise ValueError("text outside verse: %r" % s[:40])
                return
            s = sep(s)
            if not s:
                return
            st = "+".join(styles) if styles else ""
            runs = verse["runs"]
            prev = next((r for r in reversed(runs) if isinstance(r, list)), None)
            if s.startswith(" ") and (prev is None or prev[0].endswith(" ")):
                s = s.lstrip(" ")  # space on both sides of a removed note
                if not s:
                    return
            if runs and isinstance(runs[-1], list) and runs[-1][1] == st:
                runs[-1][0] += s
            else:
                runs.append([s, st])

    def close_head():
        nonlocal head_buf, mode
        if head_buf is not None:
            head_buf["text"] = ASCII_WS.sub(" ", head_buf["text"]).strip()
            pending_head.append(head_buf)
            head_buf = None
        mode = "text"

    pos = 0
    for m in TOKEN.finditer(t):
        emit(t[pos:m.start()])
        plus, name, star = m.groups()
        end = m.end()
        # a marker is followed by one delimiting space (or newline)
        if not star and end < len(t) and t[end] in " \n":
            end += 1
        pos = end
        if mode == "meta" and t[m.start() - 1:m.start()] != "\n" and False:
            pass
        if name in META:
            close_head() if mode == "head" else None
            mode, meta_key = "meta", name
            # metadata runs until end of line
            nl = t.find("\n", pos)
            book["meta"][name] = t[pos:nl].strip()
            pos = nl
            mode = "text"
            continue
        if name == "c":
            close_head() if mode == "head" else None
            mt = re.match(r"(\d+)", t[pos:])
            ch = int(mt.group(1))
            pos += mt.end()
            book["chapters"][ch] = []
            verse = None
            continue
        if name == "v":
            close_head() if mode == "head" else None
            mt = re.match(r"(\d+)(?:-(\d+))?\s", t[pos:])
            pos += mt.end()
            styles.clear()
            verse = {"v": int(mt.group(1)), "runs": [], "notes": []}
            if mt.group(2):
                verse["v_end"] = int(mt.group(2))
            if pending_para:
                verse["para"] = pending_para
                pending_para = None
            if pending_head:
                verse["headings"] = pending_head[:]
                pending_head.clear()
            book["chapters"][ch].append(verse)
            continue
        if name in PARA:
            if mode == "head":
                close_head()
            # paragraph inside a verse -> mark a break run; else defer to next verse
            pending_para = name
            if verse is not None and verse["runs"]:
                verse["runs"].append({"br": name})
                pending_para = None
            continue
        if name in HEAD:
            if mode == "head":
                close_head()
            mode = "head"
            head_buf = {"type": name, "text": ""}
            continue
        if name in ("f", "x"):
            if star:
                note["text"] = ASCII_WS.sub(" ", note["text"]).strip()
                note["ref"] = note["ref"].strip()
                verse["notes"].append(note)
                note = None
                mode = "text"
            else:
                caller = re.match(r"(\S+)\s", t[pos:])
                pos += caller.end()
                offset = sum(len(r[0]) for r in verse["runs"] if isinstance(r, list))
                note = {"type": "footnote" if name == "f" else "crossref", "ref": "", "text": "",
                        "at": offset, "field": None}
                mode = "note"
            continue
        if mode == "note":
            if name in ("fv",) and plus:
                # verse number inside a footnote, keep it visibly
                if not star:
                    note["text"] += "〔"
                else:
                    note["text"] += "〕"
                note["field"] = "ft" if star else "fv"
                continue
            if not star:
                note["field"] = name
            continue
        if name in CHAR:
            if star:
                if styles and styles[-1] == name:
                    styles.pop()
                elif name in styles:
                    styles.remove(name)
            else:
                styles.append(name)
            continue
        raise ValueError("unhandled marker \\%s%s%s at %d" % (plus, name, star, m.start()))
    emit(t[pos:])

    # finalize verses: trim, plain text
    for c, verses in book["chapters"].items():
        for v in verses:
            runs = v["runs"]
            # trim leading/trailing whitespace of the whole verse
            lst = [r for r in runs if isinstance(r, list)]
            while lst and not lst[-1][0].strip(" "):
                lst[-1][0] = ""
                lst.pop()
            if lst:
                lead = len(lst[0][0]) - len(lst[0][0].lstrip(" "))
                lst[0][0] = lst[0][0].lstrip(" ")
                lst[-1][0] = lst[-1][0].rstrip(" ")
                for n in v["notes"]:
                    n["at"] = max(0, n["at"] - lead)
            v["runs"] = [r for r in runs if not isinstance(r, list) or r[0]]
            while v["runs"] and isinstance(v["runs"][-1], dict):
                v["runs"].pop()
            v["text"] = "".join(r[0] for r in v["runs"] if isinstance(r, list))
            for n in v["notes"]:
                n.pop("field", None)
                n["at"] = min(n["at"], len(v["text"]))
            if not v["notes"]:
                del v["notes"]
    return raw, book


if __name__ == "__main__":
    src, tid, lang, out = sys.argv[1:5]
    raw, book = parse(src, lang)
    code = book["meta"]["id"].split()[0]
    doc = {"translation": tid, "book": code, "meta": book["meta"], "chapters": {}}
    for c, verses in book["chapters"].items():
        doc["chapters"][str(c)] = [dict(id=f"{code}.{c}.{v['v']}", **v) for v in verses]
    json.dump(doc, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n = sum(len(v) for v in doc["chapters"].values())
    print(f"{tid} {code}: {len(doc['chapters'])} chapters, {n} verses -> {out}")
