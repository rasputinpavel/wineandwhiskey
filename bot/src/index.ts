import dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });

import { Bot } from "grammy";
import Anthropic from "@anthropic-ai/sdk";
import cron from "node-cron";
import { getSales, getInventory, getLowStock, getInventorySummary } from "./tools.js";
import { generateMorningBriefing } from "./briefing.js";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Текущее время в Таиланде (UTC+7) — через явное смещение, без LocaleString->Date round-trip
function bangkokNow(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function nowInThailand(): string {
  const d = bangkokNow();
  const weekday = d.toLocaleDateString("ru-RU", { weekday: "long", timeZone: "UTC" });
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${weekday}, ${date}, ${time}`;
}

function todayInThailand(): string {
  return bangkokNow().toISOString().slice(0, 10); // YYYY-MM-DD
}

const SYSTEM_PROMPT = `Ты — умный помощник для управления винным магазином Wine & Whiskey в Таиланде.
Цены в тайских батах (THB). Отвечай на русском языке, кратко и по делу.
Используй инструменты чтобы получить актуальные данные. Не выдумывай цифры.
Помни контекст разговора — если пользователь уточняет вопрос, используй предыдущий контекст.

Форматирование — строго HTML для Telegram. Пример правильного ответа:

На складе сейчас <b>1 509 бутылок</b>.

Топ категории: <b>Red Wine — 320 шт</b>, <b>White Wine — 280 шт</b>, <b>Whiskey — 95 шт</b>.

<i>Ассортимент в норме, есть что предложить гостю.</i>

Правила форматирования:
- Каждый смысловой блок — отдельный абзац, между ними пустая строка (\n\n)
- <b>жирный</b> — все цифры, суммы, названия позиций
- <i>курсив</i> — оценки и выводы
- Никаких **, __, ## и прочих markdown-символов — только HTML-теги.

Если не можешь ответить — объясни почему, честно и конкретно:
- Если не понял вопрос: скажи "не понял вопрос" и попроси уточнить.
- Если данных нет в доступных инструментах (оптовые продажи, прогнозы, поставщики): скажи что эта информация пока не подключена и её можно добавить.
- Не говори просто "не знаю" — всегда объясняй причину.`;

// История сообщений на чат
interface ChatSession {
  messages: Anthropic.MessageParam[];
  lastActivityAt: number;
}
const chatSessions = new Map<number, ChatSession>();
const SESSION_TTL_MS = 60 * 60 * 1000; // сбрасывать после 1 часа тишины
const MAX_MESSAGES = 30; // защита от бесконечного роста

// Описание инструментов для Claude
const tools: Anthropic.Tool[] = [
  {
    name: "get_sales",
    description: "Получить данные о продажах за указанный период. Используй для вопросов о выручке, количестве чеков, топ-продажах.",
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string", description: "Дата начала в формате YYYY-MM-DD" },
        date_to: { type: "string", description: "Дата конца в формате YYYY-MM-DD" },
      },
      required: ["date_from", "date_to"],
    },
  },
  {
    name: "get_inventory",
    description: "Получить остатки товаров. Можно передать фильтр — название товара или категория (например 'Red Wine', 'Whiskey', 'Champagne').",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: { type: "string", description: "Фильтр по названию товара или категории (необязательно)" },
      },
    },
  },
  {
    name: "get_low_stock",
    description: "Получить список товаров с низким остатком.",
    input_schema: {
      type: "object" as const,
      properties: {
        threshold: { type: "number", description: "Порог остатка (по умолчанию 5 шт)" },
      },
    },
  },
  {
    name: "get_inventory_summary",
    description: "Получить сводку по остаткам на складе: общее количество бутылок и разбивка по категориям.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

// Выполнить инструмент по имени
async function runTool(name: string, input: any): Promise<string> {
  switch (name) {
    case "get_sales":
      return getSales(input.date_from, input.date_to);
    case "get_inventory":
      return getInventory(input.filter);
    case "get_low_stock":
      return getLowStock(input.threshold ?? 5);
    case "get_inventory_summary":
      return getInventorySummary();
    default:
      return `Неизвестный инструмент: ${name}`;
  }
}

function getSession(chatId: number): ChatSession {
  const now = Date.now();
  const existing = chatSessions.get(chatId);

  // Если сессия есть и не устарела — продолжаем
  if (existing && now - existing.lastActivityAt < SESSION_TTL_MS) {
    existing.lastActivityAt = now;
    return existing;
  }

  // Иначе — новая сессия
  const session: ChatSession = { messages: [], lastActivityAt: now };
  chatSessions.set(chatId, session);
  return session;
}

// Основной обработчик — agentic loop с tool use и памятью разговора
async function askClaude(chatId: number, userQuestion: string): Promise<string> {
  const today = todayInThailand();
  const now = nowInThailand();

  const session = getSession(chatId);
  const { messages } = session;

  // В начале каждой сессии вставляем дату, потом просто время
  const userContent = messages.length === 0
    ? `Сегодня: ${now} (${today})\n\nВопрос: ${userQuestion}`
    : `[${now}] ${userQuestion}`;

  messages.push({ role: "user", content: userContent });

  // Agentic loop — Claude может вызвать несколько инструментов подряд
  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT + `\n\nТекущее время: ${now}. Сегодня: ${today}.`,
      tools,
      messages,
    });

    // Если Claude закончил — сохранить ответ в историю и вернуть
    if (response.stop_reason === "end_turn") {
      const text = response.content.find((b) => b.type === "text");
      const answer = text?.text ?? "Нет ответа.";

      messages.push({ role: "assistant", content: answer });

      // Защита: обрезаем если сессия выросла слишком большой
      if (messages.length > MAX_MESSAGES) {
        messages.splice(0, messages.length - MAX_MESSAGES);
      }

      return answer;
    }

    // Если Claude хочет использовать инструменты
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          if (block.type !== "tool_use") throw new Error("unexpected");
          const result = await runTool(block.name, block.input);
          return { type: "tool_result" as const, tool_use_id: block.id, content: result };
        })
      );

      messages.push({ role: "user", content: toolResults });
    }
  }
}

// --- Telegram handlers ---

bot.command("start", (ctx) => {
  ctx.reply(
    `Привет! Я бот Wine & Whiskey.\n\n` +
    `Сегодня: ${nowInThailand()}\n\n` +
    `Спрашивай что угодно:\n` +
    `• "сколько продали сегодня?"\n` +
    `• "что заканчивается?"\n` +
    `• "сколько осталось виски?"\n` +
    `• "топ продаж за эту неделю"\n\n` +
    `Команды: /stock /sales`
  );
});

bot.command("chatid", (ctx) => {
  ctx.reply(`Твой chat ID: \`${ctx.chat.id}\``, { parse_mode: "Markdown" });
});

