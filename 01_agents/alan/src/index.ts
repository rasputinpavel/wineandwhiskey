import { Bot, InlineKeyboard } from "grammy";
import { TELEGRAM_TOKEN, SESSION_TTL_MS, assertEnv } from "./config.js";
import { buildQuery, photoToBase64 } from "./input.js";
import { transcribeVoice } from "./voice.js";
import { assessWine, findAnalogues } from "./pipeline.js";
import { shortVerdict, fullCard, analoguesMessage } from "./format.js";
import { SessionStore } from "./session.js";
import { detectLang } from "./lang.js";
import { triage } from "./triage.js";
import { DEFAULT_LANG } from "./config.js";
import { localPriceVerdict } from "./priceLocal.js";
import type { WineQuery, WineImage, Lang } from "./types.js";

assertEnv();

const bot = new Bot(TELEGRAM_TOKEN);
const sessions = new SessionStore(SESSION_TTL_MS);
const langs = new Map<number, Lang>();
function priorLang(id: number): Lang { return langs.get(id) ?? DEFAULT_LANG; }
function rememberLang(id: number, l: Lang): void { langs.set(id, l); }

interface Album { ctx: any; fileIds: string[]; caption: string; timer: ReturnType<typeof setTimeout> | null; }
const albums = new Map<string, Album>();
const ALBUM_DEBOUNCE_MS = 1200;

function userKey(ctx: any): number { return ctx.from?.id ?? ctx.chat?.id ?? -1; }
function parseBaht(text: string): number | null {
  const m = text.trim().match(/^[฿]?\s*(\d{2,6})(?:[.,]\d+)?\s*(฿|บาท|baht|бат|тхб|thb)?\s*$/i);
  return m ? parseInt(m[1], 10) : null;
}

const TG_LIMIT = 4000; // safe margin under Telegram's 4096-char message cap
/** Split text into ≤TG_LIMIT chunks on line boundaries (hard-splitting any over-long line). */
function chunkText(text: string, limit = TG_LIMIT): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (line.length > limit) {
      if (buf) { out.push(buf); buf = ""; }
      for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit));
      continue;
    }
    if (buf.length + line.length + 1 > limit) { out.push(buf); buf = line; }
    else { buf = buf ? buf + "\n" + line : line; }
  }
  if (buf) out.push(buf);
  return out.length ? out : [""];
}
/** Send a (possibly long) message as one or more chunks; opts attach to the last chunk. */
async function sendLong(ctx: any, text: string, lastOpts?: any): Promise<void> {
  const parts = chunkText(text);
  for (let i = 0; i < parts.length; i++) {
    await ctx.reply(parts[i], i === parts.length - 1 ? lastOpts : undefined);
  }
}
/** Remove the live "thinking" message once the result is ready (avoids a lingering,
 *  truncated reasoning duplicate next to the final summary). */
async function dropProgress(ctx: any, messageId: number): Promise<void> {
  try { await ctx.api.deleteMessage(ctx.chat.id, messageId); } catch { /* already gone */ }
}

/** Returns an onProgress(text) that edits one Telegram message in place, at most
 *  once every MIN_MS, with a trailing flush. Safe against Telegram errors / dupes. */
function makeProgressEditor(ctx: any, messageId: number): (text: string) => void {
  const MIN_MS = 2500;
  let latest = "";
  let lastSent = "";
  let lastAt = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    pending = null;
    const text = latest.trim().slice(0, 3500);
    if (!text || text === lastSent) return;
    lastSent = text;
    lastAt = Date.now();
    try {
      await ctx.api.editMessageText(ctx.chat.id, messageId, text);
    } catch {
      /* ignore "message is not modified" / transient edit errors */
    }
  }

  return (text: string) => {
    latest = text;
    const since = Date.now() - lastAt;
    if (since >= MIN_MS) { void flush(); }
    else if (!pending) { pending = setTimeout(() => void flush(), MIN_MS - since); }
  };
}

const WORKING = { ru: "Изучаю вино…", en: "Researching the wine…" } as const;
const FAIL = {
  ru: "Что-то сбойнуло на моей стороне (возможно, перегрузка сервиса). Попробуй ещё раз через минуту.",
  en: "Something glitched on my side (maybe a service overload). Try again in a minute.",
} as const;
const VOICE_FAIL = {
  ru: "Не расслышал. Пришли голос ещё раз или напиши текстом.",
  en: "Couldn't catch that. Send the voice note again or type it.",
} as const;
const START = {
  ru: "Я Алан — винный помощник. Пришли фото этикетки, название текстом или голосом — расскажу честно: что за вино, что говорят критики и толпа, и стоит ли оно денег. Или попроси подобрать аналоги.",
  en: "I'm Алан, your wine assistant. Send a label photo, type a name, or send a voice note — I'll tell you honestly what it is, what critics and the crowd say, and whether it's worth the price. Or ask for analogues.",
} as const;

bot.command("start", (ctx) =>
  ctx.reply(START[detectLang(ctx.message?.text ?? "", DEFAULT_LANG)]));

