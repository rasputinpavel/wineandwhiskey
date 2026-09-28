import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { DEFAULT_CATEGORIES } from '@/lib/categories'
import { generatePin } from '@/lib/pin'
import type { CategoryKey, Difficulty } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const games = await db.listGames()
  return NextResponse.json({ games })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    title?: string
    difficulty?: Difficulty
    startingChips?: number
    rescueChips?: number
    roundSeconds?: number
    categoryKeys?: CategoryKey[]
  } | null

  const keys = body?.categoryKeys?.length ? body.categoryKeys : DEFAULT_CATEGORIES.map(c => c.key)
  const categories = DEFAULT_CATEGORIES.filter(c => keys.includes(c.key))

  // Six digits gives a 1-in-900k collision chance; retry a few times anyway
  // rather than hand the host a 500 on the one evening they are using this.
  let pin = generatePin()
  for (let i = 0; i < 5 && (await db.getGameByPin(pin)); i++) pin = generatePin()

  const game = await db.insertGame({
    pin,
    title: body?.title?.trim() || 'Wine Casino',
    status: 'draft',
    difficulty: body?.difficulty ?? 'medium',
    starting_chips: body?.startingChips ?? 100,
    rescue_chips: body?.rescueChips ?? 10,
    round_seconds: body?.roundSeconds ?? 120,
    categories,
  })

  return NextResponse.json({ game })
}
