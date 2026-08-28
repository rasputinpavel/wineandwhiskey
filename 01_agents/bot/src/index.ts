import dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });

import { Bot, InlineKeyboard } from "grammy";
import Anthropic from "@anthropic-ai/sdk";
import cron from "node-cron";
import { getSales, getInventory, getLowStock, getInventorySummary, getSupplier, getPurchaseOrders, getPurchaseHistory } from "./tools.js";
import { generateMorningBriefing } from "./briefing.js";
import {
  PendingExpense, PendingPhoto, WALLET_LABEL,
  bangkokDate, looksLikeExpense,
  extractExpenseFromText, extractExpenseFromPhoto,
  downloadTelegramPhoto, downloadTelegramFile,
  buildExpenseMessage, buildExpenseKeyboard,
  addExpenseRow, parseExpenseFromMessage,
} from "./expenses.js";
import {
  POCard,
  buildPOMessage, buildPOKeyboard, parsePOFromMessage, toISODate,
} from "./po-parse.js";
import {
  classifyAndExtractPO, isDuplicateDocNumber,
  uploadScan, deleteScan, downloadScan, commitPO,
} from "./po.js";
import {
  hasWriteoffTrigger, buildWriteoffMessage, parseWriteoffFromMessage,
  buildWriteoffKeyboard, buildCandidatesKeyboard, isConfident, ageLabel,
  buildGroupMessage, buildGroupKeyboard,
  type Candidate, type GroupItem,
} from "./writeoff-parse.js";
import {
  parseWriteoffText, parseWriteoffPhoto, parseWriteoffPhotoMulti, matchCatalog, findVariant,
  insertWriteoff, listPending, closeWriteoff,
} from "./writeoff.js";

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

// Weight items (sold_by_weight): after the item is chosen we ask "how many grams?"
// and complete the card from the next numeric reply. In-memory like pendingPhotos.
const pendingWeight = new Map<number, { variantId: string; itemName: string }>();

// A group-photo write-off in progress: the confirmed items, held in memory
// because N variant_ids don't fit in callback data. Restart loses it (rare).
const pendingGroup = new Map<number, GroupItem[]>();

// PO confirmation holds NO in-memory state: the scan is uploaded now, its path
// travels in the callback data, and the fields are read back from the card text
// on confirm — so a bot restart (Railway redeploy) mid-flow doesn't lose it.
async function startPOFlow(
  chatId: number,
  extracted: { supplier: string; docNumber: string; orderDate: string; amount: string },
  photo: { base64: string; mimeType: "image/jpeg" | "image/png" | "application/pdf" },
): Promise<void> {
  const scanPath  = await uploadScan(photo.base64, photo.mimeType);
  const duplicate = await isDuplicateDocNumber(extracted.docNumber);
  const card: POCard = {
    supplier:     extracted.supplier,
    docNumber:    extracted.docNumber,
    orderDate:    extracted.orderDate,
    receivedDate: bangkokDate(),
    amount:       extracted.amount,
    duplicate,
  };
  await bot.api.sendMessage(chatId, buildPOMessage(card), {
    parse_mode:   "HTML",
    reply_markup: buildPOKeyboard(duplicate, scanPath),
  });
}

async function startExpenseFlow(
  chatId: number,
  extracted: { amount: string; description: string; date?: string | null },
): Promise<void> {
  const expense: PendingExpense = {
    amount:      extracted.amount,
    description: extracted.description,
    date:        extracted.date ?? bangkokDate(),
    wallet:      "cash",
    hasDocs:     false,
    category:    "Операционные",
  };
  pendingExpenses.set(chatId, expense);
  await bot.api.sendMessage(chatId, buildExpenseMessage(expense), {
    parse_mode:   "HTML",
    reply_markup: buildExpenseKeyboard(expense.wallet, expense.hasDocs, expense.category),
  });
}

async function sendWriteoffCard(
  chatId: number,
  card: { itemName: string; qty: number; weightGrams: number | null; date: string },
  variantId: string,
): Promise<void> {
  await bot.api.sendMessage(chatId, buildWriteoffMessage(card), {
    parse_mode: "HTML",
    reply_markup: buildWriteoffKeyboard(variantId),
  });
}

