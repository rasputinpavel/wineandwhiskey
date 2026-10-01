# Price Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кинуть прайс поставщика боту «Чип и Дейл» с фразой «все шардоне» и получить в чате список плюс CSV с колонками производитель / название / регион / год / цена — без записи в базу.

**Architecture:** Бот — тонкий клиент: качает файл из телеграма и шлёт его в `mission-control` на `POST /api/public/price/slice`. Портал переиспользует существующий `extractFromFile()` (19 парсеров поставщиков + Claude-фоллбэк), затем режет позиции в три шага: детерминированный фильтр по полям → LLM-добор по апелласьону → LLM-раскол «производитель / название». Разобранные позиции бот держит в памяти 30 минут, поэтому доуточнение («только Францию») идёт на `/refine` без повторного парсинга файла.

**Tech Stack:** TypeScript. Портал — Next.js 15 App Router, `@anthropic-ai/sdk` 0.96, vitest. Бот — grammY, tsx, vitest. Спека: [`docs/superpowers/specs/2026-10-01-price-slice-design.md`](../specs/2026-10-01-price-slice-design.md).

**Ветка:** `feat/price-slice` (уже создана от `origin/main`).

---

## Контекст, который сэкономит время

Прочитай перед началом:

- [`02_services/mission-control/lib/price/extract.ts`](../../../02_services/mission-control/lib/price/extract.ts) — `extractFromFile(buffer, filename, mimeType)` и `detectFileType()`. Функция чистая, в базу не пишет.
- [`02_services/mission-control/lib/price/claude.ts`](../../../02_services/mission-control/lib/price/claude.ts) — тип `ExtractedItem` (его мы режем) и `ExtractionResult`.
- [`02_services/mission-control/app/api/public/payables-alerts/route.ts`](../../../02_services/mission-control/app/api/public/payables-alerts/route.ts) — образец авторизации публичной ручки для бота.
- [`01_agents/bot/src/expenses.ts`](../../../01_agents/bot/src/expenses.ts) — `downloadTelegramFile(token, fileId, mimeHint)` возвращает `{ base64, mimeType }`.
- [`01_agents/bot/src/index.ts`](../../../01_agents/bot/src/index.ts) — `reportFailure()`, хендлеры `message:document` (PO-сканы) и `message:photo` (расходы). Туда вклиниваемся.

Три факта, на которых держится код ниже:

1. `ExtractedItem` **не содержит производителя** — в прайсах он слит с названием. Отсюда LLM-шаг раскола.
2. Установленный в портале SDK 0.96.0 поддерживает `output_config: { effort, format }` (structured outputs), но **не** поддерживает параметр `fallbacks`. Поэтому отказ модели ловим по `stop_reason === 'refusal'` и деградируем.
3. Тип `Model` в SDK — открытый (`... | (string & {})`), поэтому строка `'claude-opus-5'` проходит типизацию, хотя в енуме этой версии её нет.

---

### Task 1: Типы среза и словарь сортов

**Files:**
- Create: `02_services/mission-control/lib/price/slice/types.ts`
- Create: `02_services/mission-control/lib/price/slice/grapes.ts`
- Test: `02_services/mission-control/lib/price/slice/grapes.test.ts`

- [ ] **Step 1: Создать типы**

Создай `02_services/mission-control/lib/price/slice/types.ts`:

```ts
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
```

- [ ] **Step 2: Написать падающий тест на словарь сортов**

Создай `02_services/mission-control/lib/price/slice/grapes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fold, normalizeGrape, grapeNeedles, countKnownGrapes } from './grapes'

describe('fold', () => {
  it('убирает диакритику и регистр', () => {
    expect(fold('Albariño')).toBe('albarino')
    expect(fold('  Gewürztraminer  ')).toBe('gewurztraminer')
  })
  it('сжимает пробелы', () => {
    expect(fold('Pinot   Grigio')).toBe('pinot grigio')
  })
})

describe('normalizeGrape', () => {
  it('сводит синонимы к канону', () => {
    expect(normalizeGrape('Pinot Grigio')).toBe('pinot gris')
    expect(normalizeGrape('Shiraz')).toBe('syrah')
    expect(normalizeGrape('Primitivo')).toBe('zinfandel')
  })
  it('незнакомый сорт оставляет как есть', () => {
    expect(normalizeGrape('Saperavi')).toBe('saperavi')
  })
})

describe('grapeNeedles', () => {
  it('отдаёт все синонимы канона', () => {
    expect(grapeNeedles('pinot gris')).toContain('pinot grigio')
  })
  it('для незнакомого сорта — он сам', () => {
    expect(grapeNeedles('saperavi')).toEqual(['saperavi'])
  })
})

describe('countKnownGrapes', () => {
  it('моносорт — один', () => {
    expect(countKnownGrapes('Chardonnay')).toBe(1)
  })
  it('бленд — больше одного', () => {
    expect(countKnownGrapes('Chardonnay-Semillon')).toBe(2)
  })
  it('Cabernet Franc не засчитывается как Cabernet Sauvignon', () => {
    expect(countKnownGrapes('Cabernet Franc')).toBe(1)
  })
  it('пусто — ноль', () => {
    expect(countKnownGrapes(null)).toBe(0)
  })
})
```

- [ ] **Step 3: Запустить тест — должен упасть**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/grapes.test.ts
```

Ожидается: FAIL — `Failed to resolve import "./grapes"`.

- [ ] **Step 4: Реализовать словарь**

Создай `02_services/mission-control/lib/price/slice/grapes.ts`:

```ts
// Словарь сортов для среза прайса. Намеренно маленький и расширяемый одной
// строкой: тут только то, что реально встречается в прайсах наших поставщиков.
//
// ВАЖНО про псевдонимы: они проверяются подстрокой, поэтому слишком короткий
// псевдоним ломает подсчёт блендов. Например, alias 'cabernet' у cabernet
// sauvignon засчитал бы «Cabernet Franc» как два сорта и пометил моносорт
// блендом. Поэтому псевдонимы держим полными.
export const GRAPE_SYNONYMS: Record<string, string[]> = {
  chardonnay:           ['chardonnay'],
  'sauvignon blanc':    ['sauvignon blanc'],
  'pinot gris':         ['pinot gris', 'pinot grigio', 'grauburgunder'],
  'pinot blanc':        ['pinot blanc', 'weissburgunder'],
  'pinot noir':         ['pinot noir', 'spatburgunder', 'blauburgunder'],
  riesling:             ['riesling'],
  'cabernet sauvignon': ['cabernet sauvignon'],
  'cabernet franc':     ['cabernet franc'],
  merlot:               ['merlot'],
  syrah:                ['syrah', 'shiraz'],
  malbec:               ['malbec'],
  tempranillo:          ['tempranillo', 'tinta roriz'],
  garnacha:             ['garnacha', 'grenache', 'cannonau'],
  sangiovese:           ['sangiovese', 'brunello', 'nielluccio'],
  nebbiolo:             ['nebbiolo', 'spanna'],
  barbera:              ['barbera'],
  montepulciano:        ['montepulciano'],
  corvina:              ['corvina'],
  aglianico:            ['aglianico'],
  zinfandel:            ['zinfandel', 'primitivo'],
  carmenere:            ['carmenere'],
  mourvedre:            ['mourvedre', 'monastrell'],
  'petit verdot':       ['petit verdot'],
  carignan:             ['carignan'],
  semillon:             ['semillon'],
  viognier:             ['viognier'],
  'chenin blanc':       ['chenin blanc'],
  gewurztraminer:       ['gewurztraminer', 'traminer'],
  'gruner veltliner':   ['gruner veltliner', 'gruner'],
  albarino:             ['albarino', 'alvarinho'],
  verdejo:              ['verdejo'],
  verdicchio:           ['verdicchio'],
  vermentino:           ['vermentino'],
  glera:                ['glera', 'prosecco'],
  muscat:               ['muscat', 'moscato', 'muskat'],
  trebbiano:            ['trebbiano', 'ugni blanc'],
  torrontes:            ['torrontes'],
  saperavi:             ['saperavi'],
  rkatsiteli:           ['rkatsiteli'],
}

/** Нормализация для сравнения: без диакритики, в нижнем регистре, одиночные пробелы. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Любой псевдоним → канон. Незнакомое возвращаем свёрнутым, но как есть. */
export function normalizeGrape(raw: string): string {
  const s = fold(raw)
  for (const [canon, aliases] of Object.entries(GRAPE_SYNONYMS)) {
    if (aliases.some((a) => fold(a) === s)) return canon
  }
  return s
}

/** Что искать в тексте прайса для данного канона. */
export function grapeNeedles(canon: string): string[] {
  return GRAPE_SYNONYMS[canon] ?? [canon]
}

/** Сколько РАЗНЫХ известных сортов упомянуто. >1 — признак бленда. */
export function countKnownGrapes(text: string | null): number {
  if (!text) return 0
  const h = fold(text)
  let n = 0
  for (const aliases of Object.values(GRAPE_SYNONYMS)) {
    if (aliases.some((a) => h.includes(fold(a)))) n += 1
  }
  return n
}
```

- [ ] **Step 5: Запустить тест — должен пройти**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/grapes.test.ts
```

Ожидается: PASS, 10 тестов.

- [ ] **Step 6: Коммит**

