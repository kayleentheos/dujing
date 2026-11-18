#!/usr/bin/env python3
"""Record the pronunciation of every dictionary word of a book (Azure TTS).

Every word whose pinyin was confirmed (dictionary or reviewed) is spoken with
an SSML phoneme carrying that pinyin (tone sandhi inside the word applied), so
an isolated polyphonic word is read as it is in its verse (得 dé vs de,
差 chāi). Names whose pinyin is only from character readings are read by the
voice without forcing, as in the verse audio.

Words are synthesised in batches separated by long pauses and split at the
pauses; if a batch does not split into exactly as many pieces as words, it is
redone one word per request. Output: sprite MP3s + a manifest
  public/data/audio/<set>/words/<BOOK>-<n>.mp3
  public/data/audio/<set>/words/<BOOK>.json  { "<word>|<pinyin>": [sprite, start, end] }

Usage: generate_word_audio.py BOOK [--limit N] [--new-only]
  --new-only: skip words already recorded for another book (the app looks them up there).
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRETS = os.environ.get("SECRETS", "/home/claude/.secrets")
KEY = open(f"{SECRETS}/azure_speech_key").read().strip()
REGION = open(f"{SECRETS}/azure_speech_region").read().strip()
VOICE, SET = "zh-CN-YunyangNeural", "azure-yunyang"
BOOK = sys.argv[1]
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
SR = 24000
work = f"{ROOT}/build/words/{BOOK}"
os.makedirs(work, exist_ok=True)
sys.path.insert(0, f"{ROOT}/tools")
from build_tts_ssml import sandhi  # noqa: E402  (same tone-sandhi rule as the verse audio)

lex = json.load(open(f"{ROOT}/public/data/lexicon/{BOOK}.json", encoding="utf-8"))["entries"]
keys = sorted(lex, key=lambda k: -lex[k].get("count", 0))
if LIMIT: keys = keys[:LIMIT]
_wdir = f"{ROOT}/public/data/audio/{SET}/words"
if "--new-only" in sys.argv:
    known = set()
    for f in (os.listdir(_wdir) if os.path.isdir(_wdir) else []):
        if f.endswith(".json") and f not in (f"{BOOK}.json", "index.json"):
            known |= set(json.load(open(f"{_wdir}/{f}", encoding="utf-8"))["words"])
    keys = [k for k in keys if k not in known]
    print(f"{len(keys)} words not yet recorded for another book", flush=True)


def ssml_word(e):
    w, py = e["w"], e["py"]
    syl = py.split()
    if e.get("pyChecked") and len(syl) == len(w) and all(s != "r" for s in syl):
        return f'<phoneme alphabet="sapi" ph="{sandhi(w, syl)}">{w}</phoneme>'
    return w


def tts(inner):
    ssml = f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="{VOICE}">{inner}</voice></speak>'
    for i in range(5):
        try:
            req = urllib.request.Request(f"https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1", data=ssml.encode(),
                                         headers={"Ocp-Apim-Subscription-Key": KEY, "Content-Type": "application/ssml+xml",
                                                  "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm", "User-Agent": "dujing"}, method="POST")
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 400: raise ValueError("400")
            time.sleep(4 * (i + 1))
        except urllib.error.URLError:
            time.sleep(4 * (i + 1))
    raise RuntimeError("tts failed")


def pcm(wav):  # strip RIFF header -> raw s16le
    i = wav.find(b"data"); return wav[i + 8:]


def split_on_silence(raw, n):
    """Split raw PCM at pauses >= 0.6 s; returns list of (start,end) sample indices."""
    with tempfile.NamedTemporaryFile(suffix=".raw") as f:
        f.write(raw); f.flush()
        out = subprocess.run(["ffmpeg", "-v", "info", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", f.name,
                              "-af", "silencedetect=n=-42dB:d=0.6", "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    total = len(raw) / 2 / SR
    segs, cur = [], 0.0
    for s, e in zip(starts, ends + [total] * (len(starts) - len(ends))):
        if s > cur + 0.05: segs.append((cur, s))
        cur = e
    if cur < total - 0.05: segs.append((cur, total))
    return segs if len(segs) == n else None


clips = {}          # key -> raw pcm
done_path = f"{work}/clips.json"
if os.path.exists(done_path):
    import base64
    clips = {k: base64.b64decode(v) for k, v in json.load(open(done_path)).items()}

batch = [k for k in keys if k not in clips]
B = 30
for i in range(0, len(batch), B):
    group = batch[i:i + B]
    inner = '<break time="1500ms"/>'.join(ssml_word(lex[k]) for k in group)
    segs = None
    try:
        raw = pcm(tts(inner)); segs = split_on_silence(raw, len(group))
    except ValueError:
        raw = None
    if segs:
        for k, (s, e) in zip(group, segs):
            a, b = max(0, int((s - 0.06) * SR)), int((e + 0.08) * SR)
            clips[k] = raw[a * 2:b * 2]
    else:   # fall back: one request per word
        for k in group:
            try: r = pcm(tts(ssml_word(lex[k])))
            except ValueError: r = pcm(tts(lex[k]["w"]))         # notation refused: read naturally
            clips[k] = r
            time.sleep(3.1)
    import base64
    json.dump({k: base64.b64encode(v).decode() for k, v in clips.items()}, open(done_path, "w"))
    print(f"{len(clips)}/{len(keys)}", "split" if segs else "per-word", flush=True)
    time.sleep(3.1)

# trim leading/trailing silence of per-word fallbacks and pack sprites of ~120 words
outdir = f"{ROOT}/public/data/audio/{SET}/words"
os.makedirs(outdir, exist_ok=True)
index, PER = {}, 120
ordered = [k for k in keys if k in clips]
for n in range(0, len(ordered), PER):
    part, buf, pos = ordered[n:n + PER], bytearray(), 0
    sprite = f"{BOOK}-{n // PER + 1}.mp3"
    for k in part:
        with tempfile.NamedTemporaryFile(suffix=".raw") as f:
            f.write(clips[k]); f.flush()
            trimmed = subprocess.check_output(["ffmpeg", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", f.name,
                "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse",
                "-f", "s16le", "-"])
        seg = trimmed + b"\x00\x00" * int(0.25 * SR)       # 0.25 s gap after each word
        n_s = len(trimmed) // 2
        index[k] = [sprite, round(pos / SR, 3), round((pos + n_s) / SR, 3)]
        buf += seg; pos += len(seg) // 2
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-b:a", "48k",
                    f"{outdir}/{sprite}"], input=bytes(buf), check=True)
json.dump({"book": BOOK, "voice": VOICE, "note": "Isolated word pronunciation; reviewed pinyin applied as SSML phonemes where confirmed.",
           "words": index}, open(f"{outdir}/{BOOK}.json", "w", encoding="utf-8"), ensure_ascii=False)
# books that have word recordings, in the order the app should look them up
books = sorted(f[:-5] for f in os.listdir(outdir) if f.endswith(".json") and f != "index.json")
json.dump({"books": books}, open(f"{outdir}/index.json", "w", encoding="utf-8"))
print("PACKED", len(index), "words in", (len(ordered) + PER - 1) // PER, "sprites")
