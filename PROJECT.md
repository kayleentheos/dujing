# 读经 — Learn Chinese through the Bible

A Du Chinese–style reader: Chinese Union Version 1919 (新标点和合本, eBible `cmn-cu89s`, public domain)
with the World English Bible, every word tappable, vocabulary + spaced repetition, highlights, audio.

**Start here in a new chat:** "Read PROJECT.md in kayleentheos/dujing and continue with the next book."

## Ground rules (never break)
- Scripture is never altered. Imports are verified against eBible's independent VPL files; token lists must join back to the verse exactly.
- No invented pinyin or definitions: readings come from pypinyin + CC-CEDICT, corrected only through documented overrides; dictionary senses come from CC-CEDICT; study notes are clearly ours.
- Chinese first; English only on demand. Dictionary opens on click/tap, never hover.
- Audio is real Azure TTS (voice `zh-CN-YunyangNeural`); chapters not checked by speech-to-text say so in the player.
- **Secrets never enter the repo or the chat.** The Azure key lives in a file outside the repo (`$SECRETS`, default `/home/claude/.secrets`, files `azure_key`, `azure_region`). In a new chat, Kayleen copies that file into a folder shared from her computer; Claude reads it from there.
- Personal data backups (`dujing-backup-*.json`) are never committed.

## Layout
```
bible-app/          the live app (vanilla JS, published as a Claude artifact)
  public/           everything that gets published (index.html, js/, css/, data/)
  sources/          original eBible + CC-CEDICT zips, checked by SHA256SUMS
  tools/            the pipeline (Python); tools/lexicon/*.json = all human decisions
  tests/            Playwright browser tests
  published.json    hashes of public/ at the last publish
dujing/             the future web app (Next.js + TypeScript, npm workspaces) — Phase 1 done, Phase 2 (accounts) not started
```
Live website: **https://dujing-public.vercel.app** — Vercel project `dujing-public`, Root Directory `bible-app/public`, preset Other, no build; every push to `main` redeploys automatically (saves to the browser; no accounts yet).
Claude artifact (private, synced to Kayleen's Claude account; updated only by hand) slug: `c0ef4150-c2f3-4cfa-8fbb-28a276ac63bf` (multi-file; publish with `publish_files`; last published version 1795022675-d793).

## Status (2026-11-18)
| Book | Text + words + dictionary | Audio |
|---|---|---|
| John 约翰福音 (21) | ✓ | ✓ checked |
| 1 John 约翰一书 (5) | ✓ | ✓ checked |
| 2 John, 3 John | ✓ | ✓ checked |
| Mark 马可福音 (16) | ✓ | ✓ checked |

Plan ("Option A": Claude Pro, Azure pay-as-you-go, voice only, no speech checks): about 30 sessions;
finish ≈ mid-February 2027 at 3 sessions/week. Remaining ≈ 876k characters ≈ 55 h audio ≈ $13 TTS.
Suggested next: Philippians, Ephesians, Colossians, James, 1–2 Peter, Ruth, Jonah, then Luke, Acts, Genesis…

## Setup in a fresh session
```bash
git clone https://github.com/kayleentheos/dujing project && cd project/bible-app
pip install --break-system-packages -r tools/requirements.txt   # jieba, pypinyin, playwright
export SECRETS=/path/to/folder/with/azure_key                   # only needed for audio
```

## Adding a book (the whole loop)
```bash
python3 tools/book.py status
python3 tools/book.py prepare PHP      # import → align → verify → canon → words → dictionary → review packet
#  - if alignment stops: add a documented entry to public/data/alignment/overrides.json, rerun
#  - read build/review/PHP.md; fix readings in tools/lexicon/pinyin_overrides.json,
#    splits in tools/lexicon/biblical_words.json, notes/names in tools/lexicon/study_notes.json
python3 tools/book.py rebuild          # re-run words+dictionary for ALL books; shows changes vs last commit
python3 tools/book.py audio PHP        # voice only; add --check for the speech-to-text check (costs STT time)
python3 tools/book.py test PHP         # browser test (add --all for every suite)
git add -A && git commit -m "Add Philippians" && git push   # → website updates in ~1 min
python3 tools/book.py publish-list     # optional: JSON list of changed files → publish_files to the artifact
python3 tools/book.py mark-published
```
Also: `redo BOOK CH` re-records chapters after fixing a reading. Library reading plans live in
`public/js/views/library.js`. Book abbreviations for search come from `tools/build_canon.py` (`ZH_ABBR`).

## Known gotchas
- Adding a word to `pinyin_overrides.json` "words" also adds it to the segmenter and can change splits elsewhere — check `rebuild` output.
- Occurrence overrides are keyed `VERSEID#tokenIndex` (punctuation counts); they shift if segmentation changes.
- Azure rejects some phonemes (e.g. "lve" for 加略): leave those unforced.
- `build/` (bundles, clips, review packets) is not in git; without it, fixing one verse means re-recording the chapter.
- Audio is ~73 MB in git for the NT so far; reassess before the Old Testament (Git LFS or external storage).

## Open items
- John: 拿撒勒 may be voiced sā/sà in older recordings (not re-recorded).
- Phase 2 (Supabase accounts + sync) awaits Kayleen's go-ahead.
