/**
 * Writes a running-balance formula to "Income structure " col N, rows 8–46.
 *
 * Logic:
 *   N8 = N7 (baseline 22.04) – cumulative expenses in "Расходы" from 23.04 up to and
 *        including the date in col A of that row.
 *
 * Расходы!A = date serial, Расходы!B = amount (positive = expense).
 * Formula is re-evaluated by Sheets whenever Расходы changes — fully dynamic.
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
  console.log(`Writing formulas to N8:N${lastRow} (${lastRow - 7} rows)`);

  // Build formula values: one row per date, referencing the date in col A of that row
  const values: string[][] = [];
  for (let row = 8; row <= lastRow; row++) {
    const formula =
      `=N$7-SUMPRODUCT(` +
      `('Расходы'!A$2:A$500>=DATE(2026${S}4${S}23))*` +
      `('Расходы'!A$2:A$500<=A${row})*` +
      `IFERROR(1*'Расходы'!B$2:B$500${S}0)` +
      `)`;
    values.push([formula]);
  }

  const range = `${SHEET_NAME}!N8:N${lastRow}`;
  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { range, majorDimension: "ROWS", values }
  );

  console.log(`✓ Personal balance formulas written to N8:N${lastRow}`);
  console.log(`  Each row = ฿66,000 (22.04 baseline) – cumulative Расходы up to that date`);
}

main().catch(e => { console.error(e); process.exit(1); });
