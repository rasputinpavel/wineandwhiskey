/**
 * sync_loyverse_receipts.ts
 *
 * Pulls Loyverse receipts + customers → inventory schema (Supabase).
 * Используется для B2B-аналитики, которая невозможна по FA-invoices одним:
 * клиент может платить картой в магазине без выставления tax invoice.
 *
 * Persists:
 *   • inventory.loyverse_customer     — справочник для UI picker'а
 *   • inventory.loyverse_receipt      — все receipts (SALE + REFUND), кроме
 *                                       отменённых (cancelled_at != null —
 *                                       они выкидываются и удаляются из таблицы)
 *   • inventory.loyverse_receipt_line — детализация по SKU
 *
 * B2B классификация делается через 03_automation/lib/b2b.ts (общий с
 * sync_dashboard, gpt_dna, и пр.):
 *   • payment_type = Bank Transfer → is_b2b=true
 *   • customer name matches B2B_PATTERNS → is_b2b=true
 *
 * Исключение — чеки с b2b_manual=true (миграция 046): их is_b2b/customer_name/
 * b2b_customer_id проставил человек в портале, потому что оба сигнала выше
 * отсутствуют (B2B-продажу пробили без карточки клиента и оплатили QR/налом).
 * Такие чеки НЕ переклассифицируются — иначе правка живёт до ближайшего прогона.
 *
 * Usage:
 *   npm run inv:receipts                        # последние 30 дней
 *   LOYVERSE_FROM=2025-01-01 LOYVERSE_TO=2025-12-31 npm run inv:receipts   # backfill
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { BANK_TRANSFER_TYPE_ID, isB2BCustomerName } from "./lib/b2b.js";
dotenv.config({ path: ".env.local" });

const LOYVERSE_TOKEN = process.env.LOYVERSE_API_TOKEN!;
const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY!;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "inventory" } });
const sbLog = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "inventory" } });

// ─── Helpers ──────────────────────────────────────────────────────────────

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

function defaultWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: iso(from), to: iso(to) };
}

// Classify a receipt's payment method from its payments[] (Loyverse returns
// type + name inline). The dominant (largest-amount) payment wins for split
// payments. Used by mission-control's Income page to route inflows to a wallet:
// cash → Cash register, everything else → company Account.
function classifyPayment(payments: any[] | undefined): "cash" | "card" | "qr" | "transfer" | "other" {
  if (!payments?.length) return "other";
  const top = payments.reduce((a, b) => (Number(b.money_amount ?? 0) > Number(a.money_amount ?? 0) ? b : a));
  const type = String(top.type ?? "").toUpperCase();
  const name = String(top.name ?? "").toLowerCase();
  if (type === "CASH") return "cash";
  if (type.includes("CARD")) return "card";
  if (name.includes("qr")) return "qr";
  if (name.includes("bank") || name.includes("transfer")) return "transfer";
  return "other";
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const REQUEST_TIMEOUT_MS = 25_000; // per-request hard cap — без него зависший сокет вешает всю джобу до 15-мин GitHub cap

// Loyverse изредка отдаёт пустое/битое тело при 2xx, транзиентный 429/5xx, 202
// (троттлинг IP раннеров) — или вовсе подвисает на ответе. Ретраим с
// экспоненциальным бэкоффом + per-request таймаут, иначе одна осечка валит прогон.
async function loyverseGet(url: string): Promise<any> {
  const MAX = 5;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` }, signal: ctrl.signal });
      const body = await r.text();
      // 202 = Loyverse троттлит IP раннера (отдаёт Accepted без данных) — транзиентно, ретраим
      if (r.status === 202) throw new Error("Loyverse 202 (throttled) — retrying");
      if (!r.ok) {
        const err = new Error(`Loyverse ${r.status}: ${body.slice(0, 200)}`);
        // 429/5xx — транзиентные, ретраим; 4xx (кроме 429) — фатально, не повторяем
        if (r.status !== 429 && r.status < 500) throw Object.assign(err, { fatal: true });
        throw err;
      }
      if (!body.trim()) throw new Error("Loyverse вернул пустое тело при 2xx");
      return JSON.parse(body);
    } catch (e) {
      lastErr = (e as any)?.name === "AbortError"
        ? new Error(`Loyverse request timed out after ${REQUEST_TIMEOUT_MS}ms`)
        : e;
      if ((e as any)?.fatal || attempt === MAX) break;
      const wait = 500 * 2 ** (attempt - 1); // 0.5s, 1s, 2s, 4s
      console.warn(`[receipts]   retry ${attempt}/${MAX - 1} after error: ${String((lastErr as any)?.message ?? lastErr)} (wait ${wait}ms)`);
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const d = await loyverseGet(url);
    out.push(...(d[key] ?? []));
    cursor = d.cursor;
  } while (cursor);
  return out;
}

async function logStart(source: string): Promise<string> {
  const { data } = await sbLog.from("sync_log")
    .insert({ source, started_at: new Date().toISOString(), ok: null })
    .select("id").single();
  return (data?.id ?? "") as string;
}

async function logFinish(runId: string, ok: boolean, error: string | null, rowsIn: number, rowsOut: number) {
  await sbLog.from("sync_log").update({
    finished_at: new Date().toISOString(), ok, error, rows_in: rowsIn, rows_out: rowsOut,
  }).eq("id", runId);
}

// ─── Sync customers ───────────────────────────────────────────────────────

async function syncCustomers() {
  const runId = await logStart("loyverse_customers" as any);
  let rowsIn = 0, rowsOut = 0;
  try {
    const customers = await loyverseFetch<any>("/customers", "customers");
    rowsIn = customers.length;
    console.log(`[receipts] ${rowsIn} customers from Loyverse`);

    // Upsert батчами по 200
    for (let i = 0; i < customers.length; i += 200) {
      const batch = customers.slice(i, i + 200).map(c => ({
        id:          c.id,
        name:        c.name ?? "",
        email:       c.email ?? null,
        phone:       c.phone_number ?? null,
        total_spent: Number(c.total_spent ?? 0),
        scraped_at:  new Date().toISOString(),
      }));
      const { error } = await sb.from("loyverse_customer").upsert(batch, { onConflict: "id" });
      if (error) throw new Error(`customers upsert: ${error.message}`);
      rowsOut += batch.length;
    }
    await logFinish(runId, true, null, rowsIn, rowsOut);
  } catch (e: any) {
    await logFinish(runId, false, String(e?.message ?? e), rowsIn, rowsOut);
    throw e;
  }
}

// ─── Sync receipts ────────────────────────────────────────────────────────

async function syncReceipts(fromIso: string, toIso: string) {
  const runId = await logStart("loyverse_receipts" as any);
  let rowsIn = 0, rowsOut = 0;
  try {
    // Pull receipts (BOTH SALE и REFUND — для корректного refund-учёта)
    const url = `/receipts?created_at_min=${new Date(fromIso + "T00:00:00Z").toISOString()}&created_at_max=${new Date(toIso + "T23:59:59Z").toISOString()}`;
    const receipts = await loyverseFetch<any>(url, "receipts");
    rowsIn = receipts.length;
    console.log(`[receipts] ${rowsIn} receipts in window ${fromIso} → ${toIso}`);

    // Подгружаем имена клиентов один раз — для B2B-классификации (по name)
    const { data: lvCustomers } = await sb.from("loyverse_customer").select("id, name");
    const nameById = new Map<string, string>((lvCustomers ?? []).map(c => [c.id as string, (c.name ?? "") as string]));

    // Upsert receipt'ы и линии. Замешиваем в одном цикле.
    for (let i = 0; i < receipts.length; i += 100) {
      const rawBatch = receipts.slice(i, i + 100);

      // Отменённые чеки (cancelled_at != null) не являются продажей — выкидываем
      // их из выручки и удаляем, если они уже лежат в таблице (cascade снесёт линии).
      const cancelledNums = rawBatch.filter(r => r.cancelled_at).map(r => r.receipt_number);
      const batch = rawBatch.filter(r => !r.cancelled_at);
      if (cancelledNums.length) {
        const { error: delErr } = await sb.from("loyverse_receipt").delete().in("receipt_number", cancelledNums);
        if (delErr) throw new Error(`cancelled purge: ${delErr.message}`);
        console.log(`[receipts]   purged ${cancelledNums.length} cancelled receipt(s)`);
      }
      if (batch.length === 0) continue;

      // Receipts a human has ruled on (migration 046). is_b2b is derived from
      // signals a till operator can forget to record — no customer card, paid by
      // cash/card/QR — so a B2B sale can look exactly like a walk-in. When
      // someone corrects that in the portal we must NOT re-derive it here, or
      // the correction dies at the next run (three times a day). Carry over the
      // stored decision instead; the portal's ✕ clears b2b_manual and hands the
      // receipt back to the classifier.
      const manualByNumber = new Map<string, { is_b2b: boolean; customer_name: string | null; b2b_customer_id: string | null }>();
      let manualAvailable = true;
      {
        const { data: manual, error: mErr } = await sb
          .from("loyverse_receipt")
          .select("receipt_number, is_b2b, customer_name, b2b_customer_id")
          .in("receipt_number", batch.map(r => r.receipt_number))
          .eq("b2b_manual", true);
        // Column missing = migration 046 not applied yet. No manual rows can
        // exist in that case, so there is nothing to preserve — warn and carry
        // on rather than stopping the whole receipt sync over deploy ordering.
        if (mErr && (mErr as any).code !== "42703") throw new Error(`manual overrides: ${mErr.message}`);
        if (mErr) { manualAvailable = false; console.warn(`[receipts]   b2b_manual not available yet (migration 046 pending) — skipping manual carry-over`); }
        for (const m of manual ?? []) {
          manualByNumber.set(m.receipt_number as string, {
            is_b2b:          !!m.is_b2b,
            customer_name:   (m.customer_name ?? null) as string | null,
            b2b_customer_id: (m.b2b_customer_id ?? null) as string | null,
          });
        }
      }

      const receiptRows = batch.map(r => {
        const cName = r.customer_id ? (nameById.get(r.customer_id) ?? "") : "";
        const isBankTransfer = (r.payments ?? []).some((p: any) => p.payment_type_id === BANK_TRANSFER_TYPE_ID);
        const costTotal = (r.line_items ?? []).reduce((s: number, l: any) => s + Number(l.cost_total ?? 0), 0);
        // is_bank_transfer stays derived either way — it is a fact about the
        // payments, not a judgement call. Only the classification is human-owned.
        const manual = manualByNumber.get(r.receipt_number);
        const isB2B = manual ? manual.is_b2b : isBankTransfer || (!!cName && isB2BCustomerName(cName));
        return {
          receipt_number:      r.receipt_number,
          loyverse_receipt_id: r.id ?? null,
          receipt_date:        r.receipt_date,
          receipt_type:        r.receipt_type ?? "SALE",
          store:               r.store_id ?? null,
          customer_id:         r.customer_id ?? null,
          customer_name:       manual ? manual.customer_name : (cName || null),
          total:               Number(r.total_money ?? 0),
          cost_total:          costTotal,
          is_b2b:              isB2B,
          is_bank_transfer:    isBankTransfer,
          ...(manualAvailable ? { b2b_manual: !!manual, b2b_customer_id: manual?.b2b_customer_id ?? null } : {}),
          payment_method:      classifyPayment(r.payments),
          scraped_at:          new Date().toISOString(),
        };
      });

      const { data: upserted, error: rErr } = await sb
        .from("loyverse_receipt")
        .upsert(receiptRows, { onConflict: "receipt_number" })
        .select("id, receipt_number");
      if (rErr) throw new Error(`receipts upsert: ${rErr.message}`);
      rowsOut += receiptRows.length;

      // Lines: drop existing + insert (idempotent)
      const idByNumber = new Map<string, string>((upserted ?? []).map((r: any) => [r.receipt_number as string, r.id as string]));
      const lineRows: any[] = [];
      for (const r of batch) {
        const receiptDbId = idByNumber.get(r.receipt_number);
        if (!receiptDbId) continue;
        for (const l of (r.line_items ?? [])) {
          lineRows.push({
            receipt_id:   receiptDbId,
            sku:          l.sku ?? null,
            product_name: l.item_name ?? null,
            qty:          Number(l.quantity ?? 0),
            price:        Number(l.price ?? 0),
            cost:         Number(l.cost ?? 0),
            line_total:   Number(l.total_money ?? 0),
            scraped_at:   new Date().toISOString(),
          });
        }
      }
      if (lineRows.length) {
        // Очищаем старые линии для этих receipt'ов перед вставкой
        const receiptIds = Array.from(idByNumber.values());
        await sb.from("loyverse_receipt_line").delete().in("receipt_id", receiptIds);
        const { error: lErr } = await sb.from("loyverse_receipt_line").insert(lineRows);
        if (lErr) throw new Error(`lines insert: ${lErr.message}`);
      }
      console.log(`[receipts]   batch ${i + 1}-${i + batch.length} of ${receipts.length} — ${lineRows.length} lines`);
    }
    await logFinish(runId, true, null, rowsIn, rowsOut);
  } catch (e: any) {
    await logFinish(runId, false, String(e?.message ?? e), rowsIn, rowsOut);
    throw e;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const { from, to } = defaultWindow();
  const fromIso = process.env.LOYVERSE_FROM || from;
  const toIso   = process.env.LOYVERSE_TO   || to;
  console.log(`[receipts] window ${fromIso} → ${toIso}`);

  console.log("[receipts] step 1: customers ...");
  await syncCustomers();
  console.log("[receipts] step 2: receipts ...");
  await syncReceipts(fromIso, toIso);
  console.log("[receipts] done");
}

main().catch(e => { console.error(e); process.exit(1); });
