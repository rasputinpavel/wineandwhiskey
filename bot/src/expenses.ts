import Anthropic from "@anthropic-ai/sdk";
import { InlineKeyboard } from "grammy";

const SHEET_ID  = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PendingExpense {
  amount:      string; // raw number, e.g. "856"
  description: string;
  date:        string; // DD.MM.YYYY Bangkok
  isCompany:   boolean;
  hasDocs:     boolean;
}

export interface PendingPhoto {
  base64:    string;
  mimeType:  "image/jpeg" | "image/png";
  timestamp: number;
}

// ─── Date helper ─────────────────────────────────────────────────────────────

export function bangkokDate(): string {
  const d = new Date(Date.now() + 7 * 3600_000);
  const dd   = String(d.getUTCDate()).padStart(2, "0");
  const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

// ─── Detection ───────────────────────────────────────────────────────────────

// Heuristic: does this text look like an expense entry?
// Matches: "856 интернет", "฿450 полка", "3500 замена аккума"
export function looksLikeExpense(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("/")) return false;
  return /฿\d/.test(t) || /^\d[\d\s,.]*(?:thb|бат|baht)?\s+\S{2,}/i.test(t);
}

// ─── Claude extraction ────────────────────────────────────────────────────────

const EXTRACT_TEXT_PROMPT = (text: string) =>
  `Текст: "${text}". Определи итоговую сумму в THB и краткое описание расхода (на что потрачено, 2–5 слов). ` +
  `Ответь ТОЛЬКО валидным JSON без markdown и объяснений: {"amount":"856","description":"интернет 3BB"}`;

const EXTRACT_AMOUNT_PROMPT =
  `На изображении чек или квитанция об оплате. Найди итоговую сумму платежа в THB. ` +
  `Ответь ТОЛЬКО валидным JSON без markdown и объяснений: {"amount":"856"}`;

export async function extractExpenseFromText(
  text: string
): Promise<{ amount: string; description: string } | null> {
  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages:   [{ role: "user", content: EXTRACT_TEXT_PROMPT(text) }],
  });
  return parseExtractedJSON(response);
}

export async function extractExpenseFromPhoto(
  base64:      string,
  mimeType:    "image/jpeg" | "image/png",
  description: string,
): Promise<{ amount: string; description: string } | null> {
  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 100,
    messages:   [{
      role:    "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
        { type: "text",  text: EXTRACT_AMOUNT_PROMPT },
      ],
    }],
  });
  const parsed = parseExtractedJSON(response);
  if (!parsed) return null;
  return { amount: parsed.amount, description };
}

function parseExtractedJSON(
  response: Anthropic.Message
): { amount: string; description: string } | null {
  try {
    const raw = response.content.find(b => b.type === "text")?.text ?? "";
    // Strip any markdown fences just in case
    const clean = raw.replace(/```json|```/g, "").trim();
    const json = JSON.parse(clean);
    if (json.amount) {
      return {
        amount:      String(json.amount).replace(/[^\d.]/g, ""),
        description: json.description ? String(json.description) : "",
      };
    }
  } catch {}
  return null;
}

// ─── Telegram photo download ──────────────────────────────────────────────────

export async function downloadTelegramPhoto(
  botToken: string,
  fileId:   string,
): Promise<PendingPhoto> {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const { result } = await r.json();
  const filePath = result.file_path as string;
  const imgResp  = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  const buffer   = await imgResp.arrayBuffer();
  return {
    base64:    Buffer.from(buffer).toString("base64"),
    mimeType:  filePath.endsWith(".png") ? "image/png" : "image/jpeg",
    timestamp: Date.now(),
  };
}

// ─── UI builders ─────────────────────────────────────────────────────────────

export function buildExpenseMessage(e: PendingExpense): string {
  const company = e.isCompany ? "✅ На компанию" : "☐ Личный расход";
  const docs    = e.hasDocs   ? "✅ Есть"        : "☐ Нет";
  return [
    `📋 <b>Проверь расход:</b>`,
    ``,
    `📅 <b>Дата:</b> ${e.date}`,
    `💰 <b>Сумма:</b> ฿${e.amount}`,
    `📝 <b>На что:</b> ${e.description}`,
    ``,
    `<b>На компанию:</b> ${company}`,
    `<b>Документы:</b> ${docs}`,
  ].join("\n");
}

export function buildExpenseKeyboard(isCompany: boolean, hasDocs: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text(isCompany  ? "✅ На компанию" : "На компанию",  "exp_company_yes")
    .text(!isCompany ? "✅ Личный"      : "Личный",       "exp_company_no")
    .row()
    .text(hasDocs    ? "✅ Документы есть" : "Документы есть", "exp_docs_yes")
    .text(!hasDocs   ? "✅ Без документов" : "Без документов", "exp_docs_no")
    .row()
    .text("💾 Записать", "exp_confirm")
    .text("✖ Отмена",   "exp_cancel");
}

// ─── Google Sheets write ──────────────────────────────────────────────────────

async function gToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type:    "refresh_token",
    }),
  });
  return (await r.json()).access_token;
}

export async function addExpenseRow(e: PendingExpense): Promise<void> {
  const token = await gToken();

  // 1. Find last filled row in column A (1-based sheet row)
  const colAResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent("Расходы!A2:A")}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const colAData = await colAResp.json();
  const rows: string[][] = colAData.values ?? [];
  let lastFilledIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.[0]?.trim()) lastFilledIdx = i;
  }
  const lastSheetRow = lastFilledIdx + 2; // 1-based (header=1, first data=2)

  // 2. Get sheetId for "Расходы"
  const metaResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const meta = await metaResp.json();
  const sheetId: number = meta.sheets.find((s: any) => s.properties.title === "Расходы")?.properties.sheetId;
  if (sheetId === undefined) throw new Error("Sheet 'Расходы' not found");

  // 3. Insert a new row right after lastSheetRow, inheriting formatting from it
  // insertDimension uses 0-based indices; insert after row N (1-based) → startIndex = N
  const insertResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: lastSheetRow, endIndex: lastSheetRow + 1 },
            inheritFromBefore: true,
          },
        }],
      }),
    }
  );
  if (!insertResp.ok) throw new Error(`Insert row failed: ${await insertResp.text()}`);

  // 4. Write values into the newly inserted row
  const newRow = lastSheetRow + 1; // 1-based
  const range = `Расходы!A${newRow}:F${newRow}`;
  const writeResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method:  "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: [[
          e.date,
          `฿${e.amount}`,
          e.description,
          e.hasDocs   ? "TRUE" : "FALSE",
          "FALSE",
          e.isCompany ? "TRUE" : "FALSE",
        ]],
      }),
    }
  );
  if (!writeResp.ok) throw new Error(`Write failed: ${await writeResp.text()}`);
}