```bash
git add 02_services/mission-control/lib/price/slice/
git commit -m "прайс-срез: типы и словарь сортов

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Валидация разобранного запроса (`coerceSliceQuery`)

Модель возвращает JSON, которому нельзя верить. Вся чистка — в одной функции, её же покрываем тестами.

**Files:**
- Create: `02_services/mission-control/lib/price/slice/query.ts`
- Test: `02_services/mission-control/lib/price/slice/query.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `02_services/mission-control/lib/price/slice/query.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { coerceSliceQuery, isEmptyQuery, EMPTY_QUERY } from './query'

describe('coerceSliceQuery', () => {
  it('нормализует сорта к канону', () => {
    const q = coerceSliceQuery({ grapes: ['Pinot Grigio', ' chardonnay '] })
    expect(q.grapes).toEqual(['pinot gris', 'chardonnay'])
  })

  it('отбрасывает неизвестные цвета и категории', () => {
    const q = coerceSliceQuery({ colors: ['white', 'purple'], categories: ['wine', 'cheese'] })
    expect(q.colors).toEqual(['white'])
    expect(q.categories).toEqual(['wine'])
  })

  it('числа принимает строками с мусором', () => {
    const q = coerceSliceQuery({ priceMax: '฿600', yearMin: '2020' })
    expect(q.priceMax).toBe(600)
    expect(q.yearMin).toBe(2020)
  })

  it('нечисловое в цене даёт null', () => {
    expect(coerceSliceQuery({ priceMax: 'дорого' }).priceMax).toBeNull()
  })

  it('сортировка по умолчанию — от дешёвых', () => {
    expect(coerceSliceQuery({}).sort).toBe('price_asc')
    expect(coerceSliceQuery({ sort: 'что-то' }).sort).toBe('price_asc')
    expect(coerceSliceQuery({ sort: 'price_desc' }).sort).toBe('price_desc')
  })

  it('мусор вместо объекта не роняет', () => {
    expect(coerceSliceQuery(null)).toEqual(EMPTY_QUERY)
    expect(coerceSliceQuery('привет')).toEqual(EMPTY_QUERY)
  })

  it('пустой text становится null', () => {
    expect(coerceSliceQuery({ text: '   ' }).text).toBeNull()
  })
})

describe('isEmptyQuery', () => {
  it('запрос без единого ограничения — пустой', () => {
    expect(isEmptyQuery(coerceSliceQuery({ sort: 'price_desc' }))).toBe(true)
  })
  it('запрос с сортом — не пустой', () => {
    expect(isEmptyQuery(coerceSliceQuery({ grapes: ['chardonnay'] }))).toBe(false)
  })
  it('запрос только с ценой — не пустой', () => {
    expect(isEmptyQuery(coerceSliceQuery({ priceMax: 600 }))).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить тест — должен упасть**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/query.test.ts
```

Ожидается: FAIL — `Failed to resolve import "./query"`.

- [ ] **Step 3: Реализовать**

Создай `02_services/mission-control/lib/price/slice/query.ts`:

```ts
import type { Category, SliceQuery, SliceSort, WineColor } from './types'
import { normalizeGrape } from './grapes'

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
```

- [ ] **Step 4: Запустить тест — должен пройти**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/query.test.ts
```

Ожидается: PASS, 10 тестов.

- [ ] **Step 5: Коммит**

```bash
git add 02_services/mission-control/lib/price/slice/
git commit -m "прайс-срез: валидация разобранного запроса

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Детерминированный фильтр (шаг 1)

Самая важная часть: именно она даёт точные цены и честную пометку `explicit`.

**Files:**
- Create: `02_services/mission-control/lib/price/slice/filter.ts`
- Test: `02_services/mission-control/lib/price/slice/filter.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `02_services/mission-control/lib/price/slice/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applySliceFilter, sortRows } from './filter'
import { coerceSliceQuery } from './query'
import type { ExtractedItem, SliceRow } from './types'

function item(over: Partial<ExtractedItem>): ExtractedItem {
  return {
    name: 'Wine', country: null, region: null, grape_variety: null,
    price: null, year: null, volume: null, description: null,
    category: 'wine', wine_type: null,
    ...over,
  }
}

const CHARD = coerceSliceQuery({ grapes: ['chardonnay'] })

describe('applySliceFilter — сорт', () => {
  it('ловит сорт в grape_variety', () => {
    const { explicit } = applySliceFilter([item({ name: 'Mâcon', grape_variety: 'Chardonnay' })], CHARD)
    expect(explicit).toHaveLength(1)
    expect(explicit[0].match).toBe('explicit')
    expect(explicit[0].note).toBeNull()
  })

  it('ловит сорт прямо в названии', () => {
    const { explicit } = applySliceFilter([item({ name: 'Louis Jadot Bourgogne Chardonnay' })], CHARD)
    expect(explicit).toHaveLength(1)
  })

  it('понимает синоним (Pinot Grigio → pinot gris)', () => {
    const q = coerceSliceQuery({ grapes: ['Pinot Gris'] })
    const { explicit } = applySliceFilter([item({ name: 'Santa Margherita Pinot Grigio' })], q)
    expect(explicit).toHaveLength(1)
  })

  it('бленд помечает, но не выбрасывает', () => {
    const { explicit } = applySliceFilter(
      [item({ name: 'Hardys', grape_variety: 'Chardonnay-Semillon' })], CHARD)
    expect(explicit).toHaveLength(1)
    expect(explicit[0].note).toBe('бленд')
  })

  it('не-шардоне уходит в кандидаты на добор', () => {
    const { explicit, candidates } = applySliceFilter(
      [item({ name: 'Domaine Laroche Chablis', region: 'Chablis' })], CHARD)
    expect(explicit).toHaveLength(0)
    expect(candidates).toHaveLength(1)
  })

  it('в кандидаты попадает только вино, не крепкое', () => {
    const { candidates } = applySliceFilter(
      [item({ name: 'Grants Whisky', category: 'spirits' })], CHARD)
    expect(candidates).toHaveLength(0)
  })

  it('пустой список сортов пропускает всё', () => {
    const q = coerceSliceQuery({ priceMax: 1000 })
    const { explicit } = applySliceFilter([item({ name: 'Whatever', price: 500 })], q)
    expect(explicit).toHaveLength(1)
  })
})

describe('applySliceFilter — прочие ограничения', () => {
  it('режет по верхней цене', () => {
    const q = coerceSliceQuery({ grapes: ['chardonnay'], priceMax: 600 })
    const items = [
      item({ name: 'A Chardonnay', price: 500 }),
      item({ name: 'B Chardonnay', price: 900 }),
    ]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['A Chardonnay'])
  })

  it('позиция без цены не проходит ценовое ограничение', () => {
    const q = coerceSliceQuery({ grapes: ['chardonnay'], priceMax: 600 })
    expect(applySliceFilter([item({ name: 'A Chardonnay', price: null })], q).explicit).toHaveLength(0)
  })

  it('режет по стране без учёта регистра', () => {
    const q = coerceSliceQuery({ countries: ['france'] })
    const items = [item({ name: 'A', country: 'FRANCE' }), item({ name: 'B', country: 'Italy' })]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['A'])
  })

  it('режет по цвету', () => {
    const q = coerceSliceQuery({ colors: ['white'] })
    const items = [
      item({ name: 'W', wine_type: 'white' }),
      item({ name: 'R', wine_type: 'red' }),
    ]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['W'])
  })

  it('режет по году', () => {
    const q = coerceSliceQuery({ yearMin: 2021 })
    const items = [item({ name: 'New', year: 2022 }), item({ name: 'Old', year: 2018 })]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['New'])
  })

  it('свободный текст ищет в названии и описании', () => {
    const q = coerceSliceQuery({ text: 'organic' })
    const items = [
      item({ name: 'A', description: 'Certified organic' }),
      item({ name: 'B', description: 'Classic' }),
    ]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['A'])
  })

  it('регион ищется и по стране (прайсы путают поля)', () => {
    const q = coerceSliceQuery({ regions: ['bourgogne'] })
    const items = [item({ name: 'A', country: 'France Bourgogne' }), item({ name: 'B', country: 'Italy' })]
    expect(applySliceFilter(items, q).explicit.map((r) => r.name)).toEqual(['A'])
  })

  it('строка переносит объём и цену без изменений', () => {
    const { explicit } = applySliceFilter(
      [item({ name: 'A Chardonnay', price: 1180, volume: '750ml', year: 2022 })], CHARD)
    expect(explicit[0]).toMatchObject({ price: 1180, volume: '750ml', year: 2022, producer: null })
  })
})

