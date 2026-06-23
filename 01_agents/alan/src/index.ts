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
import type { WineQuery } from "./types.js";

assertEnv();

const bot = new Bot(TELEGRAM_TOKEN);
const sessions = new SessionStore(SESSION_TTL_MS);

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
  await ctx.reply(WORKING[query.lang]);
  try {
    if (query.intent === "analogues") {
      const result = await findAnalogues(query);
      await ctx.reply(analoguesMessage(result, query.lang));
      return;
    }
    const verdict = await assessWine(query);
    const key = ctx.from?.id ?? ctx.chat?.id ?? -1;
    sessions.set(key, verdict, query.lang);
    const kb = new InlineKeyboard().text(
      query.lang === "ru" ? "Подробнее" : "Details", "details");
    await ctx.reply(shortVerdict(verdict, query.lang), { reply_markup: kb });
  } catch (err) {
    console.error("query failed:", err);
    await ctx.reply(FAIL[query.lang]);
  }
}

async function routeText(ctx: any, text: string): Promise<void> {
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
  const { data, mediaType } = await photoToBase64(TELEGRAM_TOKEN, fileId);
  await handleQuery(ctx, buildQuery({ text: caption, imageBase64: data, imageMediaType: mediaType }));
});

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
  const key = ctx.from?.id ?? ctx.chat?.id ?? -1;
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
