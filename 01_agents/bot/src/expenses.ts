import Anthropic from "@anthropic-ai/sdk";
import { InlineKeyboard } from "grammy";

const SHEET_ID  = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExpenseCategory = "Операционные" | "Обязательные" | "Кредиторка";

export interface PendingExpense {
  amount:      string; // raw number, e.g. "856"
  description: string;
  date:        string; // DD.MM.YYYY Bangkok
  isCompany:   boolean;
  hasDocs:     boolean;
  category:    ExpenseCategory;
}

export interface PendingPhoto {
  base64:    string;
  mimeType:  "image/jpeg" | "image/png";
  timestamp: number;
}

// ─── Date helper ─────────────────────────────────────────────────────────────

export function bangkokDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 7 * 3600_000 + offsetDays * 86_400_000);
  const dd   = String(d.getUTCDate()).padStart(2, "0");
  const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

// Pull an explicit date hint out of a user message ("вчера", "25.05", "25.05.2026")
// and return both the parsed DD.MM.YYYY date and the text with the hint removed.
// Safe against false-positives inside decimal amounts: "4879.20" won't match
// because the inner digits aren't at word boundaries.
export function parseDateHint(text: string): { date: string | null; cleanText: string } {
  const wordMatch = text.match(/\b(вчера|позавчера|сегодня)\b/i);
  if (wordMatch) {
    const w = wordMatch[1].toLowerCase();
    const offset = w === "позавчера" ? -2 : w === "вчера" ? -1 : 0;
    return {
      date:      bangkokDate(offset),
      cleanText: stripMatch(text, wordMatch),
    };
  }
  const dateMatch = text.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  if (dateMatch) {
    const dd = dateMatch[1].padStart(2, "0");
    const mm = dateMatch[2].padStart(2, "0");
    let yyyy = dateMatch[3];
    if (!yyyy)                  yyyy = bangkokDate().slice(6);
    else if (yyyy.length === 2) yyyy = "20" + yyyy;
    return {
      date:      `${dd}.${mm}.${yyyy}`,
      cleanText: stripMatch(text, dateMatch),
    };
  }
  return { date: null, cleanText: text };
}

function stripMatch(text: string, m: RegExpMatchArray): string {
  return (text.slice(0, m.index!) + text.slice(m.index! + m[0].length))
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Detection ───────────────────────────────────────────────────────────────

// Heuristic: does this text look like an expense entry?
// Matches: "856 интернет", "฿450 полка", "3500 замена аккума", "4879.20 p hops кредиторка"
export function looksLikeExpense(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("/")) return false;
  return /฿\d/.test(t) || /^\d[\d.,]*(?:thb|бат|baht)?\s+\S+/i.test(t);
}

// ─── Claude extraction ────────────────────────────────────────────────────────

const EXTRACT_TEXT_PROMPT = (text: string) =>
  `Текст: "${text}". Это запись расхода — первое число всегда сумма в THB, ` +
  `остальное — описание (на что потрачено, 2–5 слов). Не интерпретируй число как количество товара. ` +
  `Примеры: "264 пакеты" → {"amount":"264","description":"пакеты"}, ` +
  `"3500 замена аккума" → {"amount":"3500","description":"замена аккумулятора"}. ` +
  `Ответь ТОЛЬКО валидным JSON без markdown и объяснений: {"amount":"856","description":"интернет 3BB"}`;

const EXTRACT_AMOUNT_PROMPT =
  `На изображении чек или квитанция об оплате. Найди итоговую сумму платежа в THB. ` +
  `Ответь ТОЛЬКО валидным JSON без markdown и объяснений: {"amount":"856"}`;

export async function extractExpenseFromText(
  text: string
): Promise<{ amount: string; description: string; date: string | null } | null> {
  const { date, cleanText } = parseDateHint(text);
  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages:   [{ role: "user", content: EXTRACT_TEXT_PROMPT(cleanText) }],
  });
  const parsed = parseExtractedJSON(response);
  if (!parsed) return null;
  return { ...parsed, date };
}

