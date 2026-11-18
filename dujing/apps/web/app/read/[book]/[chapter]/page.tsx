import Link from "next/link";
import { notFound } from "next/navigation";
import { defaultSettings, typographyVars } from "@dujing/core";
import { bible } from "@/lib/content";
import { ZhVerse } from "@/components/Verse";

const ZH_NUM = "〇一二三四五六七八九";
const zhNum = (n: number) => n <= 10 ? (n === 10 ? "十" : ZH_NUM[n]!) : n < 20 ? "十" + ZH_NUM[n - 10] : ZH_NUM[Math.floor(n / 10)] + "十" + (n % 10 ? ZH_NUM[n % 10] : "");

export async function generateStaticParams() {
  const books = (await bible.canon()).books.filter(b => b.imported);
  return books.flatMap(b => Array.from({ length: b.chapters }, (_, i) => ({ book: b.code, chapter: String(i + 1) })));
}

export default async function ReadPage({ params }: { params: Promise<{ book: string; chapter: string }> }) {
  const { book, chapter } = await params;
  const info = await bible.bookInfo(book);
  const ch = Number(chapter);
  if (!info || !Number.isInteger(ch) || ch < 1 || ch > info.chapters) notFound();
  const data = await bible.chapter(book, ch);
  const settings = defaultSettings();
  const paras: { q: boolean; rows: typeof data.rows }[] = [];
  for (const row of data.rows) {
    const v = row.zh[0];
    if (!paras.length || (v && v.para)) paras.push({ q: !!v && /^q/.test(v.para || ""), rows: [] });
    paras[paras.length - 1]!.rows.push(row);
  }
  return (
    <article className={`reader py-${settings.pinyin} red-letter`} style={typographyVars(settings) as React.CSSProperties}>
      <header className="chapter-head">
        <div className="chapter-head__book">{info.name.zh}</div>
        <div className="chapter-head__num">第{zhNum(ch)}章</div>
        <div className="chapter-head__en">{info.name.en} · Chapter {ch}</div>
        <hr className="chapter-head__rule" />
      </header>
      <div className="text">
        <div className="flow zh-text">
          {paras.map((p, i) => (
            <p key={i} className={p.q ? "q" : ""}>
              {p.rows.flatMap(r => r.zh.length
                ? r.zh.map(v => <ZhVerse key={v.id} v={v} bands={data.bands} />)
                : [<span key={r.key} className="gap" data-gap={r.key}><span className="gap-note"><span className="zh">{r.note?.zh}</span> {r.note?.en}</span></span>])}
            </p>
          ))}
        </div>
      </div>
      <nav className="reader-nav">
        {ch > 1 ? <Link href={`/read/${book}/${ch - 1}`}>← Chapter {ch - 1}</Link> : <span />}
        <Link href="/">Library</Link>
        {ch < info.chapters ? <Link href={`/read/${book}/${ch + 1}`}>Chapter {ch + 1} →</Link> : <span />}
      </nav>
    </article>
  );
}
