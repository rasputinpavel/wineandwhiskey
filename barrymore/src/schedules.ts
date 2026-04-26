import cron from "node-cron";
import { Bot } from "grammy";
import * as db from "./db.js";
import { generateScheduledMessage } from "./agent.js";
import { createOrUpdatePin } from "./pinned.js";

async function sendSafe(bot: Bot, chatId: string, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch {
    const plain = text.replace(/<[^>]+>/g, "");
    await bot.api.sendMessage(chatId, plain);
  }
}

// 10:00 — утренний брифинг: задачи на день + просроченные + запрос плана
async function morningBriefing(bot: Bot, chatId: string): Promise<void> {
  const today        = db.bangkokDate();
  const todayTasks   = await db.getTodayTasks();
  const overdueTasks = await db.getOverdueTasks();
  const activeTasks  = await db.getActiveTasks();
  const regularTasks = await db.getRegularTasks();

  const todayLines   = todayTasks.map((t) => db.formatTask(t)).join("\n") || "  — нет";
  const overdueLines = overdueTasks.map((t) => db.formatTask(t)).join("\n") || "  — нет";
  const regularLines = regularTasks.map((t) => `  🔄 ${t.title}`).join("\n") || "  — нет";
  const activeCount  = activeTasks.length;

  const prompt = `Составьте утренний брифинг для рабочего дня ${today} в стиле Бэрримора.

Данные:
- Задач с дедлайном сегодня: ${todayTasks.length}
${todayLines}

- Регулярные задачи на каждый день (нужно выполнить сегодня): ${regularTasks.length}
${regularLines}

- Просроченные задачи: ${overdueTasks.length}
${overdueLines}

- Всего активных задач в реестре: ${activeCount}

Формат: поприветствуйте утром, кратко доложите обстановку включая регулярные задачи, задайте вопрос о планах на день. Telegram HTML. Длина — не более 250 слов.`;

  const message = await generateScheduledMessage(prompt);
  if (message) {
    await sendSafe(bot, chatId, message);
    await createOrUpdatePin(bot, chatId);
  }
}

// 14:00 — тихая проверка дедлайнов + регулярные задачи
async function noonDeadlineCheck(bot: Bot, chatId: string): Promise<void> {
  const todayTasks   = await db.getTodayTasks();
  const regularTasks = await db.getRegularTasks();

  if (todayTasks.length === 0 && regularTasks.length === 0) return;

  const lines: string[] = [];
  if (todayTasks.length > 0) {
    lines.push(...todayTasks.map((t) => db.formatTask(t)));
  }
  if (regularTasks.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("<i>Регулярные (каждый день):</i>");
    lines.push(...regularTasks.map((t) => `🔄 ${t.title}`));
  }

  const text = `<i>Позвольте напомнить, господа:</i> к концу дня ожидается выполнение следующих задач:\n\n${lines.join("\n")}`;
  await sendSafe(bot, chatId, text);
}

// 20:00 — вечерний итог: что выполнено, что переносить
async function eveningCheckIn(bot: Bot, chatId: string): Promise<void> {
  const today        = db.bangkokDate();
  const activeTasks  = await db.getActiveTasks();
  const todayTasks   = await db.getTodayTasks();
  const regularTasks = await db.getRegularTasks();
  const dailyLog     = await db.getDailyLog(today);

  const planNote      = dailyLog?.morning_plan ? `\nУтренний план: ${dailyLog.morning_plan.slice(0, 120)}` : "";
  const todayLines    = todayTasks.map((t) => db.formatTask(t)).join("\n") || "  — нет";
  const regularLines  = regularTasks.map((t) => `  🔄 ${t.title}`).join("\n") || "  — нет";
  const pendingCount  = activeTasks.length;

  const prompt = `Составьте вечернее сообщение в стиле Бэрримора для подведения итогов дня ${today}.

Данные:
- Задач с дедлайном сегодня (не завершены): ${todayTasks.length}
${todayLines}
- Регулярные задачи (выполнены сегодня?): ${regularTasks.length}
${regularLines}
- Всего в реестре активных задач: ${pendingCount}${planNote}

Формат: поздоровайтесь вечером, обозначьте незавершённое включая регулярные задачи, попросите сообщить что удалось сделать и что перенести. Telegram HTML. До 200 слов.`;

  const message = await generateScheduledMessage(prompt);
  if (message) await sendSafe(bot, chatId, message);
}

export function initSchedules(bot: Bot): void {
  const chatId = process.env.BARRYMORE_CHAT_ID;
  if (!chatId) {
    console.log("BARRYMORE_CHAT_ID не задан — расписание отключено.");
    return;
  }

  cron.schedule("0 10 * * *", async () => {
    console.log("Баррим: утренний брифинг...");
    try { await morningBriefing(bot, chatId); }
    catch (e) { console.error("Ошибка утреннего брифинга:", e); }
  }, { timezone: "Asia/Bangkok" });

  cron.schedule("0 14 * * *", async () => {
    console.log("Бэрримор: полуденная проверка дедлайнов...");
    try { await noonDeadlineCheck(bot, chatId); }
    catch (e) { console.error("Ошибка полуденной проверки:", e); }
  }, { timezone: "Asia/Bangkok" });

  cron.schedule("0 20 * * *", async () => {
    console.log("Бэрримор: вечерний брифинг...");
    try { await eveningCheckIn(bot, chatId); }
    catch (e) { console.error("Ошибка вечернего брифинга:", e); }
  }, { timezone: "Asia/Bangkok" });

  console.log(`Бэрримор: расписание активировано → chat ${chatId} (Bangkok UTC+7)`);
}