describe('sortRows', () => {
  const row = (name: string, price: number | null): SliceRow => ({
    producer: null, name, region: null, country: null, year: null,
    price, volume: null, match: 'explicit', note: null,
  })

  it('по цене от дешёвых, без цены — в конец', () => {
    const out = sortRows([row('b', 900), row('nil', null), row('a', 500)], 'price_asc')
    expect(out.map((r) => r.name)).toEqual(['a', 'b', 'nil'])
  })

  it('по цене от дорогих, без цены — в конец', () => {
    const out = sortRows([row('a', 500), row('nil', null), row('b', 900)], 'price_desc')
    expect(out.map((r) => r.name)).toEqual(['b', 'a', 'nil'])
  })

  it('по названию', () => {
    const out = sortRows([row('Beta', 1), row('Alpha', 2)], 'name')
    expect(out.map((r) => r.name)).toEqual(['Alpha', 'Beta'])
  })

  it('не мутирует вход', () => {
    const input = [row('b', 900), row('a', 500)]
    sortRows(input, 'price_asc')
    expect(input.map((r) => r.name)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: Запустить тест — должен упасть**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/filter.test.ts
```

Ожидается: FAIL — `Failed to resolve import "./filter"`.

- [ ] **Step 3: Реализовать**

Создай `02_services/mission-control/lib/price/slice/filter.ts`:

```ts
import type { ExtractedItem, SliceQuery, SliceRow, SliceSort } from './types'
import { countKnownGrapes, fold, grapeNeedles } from './grapes'

export type FilterOutcome = {
  /** Прошли всё, включая сорт словом из прайса. */
  explicit: SliceRow[]
  /** Прошли всё, кроме сорта. Материал для LLM-добора по апелласьону. */
  candidates: ExtractedItem[]
}

export function toRow(it: ExtractedItem, match: SliceRow['match'], note: string | null): SliceRow {
  return {
    producer: null,       // заполняется отдельным шагом раскола
    name: it.name,
    region: it.region,
    country: it.country,
    year: it.year,
    price: it.price,
    volume: it.volume,
    match,
    note,
  }
}

/** Позиция без значения НЕ проходит ограничение — «до 600» не должно тащить безценовые. */
function inRange(v: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true
  if (v === null) return false
  if (min !== null && v < min) return false
  if (max !== null && v > max) return false
  return true
}

function anyNeedle(needles: string[], haystack: string | null): boolean {
  if (needles.length === 0) return true
  if (!haystack) return false
  const h = fold(haystack)
  return needles.some((n) => h.includes(fold(n)))
}

function join(...parts: (string | null)[]): string | null {
  const s = parts.filter((p): p is string => !!p).join(' · ')
  return s === '' ? null : s
}

/** Все ограничения, кроме сорта. */
function passesNonGrape(it: ExtractedItem, q: SliceQuery): boolean {
  if (q.categories.length > 0 && !(it.category && q.categories.includes(it.category))) return false
  if (q.colors.length > 0 && !(it.wine_type && q.colors.includes(it.wine_type))) return false
  if (!inRange(it.price, q.priceMin, q.priceMax)) return false
  if (!inRange(it.year, q.yearMin, q.yearMax)) return false
  if (q.countries.length > 0 && !anyNeedle(q.countries, join(it.country, it.region))) return false
  if (q.regions.length > 0 && !anyNeedle(q.regions, join(it.region, it.country))) return false
  if (q.text && !anyNeedle([q.text], join(it.name, it.description))) return false
  return true
}

export function applySliceFilter(items: ExtractedItem[], q: SliceQuery): FilterOutcome {
  const explicit: SliceRow[] = []
  const candidates: ExtractedItem[] = []
  const needles = q.grapes.flatMap(grapeNeedles)

  for (const it of items) {
    if (!passesNonGrape(it, q)) continue

    if (needles.length === 0) {
      explicit.push(toRow(it, 'explicit', null))
      continue
    }

    const hay = join(it.grape_variety, it.name)
    if (anyNeedle(needles, hay)) {
      // Бленд определяем ТОЛЬКО по полю сорта: в названиях полно дефисов
      // от топонимов (Pouilly-Fuissé, Saint-Émilion), они не бленды.
      const blend = countKnownGrapes(it.grape_variety) > 1
      explicit.push(toRow(it, 'explicit', blend ? 'бленд' : null))
    } else if (it.category === 'wine') {
      candidates.push(it)
    }
  }

  return { explicit, candidates }
}

export function sortRows(rows: SliceRow[], sort: SliceSort): SliceRow[] {
  const out = [...rows]
  if (sort === 'name') {
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }
  const dir = sort === 'price_desc' ? -1 : 1
  out.sort((a, b) => {
    if (a.price === null && b.price === null) return 0
    if (a.price === null) return 1   // без цены — всегда в конец
    if (b.price === null) return -1
    return (a.price - b.price) * dir
  })
  return out
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/filter.test.ts
```

Ожидается: PASS, 19 тестов.

- [ ] **Step 5: Коммит**

```bash
git add 02_services/mission-control/lib/price/slice/
git commit -m "прайс-срез: детерминированный фильтр по полям

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: LLM-плумбинг (`askJson`)

Одно место, где живут модель, structured outputs и обработка отказа.

**Files:**
- Create: `02_services/mission-control/lib/price/slice/llm.ts`

- [ ] **Step 1: Реализовать**

Создай `02_services/mission-control/lib/price/slice/llm.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Одна точка правды про модель для среза. Остальной прайс-пайплайн
// (lib/price/claude.ts) живёт на своей модели — его не трогаем.
export const SLICE_MODEL = 'claude-opus-5'

export class SliceLlmError extends Error {}

async function call(prompt: string, maxTokens: number, schema?: Record<string, unknown>) {
  return anthropic.messages.create({
    model: SLICE_MODEL,
    max_tokens: maxTokens,
    output_config: schema
      ? { effort: 'low', format: { type: 'json_schema', schema } }
      : { effort: 'low' },
    messages: [{ role: 'user', content: prompt }],
  })
}

/**
 * Запрос к модели с JSON-ответом. Шаги среза — классификация, поэтому
 * effort: 'low'.
 *
 * Схему передаём через structured outputs, но если этот билд API конкретную
 * схему не принимает (подмножество JSON Schema у structured outputs
 * ограничено), повторяем запрос без неё: промпты и так требуют только JSON, а
 * результат всё равно проходит через валидаторы (coerceSliceQuery, проверки
 * индексов в enrich.ts).
 *
 * Отказ модели превращаем в ошибку, чтобы вызывающий шаг деградировал, а не
 * разбирал пустой текст.
 */
export async function askJson<T>(opts: {
  prompt: string
  schema?: Record<string, unknown>
  maxTokens?: number
}): Promise<T> {
  const maxTokens = opts.maxTokens ?? 4096

  let res
  try {
    res = await call(opts.prompt, maxTokens, opts.schema)
  } catch (e) {
    if (opts.schema && e instanceof Anthropic.BadRequestError) {
      console.warn('[slice] схема не принята, повтор без structured outputs:', e.message)
      res = await call(opts.prompt, maxTokens)
    } else {
      throw e
    }
  }

  if (res.stop_reason === 'refusal') {
    throw new SliceLlmError(`модель отказалась: ${res.stop_details?.category ?? 'без категории'}`)
  }
  if (res.stop_reason === 'max_tokens') {
    throw new SliceLlmError('ответ модели не уместился в max_tokens')
  }

  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
  if (text === '') throw new SliceLlmError('модель вернула пустой ответ')

  // Без схемы модель иногда оборачивает JSON в ```-блок — снимаем так же, как
  // это уже делает lib/price/claude.ts.
  const bare = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()

  try {
    return JSON.parse(bare) as T
  } catch {
    throw new SliceLlmError(`ответ модели не разобрался как JSON: ${bare.slice(0, 200)}`)
  }
}
```

- [ ] **Step 2: Проверить типизацию**

```bash
cd 02_services/mission-control && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "slice/llm" || echo "slice/llm.ts типизируется чисто"
```

Ожидается: `slice/llm.ts типизируется чисто`.

- [ ] **Step 3: Коммит**

```bash
git add 02_services/mission-control/lib/price/slice/llm.ts
git commit -m "прайс-срез: LLM-плумбинг со строгой схемой ответа

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Фраза → фильтр (шаг 0)

**Files:**
- Modify: `02_services/mission-control/lib/price/slice/query.ts` (добавить `parseSliceQuery` в конец)

- [ ] **Step 1: Дописать функцию**

Добавь в конец `02_services/mission-control/lib/price/slice/query.ts`:

```ts
import { askJson } from './llm'

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
```

Импорт `askJson` подними к остальным импортам в начале файла — держи порядок, принятый в проекте.

- [ ] **Step 2: Убедиться, что прежние тесты не сломались**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/
```

Ожидается: PASS, 39 тестов (`parseSliceQuery` тестами не покрыт — это обёртка над моделью, её поведение проверяется через `coerceSliceQuery`).

- [ ] **Step 3: Коммит**

```bash
git add 02_services/mission-control/lib/price/slice/query.ts
git commit -m "прайс-срез: разбор фразы в фильтр через модель

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Добор по апелласьону и раскол производителя (шаги 2 и 3)

**Files:**
- Create: `02_services/mission-control/lib/price/slice/enrich.ts`
- Test: `02_services/mission-control/lib/price/slice/enrich.test.ts`

- [ ] **Step 1: Написать падающий тест на чистые части**

Чистое здесь — нарезка на батчи и применение ответа модели к строкам. Сами вызовы модели мокаем.

Создай `02_services/mission-control/lib/price/slice/enrich.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtractedItem, SliceRow } from './types'

const askJson = vi.fn()
vi.mock('./llm', () => ({
  askJson: (...args: unknown[]) => askJson(...args),
  SliceLlmError: class extends Error {},
  SLICE_MODEL: 'test-model',
}))

const { inferByAppellation, splitProducer, BATCH_SIZE } = await import('./enrich')

function item(over: Partial<ExtractedItem>): ExtractedItem {
  return {
    name: 'Wine', country: null, region: null, grape_variety: null,
    price: null, year: null, volume: null, description: null,
    category: 'wine', wine_type: null,
    ...over,
  }
}

function row(name: string): SliceRow {
  return {
    producer: null, name, region: null, country: null, year: null,
    price: null, volume: null, match: 'explicit', note: null,
  }
}

beforeEach(() => askJson.mockReset())

describe('inferByAppellation', () => {
  it('без сортов в запросе модель не зовётся', async () => {
    const out = await inferByAppellation([item({ name: 'Chablis' })], [])
    expect(out).toEqual([])
    expect(askJson).not.toHaveBeenCalled()
  })

  it('отобранные позиции помечает inferred с основанием', async () => {
    askJson.mockResolvedValue({ hits: [{ i: 0, why: 'Chablis' }] })
    const out = await inferByAppellation(
      [item({ name: 'Domaine Laroche Chablis' }), item({ name: 'Rioja Tinto' })],
      ['chardonnay'],
    )
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Domaine Laroche Chablis')
    expect(out[0].match).toBe('inferred')
    expect(out[0].note).toBe('Chablis')
  })

  it('индексы вне диапазона игнорирует', async () => {
    askJson.mockResolvedValue({ hits: [{ i: 99, why: 'ерунда' }] })
    const out = await inferByAppellation([item({ name: 'Chablis' })], ['chardonnay'])
    expect(out).toEqual([])
  })

  it('пустое основание заменяет на «по апелласьону»', async () => {
    askJson.mockResolvedValue({ hits: [{ i: 0, why: '' }] })
    const out = await inferByAppellation([item({ name: 'Meursault' })], ['chardonnay'])
    expect(out[0].note).toBe('по апелласьону')
  })

  it('режет на батчи', async () => {
    askJson.mockResolvedValue({ hits: [] })
    const many = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => item({ name: `W${i}` }))
    await inferByAppellation(many, ['chardonnay'])
    expect(askJson).toHaveBeenCalledTimes(2)
  })
})

describe('splitProducer', () => {
  it('пустой список модель не зовёт', async () => {
    expect(await splitProducer([])).toEqual([])
    expect(askJson).not.toHaveBeenCalled()
  })

  it('раскладывает производителя и название', async () => {
    askJson.mockResolvedValue({
      rows: [{ i: 0, producer: 'Louis Jadot', name: 'Bourgogne Chardonnay' }],
    })
    const out = await splitProducer([row('Louis Jadot Bourgogne Chardonnay')])
    expect(out[0].producer).toBe('Louis Jadot')
    expect(out[0].name).toBe('Bourgogne Chardonnay')
  })

  it('не теряет строки, которых модель не вернула', async () => {
    askJson.mockResolvedValue({ rows: [{ i: 0, producer: 'A', name: 'B' }] })
    const out = await splitProducer([row('A B'), row('Untouched')])
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ producer: null, name: 'Untouched' })
  })

  it('пустое название от модели не затирает исходное', async () => {
    askJson.mockResolvedValue({ rows: [{ i: 0, producer: 'A', name: '' }] })
    const out = await splitProducer([row('A B')])
    expect(out[0].name).toBe('A B')
    expect(out[0].producer).toBe('A')
  })
})
```

- [ ] **Step 2: Запустить тест — должен упасть**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/enrich.test.ts
```

Ожидается: FAIL — `Failed to resolve import "./enrich"`.

- [ ] **Step 3: Реализовать**

Создай `02_services/mission-control/lib/price/slice/enrich.ts`:

```ts
import type { ExtractedItem, SliceRow } from './types'
import { toRow } from './filter'
import { askJson } from './llm'

/** Сколько позиций отдаём модели за раз. Прайс в 500 строк — 5 вызовов. */
export const BATCH_SIZE = 100

// ─── Шаг 2: добор по апелласьону ────────────────────────────────────────────

const INFER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hits'],
  properties: {
    hits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'why'],
        properties: {
          i:   { type: 'integer' },
          why: { type: 'string' },
        },
      },
    },
  },
} as const

type InferReply = { hits: { i: number; why: string }[] }

function inferPrompt(grapes: string[], lines: string[]): string {
  return `Вот позиции винного прайс-листа. В них НЕ написан сорт винограда.
Укажи, какие из них сделаны из сорта: ${grapes.join(', ')}.

Считай попаданием только случай, когда апелласьон или наименование однозначно
предполагает этот сорт (например Chablis, Meursault, Pouilly-Fuissé, Bourgogne Blanc —
это chardonnay). Если сорт апелласьона не определяет однозначно или это бленд с
преобладанием другого сорта — не включай.

Ничего не добавляй: ни новых позиций, ни цен, ни догадок о производителе.
Верни ТОЛЬКО JSON, без markdown: {"hits":[{"i":0,"why":"название апелласьона, 1-3 слова"}]}
Если попаданий нет — {"hits":[]}.

${lines.join('\n')}`
}

/**
 * Шаг 2. Кандидаты (прошли всё, кроме сорта) → строки с match: 'inferred'.
 * Пустой список сортов означает, что добирать нечего.
 */
export async function inferByAppellation(
  candidates: ExtractedItem[],
  grapes: string[],
): Promise<SliceRow[]> {
  if (grapes.length === 0 || candidates.length === 0) return []

  const out: SliceRow[] = []
  for (let from = 0; from < candidates.length; from += BATCH_SIZE) {
    const batch = candidates.slice(from, from + BATCH_SIZE)
    const lines = batch.map((it, i) =>
      `${i}. ${[it.name, it.region, it.country].filter(Boolean).join(' | ')}`)

    const reply = await askJson<InferReply>({
      prompt: inferPrompt(grapes, lines),
      schema: INFER_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 4096,
    })

    for (const hit of reply.hits ?? []) {
      const it = batch[hit.i]
      if (!it) continue   // модель назвала индекс, которого нет
      const why = (hit.why ?? '').trim()
      out.push(toRow(it, 'inferred', why === '' ? 'по апелласьону' : why))
    }
  }
  return out
}

// ─── Шаг 3: раскол «производитель / название» ───────────────────────────────

const SPLIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'producer', 'name'],
        properties: {
          i:        { type: 'integer' },
          producer: { type: ['string', 'null'] },
          name:     { type: 'string' },
        },
      },
    },
  },
} as const

