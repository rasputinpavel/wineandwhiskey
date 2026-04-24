/**
 * sync_cashflow_actuals.ts
 * Runs every Sunday at 22:15 Bangkok (after dashboard sync).
 *
 * Writes the previous week's actual retail revenue into the "Закрытие" sheet.
 * Rolling Cashflow reads from it via VLOOKUP — survives cashflow recreation.
 *
 * Retail = Loyverse total for the week  −  Дебиторка invoiced that week.
 * (Dashboard weekly revenue includes B2B invoiced; Дебиторка.A = invoice date.)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID             = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const CLOSINGS_TAB         = "Закрытие";
const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bangkokNow() { return new Date(Date.now() + 7 * 3_600_000); }

/** Returns Mon–Sun bounds for the week offset from current Bangkok week */
function weekBounds(offsetWeeks = 0): { from: string; to: string } {
  const now = bangkokNow();
  const daysSinceMon = (now.getUTCDay() + 6) % 7;
  const monMs = Date.now() + 7 * 3_600_000 - daysSinceMon * 86_400_000 + offsetWeeks * 7 * 86_400_000;
  const sunMs = monMs + 6 * 86_400_000;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: fmt(monMs), to: fmt(sunMs) };
}

/** Parse "DD.MM.YYYY" → Date (UTC) */
function parseRuDate(s: string): Date | null {
  const m = s?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}

// ─── Google Sheets ────────────────────────────────────────────────────────────

let _gToken: string | null = null;
async function gToken() {
  if (_gToken) return _gToken;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`OAuth2: ${await r.text()}`);
  _gToken = (await r.json()).access_token;
  return _gToken!;
}

async function gApi(method: string, path: string, body?: unknown) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await gToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Sheets ${method} ${path}: ${await r.text()}`);
  return r.json();
}

async function readRange(range: string): Promise<string[][]> {
  try {
    const r = await gApi("GET", `/values/${encodeURIComponent(range)}`);
    return r.values ?? [];
  } catch { return []; }
}

async function ensureClosingsTab(): Promise<void> {
  const meta = await gApi("GET", "");
  const exists = (meta.sheets ?? []).some((s: any) => s.properties.title === CLOSINGS_TAB);
  if (exists) return;
  await gApi("POST", ":batchUpdate", {
    requests: [{ addSheet: { properties: {
      title: CLOSINGS_TAB,
      gridProperties: { rowCount: 100, columnCount: 3 },
    }}}],
  });
  // Write headers
  await gApi("PUT",
    `/values/${encodeURIComponent(`${CLOSINGS_TAB}!A1:C1`)}?valueInputOption=RAW`,
    { range: `${CLOSINGS_TAB}!A1:C1`, majorDimension: "ROWS",
      values: [["week_start", "fact_revenue", "note"]] },
  );
  console.log(`   Лист "${CLOSINGS_TAB}" создан`);
}

async function upsertClosing(isoWeekStart: string, revenue: number, note: string) {
  const rows = await readRange(`${CLOSINGS_TAB}!A2:C100`);
  const idx = rows.findIndex(r => r[0] === isoWeekStart);

  const rowData = [isoWeekStart, revenue, note];

  if (idx >= 0) {
    const sheetRow = idx + 2;
    await gApi("PUT",
      `/values/${encodeURIComponent(`${CLOSINGS_TAB}!A${sheetRow}:C${sheetRow}`)}?valueInputOption=RAW`,
      { range: `${CLOSINGS_TAB}!A${sheetRow}:C${sheetRow}`, majorDimension: "ROWS", values: [rowData] },
    );
    console.log(`   Обновлено (строка ${sheetRow})`);
  } else {
    await gApi("POST",
      `/values/${encodeURIComponent(`${CLOSINGS_TAB}!A:C`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { range: `${CLOSINGS_TAB}!A:C`, majorDimension: "ROWS", values: [rowData] },
    );
    console.log(`   Добавлено`);
  }
}

// ─── Loyverse ──────────────────────────────────────────────────────────────────

async function fetchWeekRevenue(from: string, to: string): Promise<number> {
  const minUtc = new Date(`${from}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${to}T23:59:59+07:00`).toISOString();
  let out: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}&limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` } });
    if (!r.ok) throw new Error(`Loyverse ${r.status}`);
    const d = await r.json();
    out = out.concat(d.receipts ?? []);
    cursor = d.cursor;
  } while (cursor);
  return out.reduce((s, r) => s + (r.total_money ?? 0), 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const bkk = bangkokNow();
  const dayOfWeek = bkk.getUTCDay(); // 0=Sun

  // Allow running any day (for testing), but log a warning if not Sunday
  if (dayOfWeek !== 0) {
    console.log(`⚠️  Сегодня не воскресенье (день ${dayOfWeek}). Запуск принудительно.`);
  }

  const lastWeek = weekBounds(-1);
  console.log(`📅 Закрытие недели: ${lastWeek.from} — ${lastWeek.to}`);

  // 1. Auth
  console.log("🔑 Авторизация...");
  await gToken();

  // 2. Ensure Закрытие sheet exists
  await ensureClosingsTab();

  // 3. Fetch total Loyverse revenue for last week
  console.log("💰 Загружаю выручку из Loyverse...");
  const totalRevenue = await fetchWeekRevenue(lastWeek.from, lastWeek.to);
  console.log(`   Выручка (все): ${totalRevenue.toFixed(0)} ฿`);

  // 4. Sum Дебиторка invoiced last week (col A = Дата счета, col E = Сумма)
  console.log("📋 Читаю Дебиторку...");
  const debRows = await readRange("Дебиторка!A2:E200");
  const fromDate = new Date(lastWeek.from + "T00:00:00Z");
  const toDate   = new Date(lastWeek.to   + "T23:59:59Z");

  let debTotal = 0;
  for (const row of debRows) {
    const invoiceDate = parseRuDate(row[0]);
    if (!invoiceDate) continue;
    if (invoiceDate < fromDate || invoiceDate > toDate) continue;
    // Parse amount: "฿3 852,00" or plain number
    const raw = (row[4] ?? "").replace(/[฿\s]/g, "").replace(",", ".");
    const amt = parseFloat(raw);
    if (!isNaN(amt)) debTotal += amt;
  }
  console.log(`   Дебиторка за неделю: ${debTotal.toFixed(0)} ฿`);

  // 5. Retail = total − дебиторка
  const retail = totalRevenue - debTotal;
  console.log(`   Розничная выручка (факт): ${retail.toFixed(0)} ฿`);

  // 6. Upsert into Закрытие sheet
  console.log("📝 Записываю в Закрытие...");
  const note = `total=${totalRevenue.toFixed(0)} deb=${debTotal.toFixed(0)}`;
  await upsertClosing(lastWeek.from, Math.round(retail), note);

  console.log(`\n✅  Готово! Неделя ${lastWeek.from}: факт выручка ${Math.round(retail).toLocaleString()} ฿`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
