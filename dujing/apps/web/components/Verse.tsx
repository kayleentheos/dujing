import { isWord, type ChapterRow } from "@dujing/core";

const HAN = /[㐀-鿿豈-﫿]/;
const cls = (st?: string) => (st || "").split("+").filter(Boolean).join(" ");

/** A Chinese verse: word tokens with per-character pinyin ruby, same markup as the original app. */
export function ZhVerse({ v, bands }: { v: ChapterRow["zh"][number]; bands: Record<string, number> }) {
  const [, , n] = v.id.split(".");
  let pos = 0, ti = 0;
  return (
    <span className="verse" data-id={v.id} lang="zh-Hans">
      <button type="button" className="vnum" data-verse={v.id} aria-label={`Verse ${n}`}>{n}</button>
      {(v.tokens ?? []).map((t, k) => {
        if (!isWord(t)) return <br key={k} className="poetry-break" />;
        const [text, py, st] = t; const at = pos; pos += text.length;
        if (!HAN.test(text)) return <span key={k} className={["p", cls(st)].filter(Boolean).join(" ")} data-o={at} data-n={text.length}>{text}</span>;
        const syl = (py || "").split(" ").filter(Boolean), chars = [...text];
        const className = ["w", cls(st), (bands[text] ?? 0) >= 3 ? "is-hard" : "", "is-tappable"].filter(Boolean).join(" ");
        return (
          <span key={k} className={className} data-t={ti++} data-o={at} data-n={text.length}>
            {syl.length === chars.length
              ? <ruby>{chars.map((c, i) => [c, <rt key={i}>{syl[i]}</rt>])}</ruby>
              : syl.length ? <ruby>{text}<rt>{syl.join("")}</rt></ruby> : text}
          </span>
        );
      })}
    </span>
  );
}
