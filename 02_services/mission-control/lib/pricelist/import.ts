import type { LineItem, PlaqueZone } from './types'

const ZONE_SYNONYMS: Record<string, PlaqueZone> = {
  white: 'white', biały: 'white', белое: 'white', белый: 'white', blanc: 'white', orange: 'white',
  red: 'red', красное: 'red', красный: 'red', rouge: 'red',
  sparkling: 'sparkling', игристое: 'sparkling', spumante: 'sparkling', champagne: 'sparkling',
  rose: 'rose', 'rosé': 'rose', розе: 'rose', розовое: 'rose',
  spirit: 'spirits', spirits: 'spirits', whisky: 'spirits', whiskey: 'spirits', vodka: 'spirits',
  крепкое: 'spirits', виски: 'spirits',
}

export function typeToZone(raw: string | undefined | null): PlaqueZone {
  const k = String(raw ?? '').trim().toLowerCase()
  return ZONE_SYNONYMS[k] ?? 'white'
}

// Header aliases → canonical field. Compared lower-cased/trimmed.
const HEADER_ALIASES: Record<string, keyof RawFields> = {
  name: 'name', наименование: 'name', вино: 'name', title: 'name',
  price: 'price', цена: 'price', thb: 'price',
  type: 'type', color: 'type', цвет: 'type', тип: 'type',
  country: 'country', страна: 'country',
  region: 'region', регион: 'region', appellation: 'region',
  grape: 'grape', сорт: 'grape', variety: 'grape',
  producer: 'producer', производитель: 'producer', winery: 'producer',
  volume: 'volume', объем: 'volume', 'объём': 'volume', size: 'volume',
  image: 'image', photo: 'image', url: 'image', фото: 'image',
}

type RawFields = {
  name?: string; price?: string; type?: string; country?: string;
  region?: string; grape?: string; producer?: string; volume?: string; image?: string
}

export type ImportReport = { total: number; missingName: number; missingPrice: number; matchedHeaders: string[] }

function normalizeRow(row: Record<string, unknown>): { fields: RawFields; matched: Set<string> } {
  const fields: RawFields = {}
  const matched = new Set<string>()
  for (const [key, val] of Object.entries(row)) {
    const canon = HEADER_ALIASES[key.trim().toLowerCase()]
    if (canon) { fields[canon] = val == null ? '' : String(val).trim(); matched.add(canon) }
  }
  return { fields, matched }
}

let counter = 0
function uid(): string { counter += 1; return `imp_${counter}_${Math.round(performance.now?.() ?? counter)}` }

export function rowsToLineItems(rows: Record<string, unknown>[]): { items: LineItem[]; report: ImportReport } {
  const items: LineItem[] = []
  const matchedHeaders = new Set<string>()
  let missingName = 0, missingPrice = 0

  for (const raw of rows) {
    const { fields, matched } = normalizeRow(raw)
    matched.forEach(m => matchedHeaders.add(m))
    const name = fields.name ?? ''
    const priceNum = fields.price ? Number(String(fields.price).replace(/[^\d.]/g, '')) : NaN
    if (!name) missingName += 1
    if (!fields.price || Number.isNaN(priceNum)) missingPrice += 1
    items.push({
      id: uid(),
      name,
      price: Number.isNaN(priceNum) ? null : priceNum,
      zone: typeToZone(fields.type),
      country: fields.country || undefined,
      region: fields.region || undefined,
      grape: fields.grape || undefined,
      producer: fields.producer || undefined,
      volume: fields.volume || undefined,
      imageUrl: fields.image || undefined,
    })
  }
  return { items, report: { total: rows.length, missingName, missingPrice, matchedHeaders: [...matchedHeaders] } }
}
