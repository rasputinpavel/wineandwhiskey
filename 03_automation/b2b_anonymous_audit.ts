/**
 * b2b_anonymous_audit.ts
 *
 * Все bank-transfer чеки БЕЗ customer_id за последние 8 месяцев.
 * Цель: вручную проидентифицировать кто это, и завести их как Loyverse customers
 * чтобы дальше детекция была чистой.
 *
 * Lists each receipt: дата/время, номер, сумма, состав, ссылка для поиска в Loyverse.
 *
 * Usage: npx tsx 03_automation/b2b_anonymous_audit.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const TAB      = "B2B без customer";
const FROM     = "2025-09-01";

const BANK_TRANSFER_TYPE_ID = "6bafa324-92d9-45c9-80d8-0539a65de4cc";

const LOYVERSE_TOKEN       = process.env.LOYVERSE_API_TOKEN!;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;

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
async function sheets(method: string, path: string, body?: unknown) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await gToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Sheets ${method} ${path}: ${await r.text()}`);
  return r.json();
}
async function ensureTab(title: string): Promise<number> {
  const meta = await sheets("GET", "");
  const existing = (meta.sheets ?? []).find((s: any) => s.properties.title === title);
  if (existing) return existing.properties.sheetId;
  const res = await sheets("POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title } } }] });
  return res.replies[0].addSheet.properties.sheetId;
}
async function clearTab(sheetId: number) {
  await sheets("POST", ":batchUpdate", {
    requests: [
      { unmergeCells: { range: { sheetId } } },
      { updateCells: { range: { sheetId }, fields: "userEnteredValue,userEnteredFormat" } },
    ],
  });
}
async function writeRows(sheetId: number, startRow: number, startCol: number, rows: any[][]) {
  if (rows.length === 0) return;
  const maxCols = Math.max(...rows.map(r => r.length));
  await sheets("POST", ":batchUpdate", {
    requests: [{
      updateCells: {
        start: { sheetId, rowIndex: startRow, columnIndex: startCol },
        rows: rows.map(row => ({
          values: Array.from({ length: maxCols }, (_, j) => {
            const v = row[j];
            if (v == null || v === "") return { userEnteredValue: { stringValue: "" } };
            if (typeof v === "number" && Number.isFinite(v)) return { userEnteredValue: { numberValue: v } };
            return { userEnteredValue: { stringValue: String(v) } };
          }),
        })),
        fields: "userEnteredValue",
      },
    }],
  });
}
async function loy<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` } });
    if (!r.ok) throw new Error(`${r.status}`);
    const d = await r.json();
    out.push(...(d[key] ?? []));
    cursor = d.cursor;
  } while (cursor);
  return out;
}

async function main() {
  const fromIso = FROM;
  const toIso = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const minUtc = new Date(`${fromIso}T00:00:00+07:00`).toISOString();
  const maxUtc = new Date(`${toIso}T23:59:59+07:00`).toISOString();
  console.log(`Period: ${fromIso} → ${toIso}`);

  const [items, employees]: any[][] = await Promise.all([
    loy("/items", "items"),
    loy("/employees", "employees"),
  ]);
  const itemName = new Map<string, string>();
  for (const it of items) itemName.set(it.id, it.item_name ?? it.name ?? "—");
  const empName = new Map<string, string>();
  for (const e of employees) empName.set(e.id, e.name ?? e.email ?? e.id.slice(0, 8));
  console.log(`Employees in Loyverse: ${employees.length}`);

  const receipts: any[] = await loy(`/receipts?receipt_type=SALE&created_at_min=${minUtc}&created_at_max=${maxUtc}`, "receipts");
  console.log(`Total SALE receipts: ${receipts.length}`);

  const matches = receipts.filter(r => {
    const hasBT = (r.payments ?? []).some((p: any) => p.payment_type_id === BANK_TRANSFER_TYPE_ID);
    return hasBT && !r.customer_id;
  });
  matches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  console.log(`Bank-transfer без customer_id: ${matches.length}`);

  // Group by day to flag "burst" days (multiple receipts likely same client)
  const dayCount = new Map<string, number>();
  // Group by cashier — see who keeps writing these
  const byCashier = new Map<string, { count: number; total: number }>();
  for (const r of matches) {
    const dtBkk = new Date(new Date(r.created_at).getTime() + 7 * 3600_000);
    const day = dtBkk.toISOString().slice(0, 10);
    dayCount.set(day, (dayCount.get(day) ?? 0) + 1);
    const empId = r.employee_id ?? "—";
    const cur = byCashier.get(empId) ?? { count: 0, total: 0 };
    cur.count++; cur.total += r.total_money ?? 0;
    byCashier.set(empId, cur);
  }

  // Build sheet
  const sheetId = await ensureTab(TAB);
  await clearTab(sheetId);

  const rows: any[][] = [];
  rows.push([`B2B-чеки без customer_id (bank transfer) · ${fromIso} → ${toIso}`]);
  rows.push([]);
  rows.push(["Найдено", matches.length, "чеков", "", "", "", "Сумма", Math.round(matches.reduce((s, r) => s + (r.total_money ?? 0), 0))]);

  // Cashier breakdown — who wrote these receipts
  rows.push([]);
  rows.push(["КТО ИЗ КАССИРОВ ВЫПИСЫВАЛ ТАКИЕ ЧЕКИ"]);
  const cashHdrRow = rows.length - 1;
  rows.push(["Кассир", "Чеков", "Сумма ฿"]);
  const cashColRow = rows.length - 1;
  const cashStart = rows.length;
  const sortedCash = [...byCashier.entries()]
    .map(([id, v]) => ({ id, name: empName.get(id) ?? id, ...v }))
    .sort((a, b) => b.total - a.total);
  for (const c of sortedCash) {
    rows.push([c.name, c.count, Math.round(c.total)]);
  }
  const cashEnd = rows.length;

  rows.push([]);
  rows.push(["Дата/время Bkk", "Чек #", "День", "Чеков в день", "Сумма ฿", "Кассир", "Состав (line items)", "Кто это? (заполни сам)"]);
  const hdrRow = rows.length - 1;
  const dataStart = rows.length;

  let total = 0;
  for (const r of matches) {
    const dt = new Date(new Date(r.created_at).getTime() + 7 * 3600_000);
    const dtStr = dt.toISOString().slice(0, 16).replace("T", " ");
    const day = dt.toISOString().slice(0, 10);
    const amount = Math.round(r.total_money ?? 0);
    total += amount;
    const composition = (r.line_items ?? []).map((li: any) => {
      const n = itemName.get(li.item_id) ?? li.item_name ?? "?";
      return `${li.quantity}× ${n}`;
    }).join("; ");
    const recNum = r.receipt_number ?? "";
    const cashier = empName.get(r.employee_id ?? "") ?? "—";
    rows.push([dtStr, recNum, day, dayCount.get(day) ?? 1, amount, cashier, composition, ""]);
  }
  const dataEnd = rows.length;

  rows.push([]);
  rows.push(["", "", "", "ИТОГО", total]);
  rows.push([]);
  rows.push(["Как искать чек в Loyverse:"]);
  rows.push(["  1. Открой https://r.loyverse.com/dashboard/#/receipts/list"]);
  rows.push(["  2. Поставь фильтр по дате (см. колонку «День») — чтобы увидеть только нужный день."]);
  rows.push(["  3. Найди чек по номеру (колонка «Чек #»). Слева в Loyverse номер чеков отображается в стиле 5-XXXX."]);
  rows.push(["  4. Открой чек → Edit → привяжи customer (или заведи нового, если он ещё не существует)."]);
  rows.push([]);
  rows.push(["Заметки:"]);
  rows.push(["  · Чеки без customer_id, оплаченные bank transfer — почти наверняка B2B-клиенты, которых забыли завести в Loyverse Customers."]);
  rows.push(["  · «Чеков в день» ≥ 2 (выделено жёлтым) — высокая вероятность что это один клиент забрал большой заказ, разбитый на несколько чеков."]);
  rows.push(["  · «Кассир» подскажет кто выписывал чеки — спроси у него/неё кому. Если все чеки от одного кассира — наверняка один и тот же оптовый клиент."]);
  rows.push(["  · В колонке «Кто это?» вписывай имя клиента. Потом передай мне список — добавлю в B2B_PATTERNS, и они перестанут быть «без customer»."]);

  await writeRows(sheetId, 0, 0, rows);

  // Formatting
  const fmt: any[] = [];
  const FMT_BAHT = { type: "CURRENCY", pattern: "#,##0\\ \"฿\"" };
  const FMT_INT  = { type: "NUMBER",   pattern: "#,##0" };
  fmt.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: hdrRow + 1 } }, fields: "gridProperties.frozenRowCount" } });
  // Cols: 0=дата/время, 1=чек#, 2=день, 3=чеков-в-день, 4=сумма, 5=кассир, 6=состав, 7=кто-это
  const widths = [140, 80, 100, 80, 100, 130, 600, 220];
  for (let i = 0; i < widths.length; i++) {
    fmt.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: widths[i] }, fields: "pixelSize" } });
  }
  // Title
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 }, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } });
  // Cashier block headers
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: cashHdrRow, endRowIndex: cashHdrRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.45, green: 0.36, blue: 0.08 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });
  fmt.push({ mergeCells: { range: { sheetId, startRowIndex: cashHdrRow, endRowIndex: cashHdrRow + 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: cashColRow, endRowIndex: cashColRow + 1, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: cashStart, endRowIndex: cashEnd, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: cashStart, endRowIndex: cashEnd, startColumnIndex: 2, endColumnIndex: 3 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Detail header row
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: hdrRow, endRowIndex: hdrRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 }, textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  });
  // Amount col 4 ฿
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: FMT_BAHT, horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // "Чеков в день" col 3 int center
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { numberFormat: FMT_INT, horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat(numberFormat,horizontalAlignment)",
    },
  });
  // Burst days (≥2) — gold background
  for (let r = dataStart; r < dataEnd; r++) {
    const row = rows[r];
    if (!row) continue;
    const cnt = Number(row[3]);
    if (cnt >= 2) {
      fmt.push({
        repeatCell: {
          range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 8 },
          cell: { userEnteredFormat: { backgroundColor: { red: 1.0, green: 0.97, blue: 0.85 } } },
          fields: "userEnteredFormat.backgroundColor",
        },
      });
    }
  }
  // Composition col 6 wrap
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 6, endColumnIndex: 7 },
      cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", textFormat: { fontSize: 9 } } },
      fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)",
    },
  });
  // "Кто это?" col 7 — light blue
  fmt.push({
    repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 7, endColumnIndex: 8 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.92, green: 0.95, blue: 1.0 }, textFormat: { italic: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  await sheets("POST", ":batchUpdate", { requests: fmt });
  console.log(`\n✓ "${TAB}" written.`);
  console.log(`→ https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
