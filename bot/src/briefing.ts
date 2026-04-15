import Anthropic from "@anthropic-ai/sdk";
import { getSales, getInventorySummary } from "./tools.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Надёжный способ получить дату в Bangkok без проблем с UTC-интерпретацией
function bangkokDateOffset(offsetDays: number): string {
  const utcNow = Date.now();
  const bangkokOffsetMs = 7 * 60 * 60 * 1000; // UTC+7
  const bangkokMs = utcNow + bangkokOffsetMs + offsetDays * 24 * 60 * 60 * 1000;
  return new Date(bangkokMs).toISOString().slice(0, 10); // YYYY-MM-DD
}

// Читаемый лейбл для даты — парсим с полуднем чтобы timezone не сдвинул день
function labelFor(date: string): string {
  return new Date(date + "T12:00:00Z").toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export async function generateMorningBriefing(): Promise<string> {
  const today = bangkokDateOffset(0);
  const yesterday = bangkokDateOffset(-1);
  const sameWeekdayLastWeek = bangkokDateOffset(-8);
  const sameWeekdayTwoWeeksAgo = bangkokDateOffset(-15);
  const monthStart = bangkokDateOffset(-30);

  const todayLabel = labelFor(today);
  const yesterdayLabel = labelFor(yesterday);

  const [salesYesterday, salesLastWeek, salesTwoWeeksAgo, salesMonth, inventory] = await Promise.all([
    getSales(yesterday, yesterday),
    getSales(sameWeekdayLastWeek, sameWeekdayLastWeek),
    getSales(sameWeekdayTwoWeeksAgo, sameWeekdayTwoWeeksAgo),
    getSales(monthStart, yesterday),
    getInventorySummary(),
  ]);

  const prompt = `Ты — дружелюбный помощник команды винного магазина Wine & Whiskey в Таиланде.
Каждое утро ты присылаешь команде тёплый брифинг о вчерашнем дне.

ВАЖНО — точные даты:
- Сегодня: ${todayLabel} (${today})
- Вчера (за что отчёт): ${yesterdayLabel} (${yesterday})
Используй эти даты точно, не додумывай дни недели сам.

ВАЖНО — честность:
- Если каких-то данных нет или период пустой — так и скажи коротко, не придумывай.
- Не делай выводов из данных которых нет.

Данные для анализа:

ВЧЕРА (${yesterdayLabel}):
${salesYesterday}

ТОТ ЖЕ ДЕНЬ ПРОШЛОЙ НЕДЕЛИ (${labelFor(sameWeekdayLastWeek)}):
${salesLastWeek}

ТОТ ЖЕ ДЕНЬ ДВЕ НЕДЕЛИ НАЗАД (${labelFor(sameWeekdayTwoWeeksAgo)}):
${salesTwoWeeksAgo}

ПОСЛЕДНИЕ 30 ДНЕЙ:
${salesMonth}

ОСТАТКИ НА СКЛАДЕ:
${inventory}

Напиши утреннее сообщение:
- Поздоровайся, назови день (${todayLabel}) — это сегодня, день отчёта — вчера (${yesterdayLabel})
- Итоги вчера: выручка, gross profit, чеки
- Сравни с тем же днём прошлых недель — динамика в процентах
- Апрель — межсезонье, суди справедливо. Хорошо — поддержи, скромно — утешь без пафоса
- Упомяни 1-2 топ-позиции
- Одна строчка про склад
- Один зарядный посыл на сегодня

Форматирование — строго HTML для Telegram. Пример структуры:

🌅 <b>Доброе утро, команда!</b> Сегодня среда, 16 апреля.

Вчера, во вторник, сделали <b>41 486 THB выручки</b> — <b>11 чеков</b>, gross profit <b>9 653 THB (23%)</b>.

По сравнению с тем же днём прошлой недели (32 100 THB) — <i>плюс 29%</i>, хороший рост.

Звёздой дня стал <b>Louis Roederer Cristal — 13 900 THB</b>. Ещё хорошо пошла <b>Car's Vodka — 7 штук</b>.

На складе <b>1 509 бутылок</b> — всё под контролем.

Впереди среда — <i>хороший день чтобы предложить что-то интересное гостю.</i> Вперёд! 💪

---
Правила:
- Каждая мысль — отдельный абзац, между ними пустая строка
- <b>жирный</b> — все цифры, суммы, названия топ-позиций
- <i>курсив</i> — оценки, сравнения, посыл в конце
- Никаких **, ##, -- и других символов кроме HTML-тегов
- 2-3 эмодзи максимум`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text");
  return text?.text ?? "Доброе утро! Не удалось загрузить данные.";
}
