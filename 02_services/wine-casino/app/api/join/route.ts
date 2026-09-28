import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { uniqueNickname } from '@/lib/pin'
import { hashToken, newPlayerToken } from '@/lib/player-auth'
import type { Lang } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { pin?: string; nickname?: string; lang?: Lang } | null
  if (!body?.pin) return NextResponse.json({ error: 'pin_required' }, { status: 400 })

  const game = await db.getGameByPin(String(body.pin).trim())
  if (!game) return NextResponse.json({ error: 'game_not_found' }, { status: 404 })
  if (game.status === 'finished') return NextResponse.json({ error: 'game_finished' }, { status: 409 })
  if (game.status === 'draft') return NextResponse.json({ error: 'game_not_open' }, { status: 409 })

  const players = await db.listPlayers(game.id)
  const nickname = uniqueNickname(body.nickname ?? '', players.map(p => p.nickname))
  const lang: Lang = body.lang === 'en' ? 'en' : 'ru'

  // A latecomer gets the full starting stack. Averaging against the table was
  // considered and dropped: it rewards joining late when the leaders are rich.
  const player = await db.insertPlayer({
    game_id: game.id, nickname, chips: game.starting_chips, lang,
  })

  const token = newPlayerToken()
  await db.savePlayerSecret(player.id, hashToken(token))

  return NextResponse.json({
    gameId: game.id,
    playerId: player.id,
    playerToken: token,
    nickname: player.nickname,
    chips: player.chips,
    lang,
  })
}
