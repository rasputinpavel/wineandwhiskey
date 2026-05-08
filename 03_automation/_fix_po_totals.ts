/**
 * One-shot data fix: an old version of scrape_purchase_orders.ts forgot
 * to divide centimes by 100 when extracting the header total from the
 * Loyverse XHR. ~400 historical POs got total_thb that's ≈100× the real
 * value (e.g. PO2198 BB&B header=1,986,348 ฿ vs real items=18,564 ฿).
 *
 * Strategy: where header_total > sum(line_total) × 10, replace header
 * with sum(line_total). Slightly under-states the real total (loses VAT
 * ~7%) but is far better than the 100× over-statement.
 *
 * Usage:
 *   npx tsx 03_automation/_fix_po_totals.ts          # dry-run
 *   npx tsx 03_automation/_fix_po_totals.ts --apply  # actually update
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const dryRun = !process.argv.includes('--apply')

async function main() {
  console.log(dryRun ? '\n[DRY RUN — pass --apply to write]\n' : '\n[APPLYING]\n')

  const pos: any[] = []
  for (let cur = 0; ; cur += 1000) {
    const { data, error } = await sb.from('purchase_orders')
      .select('id, po_number, supplier, order_date, total_thb')
      .range(cur, cur + 999)
    if (error) throw error
    if (!data?.length) break
    pos.push(...data)
    if (data.length < 1000) break
  }
  console.log(`POs loaded: ${pos.length}`)

  const itemsByPo = new Map<number, number>()
  for (let cur = 0; ; cur += 1000) {
    const { data, error } = await sb.from('purchase_order_items')
      .select('po_id, line_total')
      .range(cur, cur + 999)
    if (error) throw error
    if (!data?.length) break
    for (const r of data as any[]) {
      itemsByPo.set(r.po_id, (itemsByPo.get(r.po_id) || 0) + Number(r.line_total || 0))
    }
    if (data.length < 1000) break
  }
  console.log(`POs with at least one line item: ${itemsByPo.size}`)

  const broken: { id: number; po_number: string; supplier: string | null; order_date: string | null; total_thb: number; sum_lines: number }[] = []
  for (const po of pos) {
    const sum = itemsByPo.get(po.id) || 0
    if (sum > 0 && Number(po.total_thb) > sum * 10) {
      broken.push({ ...po, sum_lines: sum })
    }
  }
  console.log(`Broken (header > sum_lines × 10): ${broken.length}\n`)

  console.log('Sample (first 10):')
  for (const b of broken.slice(0, 10)) {
    console.log(
      `  ${b.po_number} ${b.order_date ?? '?'.padEnd(10)}  ` +
      `${(b.supplier ?? '?').slice(0, 28).padEnd(28)}  ` +
      `was=${Number(b.total_thb).toFixed(0).padStart(12)} → new=${b.sum_lines.toFixed(2).padStart(12)}`
    )
  }
  if (broken.length > 10) console.log(`  … and ${broken.length - 10} more`)

  const oldSum = broken.reduce((s, b) => s + Number(b.total_thb), 0)
  const newSum = broken.reduce((s, b) => s + b.sum_lines, 0)
  console.log(`\nOld sum (broken POs only): ฿${oldSum.toLocaleString()}`)
  console.log(`New sum (broken POs only): ฿${newSum.toLocaleString()}`)
  console.log(`Reduction:                 ${(100 * (1 - newSum / oldSum)).toFixed(1)}%`)

  if (dryRun) {
    console.log('\nNo changes written. Re-run with --apply.')
    return
  }

  let written = 0
  for (const b of broken) {
    const { error } = await sb.from('purchase_orders')
      .update({ total_thb: b.sum_lines })
      .eq('id', b.id)
    if (error) {
      console.error(`✗ ${b.po_number}: ${error.message}`)
      break
    }
    written++
    if (written % 50 === 0) process.stdout.write(`  ${written}/${broken.length}\r`)
  }
  console.log(`\nUpdated ${written}/${broken.length} rows.`)
}

main().catch(e => { console.error(e); process.exit(1) })
