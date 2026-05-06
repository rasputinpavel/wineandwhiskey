/**
 * sync_cashflow_actuals.ts
 * Runs every Sunday at 22:15 Bangkok (after dashboard sync).
 *
 * Writes the previous week's actual retail revenue into the "Закрытие" sheet.
 * Rolling reads from it via VLOOKUP — survives cashflow recreation.
 *
 * Revenue source (automated run):
 *   Reads "Текущая неделя" → Розница from the Dashboard table.
 *   On Sunday the dashboard's "current week" = the Mon–Sun week that just ended.
 *   dashboard sync always runs before actuals sync, so data is fresh.
 *
 * Manual rerun:
 *   npm run actuals -- --week 2026-04-20 --retail 67083
 *   --week   : ISO Mon of the target week
 *   --retail : actual retail revenue (required for manual runs)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SHEET_ID             = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const CLOSINGS_TAB         = "Закрытие";
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

// ─── Dashboard reader ──────────────────────────────────────────────────────────
// Dashboard summary table: header at A15, data rows at A16+
//   Cols: Период | Розница, ฿ | B2B, ฿ | Итого, ฿ | Чеков | GP, ฿ | GP% | Ср.чек
// On Sundays "Текущая неделя" = the Mon–Sun week that just ended.

async function fetchRetailFromDashboard(): Promise<{ retail: number; b2b: number; total: number }> {
  const rows = await readRange("Dashboard!A15:H22");
  for (const row of rows) {
    if ((row[0] ?? "").trim() === "Текущая неделя") {
      const parse = (v: string) => parseFloat((v ?? "").toString().replace(/[^\d.-]/g, "")) || 0;
      return { retail: parse(row[1]), b2b: parse(row[2]), total: parse(row[3]) };
    }
  }
  throw new Error("«Текущая неделя» row not found in Dashboard — did sync_dashboard.ts run first?");
}

// ─── Fix ฿ format on Rolling D column ────────────────────────────────

async function fixFactFormat(rcSheet: any) {
  const sid = rcSheet.properties.sheetId;
  const rows = rcSheet.properties.gridProperties?.rowCount ?? 100;
  await gApi("POST", ":batchUpdate", {
    requests: [{
      repeatCell: {
        range: { sheetId: sid, startRowIndex: 3, endRowIndex: rows, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: '"฿"#,##0' } } },
        fields: "userEnteredFormat(numberFormat)",
      },
    }],
  });
  console.log("   ✓ ฿ format applied to Факт (D) column");
}

// ─── Highlight closed weeks (Факт filled) with warm amber background ──────────

async function highlightClosedWeeks(rcSheet: any) {
  const sid = rcSheet.properties.sheetId;
  const rows = rcSheet.properties.gridProperties?.rowCount ?? 100;
  const FIRST_WEEK_ROW = 4;

  // Remove existing CUSTOM_FORMULA rules (ours from previous runs) — reverse order
  const existing: any[] = rcSheet.conditionalFormats ?? [];
  const toDelete = existing
    .map((r: any, i: number) => ({ r, i }))
    .filter(({ r }) => r.booleanRule?.condition?.type === "CUSTOM_FORMULA")
    .map(({ i }) => i)
    .sort((a: number, b: number) => b - a);

  const deleteReqs = toDelete.map((i: number) => ({
    deleteConditionalFormatRule: { sheetId: sid, index: i },
  }));

  const addReq = {
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: sid, startRowIndex: FIRST_WEEK_ROW - 1, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: 9 }],
        booleanRule: {
          condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=$D${FIRST_WEEK_ROW}<>""` }] },
          format: { backgroundColor: { red: 0.97, green: 0.93, blue: 0.80 } },
        },
      },
      index: 0,
    },
  };

  await gApi("POST", ":batchUpdate", { requests: [...deleteReqs, addReq] });
  console.log("   ✓ Closed week highlight applied");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const bkk = bangkokNow();
  const dayOfWeek = bkk.getUTCDay(); // 0=Sun

  const weekArg = (() => {
    const idx = process.argv.indexOf("--week");
    return idx !== -1 ? process.argv[idx + 1] : null;
  })();

  const retailArg = (() => {
    const idx = process.argv.indexOf("--retail");
    if (idx === -1) return null;
    const v = parseFloat(process.argv[idx + 1]);
    if (isNaN(v)) throw new Error("--retail must be a number");
    return v;
  })();

  let lastWeek: { from: string; to: string };
  let retail: number;
  let note: string;

  if (weekArg) {
    // ── Manual rerun ────────────────────────────────────────────────────────
    if (retailArg === null) {
      throw new Error("--week requires --retail AMOUNT (e.g. --retail 67083)");
    }
    const to = new Date(new Date(weekArg + "T00:00:00Z").getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
    lastWeek = { from: weekArg, to };
    retail = retailArg;
    note = `manual retail=${retail}`;
    console.log(`⚙️  Ручной запуск: неделя ${weekArg}, розница ${retail} ฿`);
  } else {
    // ── Automated Sunday run ─────────────────────────────────────────────────
    if (dayOfWeek !== 0) {
      console.log(`⚠️  Сегодня не воскресенье (день ${dayOfWeek}). Запуск принудительно.`);
    }
    lastWeek = weekBounds(0); // Mon–Sun of the just-ended week
    console.log(`📅 Закрытие недели: ${lastWeek.from} — ${lastWeek.to}`);

    console.log("📊 Читаю Розницу из Dashboard (Текущая неделя)...");
    const { retail: dashRetail, b2b, total } = await fetchRetailFromDashboard();
    retail = dashRetail;
    note = `dashboard total=${total} b2b=${b2b}`;
    console.log(`   Итого: ${total} ฿  |  B2B: ${b2b} ฿  |  Розница: ${retail} ฿`);
  }

  console.log(`📅 Неделя: ${lastWeek.from} — ${lastWeek.to}`);
  console.log(`💰 Факт розница: ${retail.toFixed(0)} ฿`);

  // 1. Auth
  console.log("🔑 Авторизация...");
  await gToken();

  // 2. Ensure Закрытие sheet exists
  await ensureClosingsTab();

  // 3. Upsert into Закрытие
  console.log("📝 Записываю в Закрытие...");
  await upsertClosing(lastWeek.from, Math.round(retail), note);

  // 4. Apply formatting to Rolling
  const meta = await gApi("GET", "");
  const rcSheet = (meta.sheets ?? []).find((s: any) => s.properties.title === "Rolling");
  if (rcSheet) {
    await fixFactFormat(rcSheet);
    await highlightClosedWeeks(rcSheet);
  } else {
    console.log("   Rolling not found, skipping format");
  }

  console.log(`\n✅  Готово! Неделя ${lastWeek.from}: факт выручка ${Math.round(retail).toLocaleString()} ฿`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
