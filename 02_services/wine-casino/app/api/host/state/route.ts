import { NextResponse } from 'next/server'
import * as db from '@/lib/db'

export const dynamic = 'force-dynamic'

/** The host sees everything, including the answers — they are reading them out. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t')
  if (!token) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const game = await db.getGameByHostToken(token)
  if (!game) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const [wines, players, state] = await Promise.all([
    db.listWines(game.id),
    db.listPlayers(game.id),
    db.getRoundState(game.id),
  ])

  return NextResponse.json({ game, wines, players, state })
}
