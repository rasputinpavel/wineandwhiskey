import dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });

import { Bot } from "grammy";
import Anthropic from "@anthropic-ai/sdk";
import cron from "node-cron";
import { getSales, getInventory, getLowStock, getInventorySummary, getSupplier, getPurchaseOrders, getPurchaseHistory } from "./tools.js";
import { generateMorningBriefing } from "./briefing.js";
import {
  PendingExpense, PendingPhoto,
  bangkokDate, looksLikeExpense,
  extractExpenseFromText, extractExpenseFromPhoto,
  downloadTelegramPhoto,
  buildExpenseMessage, buildExpenseKeyboard,
  addExpenseRow, parseExpenseFromMessage,
} from "./expenses.js";

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

ГЛАВНОЕ ПРАВИЛО — действуй сразу, не переспрашивай:
- "последние 3 недели" → вызови get_sales с нужными датами, не спрашивай что именно показать
- "что на складе" / "сколько бутылок" → вызови get_inventory_summary
- "что заканчивается" → вызови get_low_stock
- "как дела" / "общая картина" → вызови get_sales за текущий период + get_inventory_summary
- "у кого берём X" / "цена закупки X" / "когда последний раз заказывали X" → вызови get_purchase_history с названием товара
- Уточняй ТОЛЬКО если запрос реально неоднозначен и без уточнения невозможно выбрать инструмент

Форматирование — строго HTML для Telegram:
- Каждый смысловой блок — отдельный абзац, между ними пустая строка
- <b>жирный</b> — все цифры, суммы, названия позиций
- <i>курсив</i> — оценки и выводы
- Никаких **, __, ## — только HTML-теги

