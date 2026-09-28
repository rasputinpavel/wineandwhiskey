import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { lockRound, nextWine, openLobby, revealRound, startRound } from '@/lib/round'

export const dynamic = 'force-dynamic'

type Action = 'open' | 'start' | 'lock' | 'reveal' | 'next'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { t?: string; action?: Action } | null
  if (!body?.t || !body.action) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const game = await db.getGameByHostToken(body.t)
  if (!game) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  switch (body.action) {
    case 'open':
      await openLobby(game)
      return NextResponse.json({ ok: true })
    case 'start': {
      const wine = await startRound(game)
      return NextResponse.json({ ok: true, wineId: wine.id })
    }
    case 'lock':
      await lockRound(game)
      return NextResponse.json({ ok: true })
    case 'reveal': {
      const summary = await revealRound(game)
      return NextResponse.json({ ok: true, summary })
    }
    case 'next': {
      const wine = await nextWine(game)
      return NextResponse.json({ ok: true, wineId: wine?.id ?? null, finished: wine === null })
    }
    default:
      return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  }
}
