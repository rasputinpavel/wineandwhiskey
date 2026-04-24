import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";

// ── Fixed cost schedule ────────────────────────────────────────────────────
const FIXED_SALARY      = 36_000; // 10th
const FIXED_RENT        = 40_000; // 15th
const FIXED_CONSUMABLES =  3_000; // 1st
const FIXED_REPAIRS     =  3_000; // 1st
const FIXED_ACCOUNTING  =  6_000; // бухгалтерия + налоги, by 5th (separate column)

const S = ";"; // European locale formula separator

const RU_MONTHS = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];

// ── Month band colors (0-indexed month) ───────────────────────────────────
const MONTH_BG: Record<number, {red:number,green:number,blue:number}> = {
  3:  { red: 1.00, green: 1.00, blue: 1.00 }, // Apr: white
  4:  { red: 0.93, green: 0.96, blue: 1.00 }, // May: light blue
  5:  { red: 0.93, green: 1.00, blue: 0.95 }, // Jun: light green
  6:  { red: 1.00, green: 0.97, blue: 0.91 }, // Jul: light orange
  7:  { red: 0.97, green: 0.93, blue: 1.00 }, // Aug: light purple
  8:  { red: 1.00, green: 0.93, blue: 0.95 }, // Sep: light pink
  9:  { red: 0.91, green: 0.98, blue: 0.98 }, // Oct: light teal
  10: { red: 1.00, green: 0.99, blue: 0.88 }, // Nov: light yellow
  11: { red: 1.00, green: 0.93, blue: 0.93 }, // Dec: light red
};
const DEFAULT_BG = { red: 0.97, green: 0.97, blue: 0.97 };

async function gToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type:    "refresh_token",
    }),
  });
  return (await r.json() as any).access_token as string;
}

async function sheetsReq(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Sheets ${method} ${path}: ${await r.text()}`);
  return r.json();
}

function weekLabel(start: Date, end: Date): string {
  const s = start.getUTCDate(), e = end.getUTCDate();
  const sm = RU_MONTHS[start.getUTCMonth()], em = RU_MONTHS[end.getUTCMonth()];
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${s}–${e} ${sm}`
    : `${s} ${sm} – ${e} ${em}`;
}