// Present a chosen catalog item: weight item + known weight → card; weight item
// + no weight → ask for grams; piece item → card with qty.
async function presentChosenItem(
  chatId: number,
  item: { variant_id: string; item_name: string; sold_by_weight: boolean },
  qty: number,
  weightGrams: number | null,
): Promise<void> {
  if (item.sold_by_weight) {
    if (weightGrams != null) {
      await sendWriteoffCard(chatId, { itemName: item.item_name, qty: 1, weightGrams, date: bangkokDate() }, item.variant_id);
    } else {
      pendingWeight.set(chatId, { variantId: item.variant_id, itemName: item.item_name });
      await bot.api.sendMessage(chatId, `⚖️ Сколько грамм для ${item.item_name}? Напиши число.`);
    }
  } else {
    await sendWriteoffCard(chatId, { itemName: item.item_name, qty, weightGrams: null, date: bangkokDate() }, item.variant_id);
  }
}

// Show the write-off card (confident single match) or a candidate picker.
// No in-memory state — variant_id + qty travel in callback data, the card
// fields are read back from the message text on confirm.
async function startWriteoffFlow(
  chatId: number,
  extracted: { query: string; qty: number; weightGrams: number | null },
): Promise<void> {
  const candidates: Candidate[] = await matchCatalog(extracted.query, extracted.weightGrams);
  if (candidates.length === 0) {
    await bot.api.sendMessage(
      chatId,
      `🤔 Не нашёл «${extracted.query}» в каталоге. Напиши точнее название из Loyverse.`,
    );
    return;
  }
  if (isConfident(candidates)) {
    await presentChosenItem(chatId, candidates[0], extracted.qty, extracted.weightGrams);
    return;
  }
  await bot.api.sendMessage(chatId, `🍷 Что списываем? Выбери:`, {
    reply_markup: buildCandidatesKeyboard(candidates, extracted.qty, extracted.weightGrams),
  });
}

