import { franc } from "franc-min";

/**
 * Decide whether a transcript chunk looks like English. Used in English-only
 * mode to filter out chunks where Gemini's ASR drifted into another language
 * — both non-Latin scripts (Cyrillic, CJK, Vietnamese with diacritics) and
 * Latin-script romance/germanic mis-transcriptions ("Ay, claro.", "chào…").
 *
 * Logic:
 *   1. If the chunk contains any common English greeting/filler word
 *      ("hi", "hello", "yes", "what", ...), force-allow it. Short greetings
 *      are too brief for `franc-min` to classify reliably, and we'd rather
 *      keep a legit "hi" than be over-aggressive.
 *   2. Otherwise run `franc-min`. If it returns a confident non-English
 *      ISO 639-3 code (anything other than `eng` / `und`), reject as
 *      non-English.
 *   3. Default to allow when `franc-min` says `und` (undetermined) — the
 *      chunk is too short/ambiguous to confidently call non-English.
 *
 * Kept in sync with the server-side counterpart in
 * `server/src/lib/englishDetect.ts`.
 */
const ENGLISH_HINT_WORDS = new Set([
  "hi",
  "hello",
  "hey",
  "ok",
  "okay",
  "yes",
  "yeah",
  "no",
  "nope",
  "sure",
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "here",
  "now",
  "please",
  "thanks",
  "thank",
  "show",
  "find",
  "search",
  "load",
  "filter",
  "sort",
  "group",
  "count",
  "movies",
  "movie",
  "data",
  "gemini",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zA-Z']+/g)
    .filter(Boolean);
}

export function isLikelyEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Run franc only on long chunks. franc-min has a high false-positive rate
  // on short English text (10-25 chars), routinely mis-classifying valid
  // English as Welsh / Afrikaans / Norwegian. The primary fix is upstream
  // (`inputAudioTranscription.languageCodes` on the server pins ASR to
  // English) — this check is a safety net for the rare residual drift.
  if (trimmed.length >= 30) {
    const lang = franc(trimmed);
    if (lang !== "eng" && lang !== "und") return false;
  }

  // Short or undetermined chunks: fall back to the allowlist of common
  // English greeting/intent words. If any matches, allow. Otherwise
  // default-allow — safer than dropping legit short English deltas like
  // "the", "and", "I'll".
  const tokens = tokenize(trimmed);
  if (tokens.some((t) => ENGLISH_HINT_WORDS.has(t))) return true;
  return true;
}
