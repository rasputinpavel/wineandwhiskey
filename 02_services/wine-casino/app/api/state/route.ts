import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { tickHints } from '@/lib/round'
import { verifyPlayer } from '@/lib/player-auth'

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
  // A bearer token, not a query param: query strings end up in access logs,
  // and a player's own slip is exactly what this endpoint must not hand to
  // anyone who merely knows their id (the PIN is on the TV for everyone to see).
  const playerToken = req.headers.get('x-player-token')

  const game = gameId ? await db.getGame(gameId) : pin ? await db.getGameByPin(pin) : null
  if (!game) return NextResponse.json({ error: 'game_not_found' }, { status: 404 })

  await tickHints(game)

  const [state, players] = await Promise.all([
    db.getRoundState(game.id),
    db.listPlayers(game.id),
  ])

  // A player's own slip is private: the PIN is public, so identity has to be
  // proved, not asserted. Unverified callers still get the public projection
  // and the leaderboard — that is what the TV and the lobby need.
  const claimed = playerId && playerToken && (await verifyPlayer(playerId, playerToken))
    ? players.find(p => p.id === playerId) ?? null
    : null
  const me = claimed
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
    me: me
      ? { id: me.id, nickname: me.nickname, chips: me.chips, lang: me.lang, rescued: me.rescued }
      : null,
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
