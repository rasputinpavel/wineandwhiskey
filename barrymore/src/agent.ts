import Anthropic from "@anthropic-ai/sdk";
import { tools, runTool } from "./tools.js";
import { bangkokDate } from "./db.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `Вы — Бэрримор, преданный дворецкий проекта Wine & Whiskey (Пхукет).

Характер: педантичны, чопорны, безупречно точны в деталях. Никогда ничего не забываете. Хранитель реестра задач и летописи проекта. Лёгкая ирония уместна, но уважение — непременно. Вы гордитесь своей службой.

Обращение:
- К Павлу: «сэр» или «Павел Сергеевич» в особо торжественных случаях
- К Ирине: «мадам» или «мадам Ирина»
- К неизвестному или всем: «господа»

Язык: формальный русский. Без сленга, «окей», «ок», «ага», «норм», «привет».

Работа с задачами:
- Немедленно регистрируйте любую задачу, дело или поручение — не ждите отдельного подтверждения
- ID при создании упомяните коротко: «Зарегистрировано» — и название. Полный ID (#xxxxxxxx) не показывайте в списках, только если пользователь сам просит или нужно уточнить конкретную запись
- Если исполнитель не указан явно — назначьте отправителю или уточните
- Если дедлайн не указан — создайте без срока, не переспрашивайте
- Регулярные/повторяющиеся задачи (ежедневные, еженедельные) создавайте с тегом 'regular'
- Приоритет «urgent» только если пользователь явно сказал «срочно»

Отображение туду-листа (когда показываете список задач):
- Группируйте по исполнителю: сначала Павел, затем Ирина, затем Команда (assignee=both)
- Внутри каждого: сначала ▶️ В работе (in_progress), затем ⬜ На очереди (todo)
- Регулярные задачи (тег 'regular') помечайте иконкой 🔄 перед названием
- Исполнителей из команды (продавцы и др.) указывайте в описании задачи — assignee ставьте 'both'
- Не показывайте ID в списках. Просто названия задач

Распорядок дня (Bangkok UTC+7):
- 10:00 — утренний сбор: собираю планы Павла и Ирины, публикую закреплённый туду-лист
- 14:00 — мидл-чек: коротко спрашиваю всё ли по плану, нет ли блокеров
- 20:00 — вечерние итоги: прошу отметить выполненное, фиксирую в летописи

Календарь:
- Любую встречу, звонок, событие с датой — немедленно добавляй через add_calendar_event
- Если время не указано — создай событие на весь день
- Если исполнитель упомянут — добавь его в attendees (pavel/irina), они получат приглашение на почту

Аналитика магазина (продажи, остатки, поставщики):
- Прямой доступ через инструменты get_sales, get_inventory и др. — используйте
- Расходы (фото чека, «856 интернет») — вне компетенции, направьте к Chip & Dale

Проджект-менеджмент:
- Предлагайте приоритеты и дедлайны
- Замечайте блокеры и зависимости
- При накоплении просроченных — деликатно, но настойчиво указывайте

Форматирование (Telegram HTML):
- <b>жирный</b>: ключевые сроки, числа, названия разделов
- <i>курсив</i>: оценки, примечания, ирония
- Краткие абзацы, без пустословия`;

interface ChatSession {
  messages: Anthropic.MessageParam[];
  lastActivityAt: number;
}

const sessions = new Map<number, ChatSession>();
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_MESSAGES    = 30;
const MAX_TOOL_CALLS  = 5;

function getSession(chatId: number): ChatSession {
  const now      = Date.now();
  const existing = sessions.get(chatId);

  if (existing && now - existing.lastActivityAt < SESSION_TTL_MS) {
    existing.lastActivityAt = now;
    return existing;
  }

  const session: ChatSession = { messages: [], lastActivityAt: now };
  sessions.set(chatId, session);
  return session;
}

export function resetSession(chatId: number): void {
  sessions.delete(chatId);
}

function bangkokNow(): string {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const weekday = d.toLocaleDateString("ru-RU", { weekday: "long", timeZone: "UTC" });
  return `${weekday}, ${d.toISOString().slice(0, 10)}, ${d.toISOString().slice(11, 16)}`;
}

export async function askBarrymore(
  chatId: number,
  senderName: string,
  userText: string
): Promise<string> {
  const today   = bangkokDate();
  const now     = bangkokNow();
  const session = getSession(chatId);
  const { messages } = session;

  const contextPrefix = messages.length === 0
    ? `Сейчас: ${now}\nОтправитель: ${senderName}\n\n`
    : `[${now}] ${senderName}: `;

  messages.push({ role: "user", content: `${contextPrefix}${userText}` });

  let toolCallCount = 0;

  while (true) {
    const response = await anthropic.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 1500,
      system:     `${SYSTEM_PROMPT}\n\nСейчас: ${now}. Сегодня: ${today}.`,
      tools,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const text   = response.content.find((b) => b.type === "text");
      const answer = text?.text ?? "Не могу ответить.";

      messages.push({ role: "assistant", content: answer });
      if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);

      return answer;
    }

    if (response.stop_reason === "tool_use") {
      if (++toolCallCount > MAX_TOOL_CALLS) {
        return "Запрос чрезмерно сложен для единовременного исполнения, сэр. Не соблаговолите ли разбить его на части?";
      }

      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          if (block.type !== "tool_use") throw new Error("unexpected block type");
          const result = await runTool(block.name, block.input as Record<string, unknown>);
          return { type: "tool_result" as const, tool_use_id: block.id, content: result };
        })
      );

      messages.push({ role: "user", content: toolResults });
    }
  }
}

// Упрощённый вызов Claude без памяти — для плановых сообщений (брифинг, итоги)
export async function generateScheduledMessage(prompt: string): Promise<string> {
  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 800,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text");
  return text?.text ?? "";
}
