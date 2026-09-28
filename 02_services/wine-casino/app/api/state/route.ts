import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { tickHints } from '@/lib/round'

export const dynamic = 'force-dynamic'

/**
 * Polling fallback for phones whose Realtime socket did not come up, and the
 * screen's first paint. Also ticks hints, so a game still reveals them if the
 * host panel is asleep but guests are looking at their phones.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const pin = url.searchParams.get('pin')
  const gameId = url.searchParams.get('gameId')
  const playerId = url.searchParams.get('playerId')

  const game = gameId ? await db.getGame(gameId) : pin ? await db.getGameByPin(pin) : null
  if (!game) return NextResponse.json({ error: 'game_not_found' }, { status: 404 })

  await tickHints(game)

  const [state, players] = await Promise.all([
    db.getRoundState(game.id),
    db.listPlayers(game.id),
  ])

  const me = playerId ? players.find(p => p.id === playerId) ?? null : null
  const myBets = me && state?.wine_id
    ? await db.listBetsForPlayerWine(me.id, state.wine_id)
    : []

  return NextResponse.json({
    game: {
      id: game.id, pin: game.pin, title: game.title, status: game.status,
      categories: game.categories, roundSeconds: game.round_seconds,
    },
    state,
    players: players.map(p => ({ id: p.id, nickname: p.nickname, chips: p.chips })),
    me: me ? { id: me.id, nickname: me.nickname, chips: me.chips, lang: me.lang } : null,
    // Outcomes are written to the bet rows a moment before the round flips to
    // 'revealed'. Handing them out during that window lets a guest learn they
    // were right before the host has said a word — and someone always shouts.
    myBets: myBets.map(b => ({
      category: b.category,
      option: b.option,
      amount: b.amount,
      isCorrect: state?.round_status === 'revealed' ? b.is_correct : null,
      payout: state?.round_status === 'revealed' ? b.payout : null,
    })),
  })
}
