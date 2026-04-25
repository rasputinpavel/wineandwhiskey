import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export type TaskAssignee = "pavel" | "irina" | "both";
export type TaskPriority  = "low" | "normal" | "high" | "urgent";
export type TaskStatus    = "todo" | "in_progress" | "done" | "cancelled";

export interface Task {
  id: string;
  title: string;
  description?: string;
  assignee: TaskAssignee;
  priority: TaskPriority;
  status: TaskStatus;
  deadline?: string;
  tags: string[];
  notes?: string;
  created_at: string;
  completed_at?: string;
  created_by?: string;
}

export interface DailyLog {
  id: string;
  date: string;
  morning_plan?: string;
  evening_review?: string;
}

export interface ChronicleEntry {
  id: string;
  date: string;
  event_type: string;
  title: string;
  description?: string;
  task_id?: string;
}

// --- Tasks ---

export async function createTask(input: {
  title: string;
  assignee: TaskAssignee;
  description?: string;
  priority?: TaskPriority;
  deadline?: string;
  tags?: string[];
  created_by?: string;
}): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title:       input.title,
      assignee:    input.assignee,
      description: input.description,
      priority:    input.priority ?? "normal",
      deadline:    input.deadline,
      tags:        input.tags ?? [],
      created_by:  input.created_by,
    })
    .select()
    .single();

  if (error) throw new Error(`createTask: ${error.message}`);
  return data;
}

export async function listTasks(filters: {
  assignee?: TaskAssignee;
  status?: TaskStatus | TaskStatus[];
  deadlineBefore?: string;
  limit?: number;
} = {}): Promise<Task[]> {
  let q = supabase.from("tasks").select("*");

  if (filters.assignee && filters.assignee !== "both") {
    q = q.or(`assignee.eq.${filters.assignee},assignee.eq.both`);
  }

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      q = q.in("status", filters.status);
    } else {
      q = q.eq("status", filters.status);
    }
  }

  if (filters.deadlineBefore) {
    q = q.lte("deadline", filters.deadlineBefore).not("deadline", "is", null);
  }

  q = q.order("deadline", { ascending: true, nullsFirst: false })
       .order("priority", { ascending: false })
       .limit(filters.limit ?? 50);

  const { data, error } = await q;
  if (error) throw new Error(`listTasks: ${error.message}`);
  return data ?? [];
}

export async function updateTask(id: string, updates: {
  title?: string;
  description?: string;
  assignee?: TaskAssignee;
  priority?: TaskPriority;
  status?: TaskStatus;
  deadline?: string | null;
  notes?: string;
  tags?: string[];
}): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`updateTask: ${error.message}`);
  return data;
}

export async function completeTask(id: string, notes?: string): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString(), notes })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`completeTask: ${error.message}`);
  return data;
}

export async function getOverdueTasks(): Promise<Task[]> {
  const today = bangkokDate();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .in("status", ["todo", "in_progress"])
    .not("deadline", "is", null)
    .lt("deadline", today)
    .order("deadline", { ascending: true });

  if (error) throw new Error(`getOverdueTasks: ${error.message}`);
  return data ?? [];
}

export async function getTodayTasks(): Promise<Task[]> {
  const today = bangkokDate();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .in("status", ["todo", "in_progress"])
    .eq("deadline", today);

  if (error) throw new Error(`getTodayTasks: ${error.message}`);
  return data ?? [];
}

export async function getActiveTasks(): Promise<Task[]> {
  return listTasks({ status: ["todo", "in_progress"] });
}

export async function getTaskById(id: string): Promise<Task | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getTaskById: ${error.message}`);
  return data;
}

// --- Daily logs ---

export async function upsertDailyLog(
  date: string,
  fields: { morning_plan?: string; evening_review?: string }
): Promise<void> {
  const { error } = await supabase
    .from("daily_logs")
    .upsert({ date, ...fields, updated_at: new Date().toISOString() }, { onConflict: "date" });

  if (error) throw new Error(`upsertDailyLog: ${error.message}`);
}

export async function getDailyLog(date: string): Promise<DailyLog | null> {
  const { data, error } = await supabase
    .from("daily_logs")
    .select("*")
    .eq("date", date)
    .maybeSingle();

  if (error) throw new Error(`getDailyLog: ${error.message}`);
  return data;
}

// --- Chronicle ---

export async function addChronicleEntry(entry: {
  date: string;
  event_type: string;
  title: string;
  description?: string;
  task_id?: string;
}): Promise<void> {
  const { error } = await supabase.from("chronicle").insert(entry);
  if (error) throw new Error(`addChronicleEntry: ${error.message}`);
}

export async function getChronicle(
  dateFrom?: string,
  dateTo?: string,
  limit = 30
): Promise<ChronicleEntry[]> {
  let q = supabase.from("chronicle").select("*").order("date", { ascending: false }).limit(limit);

  if (dateFrom) q = q.gte("date", dateFrom);
  if (dateTo)   q = q.lte("date", dateTo);

  const { data, error } = await q;
  if (error) throw new Error(`getChronicle: ${error.message}`);
  return data ?? [];
}

// --- Helpers ---

export function bangkokDate(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function formatTask(task: Task): string {
  const assigneeLabel = { pavel: "сэр", irina: "мадам", both: "оба" }[task.assignee];
  const priorityIcon  = { urgent: "🔴", high: "🟠", normal: "🟡", low: "🟢" }[task.priority];
  const deadline = task.deadline ? ` до ${task.deadline}` : "";
  const id = task.id.slice(0, 8);
  return `${priorityIcon} <b>#${id}</b> ${task.title} [${assigneeLabel}${deadline}]`;
}
