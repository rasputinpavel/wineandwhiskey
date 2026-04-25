import type { Bot } from "grammy";
import * as db from "./db.js";

// ID закреплённого сообщения — живёт в памяти, при рестарте сбрасывается
let pinnedMessageId: number | null = null;

// Очередь завершённых задач — дренируется в index.ts после ответа бота
export interface CompletedTaskInfo {
  id: string;
  title: string;
  assignee: db.TaskAssignee;
  completedBy: string;
}
const completedQueue: CompletedTaskInfo[] = [];

export function pushCompleted(info: CompletedTaskInfo): void {
  completedQueue.push(info);
}

export function drainCompleted(): CompletedTaskInfo[] {
  return completedQueue.splice(0);
}

// Построить текст туду-листа по формату: Павел / Ирина / Команда
export async function buildTodoList(): Promise<string> {
  const today  = db.bangkokDate();
  const active = await db.getActiveTasks();

  // Завершённые за сегодня
  const { data: doneToday } = await (async () => {
    const all = await db.listTasks({ status: "done", limit: 100 });
    return { data: all.filter((t) => t.completed_at?.startsWith(today)) };
  })();

  const sections: Array<{ icon: string; label: string; key: db.TaskAssignee }> = [
    { icon: "👤", label: "Павел",  key: "pavel" },
    { icon: "👤", label: "Ирина",  key: "irina" },
    { icon: "👥", label: "Команда", key: "both"  },
  ];

  const lines: string[] = [`📋 <b>Задачи — ${formatDate(today)}</b>`];

  for (const { icon, label, key } of sections) {
    const sectionTasks = active.filter((t) => t.assignee === key);
    const inProgress   = sectionTasks.filter((t) => t.status === "in_progress");
    const todo         = sectionTasks.filter((t) => t.status === "todo");

    if (sectionTasks.length === 0) continue;

    lines.push(`\n<b>${icon} ${label}</b>`);

    if (inProgress.length > 0) {
      lines.push(`▶️ <b>В работе</b>`);
      for (const t of inProgress) lines.push(formatTaskLine(t));
    }

    if (todo.length > 0) {
      lines.push(`⬜ <b>На очереди</b>`);
      for (const t of todo) lines.push(formatTaskLine(t));
    }
  }

  if (doneToday.length > 0) {
    lines.push(`\n✅ <b>Выполнено сегодня</b>`);
    for (const t of doneToday) lines.push(`• <s>${t.title}</s>`);
  }

  return lines.join("\n");
}

function formatTaskLine(task: db.Task): string {
  const isRecurring = task.tags?.includes("regular");
  const prefix      = isRecurring ? "🔄 •" : "•";
  const deadline    = task.deadline && task.deadline !== db.bangkokDate()
    ? ` — до ${shortDate(task.deadline)}`
    : task.deadline === db.bangkokDate() ? " — <b>сегодня!</b>" : "";
  return `${prefix} ${task.title}${deadline}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  const months = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  return `${day} ${months[d.getUTCMonth()]}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const months = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

// Опубликовать закреплённое сообщение (или обновить существующее)
export async function createOrUpdatePin(bot: Bot, chatId: string): Promise<void> {
  const text = await buildTodoList();
  const numericChatId = Number(chatId);

  if (pinnedMessageId) {
    try {
      await bot.api.editMessageText(numericChatId, pinnedMessageId, text, { parse_mode: "HTML" });
      return;
    } catch {
      pinnedMessageId = null; // сообщение удалено — создадим новое
    }
  }

  try {
    const msg = await bot.api.sendMessage(numericChatId, text, { parse_mode: "HTML" });
    pinnedMessageId = msg.message_id;
    await bot.api.pinChatMessage(numericChatId, msg.message_id, { disable_notification: true });
  } catch (e) {
    console.error("Pin failed (нужны права администратора):", e);
  }
}
