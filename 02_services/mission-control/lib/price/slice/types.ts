import type { ExtractedItem } from '../claude'

export type WineColor = 'red' | 'white' | 'rose' | 'orange' | 'sparkling'
export type Category = 'wine' | 'spirits' | 'beer' | 'other'
export type SliceSort = 'price_asc' | 'price_desc' | 'name'

/** Разобранная фраза пользователя. Пустой массив / null = «ограничения нет». */
export type SliceQuery = {
  grapes: string[]        // канонические названия сортов латиницей
  colors: WineColor[]
  countries: string[]
  regions: string[]
  categories: Category[]
  priceMin: number | null
  priceMax: number | null
  yearMin: number | null
  yearMax: number | null
  sort: SliceSort
  text: string | null     // остаточные слова — ищутся в name/description
}

/** Строка выдачи. `match` отличает слово из прайса от вывода бота. */
export type SliceRow = {
  producer: string | null
  name: string
  region: string | null
  country: string | null
  year: number | null
  price: number | null
  volume: string | null
  match: 'explicit' | 'inferred'
  note: string | null     // 'бленд', 'Chablis', …
}

export type SliceResult = {
  query: SliceQuery
  rows: SliceRow[]
  totalItems: number
  matched: number
  /** Какие шаги не сработали — бот показывает это честно, а не молчит. */
  degraded: string[]
}

export type { ExtractedItem }
