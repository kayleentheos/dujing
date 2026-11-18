// ---------------------------------------------------------------------------
// Content types: the Bible text, alignment, word tokens and dictionary, exactly
// as produced by the import pipeline (tools/ in the original project). These
// files are static and identical for every user.
// ---------------------------------------------------------------------------

export type BookCode = string;            // USFM code, e.g. "JHN"
export type VerseId = string;             // "JHN.3.16"
export type TranslationId = "cuv" | "web" | (string & {});

export interface LocalizedName { en: string; zh: string }

export interface CanonBook {
  code: BookCode;
  name: LocalizedName;
  chapters: number;
  testament: "OT" | "NT";
  imported?: boolean;
  abbr?: string[];               // Chinese abbreviations, e.g. ["约", "约翰福音"]
  [extra: string]: unknown;
}
export interface Canon {
  categories: { id: string; name: LocalizedName; testament: "OT" | "NT"; books: BookCode[] }[];
  books: CanonBook[];
}

/** A run of text with a style, e.g. ["For God so loved", "wj"] (words of Jesus). */
export type Run = [text: string, style: string];
export interface Note { type: string; ref?: string; text: string; at: number }
export interface Heading { text: string; [extra: string]: unknown }

export interface Verse {
  id: VerseId;
  v: number;
  text: string;                  // the exact verse text — never altered
  runs: (Run | { br: string })[];
  notes?: Note[];
  para?: string;
  headings?: Heading[];
}

/** A segmented Chinese word: [text, pinyin, style?] or a poetry line break. */
export type Token = [text: string, pinyin: string, style?: string] | { br: string };
export const isWord = (t: Token): t is [string, string, string?] => Array.isArray(t);

export interface TranslationBook { translation: string; book: BookCode; meta?: unknown; chapters: Record<string, Verse[]> }
export interface TranslationMeta { id: TranslationId; language: string; name: LocalizedName; [extra: string]: unknown }
export interface Annotations { book: BookCode; translation: string; verses: Record<VerseId, Token[]>; bands: Record<string, number>; sources?: string[] }
export interface AlignmentRow { cuv: VerseId[]; web: VerseId[]; note?: { en: string; zh: string } }
export interface Alignment { book: BookCode; pair?: unknown; rows: AlignmentRow[] }

export type LexiconKind = "dictionary" | "parts" | "name" | "transliteration" | "other-reading";
export interface StudyNote { text: string; verses?: Record<VerseId, string>; [extra: string]: unknown }
export interface LexiconEntry {
  w: string; py: string; count?: number;
  kind: LexiconKind;
  trad?: string;
  senses?: string[];
  pos?: string | null; posSource?: string;
  pyChecked?: boolean;
  cl?: string[];
  note?: StudyNote;
  parts?: { w: string; py: string; senses?: string[] }[];
  alt?: { py: string; senses: string[] }[];
  name?: unknown;
}
export interface Lexicon { book: BookCode; sources?: string[]; entries: Record<string, LexiconEntry> }

/** One aligned row of a chapter: the CUV verse(s) and WEB verse(s) that correspond. */
export interface ChapterRow {
  key: VerseId;
  zh: (Verse & { tokens: Token[] | null })[];
  en: Verse[];
  note: { en: string; zh: string } | null;
  partial: boolean;
}
export interface ChapterView { book: CanonBook; chapter: number; rows: ChapterRow[]; bands: Record<string, number>; hasTokens: boolean }

// ---------------------------------------------------------------------------
// User data: everything a person saves. Stored per user (Supabase in the web
// app; the same shapes work for a mobile app). Times are ISO-8601 strings.
// ---------------------------------------------------------------------------

export type ReviewResult = "forgot" | "almost" | "got";

export interface VocabRef {
  verseId: VerseId;
  book: BookCode; bookZh: string; bookEn: string;
  chapter: number; verse: number;
  zh: string; en: string;              // the verse text when saved (exact copies)
  contextual: string | null;           // meaning in this verse, from the dictionary (never invented)
  addedAt: string;
}

export interface ReviewEvent { at: string; result: ReviewResult; interval: number }

export interface SrsState {
  state: "new" | "learning" | "review";
  interval: number;     // days; 0 = again this session
  ease: number;         // 1.3 – 3.0
  due: string | null;
  reps: number; lapses: number; streak: number;
  last: ReviewResult | null;
  inReview: boolean;
  history: ReviewEvent[];
}

/** Legacy "simple flashcard" counters from before spaced repetition. Kept so nothing is lost. */
export interface LegacyReview { seen: number; flips: number; lastSeen: string | null; history: unknown[] }

export interface VocabWord {
  schema: 1;
  id: string;                          // "word|pinyin" — the natural key, one record per word
  word: string; pinyin: string;
  trad: string | null;
  pos: string | null;
  senses: string[] | null;
  definition: string;
  kind: LexiconKind | string;
  firstRef: VerseId;
  refs: VocabRef[];
  addedAt: string; updatedAt: string;
  review?: LegacyReview;
  srs?: SrsState;
}

export const HIGHLIGHT_COLORS = ["pink", "blue", "green", "yellow", "orange", "purple"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Highlight {
  schema: 1;
  id: string;
  book: BookCode; chapter: number; verse: number; verseId: VerseId;
  start: number; end: number;          // character offsets into the verse text, [start, end)
  text: string;                        // the highlighted text (exact copy)
  color: HighlightColor;
  groupId: string | null;              // set when one selection spanned several verses
  createdAt: string; updatedAt: string;
}

export interface Bookmark {
  id: string;
  verseId: VerseId; book: BookCode; chapter: number; verse: number;
  label: string | null;
  createdAt: string; updatedAt: string;
}

export interface ReadingProgress {
  books: Record<BookCode, { read: number[]; lastChapter: number | null }>;
  last: { book: BookCode; chapter: number; verse: number | null; at: number } | null;
}

export interface ReadingSettings {
  pinyin: "off" | "hard" | "all";
  zhSize: number; pySize: number; enSize: number;
  leading: number; measure: number;
  redLetter: boolean; showNotes: boolean; showHeadings: boolean;
  script: "simplified" | "traditional";
  zhVersion: TranslationId; enVersion: TranslationId;
  [extra: string]: unknown;            // older keys are carried over, not dropped
}
