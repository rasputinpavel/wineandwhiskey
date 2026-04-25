import type Anthropic from "@anthropic-ai/sdk";
import * as db from "./db.js";
import { getSales, getInventory, getLowStock, getInventorySummary, getSupplier, getPurchaseHistory, getPurchaseOrders } from "./store.js";
import { pushCompleted } from "./pinned.js";
import { addCalendarEvent } from "./calendar.js";

export const tools: Anthropic.Tool[] = [
  {
    name: "add_task",
    description: "Зарегистрировать новую задачу в реестре. Используй при любом упоминании задачи, дела, поручения.",
    input_schema: {
      type: "object" as const,
      properties: {
        title:       { type: "string",  description: "Краткое название задачи" },
        assignee:    { type: "string",  enum: ["pavel", "irina", "both"], description: "Исполнитель: pavel, irina или both" },
        description: { type: "string",  description: "Подробное описание (необязательно)" },
        priority:    { type: "string",  enum: ["low", "normal", "high", "urgent"], description: "Приоритет, по умолчанию normal" },
        deadline:    { type: "string",  description: "Срок выполнения в формате YYYY-MM-DD (необязательно)" },
        tags:        { type: "array",   items: { type: "string" }, description: "Теги для категоризации" },
      },
      required: ["title", "assignee"],
    },
  },
  {
    name: "list_tasks",
    description: "Получить список задач из реестра. Используй для команд типа «покажи задачи», «что у меня в работе», «бэклог».",
    input_schema: {
      type: "object" as const,
      properties: {
        assignee: { type: "string", enum: ["pavel", "irina", "both"], description: "Фильтр по исполнителю (необязательно)" },
        status:   { type: "string", enum: ["todo", "in_progress", "done", "cancelled", "active"], description: "Статус задач. 'active' = todo + in_progress" },
        limit:    { type: "number", description: "Максимум задач, по умолчанию 20" },
      },
    },
  },
  {
    name: "update_task",
    description: "Изменить параметры существующей задачи: статус, приоритет, дедлайн, описание.",
    input_schema: {
      type: "object" as const,
      properties: {
        id:          { type: "string", description: "ID задачи (первые 8 символов UUID достаточно)" },
        title:       { type: "string", description: "Новое название" },
        status:      { type: "string", enum: ["todo", "in_progress", "done", "cancelled"] },
        priority:    { type: "string", enum: ["low", "normal", "high", "urgent"] },
        assignee:    { type: "string", enum: ["pavel", "irina", "both"] },
        deadline:    { type: "string", description: "Новый срок YYYY-MM-DD или null для удаления" },
        notes:       { type: "string", description: "Примечание к задаче" },
      },
      required: ["id"],
    },
  },
  {
    name: "complete_task",
    description: "Отметить задачу выполненной и внести запись в летопись. Используй когда задача завершена.",
    input_schema: {
      type: "object" as const,
      properties: {
        id:    { type: "string", description: "ID задачи" },
        notes: { type: "string", description: "Примечание к результату (необязательно)" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_overdue_tasks",
    description: "Получить список просроченных задач (дедлайн прошёл, статус не выполнена).",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "log_morning_plan",
    description: "Сохранить утренний план дня — что планируется сделать сегодня.",
    input_schema: {
      type: "object" as const,
      properties: {
        plan: { type: "string", description: "Описание планов на день" },
      },
      required: ["plan"],
    },
  },
  {
    name: "log_evening_review",
    description: "Сохранить итоги дня — что сделано, что переносится.",
    input_schema: {
      type: "object" as const,
      properties: {
        review:          { type: "string", description: "Что было сделано и что нет" },
        completed_ids:   { type: "array",  items: { type: "string" }, description: "ID задач, выполненных сегодня" },
      },
      required: ["review"],
    },
  },
  {
    name: "get_chronicle",
    description: "Получить летопись проекта — хронологию событий, выполненных задач, важных решений.",
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string", description: "С даты YYYY-MM-DD (необязательно)" },
        date_to:   { type: "string", description: "По дату YYYY-MM-DD (необязательно)" },
        limit:     { type: "number", description: "Максимум записей, по умолчанию 20" },
      },
    },
  },

  // --- Инструменты магазина (Chip & Dale) ---
  {
    name: "get_sales",
    description: "Данные о продажах магазина за период: выручка, чеки, топ-позиции, gross profit.",
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string", description: "Дата начала YYYY-MM-DD" },
        date_to:   { type: "string", description: "Дата конца YYYY-MM-DD" },
      },
      required: ["date_from", "date_to"],
    },
  },
  {
    name: "get_inventory",
    description: "Остатки товаров на складе. Можно передать фильтр по названию или категории.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: { type: "string", description: "Фильтр по названию или категории (необязательно)" },
      },
    },
  },
  {
    name: "get_low_stock",
    description: "Список товаров с низким остатком на складе.",
    input_schema: {
      type: "object" as const,
      properties: {
        threshold: { type: "number", description: "Порог остатка, по умолчанию 5 шт" },
      },
    },
  },
  {
    name: "get_inventory_summary",
    description: "Сводка по складу: общее количество бутылок и разбивка по категориям.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_supplier",
    description: "Найти поставщика по названию товара или вина.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Название товара для поиска" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_purchase_history",
    description: "История закупок конкретного товара: поставщики, средняя цена, даты заказов.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Название товара, например 'Prosecco'" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_purchase_orders",
    description: "История закупок (purchase orders) по поставщику или периоду.",
    input_schema: {
      type: "object" as const,
      properties: {
        supplier:      { type: "string",  description: "Название поставщика" },
        date_from:     { type: "string",  description: "С даты YYYY-MM-DD" },
        date_to:       { type: "string",  description: "По дату YYYY-MM-DD" },
        include_items: { type: "boolean", description: "Включить позиции заказов" },
        limit:         { type: "number",  description: "Максимум заказов" },
      },
    },
  },
  {
    name: "add_calendar_event",
    description: "Добавить встречу или событие в Google Календарь. Используй при любом упоминании встречи, звонка, дедлайна, напоминания с датой и временем.",
    input_schema: {
      type: "object" as const,
      properties: {
        title:            { type: "string",  description: "Название события" },
        date:             { type: "string",  description: "Дата в формате YYYY-MM-DD" },
        time:             { type: "string",  description: "Время начала HH:MM (если не указано — событие на весь день)" },
        duration_minutes: { type: "number",  description: "Длительность в минутах, по умолчанию 60" },
        attendees:        { type: "array",   items: { type: "string", enum: ["pavel", "irina"] }, description: "Кому отправить приглашение" },
        description:      { type: "string",  description: "Описание / повестка встречи" },
        location:         { type: "string",  description: "Место проведения" },
      },
      required: ["title", "date"],
    },
  },
];

