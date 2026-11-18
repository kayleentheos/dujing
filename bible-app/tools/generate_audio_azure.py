#!/usr/bin/env python3
"""Generate per-verse Mandarin audio with Azure AI Speech and transcribe each
clip back (speech-to-text) for the pronunciation check.

The key is read from a private file outside the app (never from or into
public/). Output is a bundle for tools/import_audio.py.

Usage: generate_audio_azure.py <ssml.json from build_tts_ssml.py> <bundle-out.json> [voice]
Set NO_STT=1 to skip the speech-to-text check (voice only; the chapter is then marked "not checked").
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error

KEY = open(os.path.join(os.environ.get("SECRETS", "/home/claude/.secrets"), "azure_speech_key")).read().strip()
REGION = open(os.path.join(os.environ.get("SECRETS", "/home/claude/.secrets"), "azure_speech_region")).read().strip()
src, out_path = sys.argv[1], sys.argv[2]
VOICE = sys.argv[3] if len(sys.argv) > 3 else "zh-CN-YunyangNeural"
items = json.load(open(src, encoding="utf-8"))["verses"]
bundle = json.load(open(out_path, encoding="utf-8")) if os.path.exists(out_path) else {}


def request(url, data, headers, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"Ocp-Apim-Subscription-Key": KEY, **headers}, method="POST")
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and i < tries - 1:
                time.sleep(4 * (i + 1)); continue
            raise RuntimeError(f"{e.code} {e.read()[:200]!r}")
        except urllib.error.URLError:
            time.sleep(4 * (i + 1))
    raise RuntimeError("retries exhausted")


def stt_check(mp3):
    """Transcribe a clip; returns {lexical, display} or {error} (never fatal)."""
    with tempfile.TemporaryDirectory() as d:
        open(f"{d}/a.mp3", "wb").write(mp3)
        subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", f"{d}/a.mp3", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", f"{d}/a.wav"])
        wav = open(f"{d}/a.wav", "rb").read()
    time.sleep(1.5)
    try:
        s = json.loads(request(f"https://{REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=detailed",
                               wav, {"Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000"}))
        return {"display": s.get("DisplayText", ""), "status": s.get("RecognitionStatus"), "lexical": (s.get("NBest") or [{}])[0].get("Lexical", "")}
    except Exception as e:
        return {"error": str(e)[:120]}


# second pass: recheck clips whose transcription failed earlier
if "--recheck" in sys.argv:
    for vid, r in bundle.items():
        if "error" in (r.get("stt") or {}):
            r["stt"] = stt_check(base64.b64decode(r["mp3"]))
            json.dump(bundle, open(out_path, "w", encoding="utf-8"))
            print("recheck", vid, r["stt"].get("display", r["stt"].get("error")), flush=True)
            time.sleep(2)
    sys.exit(0)

for vid, item in items.items():
    if vid in bundle:
        continue
    ssml = (f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">'
            f'<voice name="{VOICE}">{item["ssml"]}</voice></speak>')
    mp3 = request(f"https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1", ssml.encode("utf-8"),
                  {"Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "dujing"})
    with tempfile.TemporaryDirectory() as d:
        open(f"{d}/a.mp3", "wb").write(mp3)
        dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f"{d}/a.mp3"]).strip())
    stt = {"skipped": True} if os.environ.get("NO_STT") else stt_check(mp3)
    bundle[vid] = {"mp3": base64.b64encode(mp3).decode(), "duration": dur, "bytes": len(mp3), "stt": stt}
    json.dump(bundle, open(out_path, "w", encoding="utf-8"))
    print(vid, f"{dur:.2f}s", (bundle[vid]["stt"].get("display") or bundle[vid]["stt"].get("error", "") or "(not checked)")[:40], flush=True)
    time.sleep(0.5 if os.environ.get("NO_STT") else 1.5)
print("DONE", len(bundle))