bot.command("briefing", async (ctx) => {
  const msg = await ctx.reply("Готовлю утренний брифинг...");
  try {
    const text = await generateMorningBriefing();
    try {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, text, { parse_mode: "HTML" });
    } catch {
      const plain = text.replace(/<[^>]+>/g, "");
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, plain);
    }
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Не удалось сгенерировать брифинг.");
  }
});

bot.command("new", (ctx) => {
  chatSessions.delete(ctx.chat.id);
  ctx.reply("Контекст сброшен. Начинаем новый разговор.");
});

bot.command("stock", async (ctx) => {
  const msg = await ctx.reply("Проверяю остатки...");
  try {
    const result = await getLowStock(5);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, result, { parse_mode: "HTML" });
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Ошибка при загрузке данных.");
  }
});

bot.command("sales", async (ctx) => {
  const msg = await ctx.reply("Загружаю продажи...");
  try {
    const today = todayInThailand();
    const result = await getSales(today, today);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, result, { parse_mode: "HTML" });
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Ошибка при загрузке продаж.");
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  const msg = await ctx.reply("...");
  try {
    const answer = await askClaude(ctx.chat.id, text);
    try {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, answer, { parse_mode: "HTML" });
    } catch {
      // Fallback: если HTML невалиден из-за спецсимволов в названиях — отправить plain text
      const plain = answer.replace(/<[^>]+>/g, "");
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, plain);
    }
  } catch (e) {
    console.error(e);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "Что-то пошло не так, попробуй ещё раз.");
  }
});

// Утренний брифинг в 9:00 по Бангкоку
const notifyChatIds = (process.env.NOTIFY_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (notifyChatIds.length > 0) {
  cron.schedule("0 9 * * *", async () => {
    console.log("Sending morning briefing...");
    try {
      const text = await generateMorningBriefing();
      for (const chatId of notifyChatIds) {
        try {
          await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
        } catch {
          const plain = text.replace(/<[^>]+>/g, "");
          await bot.api.sendMessage(chatId, plain);
        }
      }
    } catch (e) {
      console.error("Briefing failed:", e);
    }
  }, { timezone: "Asia/Bangkok" });

  console.log(`Morning briefing scheduled at 9:00 Bangkok → chat IDs: ${notifyChatIds.join(", ")}`);
} else {
  console.log("NOTIFY_CHAT_IDS not set — morning briefing disabled.");
}

bot.start();
console.log(`Bot started. Today in Bangkok: ${todayInThailand()}`);