type SplitReply = { rows: { i: number; producer: string | null; name: string }[] }

function splitPrompt(lines: string[]): string {
  return `В винных прайс-листах производитель слит с названием вина в одну строку.
Раздели каждую строку на producer (хозяйство / винодельня / бренд) и name (остальное:
кюве, апелласьон, сорт).

Правила:
- producer — только то, что действительно является производителем. Не уверен — null,
  и тогда name оставь строкой целиком.
- Из name убери производителя, но не выбрасывай ничего другого.
- Не переводи, не исправляй орфографию, не добавляй год и объём.

Верни ТОЛЬКО JSON, без markdown, по строке на каждый входной индекс:
{"rows":[{"i":0,"producer":"Louis Jadot","name":"Bourgogne Chardonnay"}]}

${lines.join('\n')}`
}

/**
 * Шаг 3. Заполняет producer в уже отобранных строках. Вызывается ТОЛЬКО по срезу
 * (десятки строк), а не по всему прайсу. Строки, которых модель не вернула,
 * остаются как были.
 */
export async function splitProducer(rows: SliceRow[]): Promise<SliceRow[]> {
  if (rows.length === 0) return []

  const out = rows.map((r) => ({ ...r }))
  for (let from = 0; from < out.length; from += BATCH_SIZE) {
    const batch = out.slice(from, from + BATCH_SIZE)
    const lines = batch.map((r, i) => `${i}. ${r.name}`)

    const reply = await askJson<SplitReply>({
      prompt: splitPrompt(lines),
      schema: SPLIT_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 8192,
    })

    for (const got of reply.rows ?? []) {
      const target = batch[got.i]
      if (!target) continue
      const producer = (got.producer ?? '').trim()
      const name = (got.name ?? '').trim()
      target.producer = producer === '' ? null : producer
      if (name !== '') target.name = name   // пустое название не затираем
    }
  }
  return out
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/enrich.test.ts
```

Ожидается: PASS, 9 тестов.

- [ ] **Step 5: Коммит**

```bash
git add 02_services/mission-control/lib/price/slice/
git commit -m "прайс-срез: добор по апелласьону и раскол производителя

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Оркестрация `sliceItems`

Склеивает четыре шага и реализует правило «падение LLM-шага деградирует срез, но не отменяет его».

**Files:**
- Create: `02_services/mission-control/lib/price/slice/index.ts`
- Test: `02_services/mission-control/lib/price/slice/index.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `02_services/mission-control/lib/price/slice/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtractedItem } from './types'

const parseSliceQuery = vi.fn()
const inferByAppellation = vi.fn()
const splitProducer = vi.fn()

vi.mock('./query', async () => {
  const actual = await vi.importActual<typeof import('./query')>('./query')
  return { ...actual, parseSliceQuery: (...a: unknown[]) => parseSliceQuery(...a) }
})
vi.mock('./enrich', () => ({
  inferByAppellation: (...a: unknown[]) => inferByAppellation(...a),
  splitProducer: (...a: unknown[]) => splitProducer(...a),
  BATCH_SIZE: 100,
}))

const { sliceItems, EmptyQueryError } = await import('./index')
const { coerceSliceQuery } = await import('./query')

function item(over: Partial<ExtractedItem>): ExtractedItem {
  return {
    name: 'Wine', country: null, region: null, grape_variety: null,
    price: null, year: null, volume: null, description: null,
    category: 'wine', wine_type: null,
    ...over,
  }
}

beforeEach(() => {
  parseSliceQuery.mockReset()
  inferByAppellation.mockReset()
  splitProducer.mockReset()
  parseSliceQuery.mockResolvedValue(coerceSliceQuery({ grapes: ['chardonnay'] }))
  inferByAppellation.mockResolvedValue([])
  splitProducer.mockImplementation(async (rows: unknown) => rows)
})

const ITEMS = [
  item({ name: 'B Chardonnay', price: 900 }),
  item({ name: 'A Chardonnay', price: 500 }),
  item({ name: 'Rioja Tinto', price: 400 }),
]

describe('sliceItems', () => {
  it('отдаёт отсортированный срез и счётчики', async () => {
    const res = await sliceItems(ITEMS, 'все шардоне')
    expect(res.rows.map((r) => r.name)).toEqual(['A Chardonnay', 'B Chardonnay'])
    expect(res.matched).toBe(2)
    expect(res.totalItems).toBe(3)
    expect(res.degraded).toEqual([])
  })

  it('доборные строки попадают в выдачу', async () => {
    inferByAppellation.mockResolvedValue([{
      producer: null, name: 'Chablis', region: null, country: null,
      year: null, price: 700, volume: null, match: 'inferred', note: 'Chablis',
    }])
    const res = await sliceItems(ITEMS, 'все шардоне')
    expect(res.rows.map((r) => r.name)).toEqual(['A Chardonnay', 'Chablis', 'B Chardonnay'])
    expect(res.matched).toBe(3)
  })

  it('падение добора оставляет точные строки и пишет в degraded', async () => {
    inferByAppellation.mockRejectedValue(new Error('модель легла'))
    const res = await sliceItems(ITEMS, 'все шардоне')
    expect(res.rows).toHaveLength(2)
    expect(res.degraded).toEqual(['добор по апелласьону'])
  })

  it('падение раскола оставляет названия целиком и пишет в degraded', async () => {
    splitProducer.mockRejectedValue(new Error('модель легла'))
    const res = await sliceItems(ITEMS, 'все шардоне')
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].producer).toBeNull()
    expect(res.degraded).toEqual(['производитель'])
  })

  it('пустой срез не зовёт раскол', async () => {
    parseSliceQuery.mockResolvedValue(coerceSliceQuery({ grapes: ['saperavi'] }))
    const res = await sliceItems(ITEMS, 'всё саперави')
    expect(res.rows).toEqual([])
    expect(splitProducer).not.toHaveBeenCalled()
  })

  it('нераспознанная фраза — EmptyQueryError', async () => {
    parseSliceQuery.mockResolvedValue(coerceSliceQuery({}))
    await expect(sliceItems(ITEMS, 'бла бла')).rejects.toBeInstanceOf(EmptyQueryError)
  })

  it('готовый фильтр используется без обращения к модели', async () => {
    const res = await sliceItems(ITEMS, coerceSliceQuery({ grapes: ['chardonnay'] }))
    expect(parseSliceQuery).not.toHaveBeenCalled()
    expect(res.matched).toBe(2)
  })
})
```

- [ ] **Step 2: Запустить тест — должен упасть**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/index.test.ts
```

Ожидается: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Реализовать**

Создай `02_services/mission-control/lib/price/slice/index.ts`:

