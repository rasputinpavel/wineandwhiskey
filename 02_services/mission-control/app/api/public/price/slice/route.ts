import { NextResponse } from 'next/server'
import { ACCEPTED_TYPES } from '@/lib/price/file-types'
import { detectFileType, extractFromFile } from '@/lib/price/extract'
import { EmptyQueryError, sliceItems } from '@/lib/price/slice'
import { guardPriceApi } from '../_auth'

// Разовый разбор прайса для бота «Чип и Дейл»: файл + фраза → срез.
// В базу НИЧЕГО не пишется: ни price_list, ни wine_items. Если прайс нужен
// в базе — это другой путь, портальный /m/price/upload.

export const dynamic = 'force-dynamic'
// Замерено: 9,5-МБ PDF Enoteca (50 страниц через Vision) разбирается 6 мин.
export const maxDuration = 600

const MAX_BYTES = 20 * 1024 * 1024   // предел Telegram getFile

export async function POST(req: Request) {
  const denied = guardPriceApi(req)
  if (denied) return denied

  // Размер проверяем ДО formData: тело больше потолка middleware приходит
  // обрезанным, и formData падает невнятным «ожидается multipart/form-data».
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: 'файл больше 20 МБ' }, { status: 413 })
  }

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
