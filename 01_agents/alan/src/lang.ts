import type { Lang } from "./types.js";

/** Detect reply language. Any Cyrillic presence means the user is writing in
 *  Russian (an incidental Latin wine name doesn't change that); otherwise
 *  English if there are Latin letters. Falls back to `fallback` with no letters. */
export function detectLang(text: string, fallback: Lang): Lang {
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillic === 0 && latin === 0) return fallback;
  return cyrillic > 0 ? "ru" : "en";
}
