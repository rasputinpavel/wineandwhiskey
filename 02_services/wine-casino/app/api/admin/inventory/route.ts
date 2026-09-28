import { NextResponse } from 'next/server'
import { searchInventory } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ hits: [] })
  return NextResponse.json({ hits: await searchInventory(q) })
}
