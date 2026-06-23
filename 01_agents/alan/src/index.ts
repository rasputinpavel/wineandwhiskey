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
import type { WineQuery, WineImage } from "./types.js";

assertEnv();

const bot = new Bot(TELEGRAM_TOKEN);
const sessions = new SessionStore(SESSION_TTL_MS);

interface Album { ctx: any; fileIds: string[]; caption: string; timer: ReturnType<typeof setTimeout> | null; }
const albums = new Map<string, Album>();
const ALBUM_DEBOUNCE_MS = 1200;

function userKey(ctx: any): number { return ctx.from?.id ?? ctx.chat?.id ?? -1; }
function parseBaht(text: string): number | null {
  const m = text.trim().match(/^[฿]?\s*(\d{2,6})(?:[.,]\d+)?\s*(฿|บาท|baht|бат|тхб|thb)?\s*$/i);
  return m ? parseInt(m[1], 10) : null;
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
  ru: "Не удалось разобрать. Пришли фото этикетки чётче или напиши название текстом.",
  en: "Couldn't work that out. Send a clearer label photo or type the name.",
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
      await ctx.reply(analoguesMessage(result, query.lang));
      return;
    }
    const verdict = await assessWine(query, onProgress);
    sessions.set(userKey(ctx), verdict, query.lang);
    const kb = new InlineKeyboard().text(
      query.lang === "ru" ? "Подробнее" : "Details", "details");
    await ctx.reply(shortVerdict(verdict, query.lang), { reply_markup: kb });
  } catch (err) {
    console.error("query failed:", err);
    await ctx.reply(FAIL[query.lang]);
  }
}

async function routeText(ctx: any, text: string): Promise<void> {
  const baht = parseBaht(text);
  const entry = sessions.get(userKey(ctx));
  if (baht !== null && entry) {
    await ctx.reply(localPriceVerdict(entry.verdict.qualityScore, entry.verdict.marketUsd, baht, entry.lang));
    return;
  }
  const lang = detectLang(text, DEFAULT_LANG);
  const t = await triage(text, lang);
  if (t.kind === "chat") {
    await ctx.reply(t.reply);
    return;
  }
  const query = buildQuery({ text });
  query.intent = t.kind === "analogues" ? "analogues" : "assess"; // triage decides assess vs analogues
  await handleQuery(ctx, query);
}

bot.on("message:photo", async (ctx) => {
  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id; // largest size
  const caption = ctx.message.caption ?? "";
  const groupId = ctx.message.media_group_id;

  // Single photo: handle immediately.
  if (!groupId) {
    const img = await photoToBase64(TELEGRAM_TOKEN, fileId);
    await handleQuery(ctx, buildQuery({ text: caption, images: [img] }));
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
      album.fileIds.map((id) => photoToBase64(TELEGRAM_TOKEN, id)),
    );
    await handleQuery(album.ctx, buildQuery({ text: album.caption, images }));
  } catch (err) {
    console.error("album processing failed:", err);
    await album.ctx.reply(FAIL[DEFAULT_LANG]);
  }
}

bot.on("message:voice", async (ctx) => {
  const text = await transcribeVoice(TELEGRAM_TOKEN, ctx.message.voice.file_id);
  if (!text) { await ctx.reply(FAIL[DEFAULT_LANG]); return; }
  await routeText(ctx, text);
});

bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return; // ignore unknown commands
  await routeText(ctx, ctx.message.text);
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
  await ctx.reply(fullCard(entry.verdict, entry.lang));
});

bot.catch((err) => console.error("bot error:", err));

bot.start({
  drop_pending_updates: true,
  onStart: (i) => console.log(`Алан started as @${i.username}`),
}).catch((err) => {
  console.error("polling stopped:", err);
  process.exit(1);
});
