// Reading settings defaults and their mapping to the design's CSS variables
// (shared so web and mobile render the same typography).
import type { ReadingSettings } from "./types";

export function defaultSettings(viewportWidth = 1024): ReadingSettings {
  const narrow = viewportWidth < 720;
  return {
    pinyin: "hard", zhVersion: "cuv", enVersion: "web", script: "simplified",
    zhSize: narrow ? 20 : 22, pySize: 11, enSize: narrow ? 16 : 17,
    leading: 2.05, measure: 34, redLetter: true, showNotes: true, showHeadings: true,
  };
}
export function typographyVars(s: ReadingSettings): Record<string, string> {
  return { "--zh-size": `${s.zhSize}px`, "--py-size": `${s.pySize}px`, "--en-size": `${s.enSize}px`, "--leading": String(s.leading), "--measure": `${s.measure}em` };
}
