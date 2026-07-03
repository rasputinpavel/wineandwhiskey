/**
 * Build 08_config/manager_schedules/YYYY-MM.json from Loyverse daily revenue
 * + a CLI-passed shift map.
 *
 * Why this script exists: manager commission is 1% of *real* B2C revenue from
 * each manager's shift — "за вычетом b2b чеков". For bonus purposes we use the
 * **management** B2B classifier (lib/b2b.ts::classifyReceipt) which marks a
 * receipt B2B if EITHER (a) it was paid by bank transfer, OR (b) the customer
 * name matches B2B_PATTERNS. The strict bookkeeping classifier inside
 * sync_accounting.ts only catches (a) — so a walk-in B2B client paying by card
 * would otherwise inflate the on-shift manager's commission base.
 *
 * Usage:
 *   npm run schedule -- --month 2026-05 \
 *     --som 4,5,8,9,10,11,12,13,20,21,24,25,26,28 \
 *     --grace 1,2,6,7,14,15,16,17,18,19,22,23,27,29,30 \
 *     --half 3:Grace=11-16,Som=16-22 \
 *     --closed 31 \
 *     --closed-reason "Visakha Bucha Day" \
 *     --commission Grace=1,Som=1 \
 *     --fixed Grace=18000,Som=20000
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { classifyReceipt, BANK_TRANSFER_TYPE_ID } from "./lib/b2b.js";

dotenv.config({ path: ".env.local" });
const TOKEN = process.env.LOYVERSE_API_TOKEN;
if (!TOKEN) throw new Error("LOYVERSE_API_TOKEN missing in .env.local");

// ── args ──────────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const MONTH = arg("month");
if (!MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error("usage: --month YYYY-MM --som <days> --grace <days> [--half D:M=H-H,...] [--closed D,D] [--closed-reason X] [--commission M=N,...] [--fixed M=N,...]");
  process.exit(1);
}
const parseDays = (s?: string): number[] =>
  s ? s.split(",").map(x => +x.trim()).filter(Number.isFinite) : [];

interface HalfDay { day: number; shifts: Array<{ manager: string; from: number; to: number }>; }
function parseHalf(s?: string): HalfDay[] {
  if (!s) return [];
  return s.split("|").map(rule => {
    const [dayPart, ...shiftParts] = rule.split(":");
    const day = +dayPart;
    const shifts = shiftParts.join(":").split(",").map(p => {
      const m = p.match(/^(\w+)=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
      if (!m) throw new Error(`bad --half segment: ${p}`);
      return { manager: m[1], from: +m[2], to: +m[3] };
    });
    return { day, shifts };
  });
}
function parseKV(s?: string): Record<string, number> {
  if (!s) return {};
  return Object.fromEntries(s.split(",").map(p => {
    const [k, v] = p.split("=");
    return [k.trim(), +v];
  }));
}

const somDays   = parseDays(arg("som"));
const graceDays = parseDays(arg("grace"));
const halfDays  = parseHalf(arg("half"));
const closedDays = parseDays(arg("closed"));
const closedReason = arg("closed-reason") ?? "";
const commissions = parseKV(arg("commission"));
const fixed = parseKV(arg("fixed"));

const managers = Array.from(new Set([
  ...somDays.length ? ["Som"] : [],
  ...graceDays.length ? ["Grace"] : [],
  ...halfDays.flatMap(h => h.shifts.map(s => s.manager)),
])).sort();

// ── fetch ─────────────────────────────────────────────────────────────────
async function loy(path: string, key: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`Loyverse ${r.status}`);
    const d = await r.json();
    out.push(...(d[key] ?? []));
    cursor = d.cursor;
  } while (cursor);
  return out;
}

async function fetchCustomerNames(ids: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of ids) {
    try {
      const r = await fetch(`https://api.loyverse.com/v1.0/customers/${id}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (r.ok) {
        const d = await r.json();
        out.set(id, d.name ?? "");
      }
    } catch {}
  }
  return out;
}

function bkkParts(iso: string): { date: string; hour: number } {
  const shifted = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

async function main() {
  const fromUtc = new Date(`${MONTH}-01T00:00:00+07:00`).toISOString();
  const toUtc   = new Date(`${MONTH}-31T23:59:59+07:00`).toISOString();
  const all = await loy(`/receipts?created_at_min=${fromUtc}&created_at_max=${toUtc}`, "receipts");
  const live = all.filter((r: any) => !r.cancelled_at);
  console.log(`[fetch] ${all.length} total, ${live.length} live (skipped ${all.length - live.length} cancelled)`);

  const ids = new Set<string>();
  for (const r of live) if (r.customer_id) ids.add(r.customer_id);
  const names = await fetchCustomerNames(ids);

  // Per-day B2C (management classifier — bank transfer OR name pattern = B2B, excluded)
  const dailyB2C: Map<string, number> = new Map();
  // Bucket of B2C amounts on each half-day with hour-of-day, used to attribute by shift.
  const halfDayAmounts: Map<number, Array<{ hour: number; amount: number }>> = new Map();
  for (const h of halfDays) halfDayAmounts.set(h.day, []);

  for (const r of live) {
    const customerName = r.customer_id ? (names.get(r.customer_id) ?? "") : "";
    const cls = classifyReceipt({ payments: r.payments, customerName });
    if (cls.isB2B) continue;
    const { date, hour } = bkkParts(r.created_at);
    if (!date.startsWith(MONTH)) continue;
    const sign = r.receipt_type === "REFUND" ? -1 : 1;
    const amt = sign * Number(r.total_money ?? 0);
    dailyB2C.set(date, (dailyB2C.get(date) ?? 0) + amt);
    const dayNum = Number(date.slice(-2));
    if (halfDayAmounts.has(dayNum)) halfDayAmounts.get(dayNum)!.push({ hour, amount: amt });
  }

  // Build per-day attribution
  const days: Record<string, any> = {};
  const assigned = new Set<number>();
  for (const d of somDays) { assigned.add(d);
    const date = `${MONTH}-${String(d).padStart(2, "0")}`;
    const v = Math.round((dailyB2C.get(date) ?? 0) * 100) / 100;
    if (v !== 0) days[date] = { Som: v };
  }
  for (const d of graceDays) { assigned.add(d);
    const date = `${MONTH}-${String(d).padStart(2, "0")}`;
    const v = Math.round((dailyB2C.get(date) ?? 0) * 100) / 100;
    if (v !== 0) days[date] = { Grace: v };
  }
  for (const h of halfDays) {
    assigned.add(h.day);
    const date = `${MONTH}-${String(h.day).padStart(2, "0")}`;
    const entry: any = {};
    for (const sh of h.shifts) {
      const sum = (halfDayAmounts.get(h.day) ?? [])
        .filter(x => x.hour >= sh.from && x.hour < sh.to)
        .reduce((s, x) => s + x.amount, 0);
      const v = Math.round(sum * 100) / 100;
      if (v !== 0) entry[sh.manager] = v;
    }
    const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
    entry._note = `Half day: ${h.shifts.map(s => `${s.manager} ${hhmm(s.from)}–${hhmm(s.to)}`).join(" / ")}`;
    if (Object.keys(entry).length > 1) days[date] = entry;
  }

  const remarks: Record<string, string> = {};
  for (const d of closedDays) {
    remarks[`${MONTH}-${String(d).padStart(2, "0")}`] = closedReason
      ? `Store closed — ${closedReason}`
      : "Store closed";
  }

  // Preserve hand-edited `paid` and `paid_log` across regens — advances are
  // mid-month info the supervisor enters by hand, not derivable from Loyverse.
  const outPathEarly = path.join(process.cwd(), "08_config", "manager_schedules", `${MONTH}.json`);
  let prevPaid: Record<string, number> | undefined;
  let prevPaidLog: unknown;
  if (fs.existsSync(outPathEarly)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPathEarly, "utf-8"));
      prevPaid = prev.paid;
      prevPaidLog = prev.paid_log;
    } catch {}
  }

  const out: any = {
    month: MONTH,
    managers,
    commissions: Object.fromEntries(managers.map(m => [m, commissions[m] ?? 1])),
    fixed: Object.fromEntries(managers.map(m => [m, fixed[m] ?? 0])),
    ...(prevPaid    ? { paid: prevPaid } : {}),
    ...(prevPaidLog ? { paid_log: prevPaidLog } : {}),
    note: "Auto-generated by build_manager_schedule.ts. B2C uses lib/b2b.ts management classifier (bank-transfer OR name in B2B_PATTERNS → B2B, excluded). Half-day split by Bangkok hour.",
    days,
    remarks,
  };

  fs.writeFileSync(outPathEarly, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${outPathEarly}`);

  const totalAttributed = Object.values(days).reduce((s: number, d: any) =>
    s + Object.entries(d).filter(([k]) => k !== "_note").reduce((a, [, v]) => a + (v as number), 0), 0);
  const totalDaily = [...dailyB2C.values()].reduce((s, v) => s + v, 0);
  console.log(`Total B2C (management rule) attributed: ฿${totalAttributed.toFixed(2)}`);
  console.log(`Total daily B2C from Loyverse: ฿${totalDaily.toFixed(2)}`);
  const diff = totalDaily - totalAttributed;
  if (Math.abs(diff) > 0.01) {
    console.log(`⚠ Difference: ฿${diff.toFixed(2)} — sales on days with no manager assigned`);
    for (const [date, v] of dailyB2C) {
      const day = Number(date.slice(-2));
      if (!assigned.has(day) && Math.abs(v) > 0.01) {
        console.log(`  ${date}: ฿${v.toFixed(2)} — no manager assigned`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
