import dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });

import { Bot } from "grammy";
import { askBarrymore, generateScheduledMessage, resetSession } from "./agent.js";
import { transcribeVoice } from "./voice.js";
import { initSchedules } from "./schedules.js";
import * as db from "./db.js";

const bot = new Bot(process.env.BARRYMORE_BOT_TOKEN!);

// Группа, в которой работает Бэрримор (тот же чат что и у ops-бота)
const ALLOWED_CHAT = process.env.BARRYMORE_CHAT_ID
  ?? process.env.NOTIFY_CHAT_IDS?.split(",")[0]?.trim()
  ?? null;

// Ключевые слова для обращения к Бэрримору в групповом чате
const BARRYMORE_TRIGGERS = ["бэрримор", "баррим", "barrymore"];

function isAddressedToBarrymore(text: string, botUsername: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(`@${botUsername.toLowerCase()}`)) return true;
  return BARRYMORE_TRIGGERS.some((t) => lower.startsWith(t));
}

// Убрать "@mention" и обращение из начала сообщения перед передачей Claude
function stripAddressTrigger(text: string, botUsername: string): string {
  return text
    .replace(new RegExp(`^@${botUsername}\\s*`, "i"), "")
    .replace(new RegExp(`^(${BARRYMORE_TRIGGERS.join("|")})[,!.]?\\s*`, "i"), "")
    .trim();
}

// BARRYMORE_USERS=pavel:pavelrasputin,irina:irinaXXXX
const userMap = new Map<string, string>(); // username → имя (pavel/irina/...)
const displayMap = new Map<string, string>(); // name → обращение
displayMap.set("pavel", "сэр");
displayMap.set("irina", "мадам");

const rawUsers = process.env.BARRYMORE_USERS ?? "";
for (const pair of rawUsers.split(",")) {
  const [name, username] = pair.trim().split(":");
  if (name && username) {
    userMap.set(username.replace("@", "").toLowerCase(), name.toLowerCase());
  }
}

function identifyUser(username?: string): string {
  if (!username) return "неизвестный";
  return userMap.get(username.toLowerCase()) ?? username;
}

function isPrivate(chatType: string): boolean {
  return chatType === "private";
}

function isAllowedChat(chatId: number | string, chatType: string): boolean {
  if (isPrivate(chatType)) return true; // личка всегда разрешена
  if (!ALLOWED_CHAT) return true;
  return String(chatId) === ALLOWED_CHAT;
}

async function sendReply(
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  try {
    await bot.api.editMessageText(chatId, messageId, text, { parse_mode: "HTML" });
  } catch {
    const plain = text.replace(/<[^>]+>/g, "");
    try {
      await bot.api.editMessageText(chatId, messageId, plain);
    } catch {
      await bot.api.sendMessage(chatId, plain);
    }
  }
}

// --- Команды ---

bot.command("start", (ctx) => {
  ctx.reply(
    `Добро пожаловать. Я — Бэрримор, ваш верный дворецкий.\n\n` +
    `Готов принимать задачи, вести реестр и хранить летопись проекта.\n\n` +
    `Команды:\n` +
    `/tasks — активные задачи\n` +
    `/backlog — все задачи в работе\n` +
    `/overdue — просроченные\n` +
    `/chronicle — летопись проекта\n` +
    `/new — сбросить контекст диалога\n` +
    `/chatid — показать ID чата (для настройки)\n\n` +
    `<i>Чем могу служить?</i>`,
    { parse_mode: "HTML" }
  );
});

bot.command("chatid", (ctx) => {
  ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: "HTML" });
});

bot.command("new", (ctx) => {
  resetSession(ctx.chat.id);
  ctx.reply("Контекст беседы сброшен. Начнём с чистого листа, сэр.");
});

bot.command("tasks", async (ctx) => {
  if (!isAllowedChat(ctx.chat.id, ctx.chat.type)) return;
  const msg = await ctx.reply("Листаю реестр...");
  try {
    const answer = await askBarrymore(ctx.chat.id, "система", "Покажи все активные задачи в реестре.");
    await sendReply(ctx.chat.id, msg.message_id, answer);
  } catch (e) {
    console.error(e);
    await sendReply(ctx.chat.id, msg.message_id, "Не удалось открыть реестр задач.");
  }
});

bot.command("backlog", async (ctx) => {
  if (!isAllowedChat(ctx.chat.id, ctx.chat.type)) return;
  const msg = await ctx.reply("Просматриваю бэклог...");
  try {
    const answer = await askBarrymore(ctx.chat.id, "система", "Покажи все задачи в бэклоге — и активные, и завершённые за последнее время.");
    await sendReply(ctx.chat.id, msg.message_id, answer);
  } catch (e) {
    console.error(e);
    await sendReply(ctx.chat.id, msg.message_id, "Произошла ошибка при открытии бэклога.");
  }
});

