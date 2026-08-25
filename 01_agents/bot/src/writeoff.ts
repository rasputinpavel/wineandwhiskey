import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./db.js";
import { getCatalogItems } from "./loyverse.js";
import {
  parseWriteoffJSON, scoreCandidates,
  type WriteoffExtraction, type Candidate, type PendingRow,
} from "./writeoff-parse.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const TEXT_PROMPT =
  `Пользователь хочет списать товар со склада винного магазина («взяли себе»). ` +
  `Из сообщения извлеки название товара для поиска и количество. ` +
  `query — очищенное название БЕЗ слов-триггеров (спиши, списать, списание, себе, взяли). ` +
  `qty — число штук (по умолчанию 1, если не указано). ` +
  `Ответь ТОЛЬКО валидным JSON без markdown. Пример: {"query":"Prosecco Miravento","qty":2}.`;

const PHOTO_PROMPT =
  `На фото — бутылка/этикетка алкоголя, которую сотрудник забрал себе и хочет списать. ` +
  `Прочитай бренд/название с этикетки и верни короткое название для поиска по каталогу. ` +
  `Количество (qty) возьми из подписи пользователя, если есть, иначе 1. ` +
  `query — название без лишних слов. Ответь ТОЛЬКО валидным JSON без markdown. ` +
  `Пример: {"query":"Beluga Noble Vodka","qty":1}.`;

// Parse a plain-text write-off request via Claude. Returns null when nothing
// usable was extracted (caller then asks the user to retype).
export async function parseWriteoffText(text: string): Promise<WriteoffExtraction | null> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{ role: "user", content: `${TEXT_PROMPT}\n\nСообщение: ${text}` }],
  });
  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  return parseWriteoffJSON(raw);
}

// Parse a photo (bottle label) + optional caption via Claude vision.
export async function parseWriteoffPhoto(
  base64: string,
  mime: "image/jpeg" | "image/png",
  caption: string,
): Promise<WriteoffExtraction | null> {
  const source = { type: "base64" as const, media_type: mime, data: base64 };
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: [
        { type: "image", source },
        { type: "text", text: `${PHOTO_PROMPT}\n\nПодпись пользователя: ${caption || "(нет)"}` },
      ],
    }],
  });
  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  return parseWriteoffJSON(raw);
}

// Fetch the catalog and return the scored candidates for a query.
export async function matchCatalog(query: string): Promise<Candidate[]> {
  const catalog = await getCatalogItems();
  return scoreCandidates(query, catalog);
}

// Look up a single catalog item by variant_id (used when the user picks a
// candidate — we rebuild the card from the fresh catalog row).
export async function findVariant(
  variantId: string,
): Promise<{ variant_id: string; item_name: string; in_stock: number } | null> {
  const catalog = await getCatalogItems();
  return catalog.find((c) => c.variant_id === variantId) ?? null;
}

// ─── Supabase store ────────────────────────────────────────────────────────

export async function insertWriteoff(row: {
  variantId: string; itemName: string; qty: number; takenDate: string; takenBy: string;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase не подключён (SUPABASE_URL/SUPABASE_SERVICE_KEY).");
  const ins = await supabase.from("stock_writeoffs").insert({
    variant_id: row.variantId || null,
    item_name: row.itemName,
    qty: row.qty,
    taken_date: row.takenDate, // YYYY-MM-DD
    taken_by: row.takenBy || null,
    status: "pending",
  });
  if (ins.error) throw new Error(`DB insert failed: ${ins.error.message}`);
}

export async function listPending(): Promise<PendingRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("stock_writeoffs")
    .select("id, item_name, qty, taken_date, taken_by, status")
    .eq("status", "pending")
    .order("taken_date", { ascending: true });
  if (error) { console.error("listPending failed:", error.message); return []; }
  return (data ?? []) as PendingRow[];
}

export async function closeWriteoff(id: string, closedBy: string): Promise<void> {
  if (!supabase) throw new Error("Supabase не подключён.");
  const upd = await supabase
    .from("stock_writeoffs")
    .update({ status: "done", closed_at: new Date().toISOString(), closed_by: closedBy || null })
    .eq("id", id);
  if (upd.error) throw new Error(`DB update failed: ${upd.error.message}`);
}