// Generate weeks from current Monday through Dec 31 of current year
function getWeeksUntilYearEnd(today: Date): Array<{start: Date, end: Date}> {
  const mon = new Date(today);
  mon.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  mon.setUTCHours(0, 0, 0, 0);
  const yearEnd = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  const weeks: Array<{start: Date, end: Date}> = [];
  const d = new Date(mon);
  while (d <= yearEnd) {
    const start = new Date(d);
    const end   = new Date(d); end.setUTCDate(d.getUTCDate() + 6);
    weeks.push({ start, end });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return weeks;
}

// Fixed operational costs for a week (excl. accounting — that's a separate column)
function fixedCostsForWeek(start: Date, end: Date): number {
  let total = 0;
  const d = new Date(start);
  while (d <= end) {
    const day = d.getUTCDate();
    if (day === 10) total += FIXED_SALARY;
    if (day === 15) total += FIXED_RENT;
    if (day ===  1) total += FIXED_CONSUMABLES + FIXED_REPAIRS;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return total;
}

function accountingForWeek(start: Date, end: Date): number {
  const d = new Date(start);
  while (d <= end) {
    if (d.getUTCDate() === 5) return FIXED_ACCOUNTING;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return 0;
}

function dateF(d: Date): string {
  return `DATE(${d.getUTCFullYear()}${S}${d.getUTCMonth() + 1}${S}${d.getUTCDate()})`;
}

async function main() {
  const token = await gToken();
  const nowBkk = new Date(Date.now() + 7 * 3_600_000); // Bangkok UTC+7
  const curMonthStr = `${nowBkk.getUTCFullYear()}-${String(nowBkk.getUTCMonth() + 1).padStart(2, "0")}`;

  // ── Get or create sheet (delete + recreate for clean CF state) ────────────
  const meta = await sheetsReq(token, "GET", "");
  const existing = (meta.sheets as any[]).find(s => s.properties.title === "Rolling Cashflow");
  if (existing) {
    await sheetsReq(token, "POST", ":batchUpdate", {
      requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }],
    });
  }
  const res = await sheetsReq(token, "POST", ":batchUpdate", {
    requests: [{ addSheet: { properties: { title: "Rolling Cashflow" } } }],
  });
  const sheetId: number = res.replies[0].addSheet.properties.sheetId;
  console.log("Created Rolling Cashflow sheet, sheetId:", sheetId);

  const weeks = getWeeksUntilYearEnd(nowBkk);
  console.log(`Generating ${weeks.length} weeks through Dec 31`);

  // ── Layout ─────────────────────────────────────────────────────────────────
  //  Row 1  (idx 0): Title
  //  Row 2  (idx 1): Helper — daily avg in B2
  //  Row 3  (idx 2): Column headers
  //  Rows 4+ (idx 3+): week rows
  //
  //  Cols: A=Неделя  B=Остаток нач.  C=Прогноз  D=Факт (←Закрытие)
  //        E=Дебиторка  F=Кредиторка  G=Расходы  H=Остаток кон.

  const FIRST_WEEK_ROW = 4; // 1-based
  const NUM_COLS = 8;       // A:H

  // Daily avg retail revenue formula (auto-updates as Данные sheet is filled)
  const fDailyAvg =
    `=IFERROR(` +
    `(MAX('Данные'!B2:B31)-SUMIF(B2BData!B:B${S}"${curMonthStr}"${S}B2BData!C:C))` +
    `/MAX(COUNTA('Данные'!B2:B31)${S}1)` +
    `${S}0)`;

  const weekRows = weeks.map(({ start, end }, i) => {
    const row = FIRST_WEEK_ROW + i;

    const fOpen = i === 0
      ? `=MAX('Income structure '!I2:I100)+MAX('Income structure '!N2:N100)`
      : `=H${row - 1}`;

    // Revenue: daily avg × 7 days
    const fRev = `=$B$2*7`;

    const fDeb =
      `=SUMPRODUCT(` +
      `(IFERROR(DATEVALUE('Дебиторка'!D2:D200)${S}0)>=${dateF(start)})*` +
      `(IFERROR(DATEVALUE('Дебиторка'!D2:D200)${S}0)<=${dateF(end)})*` +
      `(UPPER(TRIM('Дебиторка'!F2:F200))<>"PAID")*` +
      `(UPPER(TRIM('Дебиторка'!H2:H200))<>"ЮРА")*` +
      `IFERROR('Дебиторка'!E2:E200${S}0))`;

    const fKred =
      `=SUMPRODUCT(` +
      `(IFERROR(DATEVALUE('Кредиторка'!E2:E200)${S}0)>=${dateF(start)})*` +
      `(IFERROR(DATEVALUE('Кредиторка'!E2:E200)${S}0)<=${dateF(end)})*` +
      `(UPPER(TRIM('Кредиторка'!G2:G200))<>"PAID")*` +
      `IFERROR('Кредиторка'!F2:F200${S}0))`;

    const fixed    = fixedCostsForWeek(start, end);
    const acctg    = accountingForWeek(start, end);
    const fExp =
      `=SUMPRODUCT(` +
      `(IFERROR('Расходы'!A2:A500${S}0)>=${dateF(start)})*` +
      `(IFERROR('Расходы'!A2:A500${S}0)<=${dateF(end)})*` +
      `IFERROR(1*'Расходы'!B2:B500${S}0))` +
      (fixed + acctg > 0 ? `+${fixed + acctg}` : ``);

    // Факт: VLOOKUP from Закрытие sheet by ISO week-start date (hardcoded per row)
    const isoStart = start.toISOString().slice(0, 10);
    const fFact = `=IFERROR(VLOOKUP("${isoStart}"${S}Закрытие!A:B${S}2${S}0)${S}"")`;

    // Closing balance: use Факт if filled, otherwise Прогноз
    const fClose =
      `=IF(D${row}<>""` +
      `${S}B${row}+D${row}+E${row}-F${row}-G${row}` +
      `${S}B${row}+C${row}+E${row}-F${row}-G${row})`;

    return [
      weekLabel(start, end),
      fOpen, fRev, fFact, fDeb, fKred,
      fExp,
      fClose,
    ];
  });

  const blankCols = Array(NUM_COLS - 1).fill("");
  const values = [
    [`ROLLING CASHFLOW — до конца ${nowBkk.getUTCFullYear()} г.`, ...blankCols],
    ["Ср. выручка/день (розница, факт)", fDailyAvg, ...Array(NUM_COLS - 2).fill("")],
    ["Неделя","Остаток нач.","Прогноз","Факт","Дебиторка","Кредиторка","Расходы","Остаток кон."],
    ...weekRows,
  ];

  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent("Rolling Cashflow!A1")}?valueInputOption=USER_ENTERED`,
    { range: "Rolling Cashflow!A1", majorDimension: "ROWS", values },
  );

  // ── Annual payments table (cols K:N = idx 10:14) ─────────────────────────
  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent("Rolling Cashflow!K1")}?valueInputOption=USER_ENTERED`,
    { range: "Rolling Cashflow!K1", majorDimension: "ROWS", values: [
      ["КРУПНЫЕ ГОДОВЫЕ ПЛАТЕЖИ", "", "", ""],
      ["Платёж", "Сумма", "Дата", "Статус"],
      ["Лицензия на алкоголь", 10_000, "", ""],
      ["Виза + work permit", 40_000, "", ""],
    ]},
  );
  console.log("✓ Values written");

  // ── Formatting ────────────────────────────────────────────────────────────
  const col = {
    dark:   { red: 0.12, green: 0.12, blue: 0.12 },
    white:  { red: 1,    green: 1,    blue: 1    },
    helper: { red: 0.95, green: 0.95, blue: 0.95 },
    hdr:    { red: 0.20, green: 0.24, blue: 0.35 },
    negBg:  { red: 0.96, green: 0.80, blue: 0.80 },
    negFg:  { red: 0.72, green: 0.10, blue: 0.10 },
    posBg:  { red: 0.85, green: 0.94, blue: 0.86 },
    posFg:  { red: 0.10, green: 0.37, blue: 0.13 },
    revFg:  { red: 0.11, green: 0.31, blue: 0.63 }, // revenue blue
    expFg:  { red: 0.72, green: 0.10, blue: 0.10 }, // expenses red
  };
  const thb = { numberFormat: { type: "CURRENCY", pattern: '"฿"#,##0' } };

  const lastWeekIdx = FIRST_WEEK_ROW - 1 + weeks.length; // 0-based end (exclusive)

  // Month background + borders
  const monthStyleReqs = weeks.map(({ start }, i) => {
    const bg = MONTH_BG[start.getUTCMonth()] ?? DEFAULT_BG;
    const rowIdx = FIRST_WEEK_ROW - 1 + i;
    return { repeatCell: {
      range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS },
      cell: { userEnteredFormat: { backgroundColor: bg } },
      fields: "userEnteredFormat(backgroundColor)" } };
  });

  const monthBorderReqs = weeks.flatMap(({ start }, i) => {
    if (i === 0) return [];
    if (start.getUTCMonth() === weeks[i - 1].start.getUTCMonth()) return [];
    const rowIdx = FIRST_WEEK_ROW - 1 + i;
    return [{ updateBorders: {
      range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: NUM_COLS },
      top: { style: "SOLID_MEDIUM", color: { red: 0.2, green: 0.2, blue: 0.2 } } } }];
  });

  // Conditional formatting for closing balance (col H = idx 7)
  const cfRules = weeks.flatMap((_, i) => {
    const rowIdx = FIRST_WEEK_ROW - 1 + i;
    const range = { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 7, endColumnIndex: 8 };
    return [
      { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: {
        condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: "0" }] },
        format: { backgroundColor: col.negBg, textFormat: { bold: true, foregroundColor: col.negFg } },
      }}, index: 0 }},
      { addConditionalFormatRule: { rule: { ranges: [range], booleanRule: {
        condition: { type: "NUMBER_GREATER_THAN_EQ", values: [{ userEnteredValue: "0" }] },
        format: { backgroundColor: col.posBg, textFormat: { bold: true, foregroundColor: col.posFg } },
      }}, index: 0 }},
    ];
  });

  await sheetsReq(token, "POST", ":batchUpdate", { requests: [
    // Title
    { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: col.dark, textFormat: { bold: true, fontSize: 13, foregroundColor: col.white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } },

    // Helper row
    { repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: col.helper, textFormat: { italic: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } },

    // Column headers (dark navy)
    { repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: col.hdr, textFormat: { bold: true, foregroundColor: col.white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } },

    // THB: daily avg + all numeric cols B:H in week rows
    { repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: thb }, fields: "userEnteredFormat(numberFormat)" } },
    { repeatCell: {
      range: { sheetId, startRowIndex: 3, endRowIndex: lastWeekIdx, startColumnIndex: 1, endColumnIndex: NUM_COLS },
      cell: { userEnteredFormat: thb }, fields: "userEnteredFormat(numberFormat)" } },

    // Прогноз C (idx 2) + Факт D (idx 3) + Дебиторка E (idx 4): blue bold
    { repeatCell: {
      range: { sheetId, startRowIndex: 3, endRowIndex: lastWeekIdx, startColumnIndex: 2, endColumnIndex: 5 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: col.revFg } } },
      fields: "userEnteredFormat(textFormat)" } },

    // Факт D (idx 3): white bg to visually mark as "live" input area
    { repeatCell: {
      range: { sheetId, startRowIndex: 3, endRowIndex: lastWeekIdx, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { backgroundColor: col.white } },
      fields: "userEnteredFormat(backgroundColor)" } },

    // Кредиторка F (idx 5) + Расходы G (idx 6): red bold
    { repeatCell: {
      range: { sheetId, startRowIndex: 3, endRowIndex: lastWeekIdx, startColumnIndex: 5, endColumnIndex: 7 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: col.expFg } } },
      fields: "userEnteredFormat(textFormat)" } },

    // Column widths
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 175 }, fields: "pixelSize" } },
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: NUM_COLS },
      properties: { pixelSize: 115 }, fields: "pixelSize" } },
    // Gap column I (idx 8)
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 },
      properties: { pixelSize: 20 }, fields: "pixelSize" } },
    // Gap column J (idx 9)
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 },
      properties: { pixelSize: 20 }, fields: "pixelSize" } },
    // Annual table K:N (idx 10:14)
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 10, endIndex: 11 },
      properties: { pixelSize: 220 }, fields: "pixelSize" } },
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 11, endIndex: 14 },
      properties: { pixelSize: 110 }, fields: "pixelSize" } },

    // Freeze first 3 rows
    { updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 3 } },
      fields: "gridProperties.frozenRowCount" } },

    // ── Annual payments table (K:N = idx 10:14) ──
    { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 10, endColumnIndex: 14 },
      cell: { userEnteredFormat: { backgroundColor: col.dark, textFormat: { bold: true, fontSize: 12, foregroundColor: col.white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } },
    { repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 10, endColumnIndex: 14 },
      cell: { userEnteredFormat: { backgroundColor: col.hdr, textFormat: { bold: true, foregroundColor: col.white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } },
    { repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 6, startColumnIndex: 11, endColumnIndex: 12 },
      cell: { userEnteredFormat: thb }, fields: "userEnteredFormat(numberFormat)" } },

    // Month styles + borders
    ...monthStyleReqs,
    ...monthBorderReqs,

    // CF rules for closing balance
    ...cfRules,
  ]});

  console.log(`✓ Rolling Cashflow ready — ${weeks.length} weeks through Dec 31 ${nowBkk.getUTCFullYear()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
