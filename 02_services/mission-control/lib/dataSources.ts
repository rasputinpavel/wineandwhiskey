// Registry of every data source the portal reads from. Powers the
// <DataFreshness> bar (last sync timestamp + manual trigger + help) on
// each module page.
//
// Two flavours:
//   - server-runnable: pure REST, can be triggered from /api/m/sync/<key>
//     and runs to completion inside the Next.js process (Loyverse REST).
//   - laptop-only:     needs Playwright + a persisted browser session
//     (FlowAccount, Loyverse PO list scrape). The UI will show the
//     command to copy and run from the user's machine.

export type SourceKey =
  | 'loyverse_products'   // Loyverse REST → inventory.sku
  | 'loyverse_stock'      // Loyverse REST → inventory.loyverse_stock
  | 'flowaccount_invoices'// Playwright FA  → inventory.flowaccount_invoice[_line]
  | 'flowaccount_receipts'// Playwright FA  → inventory.flowaccount_receipt
  | 'purchase_orders'     // Playwright LV  → public.purchase_orders[_items]

export type DataSource = {
  key: SourceKey
  label: string
  description: string
  command: string                 // CLI command to run from repo root
  runnable: 'server' | 'laptop'   // server = call /api/m/sync/<key>
}

export const SOURCES: Record<SourceKey, DataSource> = {
  loyverse_products: {
    key: 'loyverse_products',
    label: 'Loyverse products',
    description:
      'Каталог SKU из Loyverse POS. Тянется через REST: /v1.0/items + /v1.0/categories. ' +
      'Пишется в inventory.sku (upsert по loyverse_variant_id). Обычно ~30 сек.',
    command: 'npm run inv:loyverse',
    runnable: 'server',
  },
  loyverse_stock: {
    key: 'loyverse_stock',
    label: 'Loyverse stock',
    description:
      'Текущие остатки по каждому SKU и магазину из Loyverse. REST /v1.0/inventory. ' +
      'Перезаписывает inventory.loyverse_stock. Идёт вместе с loyverse_products.',
    command: 'npm run inv:loyverse',
    runnable: 'server',
  },
  flowaccount_invoices: {
    key: 'flowaccount_invoices',
    label: 'FlowAccount inv.',
    description:
      'B2B инвойсы из FlowAccount. У FA нет API для инвойсов — скрейпим UI через Playwright ' +
      'с сохранённой сессией. Поэтому запуск только локально с лэптопа. По умолчанию окно 90 дней; ' +
      'для бэкфилла: FLOW_FROM=2025-01-01 FLOW_TO=2026-12-31 npm run inv:flow.',
    command: 'npm run inv:flow',
    runnable: 'laptop',
  },
  flowaccount_receipts: {
    key: 'flowaccount_receipts',
    label: 'FlowAccount receipts',
    description:
      'B2B оплаты (расписки) из FlowAccount. Тот же скрейп что и invoices — идёт в одном npm run inv:flow.',
    command: 'npm run inv:flow',
    runnable: 'laptop',
  },
  purchase_orders: {
    key: 'purchase_orders',
    label: 'Purchase orders (приходы от поставщиков)',
    description:
      'Purchase Orders из Loyverse Dashboard — то что мы оформили как приход (= наш tax invoice от ' +
      'поставщика). Loyverse REST не даёт PO, поэтому скрейпим Playwright по странице ' +
      '/dashboard/#/inventory/orders. Долго (5–15 мин из-за пагинации).',
    command: 'npm run orders',
    runnable: 'laptop',
  },
}
