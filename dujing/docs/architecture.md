# Architecture

```
            ┌──────────────────────── apps/web (Next.js) ─────────────────────────┐
            │  screens & interaction only: reader, popover, vocabulary, study…    │
            └───────────────┬───────────────────────────────┬─────────────────────┘
                            │                               │
             ┌──────────────▼──────────────┐   ┌────────────▼─────────────┐
             │ @dujing/data  (services)    │   │ static content /content/ │
             │ vocab · study · highlights  │   │ Bible text, tokens,      │
             │ bookmarks · reading · backup│   │ dictionary, audio        │
             └──────────────┬──────────────┘   └────────────▲─────────────┘
                            │ UserDataStore interface        │ ContentSource interface
             ┌──────────────▼──────────────┐                 │
             │ memory (tests) │ Supabase   │       ┌─────────┴──────────┐
             │                │ (Phase 4)  │       │ @dujing/core       │
             └─────────────────────────────┘       │ pure rules & types │
                                                    └────────────────────┘
```

* **Content** is static and shared by everyone: served as files (CDN), never copied per user.
* **User data** goes through `UserDataStore`. Every method is implicitly scoped to the
  signed-in user; in Supabase this is enforced by Row Level Security (`user_id = auth.uid()`),
  not by the app, so a bug in a screen still cannot read another person's rows.
* **Rules** (scheduling, highlight painting, save-without-duplicates, import merging) live in
  `core` as pure functions with tests, so the web app and a phone app behave identically.

## Moving data from the original app
1. The original app has **Back up my data** (Library → My Notebook), producing a
   `dujing-backup` v1 file. A server-side copy was also taken on 2026-11-17.
2. `parseBackup()` validates it (malformed records are listed, never silently dropped).
3. `planImport()` merges into the account: words by word+pinyin, verse links by verse,
   review answers by time+result, highlights by id and position, reading progress by union.
   Importing the same file twice changes nothing (tested on the real backup).
