import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { prepareWine } from '@/lib/prepare-wine'
import type { Hint } from '@/lib/types'
import type { WineInput } from '../route'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ gameId: string; wineId: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const { gameId, wineId } = await params
  const body = await req.json().catch(() => null) as (Partial<WineInput> & { hints?: Hint[] }) | null
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const [game, current] = await Promise.all([db.getGame(gameId), db.getWine(wineId)])
  if (!game || !current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const facts = {
    name:    body.name?.trim() ?? current.name,
    country: body.country !== undefined ? body.country : current.country,
    region:  body.region  !== undefined ? body.region  : current.region,
    grape:   body.grape   !== undefined ? body.grape   : current.grape,
    vintage: body.vintage !== undefined ? body.vintage : current.vintage,
    style:   body.style   !== undefined ? body.style   : current.style,
    color:   body.color   !== undefined ? body.color   : current.color,
    abv:     body.abv     !== undefined ? body.abv     : current.abv,
  }

  // `hints: []` from the admin means "regenerate"; a non-empty array is a
  // hand-written set we must keep verbatim.
  const prepared = prepareWine(
    facts, game.categories, game.difficulty, game.round_seconds,
    body.hints && body.hints.length > 0 ? body.hints : null,
  )

  const wine = await db.updateWine(wineId, {
    ...facts,
    sku: body.sku !== undefined ? body.sku : current.sku,
    image_url: body.imageUrl !== undefined ? body.imageUrl : current.image_url,
    ...prepared,
  })

  return NextResponse.json({ wine })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { wineId } = await params
  await db.deleteWine(wineId)
  return NextResponse.json({ ok: true })
}
