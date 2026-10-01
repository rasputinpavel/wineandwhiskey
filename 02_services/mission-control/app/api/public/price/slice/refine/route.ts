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
