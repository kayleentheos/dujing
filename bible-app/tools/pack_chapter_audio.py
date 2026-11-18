#!/usr/bin/env python3
"""Pack the per-verse clips of a chapter into one MP3 with exact verse timings.

Each verse clip is decoded to PCM; the PCM is concatenated and encoded once,
so verse boundaries are computed from sample counts (exact), not estimated.
Updates the manifest entry for the chapter to the single-file form:
  { file: "JHN/1.mp3", timings: { "JHN.1.1": [start, end], ... }, ... }
and removes the per-verse clips from public/ (they stay in build/).

Usage: pack_chapter_audio.py <set> <BOOK> <chapter> [<chapter> ...]
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SET, BOOK, chapters = sys.argv[1], sys.argv[2], [int(c) for c in sys.argv[3:]]
SR = 24000
base = f"{ROOT}/public/data/audio/{SET}"
man_path = f"{base}/manifest.json"
man = json.load(open(man_path, encoding="utf-8"))
keep = f"{ROOT}/build/clips/{SET}/{BOOK}"

for c in chapters:
    key = f"{BOOK}.{c}"
    ch = man["chapters"][key]
    if "timings" in ch:
        print(key, "already packed"); continue
    pcm, timings, pos = bytearray(), {}, 0
    order = sorted(ch["verses"], key=lambda v: int(v.split(".")[2]))
    for vid in order:
        f = f"{base}/{ch['verses'][vid]['file']}"
        raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", f, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"])
        n = len(raw) // 2
        timings[vid] = [round(pos / SR, 3), round((pos + n) / SR, 3)]
        pcm += raw; pos += n
    out = f"{base}/{BOOK}/{c}.mp3"
    p = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ac", "1", "-ar", str(SR), "-i", "-",
                        "-c:a", "libmp3lame", "-b:a", "48k", out], input=bytes(pcm))
    assert p.returncode == 0
    # keep the verse clips outside public/
    os.makedirs(f"{keep}/{c}", exist_ok=True)
    for vid in order:
        src = f"{base}/{ch['verses'][vid]['file']}"
        shutil.move(src, f"{keep}/{c}/{os.path.basename(src)}")
    try: os.rmdir(f"{base}/{BOOK}/{c}")
    except OSError: pass
    ch.pop("verses")
    ch.update(file=f"{BOOK}/{c}.mp3", timings=timings, duration=round(pos / SR, 2), bytes=os.path.getsize(out))
    print(key, f"{len(timings)} verses, {pos/SR/60:.1f} min, {os.path.getsize(out)//1024} KB")
json.dump(man, open(man_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