export async function extractExpenseFromPhoto(
  base64:      string,
  mimeType:    "image/jpeg" | "image/png",
  description: string,
): Promise<{ amount: string; description: string; date: string | null } | null> {
  const { date, cleanText } = parseDateHint(description);
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
  return { amount: parsed.amount, description: cleanText, date };
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

// ─── Message parser (stateless recovery after redeploy) ──────────────────────

export function parseExpenseFromMessage(text: string): PendingExpense | null {
  const dateMatch   = text.match(/Дата:\s*(\d{2}\.\d{2}\.\d{4})/)
  const amountMatch = text.match(/Сумма:\s*฿(\d+(?:[.,]\d+)?)/)
  const descMatch   = text.match(/На что:\s*(.+)/)
  if (!dateMatch || !amountMatch || !descMatch) return null
  const category: ExpenseCategory =
    text.match(/Категория:\s*✅?\s*Обязательные/) ? "Обязательные" :
    text.match(/Категория:\s*✅?\s*Кредиторка/)   ? "Кредиторка"   :
                                                    "Операционные";
  return {
    date:        dateMatch[1],
    amount:      amountMatch[1].replace(",", "."),
    description: descMatch[1].trim(),
    isCompany:   text.includes("✅ Со счёта компании"),
    hasDocs:     text.includes("✅ Есть"),
    category,
  }
}

// ─── UI builders ─────────────────────────────────────────────────────────────

export function buildExpenseMessage(e: PendingExpense): string {
  const company = e.isCompany ? "✅ Со счёта компании" : "☐ С налички / личных";
  const docs    = e.hasDocs   ? "✅ Есть"               : "☐ Нет";
  return [
    `📋 <b>Проверь расход:</b>`,
    ``,
    `📅 <b>Дата:</b> ${e.date}`,
    `💰 <b>Сумма:</b> ฿${e.amount}`,
    `📝 <b>На что:</b> ${e.description}`,
    ``,
    `<b>Категория:</b> ✅ ${e.category}`,
    `<b>Откуда оплатили:</b> ${company}`,
    `<b>Документы:</b> ${docs}`,
  ].join("\n");
}

export function buildExpenseKeyboard(
  isCompany: boolean,
  hasDocs:   boolean,
  category:  ExpenseCategory,
): InlineKeyboard {
  return new InlineKeyboard()
    .text(category === "Операционные" ? "✅ Операц." : "Операц.", "exp_cat_op")
    .text(category === "Обязательные" ? "✅ Обяз."   : "Обяз.",   "exp_cat_oblig")
    .text(category === "Кредиторка"   ? "✅ Кредит." : "Кредит.", "exp_cat_cred")
    .row()
    .text(isCompany  ? "✅ Со счёта компании" : "Со счёта компании", "exp_company_yes")
    .text(!isCompany ? "✅ С налички/личных"  : "С налички/личных",  "exp_company_no")
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

  // Find the first empty row in column A after the header (= first gap in continuous data block)
  const colAResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent("Expenses!A2:A")}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const colAData = await colAResp.json();
  const rows: string[][] = colAData.values ?? [];

  // Walk rows until first empty cell — that's where the continuous block ends
  let firstEmptyIdx = rows.length; // fallback: right after all returned rows
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]?.[0]?.trim()) { firstEmptyIdx = i; break; }
  }
  const targetRow = firstEmptyIdx + 2; // 1-based sheet row (row 1 = header)

  const range = `Expenses!A${targetRow}:G${targetRow}`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method:  "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: [[
          e.date,
          Number(e.amount),
          e.description,
          e.hasDocs   ? "TRUE" : "FALSE",
          "FALSE",
          e.isCompany ? "TRUE" : "FALSE",
          e.category,
        ]],
      }),
    }
  );
  if (!res.ok) throw new Error(`Sheets write failed: ${await res.text()}`);
}
