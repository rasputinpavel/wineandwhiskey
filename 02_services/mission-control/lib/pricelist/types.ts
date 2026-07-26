// Shared, DB-free types for the price-list builder.

export type PlaqueZone = 'white' | 'red' | 'sparkling' | 'rose' | 'spirits'

// wine_color from inventory.v_sku_breakdown: red|white|rose|sparkling|orange
export type WineColor = 'red' | 'white' | 'rose' | 'sparkling' | 'orange'

export type RowLayout = 'pair' | 'solo-wide'

export type LineItem = {
  id: string                 // client-generated uid, stable within a doc
  code?: string              // loyverse_product_code (inventory items only)
  name: string
  price: number | null       // THB; null = show placeholder
  zone: PlaqueZone           // drives the plaque colour
  grape?: string
  country?: string
  region?: string
  producer?: string
  volume?: string
  imageSlug?: string         // resolves to 04_brand/products/<slug>.png
  imageUrl?: string          // explicit image (CSV/manual); wins over imageSlug
  rowLayout?: RowLayout      // manual override of auto packing
}

export type Grouping =
  | 'producer' | 'type' | 'region' | 'tier' | 'grape' | 'curated' | 'manual'

export type PageSettings = {
  title: string
  grouping: Grouping
  showDividers: boolean             // group heading bands; false = reference look
  tierThresholds: number[]          // e.g. [600, 1000] → three buckets
  oddItemMode: 'solo-wide' | 'tight'
  headerContact: string             // e.g. 'WhatsApp · Irina +66 93 914 0004'
  vatNote: string                   // e.g. '7% VAT NOT INCLUDED'
  cardsPerPage: number              // default 14
}

export type Row =
  | { kind: 'pair'; items: [LineItem, LineItem] }
  | { kind: 'solo-wide'; item: LineItem }
  | { kind: 'divider'; label: string }

export type Page = { rows: Row[] }

export type PriceListDoc = {
  settings: PageSettings
  items: LineItem[]
}
