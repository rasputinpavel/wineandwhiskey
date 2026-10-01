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