export async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "add_task":         return handleAddTask(input);
      case "list_tasks":       return handleListTasks(input);
      case "update_task":      return handleUpdateTask(input);
      case "complete_task":    return handleCompleteTask(input);
      case "get_overdue_tasks": return handleGetOverdueTasks();
      case "log_morning_plan": return handleLogMorningPlan(input);
      case "log_evening_review": return handleLogEveningReview(input);
      case "get_chronicle":    return handleGetChronicle(input);
      // Инструменты магазина — прямой вызов ops-данных
      case "get_sales":            return getSales(String(input.date_from), String(input.date_to));
      case "get_inventory":        return getInventory(input.filter as string | undefined);
      case "get_low_stock":        return getLowStock((input.threshold as number) ?? 5);
      case "get_inventory_summary": return getInventorySummary();
      case "get_supplier":         return getSupplier(String(input.query));
      case "get_purchase_history": return getPurchaseHistory(String(input.query));
      case "get_purchase_orders":  return getPurchaseOrders(input as Parameters<typeof getPurchaseOrders>[0]);
      case "add_calendar_event":   return handleAddCalendarEvent(input);
      default: return `Неизвестный инструмент: ${name}`;
    }
  } catch (err) {
    return `Ошибка выполнения ${name}: ${String(err)}`;
  }
}