```ts
import type { ExtractedItem, SliceQuery, SliceResult } from './types'
import { applySliceFilter, sortRows } from './filter'
import { inferByAppellation, splitProducer } from './enrich'
import { isEmptyQuery, parseSliceQuery } from './query'

export class EmptyQueryError extends Error {
  constructor() { super('запрос не содержит ни одного ограничения') }
}

/**
 * Полный срез прайса. `query` — либо фраза пользователя (её разберёт модель),
 * либо уже готовый фильтр (для доуточнения: модель второй раз не нужна).
 *
 * Падение любого LLM-шага деградирует результат, но не отменяет его: имя
 * сломавшегося шага попадает в `degraded`, и бот честно это показывает.
 */
export async function sliceItems(
  items: ExtractedItem[],
  query: string | SliceQuery,
): Promise<SliceResult> {
  const degraded: string[] = []

  const q: SliceQuery = typeof query === 'string' ? await parseSliceQuery(query) : query
  if (isEmptyQuery(q)) throw new EmptyQueryError()

  const { explicit, candidates } = applySliceFilter(items, q)

  let inferred: SliceResult['rows'] = []
  try {
    inferred = await inferByAppellation(candidates, q.grapes)
  } catch (e) {
    console.error('[slice] inferByAppellation failed:', e)
    degraded.push('добор по апелласьону')
  }

  let rows = [...explicit, ...inferred]
  if (rows.length > 0) {
    try {
      rows = await splitProducer(rows)
    } catch (e) {
      console.error('[slice] splitProducer failed:', e)
      degraded.push('производитель')
    }
  }

  return {
    query: q,
    rows: sortRows(rows, q.sort),
    totalItems: items.length,
    matched: rows.length,
    degraded,
  }
}

export type { SliceQuery, SliceResult, SliceRow } from './types'
export { coerceSliceQuery, isEmptyQuery, parseSliceQuery } from './query'
```

- [ ] **Step 4: Запустить тесты — все должны пройти**

```bash
cd 02_services/mission-control && npx vitest run lib/price/slice/
```

Ожидается: PASS, 55 тестов.

- [ ] **Step 5: Коммит**

```bash
git add 02_services/mission-control/lib/price/slice/
git commit -m "прайс-срез: оркестрация с деградацией по шагам

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Публичная ручка `POST /api/public/price/slice`

**Files:**
- Create: `02_services/mission-control/app/api/public/price/slice/route.ts`
- Create: `02_services/mission-control/app/api/public/price/_auth.ts`

- [ ] **Step 1: Вынести авторизацию**

Создай `02_services/mission-control/app/api/public/price/_auth.ts`:

```ts
import { NextResponse } from 'next/server'

/**
 * Авторизация публичных прайсовых ручек для бота. Тот же контракт, что у
 * payables-alerts: ручка живёт под /api/public/, поэтому middleware не требует
 * куки-сессию, и охраняется общим секретом.
 *
 * Возвращает NextResponse при отказе и null, если всё в порядке.
 */
export function guardPriceApi(req: Request): NextResponse | null {
  const secret = process.env.PRICE_SLICE_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'price slice not configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-api-key') ?? ''
  if (token !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}
```

- [ ] **Step 2: Написать ручку**

Создай `02_services/mission-control/app/api/public/price/slice/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { ACCEPTED_TYPES } from '@/lib/price/file-types'
import { detectFileType, extractFromFile } from '@/lib/price/extract'
import { EmptyQueryError, sliceItems } from '@/lib/price/slice'
import { guardPriceApi } from '../_auth'

// Разовый разбор прайса для бота «Чип и Дейл»: файл + фраза → срез.
// В базу НИЧЕГО не пишется: ни price_list, ни wine_items. Если прайс нужен
// в базе — это другой путь, портальный /m/price/upload.

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // большой PDF через Vision идёт минутами

const MAX_BYTES = 20 * 1024 * 1024   // предел Telegram getFile

export async function POST(req: Request) {
  const denied = guardPriceApi(req)
  if (denied) return denied

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'ожидается multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  const query = String(form.get('query') ?? '').trim()

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'поле file обязательно' }, { status: 400 })
  }
  if (query === '') {
    return NextResponse.json({ error: 'поле query обязательно' }, { status: 400 })
  }

  const mimeType = file.type || 'application/octet-stream'
  const filename = file.name || 'pricelist'
  if (!ACCEPTED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: `тип ${mimeType} не поддерживается` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'файл больше 20 МБ' }, { status: 413 })
  }

  try {
    const extracted = await extractFromFile(buffer, filename, mimeType)
    if (extracted.items.length === 0) {
      return NextResponse.json({ error: 'в файле не нашлось ни одной позиции' }, { status: 422 })
    }

    const slice = await sliceItems(extracted.items, query)

    return NextResponse.json({
      supplier_name:   extracted.supplier_name,
      price_list_date: extracted.price_list_date,
      currency:        extracted.currency,
      file_type:       detectFileType(filename, mimeType),
      total_items:     slice.totalItems,
      matched:         slice.matched,
      degraded:        slice.degraded,
      query:           slice.query,
      rows:            slice.rows,
      items:           extracted.items,   // бот кэширует для доуточнения
    })
  } catch (e) {
    if (e instanceof EmptyQueryError) {
      return NextResponse.json({ error: 'запрос не понят' }, { status: 400 })
    }
    console.error('[price/slice] failed:', e)
    const message = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Проверить типизацию**

```bash
cd 02_services/mission-control && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "api/public/price|lib/price/slice" || echo "ручка и lib типизируются чисто"
```

Ожидается: `ручка и lib типизируются чисто`.

- [ ] **Step 4: Проверить на настоящем прайсе**

В репозитории лежат реальные прайсы. У BBB есть детерминированный парсер, поэтому проверка быстрая и не жжёт токены на извлечение.

Терминал 1:
```bash
cd 02_services/mission-control && PRICE_SLICE_SECRET=localtest npm run dev
```

Терминал 2:
```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey && curl -s -X POST http://localhost:3003/api/public/price/slice \
  -H "Authorization: Bearer localtest" \
  -F "file=@.inbox/Suppliers/BBB/BB_B Price List 2026 - Issue 1.pdf;type=application/pdf" \
  -F "query=все шардоне" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('supplier_name'), d.get('total_items'), '→', d.get('matched'), 'degraded:', d.get('degraded')); [print(' ', r['producer'], '|', r['name'], '|', r['price'], r['match'], r['note'] or '') for r in d.get('rows', [])[:5]]"
```

Ожидается: имя поставщика, общее число позиций, число попаданий больше нуля, `degraded: []` и первые пять строк с заполненным `producer`.

Проверь также отказы:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3003/api/public/price/slice -F "query=x"
# ожидается 401
curl -s -X POST http://localhost:3003/api/public/price/slice -H "Authorization: Bearer localtest" \
  -F "file=@.inbox/Suppliers/BBB/BB_B Price List 2026 - Issue 1.pdf;type=application/pdf" -F "query=бла бла бла"
# ожидается {"error":"запрос не понят"} со статусом 400
```

- [ ] **Step 5: Коммит**

```bash
git add 02_services/mission-control/app/api/public/price/
git commit -m "прайс-срез: публичная ручка /api/public/price/slice

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Ручка доуточнения `POST /api/public/price/slice/refine`

**Files:**
- Create: `02_services/mission-control/app/api/public/price/slice/refine/route.ts`

- [ ] **Step 1: Написать ручку**

Создай `02_services/mission-control/app/api/public/price/slice/refine/route.ts`:

```ts
import { NextResponse } from 'next/server'
import type { ExtractedItem } from '@/lib/price/claude'
import { EmptyQueryError, sliceItems } from '@/lib/price/slice'
import { guardPriceApi } from '../../_auth'

// Доуточнение среза: позиции уже разобраны и лежат в памяти бота, файл второй
// раз не парсим. Прайс в 500 позиций — около 150 КБ JSON, это нормально.

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  const denied = guardPriceApi(req)
  if (denied) return denied

  let body: { items?: unknown; query?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'ожидается JSON' }, { status: 400 })
  }

  const items = body.items
  const query = String(body.query ?? '').trim()

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'поле items обязательно' }, { status: 400 })
  }
  if (query === '') {
    return NextResponse.json({ error: 'поле query обязательно' }, { status: 400 })
  }

  try {
    const slice = await sliceItems(items as ExtractedItem[], query)
    return NextResponse.json({
      total_items: slice.totalItems,
      matched:     slice.matched,
      degraded:    slice.degraded,
      query:       slice.query,
      rows:        slice.rows,
    })
  } catch (e) {
    if (e instanceof EmptyQueryError) {
      return NextResponse.json({ error: 'запрос не понят' }, { status: 400 })
    }
    console.error('[price/slice/refine] failed:', e)
    const message = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Проверить на живом сервере**

Сервер из Task 8 ещё запущен (`PRICE_SLICE_SECRET=localtest npm run dev`).

```bash
curl -s -X POST http://localhost:3003/api/public/price/slice/refine \
  -H "Authorization: Bearer localtest" -H "Content-Type: application/json" \
  -d '{"query":"шардоне до 600","items":[
    {"name":"Louis Jadot Bourgogne Chardonnay","country":"France","region":"Bourgogne","grape_variety":"Chardonnay","price":550,"year":2022,"volume":"750ml","description":null,"category":"wine","wine_type":"white"},
    {"name":"Expensive Chardonnay","country":"France","region":null,"grape_variety":"Chardonnay","price":2400,"year":2021,"volume":"750ml","description":null,"category":"wine","wine_type":"white"}
  ]}' | python3 -m json.tool
```

Ожидается: `matched: 1`, одна строка — Louis Jadot, `producer: "Louis Jadot"`, `name: "Bourgogne Chardonnay"`.

- [ ] **Step 3: Коммит**

```bash
git add 02_services/mission-control/app/api/public/price/slice/refine/
git commit -m "прайс-срез: ручка доуточнения без повторного парсинга

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Бот — форматирование списка и CSV

Чистые функции, поэтому идут первыми и под тестами.

**Files:**
- Create: `01_agents/bot/src/price-slice-format.ts`
- Test: `01_agents/bot/src/price-slice-format.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создай `01_agents/bot/src/price-slice-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildSliceCsv, formatSliceMessage, sliceFileName, bangkokIsoDate, type SliceRow,
} from "./price-slice-format.js";

function row(over: Partial<SliceRow>): SliceRow {
  return {
    producer: null, name: "Wine", region: null, country: null,
    year: null, price: null, volume: null, match: "explicit", note: null,
    ...over,
  };
}

