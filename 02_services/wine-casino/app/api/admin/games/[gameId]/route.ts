import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { prepareWine } from '@/lib/prepare-wine'
import { DEFAULT_CATEGORIES } from '@/lib/categories'
import type { CategoryKey, Difficulty } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ gameId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { gameId } = await params
  const game = await db.getGame(gameId)
  if (!game) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const wines = await db.listWines(gameId)
  return NextResponse.json({ game, wines })
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { gameId } = await params
  const body = await req.json().catch(() => null) as {
    title?: string
    difficulty?: Difficulty
    startingChips?: number
    rescueChips?: number
    roundSeconds?: number
    categoryKeys?: CategoryKey[]
  } | null
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.title !== undefined)         patch.title = body.title.trim() || 'Wine Casino'
  if (body.difficulty !== undefined)    patch.difficulty = body.difficulty
  if (body.startingChips !== undefined) patch.starting_chips = body.startingChips
  if (body.rescueChips !== undefined)   patch.rescue_chips = body.rescueChips
  if (body.roundSeconds !== undefined)  patch.round_seconds = body.roundSeconds
  if (body.categoryKeys !== undefined) {
    patch.categories = DEFAULT_CATEGORIES.filter(c => body.categoryKeys!.includes(c.key))
  }

  const game = await db.updateGame(gameId, patch)

  // Difficulty, round length and the category set all change what a board and a
  // hint schedule should look like, so every wine is rebuilt. Hand-edited hint
  // text is intentionally discarded here — the admin is changing the rules.
  if (body.categoryKeys !== undefined || body.difficulty !== undefined || body.roundSeconds !== undefined) {
    const wines = await db.listWines(gameId)
    for (const w of wines) {
      const prepared = prepareWine(db.factsOf(w), game.categories, game.difficulty, game.round_seconds, null)
      await db.updateWine(w.id, prepared)
    }
  }

  return NextResponse.json({ game })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { gameId } = await params
  await db.deleteGame(gameId)
  return NextResponse.json({ ok: true })
}