Если данных нет в инструментах (опт, прогнозы) — скажи что не подключено, можно добавить.`;

// Expense flow state
const pendingPhotos   = new Map<number, PendingPhoto>();
const pendingExpenses = new Map<number, PendingExpense>();

async function startExpenseFlow(
  chatId: number,
  extracted: { amount: string; description: string },
): Promise<void> {
  const expense: PendingExpense = {
    amount:      extracted.amount,
    description: extracted.description,
    date:        bangkokDate(),
    isCompany:   false,
    hasDocs:     false,
  };
  pendingExpenses.set(chatId, expense);
  await bot.api.sendMessage(chatId, buildExpenseMessage(expense), {
    parse_mode:   "HTML",
    reply_markup: buildExpenseKeyboard(expense.isCompany, expense.hasDocs),
  });
}

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
  {
    name: "get_supplier",
    description: "Найти поставщика по названию вина или товара. Используй для вопросов типа 'у кого берём X', 'какой поставщик у X', 'где заказать X'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Часть названия вина или товара для поиска" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_purchase_history",
    description: "История закупок конкретного товара: у кого покупали, сколько раз, средняя цена закупки, когда последний раз заказывали. Используй для вопросов: 'у кого берём Miravento', 'средняя цена закупки Prosecco', 'когда последний раз брали Whispering Angel', 'кто поставляет Bourgogne'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Часть названия товара для поиска, например 'Miravento' или 'Prosecco'" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_purchase_orders",
    description: "Получить историю закупок (purchase orders) по поставщику или периоду. Используй для вопросов: 'что брали у X', 'закупки за апрель', 'топ закупок', 'что заказывали у Vinum Lector'.",
    input_schema: {
      type: "object" as const,
      properties: {
        supplier:      { type: "string",  description: "Название поставщика (частичное совпадение, например 'Vinum')" },
        date_from:     { type: "string",  description: "С даты YYYY-MM-DD" },
        date_to:       { type: "string",  description: "По дату YYYY-MM-DD" },
        include_items: { type: "boolean", description: "Включить позиции каждого заказа (true для детального просмотра)" },
        limit:         { type: "number",  description: "Максимум заказов, по умолчанию 10" },
      },
    },
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
    case "get_purchase_history":
      return getPurchaseHistory(input.query);
    case "get_supplier":
      return getSupplier(input.query);
    case "get_purchase_orders":
      return getPurchaseOrders(input);
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

const MAX_TOOL_CALLS = 4; // максимум итераций в одном ответе

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
  let toolCallCount = 0;
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
      toolCallCount++;
      if (toolCallCount > MAX_TOOL_CALLS) {
        return "Запрос слишком сложный — попробуй разбить на несколько отдельных вопросов.";
      }

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

const CHIP_TRIGGERS = ["чип", "chip", "dale", "дейл"];

function isAddressedToChipDale(text: string, botUsername: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(`@${botUsername.toLowerCase()}`)) return true;
  return CHIP_TRIGGERS.some((t) => lower.startsWith(t));
}

function isGroupChat(type: string): boolean {
  return type === "group" || type === "supergroup";
}

bot.on("message:photo", async (ctx) => {
  const chatId  = ctx.chat.id;
  const caption = ctx.message.caption?.trim();
  const photos  = ctx.message.photo;
  const fileId  = photos[photos.length - 1].file_id; // largest size

  const waitMsg = await ctx.reply("Читаю чек...");
  try {
    const photo = await downloadTelegramPhoto(process.env.TELEGRAM_BOT_TOKEN!, fileId);

    if (caption) {
      const extracted = await extractExpenseFromPhoto(photo.base64, photo.mimeType, caption);
      await ctx.api.deleteMessage(chatId, waitMsg.message_id);
      if (extracted) {
        await startExpenseFlow(chatId, extracted);
      } else {
        await ctx.reply("Не смог распознать сумму. Напиши расход текстом: «856 интернет»");
      }
    } else {
      // Store photo, wait for caption in next text message
      pendingPhotos.set(chatId, photo);
      await ctx.api.editMessageText(chatId, waitMsg.message_id, "📷 Фото получено. Напиши пояснение (на что потратили и сумму, если не видно):");
    }
  } catch (e) {
    console.error(e);
    await ctx.api.editMessageText(chatId, waitMsg.message_id, "Ошибка при обработке фото.");
  }
});

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text   = ctx.message.text;
  if (text.startsWith("/")) return;
  if (isGroupChat(ctx.chat.type) && !isAddressedToChipDale(text, ctx.me.username ?? "")) return;

  // If there's a pending photo, treat this text as its caption
  const pendingPhoto = pendingPhotos.get(chatId);
  if (pendingPhoto) {
    pendingPhotos.delete(chatId);
    const msg = await ctx.reply("Читаю чек...");
    try {
      const extracted = await extractExpenseFromPhoto(pendingPhoto.base64, pendingPhoto.mimeType, text);
      await ctx.api.deleteMessage(chatId, msg.message_id);
      if (extracted) {
        await startExpenseFlow(chatId, extracted);
      } else {
        await ctx.reply("Не смог распознать сумму. Напиши расход текстом: «856 интернет»");
      }
    } catch (e) {
      console.error(e);
      await ctx.api.editMessageText(chatId, msg.message_id, "Ошибка при обработке фото.");
    }
    return;
  }

  // Expense text shortcut
  if (looksLikeExpense(text)) {
    const msg = await ctx.reply("Распознаю расход...");
    try {
      const extracted = await extractExpenseFromText(text);
      await ctx.api.deleteMessage(chatId, msg.message_id);
      if (extracted) {
        await startExpenseFlow(chatId, extracted);
      } else {
        await ctx.reply("Не смог распознать расход. Попробуй формат: «856 интернет»");
      }
    } catch (e) {
      console.error(e);
      await ctx.api.editMessageText(chatId, msg.message_id, "Ошибка при распознавании.");
    }
    return;
  }

  const msg = await ctx.reply("...");
  try {
    const answer = await askClaude(chatId, text);
    try {
      await ctx.api.editMessageText(chatId, msg.message_id, answer, { parse_mode: "HTML" });
    } catch {
      // Fallback: если HTML невалиден из-за спецсимволов в названиях — отправить plain text
      const plain = answer.replace(/<[^>]+>/g, "");
      await ctx.api.editMessageText(chatId, msg.message_id, plain);
    }
  } catch (e) {
    console.error(e);
    await ctx.api.editMessageText(chatId, msg.message_id, "Что-то пошло не так, попробуй ещё раз.");
  }
});

bot.on("callback_query:data", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCallbackQuery(); return; }

  const data = ctx.callbackQuery.data;

  if (!data.startsWith("exp_")) { await ctx.answerCallbackQuery(); return; }

  if (data === "exp_cancel") {
    pendingExpenses.delete(chatId);
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("✖ Расход отменён.");
    return;
  }

  // Parse state from the message itself first — survives Railway redeploys
  const msgText = ctx.callbackQuery.message?.text ?? "";
  const expense = parseExpenseFromMessage(msgText) ?? pendingExpenses.get(chatId);

  if (!expense) {
    await ctx.answerCallbackQuery("Сессия устарела, отправь расход снова.");
    return;
  }

  if (data === "exp_company_yes") expense.isCompany = true;
  if (data === "exp_company_no")  expense.isCompany = false;
  if (data === "exp_docs_yes")    expense.hasDocs   = true;
  if (data === "exp_docs_no")     expense.hasDocs   = false;

  if (data === "exp_confirm") {
    pendingExpenses.delete(chatId);
    await ctx.answerCallbackQuery("Записываю...");
    try {
      await addExpenseRow(expense);
      await ctx.editMessageText(
        `✅ Записано!\n\n` +
        `📅 ${expense.date} | ฿${expense.amount}\n` +
        `📝 ${expense.description}\n` +
        `${expense.isCompany ? "🏢 На компанию" : "👤 Личный"} · ` +
        `${expense.hasDocs ? "📄 Есть доки" : "📭 Без доков"}`,
      );
    } catch (e) {
      console.error(e);
      await ctx.editMessageText("❌ Ошибка записи в таблицу. Попробуй ещё раз.");
    }
    return;
  }

  // Toggle — update message
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(buildExpenseMessage(expense), {
    parse_mode:   "HTML",
    reply_markup: buildExpenseKeyboard(expense.isCompany, expense.hasDocs),
  });
});

// Утренний брифинг в 9:00 по Бангкоку
const notifyChatIds = (process.env.NOTIFY_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (notifyChatIds.length > 0) {
  cron.schedule("30 9 * * *", async () => {
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

  console.log(`Morning briefing scheduled at 9:30 Bangkok → chat IDs: ${notifyChatIds.join(", ")}`);
} else {
  console.log("NOTIFY_CHAT_IDS not set — morning briefing disabled.");
}

bot.start();
console.log(`Bot started. Today in Bangkok: ${todayInThailand()}`);
