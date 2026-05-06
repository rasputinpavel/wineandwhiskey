import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const S = ";"; // European locale formula separator

// Anchor week (Monday). Lock to a real opening-balance date so closed weeks stay
// visible after regenerations. Bump this + OPENING_BALANCE together when the
// sheet starts dragging too much old history.
const START_MONDAY = "2026-04-20";
const OPENING_BALANCE = 117_656; // company + personal accounts on START_MONDAY

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

// ── Known mandatory expenses (used to seed Обязательные tab) ──────────────
const MANDATORY_EXPENSES = [
  { name: "Аренда помещения",          amount: 40_000, day: 15, note: "" },
  { name: "Зарплата сотрудников",       amount: 36_000, day: 10, note: "" },
  { name: "Бухгалтерия + налоги",       amount:  6_000, day:  5, note: "" },
  { name: "Расходники",                  amount:  3_000, day:  1, note: "канцтовары, упаковка" },
  { name: "Мелкий ремонт / ТО",         amount:  3_000, day:  1, note: "оборудование, инвентарь" },
];

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

function getWeeksUntilYearEnd(today: Date): Array<{start: Date, end: Date}> {
  const mon = new Date(`${START_MONDAY}T00:00:00Z`);
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

function dateF(d: Date): string {
  return `DATE(${d.getUTCFullYear()}${S}${d.getUTCMonth() + 1}${S}${d.getUTCDate()})`;
}

// Formula: sum Обязательные expenses whose day-of-month falls in the week.
// Cross-month weeks use OR logic (day in tail of month1 OR head of month2).
function fMandatory(start: Date, end: Date): string {
  const sd = start.getUTCDate(), ed = end.getUTCDate();
  const crossMonth = start.getUTCMonth() !== end.getUTCMonth();
  const rng = "Обязательные!$C$2:$C$20";
  const amt = "Обязательные!$B$2:$B$20";
  if (crossMonth) {
    // day >= sd (in first month) OR day <= ed (in second month)
    return `=SUMPRODUCT(--((${rng}>=${sd})+(${rng}<=${ed})>0)*${amt})`;
  }
  return `=SUMPRODUCT((${rng}>=${sd})*(${rng}<=${ed})*${amt})`;
}

async function main() {
  const token = await gToken();
  const nowBkk = new Date(Date.now() + 7 * 3_600_000);

  const meta = await sheetsReq(token, "GET", "");
  const sheets: any[] = meta.sheets ?? [];

  // ── Ensure Обязательные tab (create once, never overwrite) ────────────────
  const hasOblTab = sheets.some((s: any) => s.properties.title === "Обязательные");
  if (!hasOblTab) {
    const res = await sheetsReq(token, "POST", ":batchUpdate", {
      requests: [{ addSheet: { properties: {
        title: "Обязательные",
        gridProperties: { rowCount: 50, columnCount: 5 },
      }}}],
    });
    const oblId: number = res.replies[0].addSheet.properties.sheetId;

    const oblValues = [
      ["Статья расхода", "Сумма (฿)", "День месяца", "Примечания"],
      ...MANDATORY_EXPENSES.map(e => [e.name, e.amount, e.day, e.note]),
    ];
    await sheetsReq(token, "PUT",
      `/values/${encodeURIComponent("Обязательные!A1")}?valueInputOption=USER_ENTERED`,
      { range: "Обязательные!A1", majorDimension: "ROWS", values: oblValues },
    );

    // Format header row
    await sheetsReq(token, "POST", ":batchUpdate", { requests: [
      { repeatCell: {
        range: { sheetId: oblId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: {
          backgroundColor: { red: 0.20, green: 0.24, blue: 0.35 },
          textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
        }},
        fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { repeatCell: {
        range: { sheetId: oblId, startRowIndex: 1, endRowIndex: 10, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
        fields: "userEnteredFormat(numberFormat)" } },
      { updateDimensionProperties: {
        range: { sheetId: oblId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 260 }, fields: "pixelSize" } },
      { updateDimensionProperties: {
        range: { sheetId: oblId, dimension: "COLUMNS", startIndex: 1, endIndex: 4 },
        properties: { pixelSize: 120 }, fields: "pixelSize" } },
    ]});

    console.log("✓ Лист «Обязательные» создан");
  } else {
    console.log("✓ Лист «Обязательные» уже существует — не трогаем");
  }

  // ── Delete + recreate Rolling ────────────────────────────────────
  const existing = sheets.find((s: any) => s.properties.title === "Rolling");
  if (existing) {
    await sheetsReq(token, "POST", ":batchUpdate", {
      requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }],
    });
  }
  const res2 = await sheetsReq(token, "POST", ":batchUpdate", {
    requests: [{ addSheet: { properties: { title: "Rolling" } } }],
  });
  const sheetId: number = res2.replies[0].addSheet.properties.sheetId;
  console.log("Created Rolling sheet, sheetId:", sheetId);

  const weeks = getWeeksUntilYearEnd(nowBkk);
  console.log(`Generating ${weeks.length} weeks through Dec 31`);

  // ── Layout ─────────────────────────────────────────────────────────────────
  //  A=Неделя  B=Остаток нач.  C=Прогноз  D=Факт
  //  E=Дебиторка  F=Кредиторка  G=Обяз расходы  H=Операц расходы  I=Остаток кон.

  const FIRST_WEEK_ROW = 4;
  const NUM_COLS = 9; // A:I

  // 7-day rolling retail average — written by sync_dashboard.ts to 'Данные'!G1.
  // Date-anchored window reflects recent days regardless of month boundary.
  const fDailyAvg = `=IFERROR('Данные'!G1${S}0)`;

  const weekRows = weeks.map(({ start, end }, i) => {
    const row = FIRST_WEEK_ROW + i;

    const fOpen = i === 0 ? OPENING_BALANCE : `=I${row - 1}`;

    const fRev = `=$B$2*7`;

    // Дебиторка:
    //   • Paid → попадает в неделю по «Дата оплаты» (G), включая оплату день-в-день
    //   • не Paid → попадает в неделю по «Оплатить до» (D)
    //   • строки с комментарием «Юра» (старый владелец) всегда исключаем
    const fDeb =
      `=SUMPRODUCT(` +
        `(` +
          `(UPPER(TRIM('Дебиторка'!F2:F200))="PAID")*` +
          `(IFERROR(DATEVALUE('Дебиторка'!G2:G200)${S}0)>=${dateF(start)})*` +
          `(IFERROR(DATEVALUE('Дебиторка'!G2:G200)${S}0)<=${dateF(end)})` +
        `+` +
          `(UPPER(TRIM('Дебиторка'!F2:F200))<>"PAID")*` +
          `(IFERROR(DATEVALUE('Дебиторка'!D2:D200)${S}0)>=${dateF(start)})*` +
          `(IFERROR(DATEVALUE('Дебиторка'!D2:D200)${S}0)<=${dateF(end)})` +
        `)*` +
        `(UPPER(TRIM('Дебиторка'!H2:H200))<>"ЮРА")*` +
        `IFERROR('Дебиторка'!E2:E200${S}0)` +
      `)`;

    const fKred =
      `=SUMPRODUCT(` +
      `(IFERROR(DATEVALUE('Кредиторка'!E2:E200)${S}0)>=${dateF(start)})*` +
      `(IFERROR(DATEVALUE('Кредиторка'!E2:E200)${S}0)<=${dateF(end)})*` +
      `(UPPER(TRIM('Кредиторка'!G2:G200))<>"PAID")*` +
      `IFERROR('Кредиторка'!F2:F200${S}0))`;

    // Обязательные: formula-driven from Обязательные tab
    const fFixed = fMandatory(start, end);

    // Операционные: actual entries from Расходы sheet
    const fOper =
      `=SUMPRODUCT(` +
      `(IFERROR('Расходы'!A2:A500${S}0)>=${dateF(start)})*` +
      `(IFERROR('Расходы'!A2:A500${S}0)<=${dateF(end)})*` +
      `IFERROR(1*'Расходы'!B2:B500${S}0))`;

    const isoStart = start.toISOString().slice(0, 10);
    const fFact = `=IFERROR(VLOOKUP("${isoStart}"${S}Закрытие!A:B${S}2${S}0)${S}"")`;

    const fClose =
      `=IF(D${row}<>""` +
      `${S}B${row}+D${row}+E${row}-F${row}-G${row}-H${row}` +
      `${S}B${row}+C${row}+E${row}-F${row}-G${row}-H${row})`;

    return [weekLabel(start, end), fOpen, fRev, fFact, fDeb, fKred, fFixed, fOper, fClose];
  });

  const blankCols = Array(NUM_COLS - 1).fill("");
  const values = [
    [`ROLLING CASHFLOW — до конца ${nowBkk.getUTCFullYear()} г.`, ...blankCols],
    ["Ср. розница/день (7д скользящее)", fDailyAvg, ...Array(NUM_COLS - 2).fill("")],
    ["Неделя","Остаток нач.","Прогноз","Факт","Дебиторка","Кредиторка","Обяз расходы","Операц расходы","Остаток кон."],
    ...weekRows,
  ];

  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent("Rolling!A1")}?valueInputOption=USER_ENTERED`,
    { range: "Rolling!A1", majorDimension: "ROWS", values },
  );

  // ── Annual payments table (cols K:N = idx 10:13) ──────────────────────────
  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent("Rolling!K1")}?valueInputOption=USER_ENTERED`,
    { range: "Rolling!K1", majorDimension: "ROWS", values: [
      ["КРУПНЫЕ ГОДОВЫЕ ПЛАТЕЖИ", "", "", ""],
      ["Платёж", "Сумма", "Дата", "Статус"],
      ["Лицензия на алкоголь", 10_000, "", ""],
      ["Виза + work permit", 40_000, "", ""],
    ]},
  );
  console.log("✓ Values written");

  // ── Formatting ────────────────────────────────────────────────────────────
  const col = {
    dark:    { red: 0.12, green: 0.12, blue: 0.12 },
    white:   { red: 1,    green: 1,    blue: 1    },
    helper:  { red: 0.95, green: 0.95, blue: 0.95 },
    hdr:     { red: 0.20, green: 0.24, blue: 0.35 },
    negBg:   { red: 0.96, green: 0.80, blue: 0.80 },
    negFg:   { red: 0.72, green: 0.10, blue: 0.10 },
    posBg:   { red: 0.85, green: 0.94, blue: 0.86 },
    posFg:   { red: 0.10, green: 0.37, blue: 0.13 },
    revFg:   { red: 0.11, green: 0.31, blue: 0.63 }, // blue
    expFg:   { red: 0.72, green: 0.10, blue: 0.10 }, // dark red — mandatory
    operFg:  { red: 0.85, green: 0.28, blue: 0.10 }, // orange-red — operational
  };
  const thb = { numberFormat: { type: "CURRENCY", pattern: '"฿"#,##0' } };

  const lastWeekIdx = FIRST_WEEK_ROW - 1 + weeks.length;

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

  // Conditional formatting for closing balance (col I = idx 8)
  const cfRules = weeks.flatMap((_, i) => {
    const rowIdx = FIRST_WEEK_ROW - 1 + i;
    const range = { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 8, endColumnIndex: 9 };
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

  // Closed-week highlight: rows where Факт (col D, idx 3) is filled → warm amber background
  const closedWeekRule = {
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId, startRowIndex: FIRST_WEEK_ROW - 1, endRowIndex: lastWeekIdx, startColumnIndex: 0, endColumnIndex: NUM_COLS }],
        booleanRule: {
          condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=$D${FIRST_WEEK_ROW}<>""` }] },
          format: { backgroundColor: { red: 0.97, green: 0.93, blue: 0.80 } },
        },
      },
      index: 0,
    },
  };

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

    // Column headers
    { repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: col.hdr, textFormat: { bold: true, foregroundColor: col.white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } },

    // THB format: daily avg + all numeric cols B:I
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

    // Факт D (idx 3): white bg
    { repeatCell: {
      range: { sheetId, startRowIndex: 3, endRowIndex: lastWeekIdx, startColumnIndex: 3, endColumnIndex: 4 },
      cell: { userEnteredFormat: { backgroundColor: col.white } },
      fields: "userEnteredFormat(backgroundColor)" } },

    // Кредиторка F (idx 5) + Обяз G (idx 6): dark red bold
    { repeatCell: {
      range: { sheetId, startRowIndex: 3, endRowIndex: lastWeekIdx, startColumnIndex: 5, endColumnIndex: 7 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: col.expFg } } },
      fields: "userEnteredFormat(textFormat)" } },

    // Операц H (idx 7): orange-red bold
    { repeatCell: {
      range: { sheetId, startRowIndex: 3, endRowIndex: lastWeekIdx, startColumnIndex: 7, endColumnIndex: 8 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: col.operFg } } },
      fields: "userEnteredFormat(textFormat)" } },

    // Column widths
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 175 }, fields: "pixelSize" } },
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: NUM_COLS },
      properties: { pixelSize: 110 }, fields: "pixelSize" } },
    // Gap col J (idx 9)
    { updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 },
      properties: { pixelSize: 24 }, fields: "pixelSize" } },
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

    // Annual payments table styling
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

    ...monthStyleReqs,
    ...monthBorderReqs,
    closedWeekRule,
    ...cfRules,
  ]});

  console.log(`✓ Rolling ready — ${weeks.length} weeks, Обязательные tab live-linked`);
}

main().catch(e => { console.error(e); process.exit(1); });
