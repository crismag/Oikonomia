/**
 * Query and text normalisation for deterministic matching.
 *
 * Lower-case, punctuation to spaces, common filler words dropped, and a light
 * plural fold ("reports" → "report"). Enough for "who can see my reports" to
 * meet "who can see my report"; not a stemmer, and not trying to be one.
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "is",
  "are",
  "am",
  "be",
  "do",
  "does",
  "did",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "it",
  "this",
  "that",
  "with",
  "what",
  "how",
  "can",
  "i'm",
  "please",
  "about",
]);

const fold = (token: string) =>
  token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;

/** The query as comparable text: lower-case words separated by single spaces. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(fold)
    .join(" ");
}

/** Meaningful words only — for overlap scoring. */
export function tokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((token) => token && !STOPWORDS.has(token));
}