async function handleAddTask(input: Record<string, unknown>): Promise<string> {
  const task = await db.createTask({
    title:       String(input.title),
    assignee:    input.assignee as db.TaskAssignee,
    description: input.description as string | undefined,
    priority:    (input.priority as db.TaskPriority) ?? "normal",
    deadline:    input.deadline as string | undefined,
    tags:        (input.tags as string[]) ?? [],
    created_by:  input.created_by as string | undefined,
  });

  const shortId = task.id.slice(0, 8);
  await db.addChronicleEntry({
    date: db.bangkokDate(),
    event_type: "task_created",
    title: `Задача создана: ${task.title}`,
    description: `Исполнитель: ${task.assignee}, приоритет: ${task.priority}`,
    task_id: task.id,
  });

  return JSON.stringify({ id: shortId, full_id: task.id, title: task.title, assignee: task.assignee, priority: task.priority, deadline: task.deadline ?? null });
}

async function handleListTasks(input: Record<string, unknown>): Promise<string> {
  const statusArg = input.status as string | undefined;
  let tasks: db.Task[];

  if (!statusArg || statusArg === "active") {
    tasks = await db.getActiveTasks();
  } else {
    tasks = await db.listTasks({
      assignee: input.assignee as db.TaskAssignee | undefined,
      status:   statusArg as db.TaskStatus,
      limit:    (input.limit as number) ?? 20,
    });
  }

  if (tasks.length === 0) return "Задач по заданным параметрам не найдено.";

  const lines = tasks.map((t) => {
    const id       = t.id.slice(0, 8);
    const assignee = { pavel: "сэр", irina: "мадам", both: "оба" }[t.assignee];
    const deadline = t.deadline ? `, до ${t.deadline}` : "";
    const priority = { urgent: "🔴", high: "🟠", normal: "🟡", low: "🟢" }[t.priority];
    const status   = { todo: "☐", in_progress: "⟳", done: "✓", cancelled: "✗" }[t.status];
    return `${status}${priority} #${id} ${t.title} [${assignee}${deadline}]`;
  });

  return `Найдено задач: ${tasks.length}\n\n${lines.join("\n")}`;
}

async function handleUpdateTask(input: Record<string, unknown>): Promise<string> {
  const shortId = String(input.id);

  // Если передан короткий ID, найдём полный
  let fullId = shortId;
  if (shortId.length < 36) {
    const all = await db.getActiveTasks();
    const match = all.find((t) => t.id.startsWith(shortId));
    if (!match) return `Задача с ID ${shortId} не найдена.`;
    fullId = match.id;
  }

  const updates: Record<string, unknown> = {};
  if (input.title)    updates.title    = input.title;
  if (input.status)   updates.status   = input.status;
  if (input.priority) updates.priority = input.priority;
  if (input.assignee) updates.assignee = input.assignee;
  if ("deadline" in input) updates.deadline = input.deadline ?? null;
  if (input.notes)    updates.notes    = input.notes;

  const task = await db.updateTask(fullId, updates as Parameters<typeof db.updateTask>[1]);
  return `Задача #${task.id.slice(0, 8)} «${task.title}» обновлена.`;
}

