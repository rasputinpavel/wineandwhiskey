/**
 * Writes a running-balance formula to "Income structure " col O, rows 8–46.
 *
 * Logic:
 *   O8 = O7 (baseline 22.04 = ฿66 000) – cumulative expenses in "Expenses"
 *        from 23.04 up to and including the date in col A of that row,
 *        excluding rows where F=TRUE (paid from company account).
 *
 * Expenses!A = date serial, Expenses!B = amount (positive = expense),
 * Expenses!F = "со счёта компании" flag (TRUE = skip — that money never came
 *             out of the personal balance).
 *
 * Formula is re-evaluated by Sheets whenever Expenses changes — fully dynamic.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const SHEET_NAME = "Income structure ";
const S = ";"; // formula separator (Russian/European locale)

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
  return ((await r.json()) as any).access_token as string;
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

async function main() {
  const token = await gToken();

  // Read col A to find the last row with a date
  const raw = await sheetsReq(token, "GET",
    `/values/${encodeURIComponent(SHEET_NAME + "!A1:A100")}?valueRenderOption=UNFORMATTED_VALUE`
  );
  const colA: any[] = (raw.values || []).map((r: any[]) => r[0]);

  // Row 7 (index 6) = 22.04 baseline. Rows 8+ (index 7+) need formulas.
  // Find last row that has a numeric date serial in col A.
  let lastRow = 7; // 1-based
  for (let i = 7; i < colA.length; i++) {
    if (typeof colA[i] === "number" && colA[i] > 40000) lastRow = i + 1;
  }
  console.log(`Writing formulas to O8:O${lastRow} (${lastRow - 7} rows)`);

  // Build formula values: one row per date, referencing the date in col A of that row
  const values: string[][] = [];
  for (let row = 8; row <= lastRow; row++) {
    const formula =
      `=O$7-SUMPRODUCT(` +
      `('Expenses'!A$2:A$500>=DATE(2026${S}4${S}23))*` +
      `('Expenses'!A$2:A$500<=A${row})*` +
      `('Expenses'!F$2:F$500<>TRUE)*` +
      `IFERROR(1*'Expenses'!B$2:B$500${S}0)` +
      `)`;
    values.push([formula]);
  }

  const range = `${SHEET_NAME}!O8:O${lastRow}`;
  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { range, majorDimension: "ROWS", values }
  );

  console.log(`✓ Personal balance formulas written to O8:O${lastRow}`);
  console.log(`  Each row = ฿66,000 (22.04 baseline) – cumulative личные Expenses (F<>TRUE)`);
}

main().catch(e => { console.error(e); process.exit(1); });
