import Link from "next/link";
import { bible } from "@/lib/content";

export default async function Home() {
  const books = (await bible.canon()).books.filter(b => b.imported);
  return (
    <main>
      <div className="p1-home">
        <h1>读经</h1>
        <p>Scripture &amp; Mandarin</p>
      </div>
      <p className="p1-banner">Preview of the new web app: the reading text is rendered by the shared TypeScript core. Accounts, the dictionary popover, vocabulary, flashcards, highlights and audio arrive in the next phases — they all keep working in the current app meanwhile.</p>
      {books.map(b => (
        <section key={b.code}>
          <h2 className="p1-book"><span className="zh">{b.name.zh}</span> {b.name.en}</h2>
          <nav className="p1-chapters" aria-label={`${b.name.en} chapters`}>
            {Array.from({ length: b.chapters }, (_, i) => i + 1).map(c => <Link key={c} href={`/read/${b.code}/${c}`}>{c}</Link>)}
          </nav>
        </section>
      ))}
    </main>
  );
}