async function handleCompleteTask(input: Record<string, unknown>): Promise<string> {
  const shortId = String(input.id);

  let fullId = shortId;
  if (shortId.length < 36) {
    const active = await db.getActiveTasks();
    const match  = active.find((t) => t.id.startsWith(shortId));
    if (!match) {
      // Поискать среди всех задач (включая завершённые)
      const allTasks = await db.listTasks({ limit: 200 });
      const found    = allTasks.find((t) => t.id.startsWith(shortId));
      if (!found) return `Задача с ID ${shortId} не найдена.`;
      fullId = found.id;
    } else {
      fullId = match.id;
    }
  }

  const task = await db.completeTask(fullId, input.notes as string | undefined);
  await db.addChronicleEntry({
    date: db.bangkokDate(),
    event_type: "task_completed",
    title: `Завершено: ${task.title}`,
    description: task.notes,
    task_id: task.id,
  });

  pushCompleted({
    id:          task.id,
    title:       task.title,
    assignee:    task.assignee,
    completedBy: String(input.completed_by ?? ""),
  });

  return `Задача «${task.title}» отмечена выполненной и внесена в летопись.`;
}

async function handleGetOverdueTasks(): Promise<string> {
  const tasks = await db.getOverdueTasks();
  if (tasks.length === 0) return "Просроченных задач нет. Превосходно.";

  const today = db.bangkokDate();
  const lines = tasks.map((t) => {
    const daysOverdue = t.deadline
      ? Math.ceil((new Date(today).getTime() - new Date(t.deadline).getTime()) / 86400000)
      : 0;
    const assignee = { pavel: "сэр", irina: "мадам", both: "оба" }[t.assignee];
    return `🔴 #${t.id.slice(0, 8)} ${t.title} [${assignee}] — просрочена на ${daysOverdue} д.`;
  });

  return `Просроченные задачи (${tasks.length}):\n\n${lines.join("\n")}`;
}

async function handleLogMorningPlan(input: Record<string, unknown>): Promise<string> {
  const today = db.bangkokDate();
  await db.upsertDailyLog(today, { morning_plan: String(input.plan) });
  await db.addChronicleEntry({
    date: today,
    event_type: "morning_plan",
    title: "Утренний план дня",
    description: String(input.plan),
  });
  return `Утренний план на ${today} записан.`;
}

async function handleLogEveningReview(input: Record<string, unknown>): Promise<string> {
  const today = db.bangkokDate();
  await db.upsertDailyLog(today, { evening_review: String(input.review) });

  const completedIds = (input.completed_ids as string[]) ?? [];
  for (const id of completedIds) {
    try {
      await handleCompleteTask({ id });
    } catch {
      // ignore individual errors
    }
  }

  await db.addChronicleEntry({
    date: today,
    event_type: "evening_review",
    title: "Итоги дня",
    description: String(input.review),
  });

  return `Итоги дня ${today} записаны в летопись.`;
}

async function handleGetChronicle(input: Record<string, unknown>): Promise<string> {
  const entries = await db.getChronicle(
    input.date_from as string | undefined,
    input.date_to   as string | undefined,
    (input.limit as number) ?? 20
  );

  if (entries.length === 0) return "Летопись за указанный период пуста.";

  const lines = entries.map((e) => {
    const icon = {
      task_created:   "📋",
      task_completed: "✅",
      morning_plan:   "🌅",
      evening_review: "🌙",
      milestone:      "🏆",
      decision:       "⚖️",
      note:           "📝",
    }[e.event_type] ?? "•";
    const desc = e.description ? `\n  ${e.description.slice(0, 80)}` : "";
    return `${icon} <b>${e.date}</b> ${e.title}${desc}`;
  });

  return `Летопись (${entries.length} записей):\n\n${lines.join("\n\n")}`;
}

async function handleAddCalendarEvent(input: Record<string, unknown>): Promise<string> {
  const result = await addCalendarEvent({
    title:            String(input.title),
    date:             String(input.date),
    time:             input.time ? String(input.time) : undefined,
    duration_minutes: input.duration_minutes ? Number(input.duration_minutes) : 60,
    attendees:        (input.attendees as ("pavel" | "irina")[]) ?? [],
    description:      input.description ? String(input.description) : undefined,
    location:         input.location ? String(input.location) : undefined,
  });
  const { link } = JSON.parse(result);
  const who = ((input.attendees as string[]) ?? []).join(", ");
  return `Событие добавлено в календарь${who ? ` (приглашения: ${who})` : ""}. ${link}`;
}
