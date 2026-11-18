# 读经 · Learn Chinese through Scripture — web app

The full web application (Next.js + TypeScript, Supabase in later phases),
grown out of the original prototype in `../bible-app`.

## Layout

| Folder | What it is | Depends on |
|---|---|---|
| `packages/core` | Pure TypeScript rules: Bible content assembly, references, dictionary helpers, vocabulary, spaced repetition, highlights, reading settings, backup format and import planning. No React, no browser APIs, no database. | nothing |
| `packages/data` | User-data services (save word, study, highlight, bookmark, progress, import/export) behind a `UserDataStore` interface. In-memory store now; Supabase store in Phase 4. | core |
| `apps/web` | The Next.js app (screens only). | core, data |
| `apps/web/public/content` | Static Bible text, alignment, word tokens, dictionary, audio — the same for every user. Synced from the original project with `npm run content:sync`. | — |
| `supabase/` | Database schema and security rules (Phase 2/4). | — |
| `docs/` | Architecture and the future mobile app plan. | — |

## Commands

```
npm install
npm test             # unit tests for core + data (vitest)
npm run typecheck    # TypeScript, all packages
npm run dev          # web app at http://localhost:3000
npm run build        # production build
```

## Rules carried over from the original project
* Scripture is never paraphrased or altered; tests check every verse.
* Definitions and pinyin come only from the dictionary data; missing means "unavailable".
* Chinese-only reading by default; English only on request.
* No secret keys in frontend code.