bot.command("overdue", async (ctx) => {
  if (!isAllowedChat(ctx.chat.id, ctx.chat.type)) return;
  const msg = await ctx.reply("Проверяю просрочки...");
  try {
    const answer = await askBarrymore(ctx.chat.id, "система", "Покажи список просроченных задач.");
    await sendReply(ctx.chat.id, msg.message_id, answer);
  } catch (e) {
    console.error(e);
    await sendReply(ctx.chat.id, msg.message_id, "Не удалось проверить просрочки.");
  }
});

bot.command("chronicle", async (ctx) => {
  if (!isAllowedChat(ctx.chat.id, ctx.chat.type)) return;
  const msg = await ctx.reply("Открываю летопись...");
  try {
    const answer = await askBarrymore(ctx.chat.id, "система", "Покажи летопись проекта за последние 2 недели.");
    await sendReply(ctx.chat.id, msg.message_id, answer);
  } catch (e) {
    console.error(e);
    await sendReply(ctx.chat.id, msg.message_id, "Летопись временно недоступна.");
  }
});

// Ручной тригер для тестирования брифинга
bot.command("morning", async (ctx) => {
  if (!isAllowedChat(ctx.chat.id, ctx.chat.type)) return;
  const today      = db.bangkokDate();
  const todayTasks = await db.getTodayTasks();
  const overdue    = await db.getOverdueTasks();
  const active     = await db.getActiveTasks();

  const todayLines   = todayTasks.map((t) => db.formatTask(t)).join("\n") || "  — нет";
  const overdueLines = overdue.map((t) => db.formatTask(t)).join("\n") || "  — нет";

  const prompt = `Составьте утренний брифинг для дня ${today}. Задач на сегодня: ${todayTasks.length}.\n${todayLines}\nПросроченных: ${overdue.length}.\n${overdueLines}\nВсего активных: ${active.length}.\nФормат: приветствие, доклад, вопрос о планах. HTML. До 250 слов.`;
  const message = await generateScheduledMessage(prompt);
  if (message) {
    try { await bot.api.sendMessage(ctx.chat.id, message, { parse_mode: "HTML" }); }
    catch { await bot.api.sendMessage(ctx.chat.id, message.replace(/<[^>]+>/g, "")); }
  }
});

// --- Голосовые сообщения ---

bot.on("message:voice", async (ctx) => {
  if (!isAllowedChat(ctx.chat.id, ctx.chat.type)) return;

  const username   = ctx.from?.username;
  const senderName = identifyUser(username);
  const fileId     = ctx.message.voice.file_id;

  const waitMsg = await ctx.reply("Слушаю...");

  const transcript = await transcribeVoice(process.env.BARRYMORE_BOT_TOKEN!, fileId);
  if (!transcript) {
    await bot.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      "Прошу прощения, сэр — голосовые сообщения пока не в моей власти. Не соблаговолите ли изложить задачу текстом?"
    );
    return;
  }

  try {
    const answer = await askBarrymore(ctx.chat.id, senderName, `[голосовое] ${transcript}`);
    await sendReply(ctx.chat.id, waitMsg.message_id, answer);
  } catch (e) {
    console.error(e);
    await sendReply(ctx.chat.id, waitMsg.message_id, "Что-то пошло не так. Попробуйте ещё раз, сэр.");
  }
});

// --- Текстовые сообщения ---

bot.on("message:text", async (ctx) => {
  if (!isAllowedChat(ctx.chat.id, ctx.chat.type)) return;

  const rawText = ctx.message.text;
  if (rawText.startsWith("/")) return;

  const me      = ctx.me.username ?? "barrymorebot";
  const private_ = isPrivate(ctx.chat.type);

  // В группе — только если обратились к Бэрримору; в личке — всегда
  if (!private_ && !isAddressedToBarrymore(rawText, me)) return;

  const text = private_ ? rawText : stripAddressTrigger(rawText, me);
  const username   = ctx.from?.username;
  const senderName = identifyUser(username);

  const waitMsg = await ctx.reply("...");
  try {
    const answer = await askBarrymore(ctx.chat.id, senderName, text);
    await sendReply(ctx.chat.id, waitMsg.message_id, answer);
  } catch (e) {
    console.error(e);
    await sendReply(ctx.chat.id, waitMsg.message_id, "Что-то пошло не так. Мои извинения, сэр.");
  }
});

// --- Старт ---

initSchedules(bot);

bot.start();

function bangkokNow(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

console.log(`Бэрримор к вашим услугам. Сегодня в Бангкоке: ${bangkokNow()}`);
if (ALLOWED_CHAT) {
  console.log(`Обслуживаю чат: ${ALLOWED_CHAT}`);
} else {
  console.log("BARRYMORE_CHAT_ID не задан — отвечаю в любом чате");
}
