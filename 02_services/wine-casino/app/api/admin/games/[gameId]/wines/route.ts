import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { prepareWine } from '@/lib/prepare-wine'
import type { WineColor } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ gameId: string }> }

export type WineInput = {
  sku?: string | null
  name: string
  country?: string | null
  region?: string | null
  grape?: string | null
  vintage?: number | null
  style?: string | null
  color?: WineColor | null
  abv?: number | null
  imageUrl?: string | null
}

export async function POST(req: Request, { params }: Ctx) {
  const { gameId } = await params
  const body = await req.json().catch(() => null) as WineInput | null
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const game = await db.getGame(gameId)
  if (!game) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const existing = await db.listWines(gameId)
  // Not existing.length + 1: deleting a wine never renumbers the rest (the
  // guest-facing label is `#${orderNo}`, and a hole like "#1, #3" is honest),
  // so the next slot has to be one past the highest order_no still on file --
  // otherwise the next insert collides with a live row under the
  // `unique (game_id, order_no)` constraint and 500s.
  const orderNo = existing.reduce((max, w) => Math.max(max, w.order_no), 0) + 1

  const facts = {
    name: body.name.trim(),
    country: body.country ?? null,
    region: body.region ?? null,
    grape: body.grape ?? null,
    vintage: body.vintage ?? null,
    style: body.style ?? null,
    color: body.color ?? null,
    abv: body.abv ?? null,
  }
  const prepared = prepareWine(facts, game.categories, game.difficulty, game.round_seconds, null)

  const wine = await db.insertWine({
    game_id: gameId,
    order_no: orderNo,
    // Guests must never see the real name before the reveal, so the label is
    // deliberately a number, not the bottle.
    label: `#${orderNo}`,
    sku: body.sku ?? null,
    image_url: body.imageUrl ?? null,
    ...facts,
    ...prepared,
    status: 'pending',
  })

  return NextResponse.json({ wine })
}
