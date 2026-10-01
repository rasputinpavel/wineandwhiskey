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
