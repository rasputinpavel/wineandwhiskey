import type { WineQuery, Intent, Lang } from "./types.js";
import { DEFAULT_LANG } from "./config.js";
import { detectLang } from "./lang.js";
import { downloadTelegramFile } from "./voice.js";

/** Choose intent from the user's words. Analogue triggers in ru/en, else assess. */
export function detectIntent(text: string): Intent {
  return /аналог|замен|похож|вместо|substitut|similar|alternative|instead/i.test(text)
    ? "analogues" : "assess";
}

export async function photoToBase64(
  botToken: string, fileId: string,
): Promise<{ data: string; mediaType: WineQuery["imageMediaType"] }> {
  const buf = await downloadTelegramFile(botToken, fileId);
  // Telegram photos are JPEG; declare jpeg.
  return { data: buf.toString("base64"), mediaType: "image/jpeg" };
}

export function buildQuery(opts: {
  text: string;
  imageBase64?: string;
  imageMediaType?: WineQuery["imageMediaType"];
}): WineQuery {
  const text = opts.text ?? "";
  const lang: Lang = detectLang(text, DEFAULT_LANG);
  return {
    text,
    imageBase64: opts.imageBase64,
    imageMediaType: opts.imageMediaType,
    lang,
    intent: detectIntent(text),
  };
}
