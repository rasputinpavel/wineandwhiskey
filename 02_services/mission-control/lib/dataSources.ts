// Registry of every data source the portal reads from. Powers the
// <DataFreshness> bar (last sync timestamp + manual trigger + help) on
// each module page.
//
// Three flavours of `runnable`:
//   - 'web':   fast REST sync, runs inline inside the Next.js process
//              when the user clicks Sync now (Loyverse REST).
//   - 'cron':  Playwright-heavy sync, runs on a GitHub Actions schedule
//              (every 8 hours: 06:30 / 14:30 / 22:30 BKK). The UI just reports
//              when the next run is — no manual trigger needed in
//              normal operation.
//   - 'manual':one-off scripts that nobody runs on a schedule yet.

export type SourceKey =
  | 'loyverse_products'
  | 'loyverse_stock'
  | 'loyverse_receipts'
  | 'flowaccount_invoices'
  | 'flowaccount_receipts'
  | 'purchase_orders'

export type DataSource = {
  key: SourceKey
  label: string
  description: string
  command: string                       // CLI fallback, shown only in advanced view
  runnable: 'web' | 'cron' | 'manual'
  cronEveryHours?: number               // for 'cron' kind, the cadence (used for "next in" hint)
  cronOffsetHourUtc?: number            // first cron of the day in UTC (e.g. 7 = 14:00 BKK)
  cronOffsetMinute?: number             // minute of each cron tick (e.g. 30 → :30)
  workflow?: string                     // GitHub Actions workflow file (for future workflow_dispatch)
}

export const SOURCES: Record<SourceKey, DataSource> = {
  loyverse_products: {
    key: 'loyverse_products',
    label: 'Loyverse products',
    description:
      'Каталог SKU из Loyverse POS. Тянется через REST: /v1.0/items + /v1.0/categories. ' +
      'Пишется в inventory.sku. Обновляется автоматически каждые 8 часов (06:30 / 14:30 / 22:30 BKK), ' +
      'можно дёрнуть руками кнопкой «Sync now» (~30 сек).',
    command: 'npm run inv:loyverse',
    runnable: 'web',
    cronEveryHours: 8,
    cronOffsetHourUtc: 7,
    cronOffsetMinute: 30,
    workflow: 'sync-loyverse.yml',
  },
  loyverse_stock: {
    key: 'loyverse_stock',
    label: 'Loyverse stock',
    description:
      'Текущие остатки по каждому SKU и магазину из Loyverse REST. Идёт одним заходом ' +
      'с loyverse_products. Обновляется автоматически каждые 8 часов (06:30 / 14:30 / 22:30 BKK), ' +
      'можно дёрнуть руками кнопкой «Sync now».',
    command: 'npm run inv:loyverse',
    runnable: 'web',
    cronEveryHours: 8,
    cronOffsetHourUtc: 7,
    cronOffsetMinute: 30,
    workflow: 'sync-loyverse.yml',
  },
  loyverse_receipts: {
    key: 'loyverse_receipts',
    label: 'Loyverse receipts',
    description:
      'B2C-чеки и B2B-чеки из Loyverse POS (Sale + Refund) с детализацией по SKU. ' +
      'Тянется через REST: /v1.0/receipts. Пишется в inventory.loyverse_receipt. ' +
      'Обновляется автоматически 3×/день в 06:30 / 14:30 / 22:30 BKK на GitHub ' +
      'Actions (sync-loyverse-receipts.yml) — последний прогон сразу после закрытия. ' +
      'Это источник строки sales на карточках Income.',
    command: 'npm run inv:receipts',
    runnable: 'cron',
    cronEveryHours: 8,
    cronOffsetHourUtc: 7,    // 07:30 UTC = 14:30 BKK; +8h → 22:30, 06:30
    cronOffsetMinute: 30,
    workflow: 'sync-loyverse-receipts.yml',
  },
  flowaccount_invoices: {
    key: 'flowaccount_invoices',
    label: 'FlowAccount inv.',
    description:
      'B2B инвойсы из FlowAccount. У FA нет API — скрейпим через Playwright. ' +
      'Обновляется автоматически каждые 8 часов (06:30 / 14:30 / 22:30 BKK) на GitHub Actions.',
    command: 'npm run inv:flow',
    runnable: 'cron',
    cronEveryHours: 8,
    cronOffsetHourUtc: 7,
    cronOffsetMinute: 30,
    workflow: 'sync-flowaccount.yml',
  },
  flowaccount_receipts: {
    key: 'flowaccount_receipts',
    label: 'FlowAccount receipts',
    description:
      'B2B оплаты (расписки) из FlowAccount. Идут одним job\'ом с invoices. ' +
      'Обновляется каждые 8 часов (06:30 / 14:30 / 22:30 BKK).',
    command: 'npm run inv:flow',
    runnable: 'cron',
    cronEveryHours: 8,
    cronOffsetHourUtc: 7,
    cronOffsetMinute: 30,
    workflow: 'sync-flowaccount.yml',
  },
  purchase_orders: {
    key: 'purchase_orders',
    label: 'Purchase orders',
    description:
      'Purchase Orders из Loyverse Dashboard (= наши tax invoices от поставщиков). ' +
      'Скрейп через Playwright. Обновляется автоматически каждые 8 часов (06:30 / 14:30 / 22:30 BKK).',
    command: 'npm run orders',
    runnable: 'cron',
    cronEveryHours: 8,
    cronOffsetHourUtc: 7,
    cronOffsetMinute: 30,
    workflow: 'scrape-purchase-orders.yml',
  },
}

// Compute the next cron tick for a source. Returns ms-from-now or null.
// Any source with cronEveryHours has a schedule, regardless of `runnable`
// (e.g. Loyverse is 'web' for the manual button but also runs on a cron).
export function nextCronAt(src: DataSource, now: Date = new Date()): Date | null {
  if (!src.cronEveryHours) return null
  const startUtcHour = src.cronOffsetHourUtc ?? 0
  const min = src.cronOffsetMinute ?? 0
  // Build today's tick list, then find first one in the future.
  const ticks: Date[] = []
  for (let h = startUtcHour; h < 24; h += src.cronEveryHours) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, min, 0, 0))
    ticks.push(d)
  }
  // Tomorrow's first tick as a fallback.
  ticks.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, startUtcHour, min, 0, 0)))
  return ticks.find(t => t.getTime() > now.getTime()) ?? null
}
