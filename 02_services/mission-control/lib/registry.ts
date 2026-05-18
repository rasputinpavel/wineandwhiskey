// Registry of every section/item rendered in the portal sidebar.
// Each item has a `route` — the URL inside the portal that opens it.
// Items come in three flavours:
//   - native:   first-class module living at /m/<slug>/* with its own pages
//   - iframe:   third-party tool embedded via <iframe>; route /m/<slug> renders the embed
//   - external: third-party tool that blocks framing; route /m/<slug> renders an "Open ↗" card

export type SectionKey = 'operations' | 'analytics' | 'brand' | 'marketing' | 'sales' | 'agents' | 'knowledge' | 'tech'
export type ItemStatus = 'live' | 'building' | 'planned'

export type Embed =
  | { kind: 'native' }
  | { kind: 'iframe';   src: string; openHref?: string }
  | { kind: 'external'; href: string; mirrors?: { label: string; href: string }[] }
  | { kind: 'builtin';  component: 'env' | 'placeholder' }

export type Item = {
  slug: string
  name: string
  icon: string
  description: string
  status: ItemStatus
  route: string                  // pathname inside the portal
  embed: Embed
}

export type Section = {
  key: SectionKey
  label: string
  description: string
  items: Item[]
}

// ── Real IDs / URLs found in the codebase ────────────────────────────────
const SHEET_OPS  = '1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY'
const SHEET_WINE = '10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg'
const FOLDER_ACC = '1afS7_bS-IKkBdfOjEHCLz7SRIoW8lD8N'

const REPO        = 'https://github.com/rasputinpavel/wineandwhiskey'
const REPO_SF     = 'https://github.com/rasputinpavel/phuket-sip-reserve'
const STOREFRONT  = 'https://phuket-sip-reserve.lovable.app'
const TRENDWATCH  = 'https://trendwatch-production.up.railway.app'

const sheetEmbed  = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing&rm=embedded&widget=true`
const sheetEdit   = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`
const DRIVE_AUTHUSER = 'info@wine-whiskey.com'
const folderEmbed = (id: string) => `https://drive.google.com/embeddedfolderview?id=${id}&authuser=${encodeURIComponent(DRIVE_AUTHUSER)}#list`
const folderOpen  = (id: string) => `https://drive.google.com/drive/folders/${id}?authuser=${encodeURIComponent(DRIVE_AUTHUSER)}`

const m = (slug: string) => `/m/${slug}`

