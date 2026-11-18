// Copy the static Bible content (texts, alignment, word tokens, dictionary,
// audio) produced by the import pipeline into the web app's public folder.
// Source: the original project (../bible-app/public/data). Content is identical
// for every user, so it is served as static files, not stored per user.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const src = resolve(process.env.DUJING_CONTENT_SRC ?? "../bible-app/public/data");
const dest = resolve("apps/web/public/content");
if (!existsSync(src)) { console.error(`Content source not found: ${src}`); process.exit(1); }
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
let n = 0, bytes = 0;
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f), s = statSync(p); if (s.isDirectory()) walk(p); else { n++; bytes += s.size; } } };
walk(dest);
console.log(`Copied ${n} content files (${(bytes / 1e6).toFixed(1)} MB) to ${dest}`);