async function handleQuery(ctx: any, query: WineQuery): Promise<void> {
  const progress = await ctx.reply(WORKING[query.lang]);
  const onProgress = makeProgressEditor(ctx, progress.message_id);
  try {
    if (query.intent === "analogues") {
      const result = await findAnalogues(query, onProgress);
      await dropProgress(ctx, progress.message_id);
      await sendLong(ctx, analoguesMessage(result, query.lang));
      return;
    }
    const verdict = await assessWine(query, onProgress);
    sessions.set(userKey(ctx), verdict, query.lang);
    await dropProgress(ctx, progress.message_id);
    const kb = new InlineKeyboard().text(
      query.lang === "ru" ? "Подробнее" : "Details", "details");
    await sendLong(ctx, shortVerdict(verdict, query.lang), { reply_markup: kb });
  } catch (err) {
    console.error("query failed:", err);
    await dropProgress(ctx, progress.message_id);
    await ctx.reply(FAIL[query.lang]);
  }
}

async function routeText(ctx: any, text: string, conversational: boolean): Promise<void> {
  const id = userKey(ctx);
  const prior = priorLang(id);

  const baht = parseBaht(text);
  const entry = sessions.get(id);
  if (baht !== null && entry) {
    await ctx.reply(localPriceVerdict(entry.verdict.qualityScore, entry.verdict.marketUsd, baht, entry.lang));
    return;
  }

  const detected = detectLang(text, prior);
  const t = await triage(text, detected);
  if (t.kind === "chat") {
    rememberLang(id, detected); // conversation reveals the user's language
    await ctx.reply(t.reply);
    return;
  }

  // Wine request: a typed wine name (often Latin) must NOT flip the language.
  // Use the sticky language; only voice transcripts count as conversational here.
  const lang: Lang = conversational ? detected : prior;
  if (conversational) rememberLang(id, detected);
  const query = buildQuery({ text, lang });
  query.intent = t.kind === "analogues" ? "analogues" : "assess";
  await handleQuery(ctx, query);
}

bot.on("message:photo", async (ctx) => {
  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id; // largest size
  const caption = ctx.message.caption ?? "";
  const groupId = ctx.message.media_group_id;

  const id = userKey(ctx);
  const lang = caption ? detectLang(caption, priorLang(id)) : priorLang(id);
  if (caption) rememberLang(id, lang);

  // Single photo: handle immediately.
  if (!groupId) {
    const img = await photoToBase64(TELEGRAM_TOKEN, fileId);
    await handleQuery(ctx, buildQuery({ text: caption, images: [img], lang }));
    return;
  }

  // Album: buffer photos sharing a media_group_id, process once after a quiet gap.
  let album = albums.get(groupId);
  if (!album) {
    album = { ctx, fileIds: [], caption: "", timer: null };
    albums.set(groupId, album);
  }
  album.fileIds.push(fileId);
  if (caption) album.caption = caption; // only one photo in the group carries the caption
  if (album.timer) clearTimeout(album.timer);
  album.timer = setTimeout(() => { void flushAlbum(groupId); }, ALBUM_DEBOUNCE_MS);
});

async function flushAlbum(groupId: string): Promise<void> {
  const album = albums.get(groupId);
  if (!album) return;
  albums.delete(groupId);
  try {
    const images: WineImage[] = await Promise.all(
      album.fileIds.map((fid) => photoToBase64(TELEGRAM_TOKEN, fid)),
    );
    const id = userKey(album.ctx);
    const lang = album.caption ? detectLang(album.caption, priorLang(id)) : priorLang(id);
    if (album.caption) rememberLang(id, lang);
    await handleQuery(album.ctx, buildQuery({ text: album.caption, images, lang }));
  } catch (err) {
    console.error("album processing failed:", err);
    await album.ctx.reply(FAIL[priorLang(userKey(album.ctx))]);
  }
}

bot.on("message:voice", async (ctx) => {
  const text = await transcribeVoice(TELEGRAM_TOKEN, ctx.message.voice.file_id);
  if (!text) { await ctx.reply(VOICE_FAIL[priorLang(userKey(ctx))]); return; }
  await routeText(ctx, text, true);
});

bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return; // ignore unknown commands
  await routeText(ctx, ctx.message.text, false);
});

bot.callbackQuery("details", async (ctx) => {
  await ctx.answerCallbackQuery();
  const key = userKey(ctx);
  const entry = sessions.get(key);
  if (!entry) {
    await ctx.reply(
      DEFAULT_LANG === "ru"
        ? "Сессия истекла, пришли вино заново."
        : "Session expired, send the wine again.");
    return;
  }
  await sendLong(ctx, fullCard(entry.verdict, entry.lang));
});

bot.catch((err) => console.error("bot error:", err));

bot.start({
  drop_pending_updates: true,
  onStart: (i) => console.log(`Алан started as @${i.username}`),
}).catch((err) => {
  console.error("polling stopped:", err);
  process.exit(1);
});
