import { franc } from "franc-min";

/**
 * Mirror of `ui/src/lib/englishDetect.ts`. Used by `geminiStream.ts` to
 * decide whether to suppress the agent's reply (and the agent's outbound
 * transcript) when the user's audio was transcribed as non-English.
 *
 * Logic:
 *   1. If the chunk contains a common English greeting/filler word,
 *      force-allow — short utterances are too brief for `franc-min` to
 *      classify reliably.
 *   2. Else run `franc-min`. Reject if it returns a confident non-English
 *      ISO 639-3 code.
 *   3. Default to allow when result is `und` (undetermined).
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

  // Run franc only on chunks long enough for reliable classification.
  // franc-min has a high false-positive rate on short English text (10-25
  // chars), routinely mis-classifying valid English as Welsh / Afrikaans /
  // Norwegian. We pair this with `inputAudioTranscription.languageCodes`
  // on the server, which pins the Gemini ASR to English at the source —
  // so this downstream check is a safety net for the rare case where the
  // ASR still drifts, not the primary line of defense.
  if (trimmed.length >= 30) {
    const lang = franc(trimmed);
    if (lang !== "eng" && lang !== "und") return false;
  }

  // Short or undetermined chunks: allowlist + default-allow. Streaming
  // deltas like "the", "I'll", " load" come through here and should pass.
  const tokens = tokenize(trimmed);
  if (tokens.some((t) => ENGLISH_HINT_WORDS.has(t))) return true;
  return true;
}
