import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { validateBetSlip } from '@/lib/bets'
import type { BetLine } from '@/lib/bets'
import { verifyPlayer } from '@/lib/player-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { playerId?: string; playerToken?: string; wineId?: string; slip?: BetLine[] } | null

  if (!body?.playerId || !body.playerToken || !body.wineId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (!(await verifyPlayer(body.playerId, body.playerToken))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const player = await db.getPlayer(body.playerId)
  if (!player) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const [game, wine] = await Promise.all([db.getGame(player.game_id), db.getWine(body.wineId)])
  if (!game || !wine) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // The clock is not decoration. The host may be slow to press Close, and a
  // guest who waits out the timer would otherwise bet with the last hint in
  // hand and no time risk. Small grace for a slip that left the phone in time.
  const BET_GRACE_MS = 2000
  if (wine.ends_at && Date.now() > Date.parse(wine.ends_at) + BET_GRACE_MS) {
    return NextResponse.json({ error: 'round_closed' }, { status: 409 })
  }

  const verdict = validateBetSlip({
    roundStatus: wine.status,
    activeCategories: game.categories.map(c => c.key),
    options: wine.options,
    playerChips: player.chips,
    slip: body.slip ?? [],
    playerGameId: player.game_id,
    wineGameId: wine.game_id,
  })
  if (!verdict.ok) {
    // A phone left open on last week's game must not reach into tonight's.
    const status = verdict.error === 'wrong_game' ? 403 : 409
    return NextResponse.json({ error: verdict.error }, { status })
  }

  await db.replaceBets(player.id, wine.id, (body.slip ?? []).map(l => ({
    game_id: game.id, wine_id: wine.id, player_id: player.id,
    category: l.category, option: l.option, amount: l.amount,
  })))

  return NextResponse.json({ ok: true, total: verdict.total })
}
