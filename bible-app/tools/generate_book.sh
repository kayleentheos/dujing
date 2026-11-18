#!/bin/bash
# Generate, check and import audio for the given chapters; resumable.
# Usage: tools/generate_book.sh JHN 2 3 4 ...   (stops cleanly after $BUDGET seconds)
BOOK=$1; shift
BUDGET=${BUDGET:-540}
START=$(date +%s)
for C in "$@"; do
  python3 -c "import json,sys;m=json.load(open('public/data/audio/azure-yunyang/manifest.json'));sys.exit(0 if '$BOOK.$C' in m['chapters'] else 1)" && { echo "skip $C (done)"; continue; }
  python3 tools/build_tts_ssml.py $BOOK $C > build/ssml_${BOOK}_$C.json
  N=$(python3 -c "import json;print(len(json.load(open('build/ssml_${BOOK}_$C.json'))['verses']))")
  timeout $(( BUDGET - ($(date +%s) - START) )) python3 tools/generate_audio_azure.py build/ssml_${BOOK}_$C.json build/audio_${BOOK}_$C.json >> build/gen_${BOOK}_$C.log 2>&1
  HAVE=$(python3 -c "import json,os;p='build/audio_${BOOK}_$C.json';print(len(json.load(open(p))) if os.path.exists(p) else 0)")
  if [ "$HAVE" = "$N" ]; then
    python3 tools/generate_audio_azure.py build/ssml_${BOOK}_$C.json build/audio_${BOOK}_$C.json --recheck >> build/gen_${BOOK}_$C.log 2>&1
    python3 tools/import_audio.py build/audio_${BOOK}_$C.json azure-yunyang $BOOK $C zh-CN-YunyangNeural "Microsoft Azure AI Speech" && python3 tools/pack_chapter_audio.py azure-yunyang $BOOK $C
  else
    echo "chapter $C: $HAVE/$N verses so far (will resume)"; exit 0
  fi
  [ $(( $(date +%s) - START )) -ge $(( BUDGET - 20 )) ] && { echo "time budget reached"; exit 0; }
done
echo ALL-DONE