describe("buildSliceCsv", () => {
  it("начинается с BOM и шапки, строки через CRLF", () => {
    const csv = buildSliceCsv([row({ producer: "Louis Jadot", name: "Bourgogne", price: 1180 })]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(
      "﻿производитель,название,регион,год,цена,объём,пометка");
    expect(csv.split("\r\n")[1]).toBe("Louis Jadot,Bourgogne,,,1180,,");
  });

  it("экранирует запятые и кавычки", () => {
    const csv = buildSliceCsv([row({ name: 'Wine, "Reserve"' })]);
    expect(csv).toContain('"Wine, ""Reserve"""');
  });

  it("цену пишет числом без разделителей разрядов", () => {
    const csv = buildSliceCsv([row({ price: 12450 })]);
    expect(csv).toContain(",12450,");
  });

  it("доборную строку помечает в колонке пометка", () => {
    const csv = buildSliceCsv([row({ match: "inferred", note: "Chablis" })]);
    expect(csv.trimEnd().endsWith("Chablis")).toBe(true);
  });

  it("пустой срез — только шапка", () => {
    expect(buildSliceCsv([]).split("\r\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("formatSliceMessage", () => {
  const rows = Array.from({ length: 14 }, (_, i) =>
    row({ producer: `P${i}`, name: `Wine ${i}`, price: 400 + i * 100, country: "FR" }));

  it("показывает поставщика, счёт и вилку цен", () => {
    const msg = formatSliceMessage({
      supplier: "Janhom", priceListDate: "2026-09-12",
      rows, totalItems: 214, matched: 14, degraded: [], limit: 10,
    });
    expect(msg).toContain("Janhom");
    expect(msg).toContain("12.09.2026");
    expect(msg).toContain("14 позиций");
    expect(msg).toContain("฿400");
    expect(msg).toContain("฿1,700");
  });

  it("обрезает до limit и пишет остаток", () => {
    const msg = formatSliceMessage({
      supplier: "Janhom", priceListDate: null,
      rows, totalItems: 214, matched: 14, degraded: [], limit: 10,
    });
    expect(msg).toContain("Wine 9");
    expect(msg).not.toContain("Wine 10");
    expect(msg).toContain("ещё 4");
  });

  it("помечает доборные строки", () => {
    const msg = formatSliceMessage({
      supplier: "X", priceListDate: null, limit: 10, totalItems: 10, matched: 1, degraded: [],
      rows: [row({ name: "Chablis", match: "inferred", note: "Chablis" })],
    });
    expect(msg).toContain("◦ Chablis");
  });

  it("экранирует HTML в данных прайса", () => {
    const msg = formatSliceMessage({
      supplier: "A & B <Co>", priceListDate: null, limit: 10, totalItems: 1, matched: 1, degraded: [],
      rows: [row({ name: "Wine <1>" })],
    });
    expect(msg).toContain("A &amp; B &lt;Co&gt;");
    expect(msg).toContain("Wine &lt;1&gt;");
  });

  it("пустой срез объясняет, что прайс прочитан", () => {
    const msg = formatSliceMessage({
      supplier: "Janhom", priceListDate: null, rows: [],
      totalItems: 214, matched: 0, degraded: [], limit: 10,
    });
    expect(msg).toContain("ничего не нашёл");
    expect(msg).toContain("214");
  });

  it("сломавшийся шаг показывает честно", () => {
    const msg = formatSliceMessage({
      supplier: "X", priceListDate: null, limit: 10, totalItems: 5, matched: 1,
      degraded: ["добор по апелласьону"], rows: [row({})],
    });
    expect(msg).toContain("добор по апелласьону");
  });
});

describe("sliceFileName", () => {
  it("склеивает запрос, поставщика и дату", () => {
    expect(sliceFileName("все шардоне", "Janhom Wine", "2026-10-01"))
      .toBe("vse-shardone_janhom-wine_2026-10-01.csv");
  });

  it("подчищает мусорные символы", () => {
    expect(sliceFileName("шардоне < 600!", "A/B", "2026-10-01"))
      .toBe("shardone-600_a-b_2026-10-01.csv");
  });
});

describe("bangkokIsoDate", () => {
  it("отдаёт ISO-дату", () => {
    expect(bangkokIsoDate(Date.UTC(2026, 9, 1, 5, 0, 0))).toBe("2026-10-01");
  });

  it("учитывает смещение Бангкока (+7): поздний вечер UTC — уже следующий день", () => {
    expect(bangkokIsoDate(Date.UTC(2026, 9, 1, 18, 0, 0))).toBe("2026-10-02");
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

```bash
cd 01_agents/bot && npx vitest run src/price-slice-format.test.ts
```

Ожидается: FAIL — `Failed to resolve import "./price-slice-format.js"`.

- [ ] **Step 3: Реализовать**

Создай `01_agents/bot/src/price-slice-format.ts`:

```ts
// Отрисовка среза прайса для телеграма: читаемый список в чат и CSV-вложение
// с полной таблицей. Чистые функции — вся работа с сетью живёт в price-slice.ts.

export type SliceRow = {
  producer: string | null;
  name: string;
  region: string | null;
  country: string | null;
  year: number | null;
  price: number | null;
  volume: string | null;
  match: "explicit" | "inferred";
  note: string | null;
};

const CSV_HEADER = ["производитель", "название", "регион", "год", "цена", "объём", "пометка"];

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV для Excel: BOM и CRLF, иначе тайский Excel ломает кириллицу и строки.
 * Цена — числом без разделителей разрядов, чтобы считалась формулами.
 */
export function buildSliceCsv(rows: SliceRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(r.producer),
      csvCell(r.name),
      csvCell(r.region ?? r.country),
      csvCell(r.year),
      csvCell(r.price),
      csvCell(r.volume),
      csvCell(r.match === "inferred" ? (r.note ?? "по апелласьону") : (r.note ?? null)),
    ].join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function baht(n: number): string {
  return "฿" + n.toLocaleString("en-US");
}

function ruDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

export type SliceMessageInput = {
  supplier: string;
  priceListDate: string | null;
  rows: SliceRow[];
  totalItems: number;
  matched: number;
  degraded: string[];
  limit: number;
};

/**
 * Список в чат, parse_mode HTML. По две строки на вино — так читается с телефона
 * без горизонтального скролла, в отличие от моноширинной таблицы в пять колонок.
 */
export function formatSliceMessage(input: SliceMessageInput): string {
  const { supplier, rows, totalItems, matched, degraded, limit } = input;
  const date = ruDate(input.priceListDate);
  const head = `<b>${esc(supplier)}</b>${date ? ` · прайс от ${date}` : ""}`;

  if (matched === 0) {
    return `${head}\nПо запросу ничего не нашёл. В прайсе ${totalItems} позиций — попробуй переформулировать.`;
  }

  const prices = rows.map((r) => r.price).filter((p): p is number => p !== null);
  const span = prices.length > 0
    ? `, ${baht(Math.min(...prices))}–${baht(Math.max(...prices))}`
    : "";

  const lines = [head, `Нашёл ${matched} позиций${span}`, ""];

  rows.slice(0, limit).forEach((r, i) => {
    const title = [r.producer, r.name].filter(Boolean).map((s) => esc(s!)).join(" · ");
    const facts = [
      [r.region, r.country].filter(Boolean).map((s) => esc(s!)).join(", ") || null,
      r.year !== null ? String(r.year) : null,
      r.price !== null ? baht(r.price) : null,
    ].filter(Boolean).join(" · ");
    const mark = r.match === "inferred" ? `  ◦ ${esc(r.note ?? "по апелласьону")}` : "";
    lines.push(`${i + 1}. ${title}`);
    lines.push(`   ${facts}${mark}`);
  });

  if (matched > limit) lines.push("", `…и ещё ${matched - limit} — в файле`);
  if (degraded.length > 0) lines.push("", `⚠️ не сработало: ${degraded.map(esc).join(", ")}`);

  return lines.join("\n");
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Имя CSV: запрос_поставщик_дата — чтобы в «Загрузках» было понятно, что это. */
export function sliceFileName(query: string, supplier: string, isoDate: string): string {
  const parts = [slug(query), slug(supplier), isoDate].filter((p) => p !== "");
  return `${parts.join("_")}.csv`;
}

/**
 * Дата по Бангкоку в ISO. Своя, а не bangkokDate() из expenses.ts: та отдаёт
 * ДД.ММ.ГГГГ, и в имени файла такая дата сортируется неправильно.
 */
export function bangkokIsoDate(now = Date.now()): string {
  return new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

```bash
cd 01_agents/bot && npx vitest run src/price-slice-format.test.ts
```

Ожидается: PASS, 15 тестов.

- [ ] **Step 5: Коммит**

```bash
git add 01_agents/bot/src/price-slice-format.ts 01_agents/bot/src/price-slice-format.test.ts
git commit -m "прайс-срез: вывод списка в чат и CSV-вложение

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Бот — клиент портала и состояние

**Files:**
- Create: `01_agents/bot/src/price-slice.ts`
- Test: `01_agents/bot/src/price-slice.test.ts`

- [ ] **Step 1: Написать падающий тест на состояние**

Сеть не тестируем, тестируем кэш и TTL — то, где легко ошибиться.

Создай `01_agents/bot/src/price-slice.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  rememberSlice, recallSlice, forgetSlice, SLICE_TTL_MS,
} from "./price-slice.js";

const ITEMS = [{ name: "A", price: 1 }];

beforeEach(() => {
  vi.useFakeTimers();
  forgetSlice(1);
});
afterEach(() => vi.useRealTimers());

describe("кэш разобранного прайса", () => {
  it("возвращает свежую запись", () => {
    rememberSlice(1, { items: ITEMS, supplier: "Janhom", messageId: 42 });
    expect(recallSlice(1)?.supplier).toBe("Janhom");
    expect(recallSlice(1)?.messageId).toBe(42);
  });

  it("не отдаёт просроченную запись", () => {
    rememberSlice(1, { items: ITEMS, supplier: "Janhom", messageId: 42 });
    vi.advanceTimersByTime(SLICE_TTL_MS + 1);
    expect(recallSlice(1)).toBeNull();
  });

  it("чаты не видят кэш друг друга", () => {
    rememberSlice(1, { items: ITEMS, supplier: "A", messageId: 1 });
    expect(recallSlice(2)).toBeNull();
  });

  it("forgetSlice убирает запись", () => {
    rememberSlice(1, { items: ITEMS, supplier: "A", messageId: 1 });
    forgetSlice(1);
    expect(recallSlice(1)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

```bash
cd 01_agents/bot && npx vitest run src/price-slice.test.ts
```

Ожидается: FAIL — `Failed to resolve import "./price-slice.js"`.

- [ ] **Step 3: Реализовать**

Создай `01_agents/bot/src/price-slice.ts`:

```ts
// Прайс-срез: бот качает файл из телеграма и отдаёт его в mission-control,
// который переиспользует прайсовый пайплайн портала (парсеры поставщиков +
// Claude-фоллбэк). Сам бот ничего не парсит и в базу ничего не пишет.

import type { SliceRow } from "./price-slice-format.js";

/** Позиция прайса как её отдаёт портал. Держим в памяти для доуточнения. */
export type SliceItem = Record<string, unknown>;

export type SliceResponse = {
  supplier_name: string;
  price_list_date: string | null;
  currency: string | null;
  total_items: number;
  matched: number;
  degraded: string[];
  rows: SliceRow[];
  items: SliceItem[];
};

export type RefineResponse = {
  total_items: number;
  matched: number;
  degraded: string[];
  rows: SliceRow[];
};

export class PriceSliceError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

const TIMEOUT_MS = 300_000;   // большой PDF через Vision идёт минутами

function portalUrl(path: string): string {
  const base = process.env.MISSION_CONTROL_URL;
  if (!base) throw new PriceSliceError("MISSION_CONTROL_URL не задан");
  return `${base.replace(/\/+$/, "")}${path}`;
}

function authHeader(): Record<string, string> {
  const secret = process.env.PRICE_SLICE_SECRET;
  if (!secret) throw new PriceSliceError("PRICE_SLICE_SECRET не задан");
  return { Authorization: `Bearer ${secret}` };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `портал ответил ${res.status}`;
  } catch {
    return `портал ответил ${res.status}`;
  }
}

/** Разбор файла + первый срез. */
export async function requestSlice(opts: {
  base64: string;
  mimeType: string;
  filename: string;
  query: string;
}): Promise<SliceResponse> {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(opts.base64, "base64")], { type: opts.mimeType }), opts.filename);
  form.append("query", opts.query);

  const res = await fetch(portalUrl("/api/public/price/slice"), {
    method: "POST",
    headers: authHeader(),
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PriceSliceError(await readError(res), res.status);
  return (await res.json()) as SliceResponse;
}

/** Доуточнение по уже разобранным позициям — файл второй раз не парсится. */
export async function requestRefine(items: SliceItem[], query: string): Promise<RefineResponse> {
  const res = await fetch(portalUrl("/api/public/price/slice/refine"), {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ items, query }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PriceSliceError(await readError(res), res.status);
  return (await res.json()) as RefineResponse;
}

// ─── Кэш разобранного прайса ────────────────────────────────────────────────
// В памяти процесса, как pendingPhotos и pendingWeight. Редеплой кэш теряет —
// тогда файл присылается заново, это приемлемо и проще внешнего хранилища.

export const SLICE_TTL_MS = 30 * 60 * 1000;

export type SliceCacheEntry = {
  items: SliceItem[];
  supplier: string;
  /** id сообщения со срезом: reply на него = доуточнение. */
  messageId: number;
};

const cache = new Map<number, SliceCacheEntry & { ts: number }>();

export function rememberSlice(chatId: number, entry: SliceCacheEntry): void {
  cache.set(chatId, { ...entry, ts: Date.now() });
}

export function recallSlice(chatId: number): SliceCacheEntry | null {
  const hit = cache.get(chatId);
  if (!hit) return null;
  if (Date.now() - hit.ts > SLICE_TTL_MS) {
    cache.delete(chatId);
    return null;
  }
  return hit;
}

export function forgetSlice(chatId: number): void {
  cache.delete(chatId);
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

```bash
cd 01_agents/bot && npx vitest run src/price-slice.test.ts
```

Ожидается: PASS, 4 теста.

- [ ] **Step 5: Коммит**

```bash
git add 01_agents/bot/src/price-slice.ts 01_agents/bot/src/price-slice.test.ts
git commit -m "прайс-срез: клиент портала и кэш разобранного прайса

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Бот — команда, маршрутизация файла и доуточнение

Самая аккуратная задача: `message:document` уже занят PO-сканами, а `message:text` — расходами. Вклиниваемся так, чтобы не перехватить ничего лишнего.

⚠️ **В боте нет `bot.catch`.** Необработанное исключение в хендлере не превратится в сообщение пользователю — он останется с «Читаю прайс...» навсегда. Поэтому всё, что может упасть (скачивание файла, запрос в портал, отправка вложения), обязано быть внутри `try` с `reportFailure` в `catch`.

**Files:**
- Modify: `01_agents/bot/src/index.ts`

- [ ] **Step 1: Добавить импорты**

В блок импортов `01_agents/bot/src/index.ts` (после импорта `./writeoff.js`, перед `./errors.js`) добавь:

```ts
import {
  requestSlice, requestRefine, rememberSlice, recallSlice,
  PriceSliceError, type SliceItem,
} from "./price-slice.js";
import {
  buildSliceCsv, formatSliceMessage, sliceFileName, bangkokIsoDate,
  type SliceRow,
} from "./price-slice-format.js";
```

И в импорте grammY добавь `InputFile`:

```ts
import { Bot, InlineKeyboard, InputFile } from "grammy";
```

- [ ] **Step 2: Добавить состояние и общий исполнитель**

Рядом с другими `pending*`-мапами в `index.ts` добавь:

```ts
// Прайс-срез. pendingPriceSlice: ждём файл после /price. Текстовое доуточнение
// принимаем ТОЛЬКО как reply на сообщение со срезом — иначе перехватим расходы.
const pendingPriceSlice = new Map<number, { query: string }>();

const SLICE_CHAT_LIMIT = 10;

function sliceHint(): string {
  return "Пришли файл прайса (PDF, Excel или фото) — подпиши, что нужно. Например: «все шардоне до 600».";
}

// Общий финал для первого среза и доуточнения: список в чат + CSV-вложение.
async function sendSlice(ctx: any, waitMsgId: number, opts: {
  supplier: string;
  priceListDate: string | null;
  rows: SliceRow[];
  totalItems: number;
  matched: number;
  degraded: string[];
  query: string;
  items?: SliceItem[];
}): Promise<void> {
  const chatId = ctx.chat.id;
  const text = formatSliceMessage({
    supplier: opts.supplier,
    priceListDate: opts.priceListDate,
    rows: opts.rows,
    totalItems: opts.totalItems,
    matched: opts.matched,
    degraded: opts.degraded,
    limit: SLICE_CHAT_LIMIT,
  });

  const msg = await ctx.api.editMessageText(chatId, waitMsgId, text, { parse_mode: "HTML" });
  const messageId = typeof msg === "object" && msg !== null && "message_id" in msg
    ? (msg.message_id as number)
    : waitMsgId;

  if (opts.matched > 0) {
    const csv = buildSliceCsv(opts.rows);
    const name = sliceFileName(opts.query, opts.supplier, bangkokIsoDate());
    await ctx.replyWithDocument(new InputFile(Buffer.from(csv, "utf8"), name), {
      reply_to_message_id: messageId,
    });
  }

  if (opts.items) {
    rememberSlice(chatId, { items: opts.items, supplier: opts.supplier, messageId });
  }
}

// Один путь для файла из любого входа: /price, подпись «прайс…», кнопка.
//
// Файл качаем ВНУТРИ try: в боте нет bot.catch, поэтому исключение из
// downloadTelegramFile (например, файл больше 20 МБ — телеграм его не отдаёт)
// иначе стало бы необработанным отказом, и пользователь остался бы с
// «Читаю прайс...» навсегда.
async function runPriceSlice(
  ctx: any,
  fetchFile: () => Promise<{ base64: string; mimeType: string; filename: string }>,
  query: string,
): Promise<void> {
  const waitMsg = await ctx.reply("Читаю прайс... Большой файл может занять пару минут.");
  try {
    const file = await fetchFile();
    const res = await requestSlice({ ...file, query });
    await sendSlice(ctx, waitMsg.message_id, {
      supplier: res.supplier_name,
      priceListDate: res.price_list_date,
      rows: res.rows,
      totalItems: res.total_items,
      matched: res.matched,
      degraded: res.degraded,
      query,
      items: res.items,
    });
  } catch (e) {
    if (e instanceof PriceSliceError && e.status === 422) {
      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id,
        "Не смог прочитать это как прайс-лист. Если это PO поставщика — пришли его без подписи.");
      return;
    }
    if (e instanceof PriceSliceError && e.status === 400) {
      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id,
        `Не понял запрос. Например: «все шардоне до 600».`);
      return;
    }
    await reportFailure(ctx, waitMsg.message_id, "разбор прайса", e);
  }
}
```

- [ ] **Step 3: Добавить команду `/price`**

Рядом с другими `bot.command(...)` добавь:

```ts
// Прайс-срез. Команда латиницей не из вредности: Telegram разбирает как
// bot_command только [a-zA-Z0-9_], «/прайс» командой просто не станет.
// Второй вход — подпись к файлу, начинающаяся со слова «прайс».
bot.command("price", async (ctx) => {
  const chatId = ctx.chat.id;
  const query = (ctx.match ?? "").toString().trim();

  // Есть тёплый кэш и есть запрос — это доуточнение, файл не нужен.
  const cached = recallSlice(chatId);
  if (query !== "" && cached) {
    const waitMsg = await ctx.reply("Пересчитываю срез...");
    try {
      const res = await requestRefine(cached.items, query);
      await sendSlice(ctx, waitMsg.message_id, {
        supplier: cached.supplier, priceListDate: null, rows: res.rows,
        totalItems: res.total_items, matched: res.matched, degraded: res.degraded,
        query, items: cached.items,
      });
    } catch (e) {
      await reportFailure(ctx, waitMsg.message_id, "доуточнение среза", e);
    }
    return;
  }

  pendingPriceSlice.set(chatId, { query });
  await ctx.reply(query === ""
    ? sliceHint()
    : `Жду файл прайса. Запрос: «${query}».`);
});
```

- [ ] **Step 4: Вклинить маршрутизацию в хендлер документов**

В `bot.on("message:document", ...)` **первым делом**, до проверки `PO_DOC_MIMES`, вставь:

```ts
  // Прайс-срез перехватывает файл раньше PO-сканера: либо мы его ждём после
  // /price, либо подпись начинается со слова «прайс».
  const sliceState = pendingPriceSlice.get(chatId);
  const caption = (ctx.message.caption ?? "").trim();
  const captionAsks = /^прайс\b[\s:,-]*/i.test(caption);
  if (sliceState || captionAsks) {
    pendingPriceSlice.delete(chatId);
    const query = captionAsks ? caption.replace(/^прайс\b[\s:,-]*/i, "").trim() : (sliceState?.query ?? "");
    if (query === "") {
      pendingPriceSlice.set(chatId, { query: "" });
      await ctx.reply("Что нужно из этого прайса? Например: «все шардоне до 600».");
      return;
    }
    await runPriceSlice(ctx, async () => {
      const file = await downloadTelegramFile(process.env.TELEGRAM_BOT_TOKEN!, doc.file_id, mime);
      return { ...file, filename: doc.file_name ?? "pricelist" };
    }, query);
    return;
  }
```

- [ ] **Step 5: Вклинить маршрутизацию в хендлер фото**

В `bot.on("message:photo", ...)` **первым делом**, до логики расходов, вставь:

```ts
  // Фото прайса (сняли лист на телефон) — тот же путь, что документ.
  const sliceStatePhoto = pendingPriceSlice.get(chatId);
  const captionPhoto = (ctx.message.caption ?? "").trim();
  const captionAsksPhoto = /^прайс\b[\s:,-]*/i.test(captionPhoto);
  if (sliceStatePhoto || captionAsksPhoto) {
    pendingPriceSlice.delete(chatId);
    const query = captionAsksPhoto
      ? captionPhoto.replace(/^прайс\b[\s:,-]*/i, "").trim()
      : (sliceStatePhoto?.query ?? "");
    if (query === "") {
      pendingPriceSlice.set(chatId, { query: "" });
      await ctx.reply("Что нужно из этого прайса? Например: «все шардоне до 600».");
      return;
    }
    await runPriceSlice(ctx, async () => {
      const photos = ctx.message.photo;
      const fileId = photos[photos.length - 1].file_id;   // самый большой размер
      const file = await downloadTelegramFile(process.env.TELEGRAM_BOT_TOKEN!, fileId, "image/jpeg");
      return { ...file, filename: "pricelist.jpg" };
    }, query);
    return;
  }
```

- [ ] **Step 6: Доуточнение через reply**

В `bot.on("message:text", ...)` сразу после `if (text.startsWith("/")) return;` вставь:

```ts
  // Доуточнение среза: ТОЛЬКО reply на сообщение со срезом. Любой другой текст
  // уходит дальше, в расходы и списания, как и раньше.
  const sliceCache = recallSlice(chatId);
  const replyTo = ctx.message.reply_to_message?.message_id;
  if (sliceCache && replyTo === sliceCache.messageId) {
    const waitMsg = await ctx.reply("Пересчитываю срез...");
    try {
      const res = await requestRefine(sliceCache.items, text);
      await sendSlice(ctx, waitMsg.message_id, {
        supplier: sliceCache.supplier, priceListDate: null, rows: res.rows,
        totalItems: res.total_items, matched: res.matched, degraded: res.degraded,
        query: text, items: sliceCache.items,
      });
    } catch (e) {
      if (e instanceof PriceSliceError && e.status === 400) {
        await ctx.api.editMessageText(chatId, waitMsg.message_id,
          "Не понял уточнение. Например: «только Францию» или «до 600».");
      } else {
        await reportFailure(ctx, waitMsg.message_id, "доуточнение среза", e);
      }
    }
    return;
  }
```

- [ ] **Step 7: Кнопка на отказе PO-сканера**

Найди в `message:document` ветку «Не распознал это как PO поставщика» и замени её сообщение на вариант с кнопкой:

```ts
    pendingPriceFile.set(chatId, { base64: file.base64, mimeType: scanMime, filename: doc.file_name ?? "pricelist" });
    await ctx.api.editMessageText(
      chatId, waitMsg.message_id,
      "Не распознал это как PO поставщика. Если это расход — напиши сумму текстом: «856 интернет».",
      { reply_markup: new InlineKeyboard().text("Это прайс-лист →", "pslice:use") },
    );
```

Рядом с `pendingPriceSlice` добавь мапу и обработчик колбэка:

```ts
// Файл уже скачан на попытке распознать PO — держим его, чтобы кнопка
// «Это прайс-лист» не качала заново.
const pendingPriceFile = new Map<number, { base64: string; mimeType: string; filename: string }>();

bot.callbackQuery("pslice:use", async (ctx) => {
  const chatId = ctx.chat!.id;
  await ctx.answerCallbackQuery();
  if (!pendingPriceFile.has(chatId)) {
    await ctx.reply("Файл уже не в памяти — пришли его заново с подписью «прайс: все шардоне».");
    return;
  }
  pendingPriceSlice.set(chatId, { query: "" });
  await ctx.reply("Что нужно из этого прайса? Например: «все шардоне до 600».");
});
```

И в ветку `message:text`, сразу после блока доуточнения, добавь выдачу запроса к уже скачанному файлу:

```ts
  // Ответ на вопрос «что нужно из прайса?» для файла, пойманного кнопкой.
  const heldFile = pendingPriceFile.get(chatId);
  if (heldFile && pendingPriceSlice.get(chatId)?.query === "") {
    pendingPriceSlice.delete(chatId);
    pendingPriceFile.delete(chatId);
    await runPriceSlice(ctx, async () => heldFile, text);
    return;
  }
```

- [ ] **Step 8: Проверить сборку и тесты**

```bash
cd 01_agents/bot && npx tsc --noEmit && npm test
```

Ожидается: типизация чистая, все тесты бота проходят (включая прежние `errors`, `po-parse`, `writeoff-parse`).

- [ ] **Step 9: Проверить живым ботом**

Нужны `MISSION_CONTROL_URL`, `PRICE_SLICE_SECRET`, `TELEGRAM_BOT_TOKEN` в `.env.local` и запущенный портал.

```bash
cd 01_agents/bot && npm run dev
```

В телеграме проверь четыре пути:
1. `/price все шардоне` → бот просит файл → пришли PDF прайса → список + CSV.
2. Файл с подписью `прайс: все шардоне до 600` → сразу срез.
3. Reply на сообщение со срезом текстом `только Францию` → пересчитанный срез.
4. Обычный расход текстом `856 интернет` → по-прежнему уходит в расходы, а не в срез.

- [ ] **Step 10: Коммит**

```bash
git add 01_agents/bot/src/index.ts
git commit -m "прайс-срез: команда /price, маршрутизация файла и доуточнение

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Документация и переменные окружения

**Files:**
- Modify: `docs/SERVICES.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `config/secrets.example.env`

- [ ] **Step 1: Дописать публичную ручку в каталог сервисов**

Открой `docs/SERVICES.md`, найди раздел про `mission-control` и его публичные ручки, добавь в том же формате, что уже используется в файле:

```markdown
- `POST /api/public/price/slice` — разовый срез прайса для бота «Чип и Дейл»:
  multipart `file` + `query` → список позиций и полный разбор. Переиспользует
  `extractFromFile` (парсеры поставщиков + Claude-фоллбэк). В базу не пишет.
  Секрет: `PRICE_SLICE_SECRET`.
- `POST /api/public/price/slice/refine` — доуточнение по уже разобранным позициям
  (JSON `items` + `query`), без повторного парсинга файла.
```

- [ ] **Step 2: Отметить второй вход в прайс-пайплайн**

Открой `docs/ARCHITECTURE.md`, найди описание прайсового пайплайна и добавь абзац:

```markdown
У прайсового пайплайна два входа. Портальный `/m/price/upload` разбирает файл и
**сохраняет** его в `wine_items` с историей цен. Бот «Чип и Дейл» через
`/api/public/price/slice` разбирает файл **разово**, только чтобы отдать срез по
запросу («все шардоне») — в базу при этом не пишется ничего. Оба входа зовут один
и тот же `extractFromFile`, поэтому точность извлечения у них одинаковая.
```

- [ ] **Step 3: Добавить секрет в образец env**

В `config/secrets.example.env` добавь:

```
# Прайс-срез: общий секрет бота и mission-control для /api/public/price/slice
PRICE_SLICE_SECRET=
```

- [ ] **Step 4: Добавить команду в список у BotFather**

Это ручной шаг, кодом не делается. В BotFather для бота «Чип и Дейл» добавь к списку команд:

```
price - срез прайса: пришли файл и скажи, что нужно
```

- [ ] **Step 5: Коммит**

```bash
git add docs/SERVICES.md docs/ARCHITECTURE.md config/secrets.example.env
git commit -m "прайс-срез: документация и переменные окружения

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Финальная проверка и ветка

- [ ] **Step 1: Прогнать всё**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npm test && npx tsc --noEmit
cd /Users/pavelrasputin/Desktop/Wine_Whiskey/01_agents/bot && npm test && npx tsc --noEmit
```

Ожидается: оба пакета — тесты PASS, типизация без ошибок.

- [ ] **Step 2: Собрать портал**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey/02_services/mission-control && npm run build
```

Ожидается: сборка проходит, в списке роутов видны `/api/public/price/slice` и `/api/public/price/slice/refine`.

- [ ] **Step 3: Запушить ветку**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey && git push origin feat/price-slice
```

- [ ] **Step 4: Переменные на Railway (ручной шаг)**

Задай `PRICE_SLICE_SECRET` (одно и то же значение) в двух сервисах: `mission-control` и боте. У бота проверь, что `MISSION_CONTROL_URL` уже задан — он нужен был для платёжных алертов.

---

## Чего в этом плане намеренно нет

Из спеки, раздел «Вне скоупа»: пометки «есть у нас» (матчинг с Loyverse), заливки разобранного прайса в базу, страницы в портале, сборки винной карты, генерации `.xlsx`.
