import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { tickHints } from '@/lib/round'

export const dynamic = 'force-dynamic'

/**
 * The host panel calls this every two seconds while a round is running. It is
 * the game's clock: hints become visible because this fires, not because a
 * phone decided it was time. Cheap and idempotent.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { t?: string } | null
  if (!body?.t) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const game = await db.getGameByHostToken(body.t)
  if (!game) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const hints = await tickHints(game)
  return NextResponse.json({ ok: true, hints })
}
