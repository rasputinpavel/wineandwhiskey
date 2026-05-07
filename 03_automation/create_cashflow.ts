import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";

async function gToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
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

// ── Config ──────────────────────────────────────────────────────────────────

const TARGET_MONTH = 5;  // ← May; change to 6 for June etc.
const TARGET_YEAR  = 2026;

const FIXED_RENT        = 40_000;
const FIXED_SALARY      = 36_000;
const FIXED_CONSUMABLES =  3_000;
const FIXED_REPAIRS     =  3_000;
const MARKETING_PCT     = 0.10;

const MONTH_NAMES = ["","Январь","Февраль","Март","Апрель","Май","Июнь",
                     "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const token = await gToken();
  const M = TARGET_MONTH;
  const Y = TARGET_YEAR;
  const prevM = M === 1 ? 12 : M - 1;
  const prevY = M === 1 ? Y - 1 : Y;
  const daysInMonth = new Date(Y, M, 0).getDate();

  // ── Get or create Cashflow tab ────────────────────────────────────────────
  const meta = await sheetsReq(token, "GET", "");
  let sheetId: number;
  const existing = (meta.sheets as any[]).find(s => s.properties.title === "Cashflow");
  if (existing) {
    sheetId = existing.properties.sheetId;
    console.log("Cashflow sheet exists, sheetId:", sheetId);
  } else {
    const res = await sheetsReq(token, "POST", ":batchUpdate", {
      requests: [{ addSheet: { properties: { title: "Cashflow" } } }],
    });
    sheetId = res.replies[0].addSheet.properties.sheetId;
    console.log("Created Cashflow sheet, sheetId:", sheetId);
  }

  // ── Formulas ──────────────────────────────────────────────────────────────

  // Separator: semicolon (European/Russian locale Google Sheets)
  const S = ";";

  // Current balance: MAX of cumulative col I.
  // Future dates carry the last filled value forward, so MAX = latest actual balance.
  const fBalance = `=MAX('Income structure '!I2:I100)`;

  // Revenue projection (retail only, excluding B2B):
  // Данные col B is cumulative → MAX gives latest total; B2BData col C = monthly B2B revenue
  const prevMonthStr = `${prevY}-${String(prevM).padStart(2, "0")}`; // e.g. "2026-04"
  const fRevenue =
    `=IFERROR((MAX('Данные'!B2:B31)` +
    `-SUMIF(B2BData!B:B${S}"${prevMonthStr}"${S}B2BData!C:C))` +
    `/MAX(COUNTA('Данные'!B2:B31)${S}1)*${daysInMonth}${S}0)`;

  // Дебиторка due in target month: col D = due date DD.MM.YYYY, col E = amount, col F = status
  const fDeb =
    `=SUMPRODUCT(` +
    `(IFERROR(VALUE(MID('Дебиторка'!D2:D200${S}4${S}2))${S}0)=${M})*` +
    `(IFERROR(VALUE(RIGHT('Дебиторка'!D2:D200${S}4))${S}0)=${Y})*` +
    `(UPPER(TRIM('Дебиторка'!F2:F200))<>"PAID")*` +
    `(UPPER(TRIM('Дебиторка'!H2:H200))<>"ЮРА")*` +
    `IFERROR('Дебиторка'!E2:E200${S}0))`;

  // Кредиторка due in target month: col E = due date DD.MM.YYYY, col F = amount, col G = status
  const fKred =
    `=SUMPRODUCT(` +
    `(IFERROR(VALUE(MID('Кредиторка'!E2:E200${S}4${S}2))${S}0)=${M})*` +
    `(IFERROR(VALUE(RIGHT('Кредиторка'!E2:E200${S}4))${S}0)=${Y})*` +
    `(UPPER(TRIM('Кредиторка'!G2:G200))<>"PAID")*` +
    `IFERROR('Кредиторка'!F2:F200${S}0))`;

  // Personal account balance: M = date, N = amount (latest entry = MAX)
  const fPersonal = `=MAX('Income structure '!N2:N100)`;

  // Marketing: 10% of projected revenue (row 6, after personal balance row added)
  const fMarketing = `=B6*${MARKETING_PCT.toString().replace(".", ",")}`;

  // Прочие расходы: actual Expenses for previous month
  // Old rows have text "฿856,00" in col B → force numeric with 1* so IFERROR catches text too
  const prevDateFragment = `.${String(prevM).padStart(2, "0")}.${prevY}`; // e.g. ".04.2026"
  const fOther =
    `=SUMPRODUCT(` +
    `(ISNUMBER(SEARCH("${prevDateFragment}"${S}'Expenses'!A2:A500)))*` +
    `IFERROR(1*'Expenses'!B2:B500${S}0))`;

  // ── Layout ────────────────────────────────────────────────────────────────
  //
  //  Row  (0-based idx)  Content
  //  1    0              Title
  //  2    1              (empty)
  //  3    2              ── ПРИХОД ──
  //  4    3              Остаток на корп. счету     B4 = fBalance
  //  5    4              Остаток на личном счету    B5 = fPersonal  ← NEW
  //  6    5              Прогноз выручки            B6 = fRevenue
  //  7    6              Дебиторка к получению      B7 = fDeb
  //  8    7              ИТОГО ПРИХОД               B8 = B4+B5+B6+B7
  //  9    8              (empty)
  //  10   9              ── РАСХОД ──
  //  11   10             Кредиторка к оплате        B11 = fKred
  //  12   11             Аренда + свет              B12 = 40000
  //  13   12             Зарплаты                   B13 = 36000
  //  14   13             Расходники                 B14 = 3000
  //  15   14             Мелкий ремонт              B15 = 3000
  //  16   15             Маркетинг (10%)            B16 = fMarketing
  //  17   16             Прочие (факт пред. мес.)   B17 = fOther
  //  18   17             ИТОГО РАСХОД               B18 = SUM(B11:B17)
  //  19   18             (empty)
  //  20   19             ОСТАТОК НА КОНЕЦ МЕСЯЦА    B20 = B8-B18
  //  21   20             СТАТУС                     B21 = IF(...)

  const rows = [
    [`CASHFLOW — Прогноз на ${MONTH_NAMES[M]} ${Y}`, ""],               // 1
    ["", ""],                                                             // 2
    ["── ПРИХОД ──", ""],                                                 // 3
    ["Остаток на корп. счету (последние данные)", fBalance],             // 4
    ["Остаток на личном счету", fPersonal],                              // 5
    [`Прогноз выручки (${MONTH_NAMES[M]}, ${daysInMonth} дн.)`, fRevenue], // 6
    ["Дебиторка к получению", fDeb],                                     // 7
    ["ИТОГО ПРИХОД", "=B4+B5+B6+B7"],                                    // 8
    ["", ""],                                                             // 9
    ["── РАСХОД ──", ""],                                                 // 10
    ["Кредиторка к оплате", fKred],                                      // 11
    ["Аренда + свет", FIXED_RENT],                                       // 12
    ["Зарплаты (2 продавца + премии)", FIXED_SALARY],                    // 13
    ["Расходники", FIXED_CONSUMABLES],                                   // 14
    ["Мелкий ремонт", FIXED_REPAIRS],                                    // 15
    [`Маркетинг (${MARKETING_PCT * 100}% от прогноза выручки)`, fMarketing], // 16
    [`Прочие расходы (факт ${MONTH_NAMES[prevM]} ${prevY})`, fOther],   // 17
    ["ИТОГО РАСХОД", "=SUM(B11:B17)"],                                   // 18
    ["", ""],                                                             // 19
    ["ОСТАТОК НА КОНЕЦ МЕСЯЦА", "=B8-B18"],                              // 20
    ["СТАТУС", `=IF(B20<0${S}"🔴 КАССОВЫЙ РАЗРЫВ"${S}IF(B20<50000${S}"🟡 Мало (< ฿50K)"${S}"🟢 Норма"))`], // 21
  ];

  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent("Cashflow!A1")}?valueInputOption=USER_ENTERED`,
    { range: "Cashflow!A1", majorDimension: "ROWS", values: rows },
  );
  console.log("✓ Values written");

  // ── Formatting ────────────────────────────────────────────────────────────
  const c = {
    dark:    { red: 0.12, green: 0.12, blue: 0.12 },
    white:   { red: 1,    green: 1,    blue: 1    },
    section: { red: 0.22, green: 0.22, blue: 0.22 },
    total:   { red: 0.88, green: 0.88, blue: 0.88 },
    result:  { red: 0.13, green: 0.37, blue: 0.18 },
  };
  const thb = { numberFormat: { type: "CURRENCY", pattern: '"฿"#,##0' } };

  await sheetsReq(token, "POST", ":batchUpdate", { requests: [
    // Title: dark bg, white bold 14pt
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: c.dark, textFormat: { bold: true, fontSize: 14, foregroundColor: c.white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } },

    // Section headers (rows 3, 10 → idx 2, 9)
    ...([2, 9] as number[]).map(idx => ({ repeatCell: {
      range: { sheetId, startRowIndex: idx, endRowIndex: idx + 1 },
      cell: { userEnteredFormat: { backgroundColor: c.section, textFormat: { bold: true, foregroundColor: c.white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } })),

    // ИТОГО rows (idx 7, 17): gray bold
    ...([7, 17] as number[]).map(idx => ({ repeatCell: {
      range: { sheetId, startRowIndex: idx, endRowIndex: idx + 1 },
      cell: { userEnteredFormat: { backgroundColor: c.total, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } })),

    // ОСТАТОК row (idx 19): green bold large
    { repeatCell: { range: { sheetId, startRowIndex: 19, endRowIndex: 20 },
      cell: { userEnteredFormat: { backgroundColor: c.result, textFormat: { bold: true, fontSize: 12, foregroundColor: c.white } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)" } },

    // THB format for all B values (rows 4–18, 20 → idx 3–17, 19)
    { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: 18, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: thb }, fields: "userEnteredFormat(numberFormat)" } },
    { repeatCell: { range: { sheetId, startRowIndex: 19, endRowIndex: 20, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: thb }, fields: "userEnteredFormat(numberFormat)" } },

    // Column widths
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 380 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 150 }, fields: "pixelSize" } },

    // Freeze header row
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: "gridProperties.frozenRowCount" } },
  ]});

  console.log(`✓ Cashflow sheet ready — ${MONTH_NAMES[M]} ${Y}`);
}

main().catch(e => { console.error(e); process.exit(1); });
