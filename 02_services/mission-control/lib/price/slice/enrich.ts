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
