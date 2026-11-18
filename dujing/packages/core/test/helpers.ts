import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ContentSource } from "../src";
export const CONTENT = resolve(__dirname, "../../../apps/web/public/content");
export const diskSource: ContentSource = { async getJSON(p) { return JSON.parse(readFileSync(resolve(CONTENT, p), "utf8")); } };
export const readJSON = (p: string) => JSON.parse(readFileSync(p, "utf8"));
