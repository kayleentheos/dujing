// Server-side access to the static Bible content (public/content). Pages are
// pre-rendered from it at build time; the browser can also fetch the same
// files from /content/ through @dujing/core's fetchSource.
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createBibleRepo } from "@dujing/core";

const ROOT = join(process.cwd(), "public", "content");
export const bible = createBibleRepo({ async getJSON(p) { return JSON.parse(await readFile(join(ROOT, p), "utf8")); } });
