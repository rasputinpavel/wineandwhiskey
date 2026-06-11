// ════════════════════════════════════════════════════════════════════════════
// Shared, cached Loyverse receipt history.
//
// Four analytics pages (dashboard, pulse, income, rolling) each used to page
// the full inventory.loyverse_receipt history on every navigation — dozens of
// sequential 1000-row PostgREST round-trips per click, repeated per page. That
// is the dominant cost behind slow page switches.
//
// This module does that paging ONCE and caches the result (next/unstable_cache),
// shared across all four pages and across requests. Receipts are ingested by a
// GitHub Actions cron 3×/day (not from the portal), so a 10-minute time-based
// revalidate is invisible in practice. The aggregation stays in each page's
// pure functions — this only changes WHERE the rows come from, never the maths,
// so Pulse/Dashboard numbers still reconcile to the ruble.
//
// Each page slices this superset to its own window (see RECEIPTS_HISTORY_START)
// before aggregating, preserving its exact previous behaviour.
// ════════════════════════════════════════════════════════════════════════════

import { unstable_cache } from 'next/cache'
import { sbInventory } from './supabase'

// Earliest start any consumer needs — the dashboard's LY×1.25 plan base. Every
// other page starts later and slices this set down, so this is the superset.
export const RECEIPTS_HISTORY_START = '2025-01-01'

// Cache tag — exported so an on-demand revalidation endpoint can be wired to the
// sync cron later (POST /api/.../revalidate → revalidateTag(RECEIPTS_CACHE_TAG)).
export const RECEIPTS_CACHE_TAG = 'loyverse-receipts'

// Superset of every column the four analytics pages read. Extra fields are
// harmless to consumers that expect a narrower Pick<> shape.
export type CachedReceipt = {
  receipt_date: string
  receipt_type: string
  total: number
  cost_total: number
  is_b2b: boolean
  is_bank_transfer: boolean
  payment_method: string | null
}

async function fetchReceiptHistory(): Promise<CachedReceipt[]> {
  const all: CachedReceipt[] = []
  const PAGE = 1000
  // PostgREST caps responses at 1000 rows — page through the full history once.
  for (let from = 0; from < 500000; from += PAGE) {
    const { data, error } = await sbInventory
      .from('loyverse_receipt')
      .select('receipt_date, receipt_type, total, cost_total, is_b2b, is_bank_transfer, payment_method')
      .gte('receipt_date', RECEIPTS_HISTORY_START)
      .order('receipt_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as CachedReceipt[]))
    if (data.length < PAGE) break
  }
  return all
}

// Shared across pages and requests; refreshed at most every 10 minutes. Throws
// on DB error (not cached) — callers keep their try/catch → SchemaError UI.
export const getReceiptHistory = unstable_cache(
  fetchReceiptHistory,
  ['receipt-history-v1'],
  { revalidate: 600, tags: [RECEIPTS_CACHE_TAG] },
)

// Slice the cached superset down to a page's own window. Compares as timestamps
// (receipt_date is timestamptz) so the boundary day matches PostgREST's `gte`
// exactly — string compare could miss it on the 'Z' vs '+00:00' offset.
export function receiptsFrom<T extends { receipt_date: string }>(rows: T[], startIso: string): T[] {
  const t0 = new Date(startIso).getTime()
  return rows.filter(r => new Date(r.receipt_date).getTime() >= t0)
}