export const SECTIONS: Section[] = [
  // ═══ OPERATIONS ═══════════════════════════════════════════════════════
  {
    key: 'operations', label: 'Operations',
    description: 'Прайс, склад, B2B/B2C',
    items: [
      {
        slug: 'inventory', name: 'Inventory', icon: '📦', status: 'building',
        description: 'Склад: остатки Loyverse, B2B in-transit, consignment.',
        route: '/m/inventory',
        embed: { kind: 'native' },
      },
      {
        slug: 'customers', name: 'Customers', icon: '👥', status: 'building',
        description: 'B2B клиенты: условия оплаты, обороты по годам, consignment.',
        route: '/m/customers',
        embed: { kind: 'native' },
      },
      {
        slug: 'suppliers', name: 'Suppliers', icon: '🚚', status: 'building',
        description: 'Поставщики: tax invoices vs consignment, обороты, условия.',
        route: '/m/suppliers',
        embed: { kind: 'native' },
      },
      // Purchase Orders живёт под Suppliers (вкладка), не отдельным пунктом сайдбара.
      // Tax Invoices — под Customers (вкладка).
      {
        slug: 'price', name: 'Прайс-листы', icon: '🏷', status: 'live',
        description: 'Управление прайс-листом. Печать, экспорт, public Vivino API.',
        route: m('price'),
        embed: { kind: 'native' },
      },
      {
        slug: 'wine-matrix', name: 'Wine Matrix', icon: '🧮', status: 'planned',
        description: 'Trello-доска: что заказывать, у каких поставщиков, в каком объёме.',
        route: m('wine-matrix'),
        embed: { kind: 'external', href: `${REPO}/tree/main/02_services/matrix-runner` },
      },
    ],
  },

  // ═══ ANALYTICS ════════════════════════════════════════════════════════
  {
    key: 'analytics', label: 'Аналитика',
    description: 'Дашборды, метрики, отчёты',
    items: [
      {
        slug: 'pulse', name: 'Finance Pulse', icon: '❤', status: 'building',
        description: 'Sales, gross profit, B2B AR, supplier AP — single screen reconciled from Loyverse + FlowAccount.',
        route: m('pulse'),
        embed: { kind: 'native' },
      },
      {
        slug: 'dashboard-sheet', name: 'Главный Dashboard', icon: '📊', status: 'live',
        description: 'Cashflow, daily revenue, B2B, поставщики, остатки.',
        route: m('dashboard-sheet'),
        embed: { kind: 'iframe', src: sheetEmbed(SHEET_OPS), openHref: sheetEdit(SHEET_OPS) },
      },
      {
        slug: 'wine-analytics-sheet', name: 'Wine Analytics', icon: '🍇', status: 'live',
        description: 'Bestsellers, B2C margins, channels, segmentation.',
        route: m('wine-analytics-sheet'),
        embed: { kind: 'iframe', src: sheetEmbed(SHEET_WINE), openHref: sheetEdit(SHEET_WINE) },
      },
      {
        slug: 'accounting-folder', name: 'Accounting (Drive)', icon: '📒', status: 'live',
        description: 'Папка с месячными отчётами: Sales · Tax Invoices · Expenses.',
        route: m('accounting-folder'),
        embed: { kind: 'iframe', src: folderEmbed(FOLDER_ACC), openHref: folderOpen(FOLDER_ACC) },
      },
    ],
  },

  // ═══ BRAND & DESIGN ═══════════════════════════════════════════════════
  {
    key: 'brand', label: 'Brand & Design',
    description: 'Identity, design system, finished design',
    items: [
      {
        slug: 'design-system', name: 'Design System', icon: '🎨', status: 'live',
        description: 'Living design system: palette, typography, components, tone of voice.',
        route: m('design-system'),
        embed: { kind: 'native' },
      },
      {
        slug: 'brand-assets', name: 'Brand Assets', icon: '🖼', status: 'live',
        description: 'Logos, business cards, references, backgrounds.',
        route: m('brand-assets'),
        embed: { kind: 'native' },
      },
      {
        slug: 'creative-library', name: 'Creative Library', icon: '🗂', status: 'live',
        description: 'Archive of finished design: posts, price tags, sales kit, reports.',
        route: m('creative-library'),
        embed: { kind: 'native' },
      },
    ],
  },

  // ═══ MARKETING ════════════════════════════════════════════════════════
  {
    key: 'marketing', label: 'Marketing',
    description: 'Витрина, соцсети, реклама',
    items: [
      {
        slug: 'storefront', name: 'Storefront', icon: '🍷', status: 'live',
        description: 'Витрина каталога + бронирование.',
        route: m('storefront'),
        embed: { kind: 'iframe', src: STOREFRONT, openHref: STOREFRONT },
      },
      {
        slug: 'trendwatch', name: 'Trendwatch', icon: '📡', status: 'building',
        description: 'Скан Reels конкурентов, AI-разбор, Runway-бриф для ремейка.',
        route: m('trendwatch'),
        embed: { kind: 'external', href: TRENDWATCH,
          mirrors: [{ label: 'Repo', href: `${REPO}/tree/main/02_services/trendwatch` }] },
      },
      {
        slug: 'social', name: 'Instagram + FB + Maps', icon: '📣', status: 'planned',
        description: 'Единый маркетинг-хаб: посты, ответы на отзывы Maps, метрики каналов.',
        route: m('social'),
        embed: { kind: 'builtin', component: 'placeholder' },
      },
      {
        slug: 'wa-corp', name: 'WhatsApp Business', icon: '💬', status: 'planned',
        description: 'Корпоративный WA для B2B: рассылки, заказы, ответы.',
        route: m('wa-corp'),
        embed: { kind: 'builtin', component: 'placeholder' },
      },
    ],
  },

  // ═══ SALES ════════════════════════════════════════════════════════════
  {
    key: 'sales', label: 'Sales',
    description: 'B2B outreach: leads from Google Maps, pipeline',
    items: [
      {
        slug: 'sales-crm', name: 'B2B Outreach', icon: '🎯', status: 'building',
        description: 'Leads from Apify (Google Places), pipeline from lead to first purchase.',
        route: m('sales'),
        embed: { kind: 'native' },
      },
      {
        slug: 'sales-playbook', name: 'Playbook', icon: '📘', status: 'live',
        description: 'Cold-outreach materials: call script, B2B price list, messenger pitch template.',
        route: m('sales-playbook'),
        embed: { kind: 'native' },
      },
    ],
  },

  // ═══ AGENTS ═══════════════════════════════════════════════════════════
  {
    key: 'agents', label: 'Agents',
    description: 'Telegram-боты: ops, secretary',
    items: [
      {
        slug: 'ops-bot', name: 'Chip & Dale (ops bot)', icon: '🐿', status: 'live',
        description: 'Telegram-бот: продажи, остатки, утренний брифинг 9:30 BKK.',
        route: m('ops-bot'),
        embed: { kind: 'external', href: 'https://t.me/',
          mirrors: [{ label: 'Repo', href: `${REPO}/tree/main/01_agents/bot` }] },
      },
      {
        slug: 'barrymore', name: 'Бэрримор (secretary)', icon: '🎩', status: 'building',
        description: 'Бот-секретарь: задачи, летопись, голосовые. 9:00 / 13:00 / 20:00 BKK.',
        route: m('barrymore'),
        embed: { kind: 'external', href: 'https://t.me/',
          mirrors: [{ label: 'Repo', href: `${REPO}/tree/main/01_agents/barrymore` }] },
      },
    ],
  },

  // ═══ KNOWLEDGE ════════════════════════════════════════════════════════
  {
    key: 'knowledge', label: 'Knowledge',
    description: 'Винная база, документация',
    items: [
      {
        slug: 'wine-library', name: 'Лекции по вину', icon: '🎓', status: 'live',
        description: 'Расшифровки: Бордо, Прованс, Лангедок, Эльзас, Жюра, Корсика.',
        route: m('wine-library'),
        embed: { kind: 'external', href: `${REPO}/tree/main/06_knowledge/Lectures` },
      },
      {
        slug: 'claude-md', name: 'CLAUDE.md', icon: '📜', status: 'live',
        description: 'Структура репозитория и правила работы для AI-агентов.',
        route: m('claude-md'),
        embed: { kind: 'external', href: `${REPO}/blob/main/CLAUDE.md` },
      },
    ],
  },

  // ═══ TECH ═════════════════════════════════════════════════════════════
  {
    key: 'tech', label: 'Техничка',
    description: 'Репозитории, инфраструктура, секреты',
    items: [
      {
        slug: 'github-monorepo', name: 'Monorepo', icon: '📁', status: 'live',
        description: 'GitHub репозиторий: агенты, сервисы, скрипты, документация.',
        route: m('github-monorepo'),
        embed: { kind: 'external', href: REPO },
      },
      {
        slug: 'storefront-repo', name: 'Storefront repo', icon: '🍷', status: 'live',
        description: 'Lovable-проект витрины. Отдельный репо.',
        route: m('storefront-repo'),
        embed: { kind: 'external', href: REPO_SF },
      },
      {
        slug: 'railway', name: 'Railway', icon: '🚆', status: 'live',
        description: 'Хостинг сервисов и ботов. Деплой по push в main.',
        route: m('railway'),
        embed: { kind: 'external', href: 'https://railway.app' },
      },
      {
        slug: 'supabase', name: 'Supabase', icon: '🗄', status: 'live',
        description: 'База и storage. Используется price-service, trendwatch, inventory.',
        route: m('supabase'),
        embed: { kind: 'external', href: 'https://supabase.com/dashboard' },
      },
      {
        slug: 'loyverse', name: 'Loyverse (POS)', icon: '🛒', status: 'live',
        description: 'Розничная POS: продажи, остатки, gross profit. Источник данных №1.',
        route: m('loyverse'),
        embed: { kind: 'external', href: 'https://r.loyverse.com' },
      },
      {
        slug: 'flowaccount', name: 'FlowAccount (B2B)', icon: '🧾', status: 'live',
        description: 'B2B инвойсы и расписки. Скрейпится в Supabase через npm run orders.',
        route: m('flowaccount'),
        embed: { kind: 'external', href: 'https://advance.flowaccount.com' },
      },
      {
        slug: 'env', name: 'Секреты и env', icon: '🔑', status: 'planned',
        description: 'Список всех ENV-переменных по сервисам.',
        route: m('env'),
        embed: { kind: 'builtin', component: 'env' },
      },
    ],
  },
]

// All items, flat — for catch-all route lookup.
export const ITEMS: Item[] = SECTIONS.flatMap(s => s.items)

export const STATUS_LABEL: Record<ItemStatus, string> = {
  live: 'Live', building: 'Building', planned: 'Planned',
}

export function statusDotClasses(s: ItemStatus): string {
  switch (s) {
    case 'live':     return 'bg-wine-red'
    case 'building': return 'bg-amber-gold'
    case 'planned':  return 'bg-pale-stone'
  }
}

export function findItem(slug: string): Item | undefined {
  return ITEMS.find(i => i.slug === slug)
}

export function findSectionForItem(slug: string): Section | undefined {
  return SECTIONS.find(s => s.items.some(i => i.slug === slug))
}

// Default landing — what the portal opens to after login.
export const DEFAULT_ROUTE = '/m/inventory'
