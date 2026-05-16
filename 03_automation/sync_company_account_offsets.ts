/**
 * sync_company_account_offsets.ts
 *
 * On "Income structure ":
 *   B (rows 3..lastRow) = -SUMIFS(Expenses.B; Expenses.A=A_row; Expenses.F=TRUE)
 *     i.e. negative sum of expenses paid from the company account on that date.
 *   D (rows 3..lastRow) = D_prev + C + B  — running total of "Поступления на счет",
 *     net of company-account outflows. (D3 seeded as C2+C3+B3 because row 2 = baseline.)
 *
 * Effect: company-account expenses automatically reduce the running balance
 * the moment the bot logs them with «Со счёта компании», so the user no longer
 * needs to add −sum manually to C.
 *
 * Migration note: for past dates where the user already typed minuses in C,
 * those minuses must be removed manually — otherwise double counting.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const SHEET_NAME = "Income structure ";
const S = ";"; // formula separator

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

  // Find last row with a date serial in col A (rows 3..N).
  const raw = await sheetsReq(token, "GET",
    `/values/${encodeURIComponent(SHEET_NAME + "!A1:A100")}?valueRenderOption=UNFORMATTED_VALUE`
  );
  const colA: any[] = (raw.values || []).map((r: any[]) => r[0]);

  let lastRow = 2;
  for (let i = 2; i < colA.length; i++) {
    if (typeof colA[i] === "number" && colA[i] > 40000) lastRow = i + 1;
  }
  if (lastRow < 3) {
    console.log("No date rows found, nothing to do.");
    return;
  }
  console.log(`Writing B/D formulas to rows 3..${lastRow}`);

  const bValues: string[][] = [];
  const dValues: string[][] = [];
  for (let row = 3; row <= lastRow; row++) {
    const bFormula =
      `=-SUMIFS('Expenses'!B:B${S}'Expenses'!A:A${S}A${row}${S}'Expenses'!F:F${S}TRUE)`;
    const dFormula = row === 3
      ? `=C2+C3+B3`
      : `=D${row - 1}+C${row}+B${row}`;
    bValues.push([bFormula]);
    dValues.push([dFormula]);
  }

  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent(`${SHEET_NAME}!B3:B${lastRow}`)}?valueInputOption=USER_ENTERED`,
    { range: `${SHEET_NAME}!B3:B${lastRow}`, majorDimension: "ROWS", values: bValues },
  );
  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent(`${SHEET_NAME}!D3:D${lastRow}`)}?valueInputOption=USER_ENTERED`,
    { range: `${SHEET_NAME}!D3:D${lastRow}`, majorDimension: "ROWS", values: dValues },
  );

  console.log(`✓ Колонка B заполнена формулой -SUMIFS (расходы со счёта компании)`);
  console.log(`✓ Колонка D пересчитана как D_prev + C + B`);
  console.log(`⚠  За прошлые даты с минусами в C — убери их руками, иначе двойное списание.`);
}

main().catch(e => { console.error(e); process.exit(1); });
