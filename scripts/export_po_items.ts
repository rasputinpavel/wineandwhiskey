import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SHEET_ID  = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
const supabase  = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

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
  return (await r.json()).access_token as string;
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
  // Fetch all PO items from Supabase with pagination
  const PAGE = 500;
  const allItems: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("purchase_order_items")
      .select("po_number, product_name, sku, qty_ordered, cost_price, line_total, purchase_orders(order_date, supplier, status)")
      .range(from, from + PAGE - 1)
      .order("po_number", { ascending: false });
    if (error) throw new Error(error.message);
    allItems.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Fetched ${allItems.length} items`);

  // Build rows
  const header = ["PO №", "Дата", "Поставщик", "Статус", "Товар", "SKU", "Кол-во", "Цена закупки", "Сумма строки"];
  const rows: any[][] = [header];
  for (const item of allItems) {
    const po = (item.purchase_orders as any) ?? {};
    rows.push([
      item.po_number,
      po.order_date ?? "",
      po.supplier   ?? "",
      po.status     ?? "",
      item.product_name ?? "",
      item.sku          ?? "",
      item.qty_ordered  ?? 0,
      item.cost_price   ?? 0,
      item.line_total   ?? 0,
    ]);
  }

  // Ensure tab exists
  const token = await gToken();
  const meta  = await sheetsReq(token, "GET", "");
  let sheetId: number;
  const existing = (meta.sheets ?? []).find((s: any) => s.properties.title === "PO Items");
  if (existing) {
    sheetId = existing.properties.sheetId;
  } else {
    const res = await sheetsReq(token, "POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title: "PO Items" } } }] });
    sheetId = res.replies[0].addSheet.properties.sheetId;
  }

  // Clear and write
  await sheetsReq(token, "POST", ":batchUpdate", {
    requests: [{ updateCells: { range: { sheetId }, fields: "userEnteredValue" } }],
  });
  await sheetsReq(token, "PUT",
    `/values/${encodeURIComponent("PO Items!A1")}?valueInputOption=RAW`,
    { range: "PO Items!A1", majorDimension: "ROWS", values: rows }
  );

  // Format header + freeze
  const dark = { red: 0.15, green: 0.15, blue: 0.15 };
  const white = { red: 1, green: 1, blue: 1 };
  await sheetsReq(token, "POST", ":batchUpdate", {
    requests: [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: dark, textFormat: { bold: true, foregroundColor: white } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
      { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 9 } } },
    ],
  });

  console.log(`✓ Done. ${rows.length - 1} rows → "PO Items" tab`);
}

main().catch(e => { console.error(e); process.exit(1); });