// Match each recognized bottle; confident piece matches go into the summary,
// everything else (ambiguous / not found / weight item) is listed to enter by hand.
async function startGroupWriteoffFlow(
  chatId: number,
  extractions: { query: string; qty: number; weightGrams: number | null }[],
): Promise<void> {
  const byVariant = new Map<string, GroupItem>();
  const unresolved: string[] = [];
  for (const ex of extractions) {
    const cands = await matchCatalog(ex.query, ex.weightGrams);
    if (cands.length > 0 && isConfident(cands) && !cands[0].sold_by_weight) {
      const c = cands[0];
      const g = byVariant.get(c.variant_id);
      if (g) g.qty += ex.qty;
      else byVariant.set(c.variant_id, { variantId: c.variant_id, itemName: c.item_name, qty: ex.qty });
    } else {
      unresolved.push(ex.query);
    }
  }
  const items = [...byVariant.values()];
  if (items.length === 0) {
    await bot.api.sendMessage(chatId, `🤔 Не распознал уверенно ни одной позиции. Заведи по одной: ${unresolved.join(", ")}`);
    return;
  }
  pendingGroup.set(chatId, items);
  await bot.api.sendMessage(chatId, buildGroupMessage(items, unresolved), {
    parse_mode: "HTML",
    reply_markup: buildGroupKeyboard(),
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

bot.command("writeoffs", async (ctx) => {
  const pending = await listPending();
  if (pending.length === 0) {
    await ctx.reply("Всё списано, чисто 👍");
    return;
  }
  const today = todayInThailand();
  await ctx.reply(`🍷 Незакрытые списания (${pending.length}):`);
  for (const r of pending) {
    const amount = r.weight_grams != null ? `${r.weight_grams} г` : `${r.qty}×`;
    await ctx.reply(
      `📦 ${amount} ${r.item_name}\n📅 ${r.taken_date} · ${ageLabel(r.taken_date, today)}` +
        (r.taken_by ? ` · ${r.taken_by}` : ""),
      { reply_markup: new InlineKeyboard().text("✅ Списано", `wo_close:${r.id}`) },
    );
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

  const waitMsg = await ctx.reply("Читаю документ...");
  try {
    const photo = await downloadTelegramPhoto(process.env.TELEGRAM_BOT_TOKEN!, fileId);

    // A captioned photo is an explicit expense entry (existing convention: photo
    // + caption = расход). A supplier PO scan arrives as a plain photo, so we only
    // run the (costly) PO classification when there is NO caption.
    if (caption) {
      // A write-off trigger in the caption ("спиши 2", "себе") routes to the
      // write-off flow; otherwise the long-standing convention holds: a
      // captioned photo is an expense entry.
      if (hasWriteoffTrigger(caption)) {
        const items = await parseWriteoffPhotoMulti(photo.base64, photo.mimeType as "image/jpeg" | "image/png", caption);
        await ctx.api.deleteMessage(chatId, waitMsg.message_id);
        if (items.length === 0) await ctx.reply("Не понял, что списать. Напиши: «спиши 2 просекко».");
        else if (items.length === 1) await startWriteoffFlow(chatId, items[0]);
        else await startGroupWriteoffFlow(chatId, items);
        return;
      }
      const extracted = await extractExpenseFromPhoto(photo.base64, photo.mimeType, caption);
      await ctx.api.deleteMessage(chatId, waitMsg.message_id);
      if (extracted) {
        await startExpenseFlow(chatId, extracted);
      } else {
        await ctx.reply("Не смог распознать сумму. Напиши расход текстом: «856 интернет»");
      }
      return;
    }

    // No caption → could be a supplier purchase order. Classify.
    const po = await classifyAndExtractPO(photo.base64, photo.mimeType);
    if (po) {
      await ctx.api.deleteMessage(chatId, waitMsg.message_id);
      await startPOFlow(chatId, po, photo);
      return;
    }

    // Not a PO → store photo, wait for caption in next text message.
    pendingPhotos.set(chatId, photo);
    await ctx.api.editMessageText(chatId, waitMsg.message_id, "📷 Фото получено. Напиши пояснение (на что потратили и сумму, если не видно):");
  } catch (e) {
    console.error(e);
    await ctx.api.editMessageText(chatId, waitMsg.message_id, "Ошибка при обработке фото.");
  }
});

// PO scans also arrive as documents (PDF, or an uncompressed image sent as a
// file) — these come through message:document, not message:photo. We only act
// on PDFs and images; other file types are ignored.
const PO_DOC_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);

bot.on("message:document", async (ctx) => {
  const chatId = ctx.chat.id;
  const doc    = ctx.message.document;
  const mime   = doc.mime_type ?? "";
  if (!PO_DOC_MIMES.has(mime)) return; // not a PO-shaped document — ignore

  const waitMsg = await ctx.reply("Читаю документ...");
  try {
    const file = await downloadTelegramFile(process.env.TELEGRAM_BOT_TOKEN!, doc.file_id, mime);
    const scanMime = file.mimeType as "image/jpeg" | "image/png" | "application/pdf";

    const po = await classifyAndExtractPO(file.base64, scanMime);
    if (po) {
      await ctx.api.deleteMessage(chatId, waitMsg.message_id);
      await startPOFlow(chatId, po, { base64: file.base64, mimeType: scanMime });
      return;
    }

    await ctx.api.editMessageText(
      chatId, waitMsg.message_id,
      "Не распознал это как PO поставщика. Если это расход — напиши сумму текстом: «856 интернет».",
    );
  } catch (e) {
    console.error(e);
    await ctx.api.editMessageText(chatId, waitMsg.message_id, "Ошибка при обработке документа.");
  }
});

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text   = ctx.message.text;
  if (text.startsWith("/")) return;

  const pw = pendingWeight.get(chatId);
  if (pw) {
    const m = text.match(/(\d+)/);
    const grams = m ? Number(m[1]) : 0;
    if (!grams || grams <= 0) {
      await ctx.reply("Нужно число грамм, например 250.");
      return;
    }
    pendingWeight.delete(chatId);
    await sendWriteoffCard(chatId, { itemName: pw.itemName, qty: 1, weightGrams: grams, date: bangkokDate() }, pw.variantId);
    return;
  }

  // If there's a pending photo, treat this text as its caption — even in group chats
  // where the user didn't explicitly address the bot. The bot already asked for a reply.
  const pendingPhoto = pendingPhotos.get(chatId);
  if (pendingPhoto) {
    pendingPhotos.delete(chatId);
    // A write-off trigger as the follow-up text means: write off the photographed
    // bottle, not log an expense for it (user sent a bare bottle photo, then «спиши»).
    if (hasWriteoffTrigger(text)) {
      const wmsg = await ctx.reply("Распознаю списание...");
      try {
        const items = await parseWriteoffPhotoMulti(pendingPhoto.base64, pendingPhoto.mimeType, text);
        await ctx.api.deleteMessage(chatId, wmsg.message_id);
        if (items.length === 0) await ctx.reply("Не понял, что списать. Пришли фото ещё раз с подписью «спиши 2».");
        else if (items.length === 1) await startWriteoffFlow(chatId, items[0]);
        else await startGroupWriteoffFlow(chatId, items);
      } catch (e) {
        console.error(e);
        await ctx.api.editMessageText(chatId, wmsg.message_id, "Ошибка при распознавании списания.");
      }
      return;
    }
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

  // Write-off shortcut — works in groups without addressing the bot, same as
  // expenses. Checked before looksLikeExpense so "спиши ..." never lands as an
  // expense.
  if (hasWriteoffTrigger(text)) {
    const msg = await ctx.reply("Распознаю списание...");
    try {
      const extracted = await parseWriteoffText(text);
      await ctx.api.deleteMessage(chatId, msg.message_id);
      if (extracted) await startWriteoffFlow(chatId, extracted);
      else await ctx.reply("Не понял, что списать. Напиши: «спиши 2 просекко».");
    } catch (e) {
      console.error(e);
      await ctx.api.editMessageText(chatId, msg.message_id, "Ошибка при распознавании списания.");
    }
    return;
  }

  // Expense text shortcut — works in groups without addressing the bot,
  // same as the photo handler (фото записываются без префикса «чип»).
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

  if (isGroupChat(ctx.chat.type) && !isAddressedToChipDale(text, ctx.me.username ?? "")) return;

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

async function handlePOCallback(ctx: any, chatId: number, data: string): Promise<void> {
  // data = "<action>:<scanPath>" (scanPath survives a bot restart; the card
  // fields are read back from the message text below).
  const sep = data.indexOf(":");
  const action = sep === -1 ? data : data.slice(0, sep);
  const scanPath = sep === -1 ? "" : data.slice(sep + 1);

  if (action === "po_cancel") {
    await deleteScan(scanPath);
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("✖ PO отменён.");
    return;
  }

  const card = parsePOFromMessage(ctx.callbackQuery?.message?.text ?? "");
  if (!card) {
    await ctx.answerCallbackQuery("Не смог прочитать карточку — отправь скан снова.");
    return;
  }

  if (action === "po_expense") {
    // Misclassified — it is an expense. Pull the bytes back, drop the PO scan,
    // and hand images to the expense flow (PDF expenses → ask for a text amount).
    await ctx.answerCallbackQuery("Ок, это расход");
    const scan = await downloadScan(scanPath);
    await deleteScan(scanPath);
    if (scan && scan.mime !== "application/pdf") {
      pendingPhotos.set(chatId, {
        base64: scan.base64,
        mimeType: scan.mime as "image/jpeg" | "image/png",
        timestamp: Date.now(),
      });
      await ctx.editMessageText("↔️ Ок, это расход. Напиши пояснение (на что потратили и сумму, если не видно):");
    } else {
      await ctx.editMessageText("↔️ Ок. Напиши сумму текстом: «856 интернет».");
    }
    return;
  }

  if (action === "po_confirm" || action === "po_overwrite") {
    if (!scanPath) {
      // An old card shown before this version — no scan reference to save.
      await ctx.answerCallbackQuery("Старая карточка — отправь скан заново.");
      try { await ctx.editMessageText("⚠️ Старая карточка. Отправь скан заново."); } catch {}
      return;
    }
    const overwrite = action === "po_overwrite";
    await ctx.answerCallbackQuery(overwrite ? "Перезаписываю..." : "Записываю...");
    const uploadedBy = ctx.from?.first_name ?? ctx.from?.username ?? "—";
    try {
      await commitPO(
        {
          supplier:     card.supplier,
          docNumber:    card.docNumber,
          orderDate:    card.orderDate,
          receivedDate: card.receivedDate,
          amount:       card.amount,
          uploadedBy,
        },
        scanPath,
        { overwrite },
      );
    } catch (e) {
      console.error("commitPO failed:", e);
      try {
        await ctx.editMessageText("❌ Ошибка записи PO. Отправь скан снова.");
      } catch (editErr) { console.error("editMessageText failed:", editErr); }
      return;
    }
    try {
      await ctx.editMessageText(
        `${overwrite ? "♻️ PO перезаписан." : "✅ PO записан."}\n\n` +
        `🏭 ${card.supplier || "—"}\n` +
        `🧾 ${card.docNumber || "—"}\n` +
        `📅 ${card.orderDate || "—"} · 📦 ${card.receivedDate}\n` +
        `💰 ฿${card.amount || "—"}`,
      );
    } catch (editErr) { console.error("confirmation edit failed:", editErr); }
    return;
  }

  await ctx.answerCallbackQuery();
}

async function handleWriteoffCallback(ctx: any, chatId: number, data: string): Promise<void> {
  // wo_cancel | wo_pick:<qty>:<variant_id> | wo_confirm:<variant_id> | wo_close:<id>
  if (data === "wo_cancel") {
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("✖ Списание отменено.");
    return;
  }

  if (data === "wo_group_cancel") {
    pendingGroup.delete(chatId);
    await ctx.answerCallbackQuery("Отменено");
    await ctx.editMessageText("✖ Групповое списание отменено.");
    return;
  }
  if (data === "wo_group_confirm") {
    const items = pendingGroup.get(chatId);
    if (!items || items.length === 0) {
      await ctx.answerCallbackQuery("Группа устарела — отправь фото снова.");
      return;
    }
    await ctx.answerCallbackQuery("Записываю…");
    const takenBy = ctx.from?.first_name ?? ctx.from?.username ?? "—";
    const takenDate = todayInThailand();
    try {
      for (const it of items) {
        await insertWriteoff({ variantId: it.variantId, itemName: it.itemName, qty: it.qty, weightGrams: null, takenDate, takenBy });
      }
    } catch (e) {
      console.error("group confirm failed:", e);
      try { await ctx.editMessageText("❌ Ошибка записи группы. Попробуй снова."); } catch {}
      return;
    }
    pendingGroup.delete(chatId);
    try {
      await ctx.editMessageText(
        `✅ Записано: ${items.length} ${items.length === 1 ? "позиция" : "позиций"}.\n\n` +
          `Когда сделаешь Stock Adjustment в Loyverse — жми «Списано» в /writeoffs.`,
      );
    } catch {}
    return;
  }

  if (data.startsWith("wo_pick:")) {
    const [, qtyStr, gStr, variantId] = data.split(":");
    const qty = Number(qtyStr) || 1;
    const weightGrams = gStr === "-" ? null : (Number(gStr) || null);
    await ctx.answerCallbackQuery("Загружаю…"); // ack immediately, before the catalog fetch
    try {
      const item = await findVariant(variantId);
      if (!item) {
        await ctx.editMessageText("Товар не найден в каталоге — заведи списание заново.");
        return;
      }
      if (item.sold_by_weight && weightGrams == null) {
        pendingWeight.set(chatId, { variantId: item.variant_id, itemName: item.item_name });
        await ctx.editMessageText(`⚖️ Сколько грамм для ${item.item_name}? Напиши число.`);
        return;
      }
      const card = {
        itemName: item.item_name,
        qty: item.sold_by_weight ? 1 : qty,
        weightGrams: item.sold_by_weight ? weightGrams : null,
        date: bangkokDate(),
      };
      await ctx.editMessageText(buildWriteoffMessage(card), {
        parse_mode: "HTML",
        reply_markup: buildWriteoffKeyboard(item.variant_id),
      });
    } catch (e) {
      console.error("wo_pick failed:", e);
      try { await ctx.editMessageText("❌ Ошибка при выборе товара. Заведи списание заново."); } catch {}
    }
    return;
  }

  if (data.startsWith("wo_confirm:")) {
    const variantId = data.slice("wo_confirm:".length);
    const card = parseWriteoffFromMessage(ctx.callbackQuery?.message?.text ?? "");
    if (!card) {
      await ctx.answerCallbackQuery("Не смог прочитать карточку — заведи заново.");
      return;
    }
    await ctx.answerCallbackQuery("Записываю...");
    const takenBy = ctx.from?.first_name ?? ctx.from?.username ?? "—";
    try {
      await insertWriteoff({
        variantId,
        itemName: card.itemName,
        qty: card.qty,
        weightGrams: card.weightGrams,
        takenDate: toISODate(card.date) ?? todayInThailand(),
        takenBy,
      });
    } catch (e) {
      console.error("insertWriteoff failed:", e);
      try { await ctx.editMessageText("❌ Ошибка записи списания. Заведи заново."); } catch {}
      return;
    }
    try {
      const amount = card.weightGrams != null ? `${card.weightGrams} г` : `${card.qty}×`;
      await ctx.editMessageText(
        `✅ Записано в список на списание.\n\n📦 ${amount} ${card.itemName}\n📅 ${card.date}\n\n` +
          `Когда сделаешь Stock Adjustment в Loyverse — жми «Списано» в /writeoffs.`,
      );
    } catch (e) { console.error("confirm edit failed:", e); }
    return;
  }

  if (data.startsWith("wo_close:")) {
    const id = data.slice("wo_close:".length);
    await ctx.answerCallbackQuery("Отмечаю...");
    const closedBy = ctx.from?.first_name ?? ctx.from?.username ?? "—";
    try {
      await closeWriteoff(id, closedBy);
    } catch (e) {
      console.error("closeWriteoff failed:", e);
      try { await ctx.editMessageText("❌ Не смог отметить. Попробуй ещё раз."); } catch {}
      return;
    }
    const base = (ctx.callbackQuery?.message?.text ?? "").split("\n")[0];
    try { await ctx.editMessageText(`✅ Списано: ${base.replace(/^📦\s*/, "")}`); } catch {}
    return;
  }

  await ctx.answerCallbackQuery();
}

bot.on("callback_query:data", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCallbackQuery(); return; }

  const data = ctx.callbackQuery.data;

  if (data.startsWith("wo_")) { await handleWriteoffCallback(ctx, chatId, data); return; }
  if (data.startsWith("po_")) { await handlePOCallback(ctx, chatId, data); return; }
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

  if (data === "exp_wallet_account")  expense.wallet = "account";
  if (data === "exp_wallet_cash")     expense.wallet = "cash";
  if (data === "exp_wallet_personal") expense.wallet = "personal";
  if (data === "exp_docs_yes")    expense.hasDocs   = true;
  if (data === "exp_docs_no")     expense.hasDocs   = false;
  if (data === "exp_cat_op")      expense.category  = "Операционные";
  if (data === "exp_cat_oblig")   expense.category  = "Обязательные";
  if (data === "exp_cat_cred")    expense.category  = "Кредиторка";

  if (data === "exp_confirm") {
    pendingExpenses.delete(chatId);
    await ctx.answerCallbackQuery("Записываю...");
    try {
      await addExpenseRow(expense);
    } catch (e) {
      console.error("addExpenseRow failed:", e);
      try {
        await ctx.editMessageText("❌ Ошибка записи в таблицу. Попробуй ещё раз.");
      } catch (editErr) { console.error("editMessageText failed:", editErr); }
      return;
    }
    // Sheet write succeeded — confirmation edit is cosmetic, swallow its errors
    // (e.g. "message is not modified" if a duplicate callback already updated it).
    try {
      await ctx.editMessageText(
        `✅ Записано!\n\n` +
        `📅 ${expense.date} | ฿${expense.amount}\n` +
        `📝 ${expense.description}\n` +
        `🏷 ${expense.category}\n` +
        `${WALLET_LABEL[expense.wallet]} · ` +
        `${expense.hasDocs ? "📄 Есть доки" : "📭 Без доков"}`,
      );
    } catch (editErr) { console.error("confirmation edit failed:", editErr); }
    return;
  }

  // Toggle — update message
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(buildExpenseMessage(expense), {
    parse_mode:   "HTML",
    reply_markup: buildExpenseKeyboard(expense.wallet, expense.hasDocs, expense.category),
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
