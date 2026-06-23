import type { WineQuery, WineImage, Intent, Lang } from "./types.js";
import { DEFAULT_LANG } from "./config.js";
import { detectLang } from "./lang.js";
import { downloadTelegramFile } from "./voice.js";

/** Choose intent from the user's words. Analogue triggers in ru/en, else assess. */
export function detectIntent(text: string): Intent {
  return /аналог|замен|похож|вместо|substitut|similar|alternative|instead/i.test(text)
    ? "analogues" : "assess";
}

export async function photoToBase64(botToken: string, fileId: string): Promise<WineImage> {
  const buf = await downloadTelegramFile(botToken, fileId);
  // Telegram photos are JPEG.
  return { data: buf.toString("base64"), mediaType: "image/jpeg" };
}

export function buildQuery(opts: { text: string; images?: WineImage[] }): WineQuery {
  const text = opts.text ?? "";
  const lang: Lang = detectLang(text, DEFAULT_LANG);
  return {
    text,
    images: opts.images ?? [],
    lang,
    intent: detectIntent(text),
  };
}
