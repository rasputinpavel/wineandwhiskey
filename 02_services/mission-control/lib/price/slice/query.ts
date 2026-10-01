import type { Category, SliceQuery, SliceSort, WineColor } from './types'
import { normalizeGrape } from './grapes'
import { askJson } from './llm'

const COLORS: readonly string[] = ['red', 'white', 'rose', 'orange', 'sparkling']
const CATEGORIES: readonly string[] = ['wine', 'spirits', 'beer', 'other']
const SORTS: readonly string[] = ['price_asc', 'price_desc', 'name']

export const EMPTY_QUERY: SliceQuery = {
  grapes: [], colors: [], countries: [], regions: [], categories: [],
  priceMin: null, priceMax: null, yearMin: null, yearMax: null,
  sort: 'price_asc', text: null,
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim().toLowerCase())
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const cleaned = v.replace(/[^\d.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Приводит что угодно (в том числе ответ модели) к валидному SliceQuery. */
export function coerceSliceQuery(raw: unknown): SliceQuery {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    grapes:     strList(o.grapes).map(normalizeGrape),
    colors:     strList(o.colors).filter((c): c is WineColor => COLORS.includes(c)),
    countries:  strList(o.countries),
    regions:    strList(o.regions),
    categories: strList(o.categories).filter((c): c is Category => CATEGORIES.includes(c)),
    priceMin:   num(o.priceMin),
    priceMax:   num(o.priceMax),
    yearMin:    num(o.yearMin),
    yearMax:    num(o.yearMax),
    sort:       SORTS.includes(String(o.sort)) ? (o.sort as SliceSort) : 'price_asc',
    text:       typeof o.text === 'string' && o.text.trim() !== '' ? o.text.trim() : null,
  }
}

/** Ни одного ограничения — резать нечего, бот просит переформулировать. */
export function isEmptyQuery(q: SliceQuery): boolean {
  return q.grapes.length === 0
    && q.colors.length === 0
    && q.countries.length === 0
    && q.regions.length === 0
    && q.categories.length === 0
    && q.priceMin === null && q.priceMax === null
    && q.yearMin === null && q.yearMax === null
    && q.text === null
}

// ─── Шаг 0: фраза пользователя → фильтр ─────────────────────────────────────

const QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['grapes', 'colors', 'countries', 'regions', 'categories',
             'priceMin', 'priceMax', 'yearMin', 'yearMax', 'sort', 'text'],
  properties: {
    grapes:     { type: 'array', items: { type: 'string' } },
    colors:     { type: 'array', items: { enum: ['red', 'white', 'rose', 'orange', 'sparkling'] } },
    countries:  { type: 'array', items: { type: 'string' } },
    regions:    { type: 'array', items: { type: 'string' } },
    categories: { type: 'array', items: { enum: ['wine', 'spirits', 'beer', 'other'] } },
    priceMin:   { type: ['number', 'null'] },
    priceMax:   { type: ['number', 'null'] },
    yearMin:    { type: ['integer', 'null'] },
    yearMax:    { type: ['integer', 'null'] },
    sort:       { enum: ['price_asc', 'price_desc', 'name'] },
    text:       { type: ['string', 'null'] },
  },
} as const

const QUERY_PROMPT = `Разбери запрос по винному прайс-листу в структурированный фильтр.

Запрос может быть на русском или английском. Правила:
- grapes: сорта винограда ЛАТИНИЦЕЙ в общепринятом написании ("шардоне" → "chardonnay",
  "пино гриджо" → "pinot grigio"). Если сорт не назван — пустой массив.
- countries / regions: как принято писать в прайсах, латиницей ("Италия" → "italy").
- Цены в тайских батах. "до 600" → priceMax 600. "от 500 до 900" → priceMin 500, priceMax 900.
- "игристое" / "sparkling" — это colors: ["sparkling"], а не сорт.
- "вино" → categories ["wine"]; "виски", "крепкое" → ["spirits"].
- sort: "дешёвые сначала" / по умолчанию → "price_asc"; "дорогие сначала" → "price_desc";
  "по алфавиту" → "name".
- text: только те смысловые слова, которые не влезли ни в одно поле (например "organic",
  "магнум"). Если всё разложилось по полям — null.
- Ничего не придумывай: чего в запросе нет, то пустой массив или null.

Верни ТОЛЬКО JSON, без markdown и пояснений:
{"grapes":[],"colors":[],"countries":[],"regions":[],"categories":[],"priceMin":null,"priceMax":null,"yearMin":null,"yearMax":null,"sort":"price_asc","text":null}

Запрос: `

/** Фраза пользователя → валидный SliceQuery. Бросает SliceLlmError при отказе модели. */
export async function parseSliceQuery(text: string): Promise<SliceQuery> {
  const raw = await askJson<unknown>({
    prompt: `${QUERY_PROMPT}${JSON.stringify(text)}`,
    schema: QUERY_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1024,
  })
  return coerceSliceQuery(raw)
}
