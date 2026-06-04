import { NextResponse } from 'next/server'
import { listInStock } from '@/lib/wines'

// Public JSON feed for the wizard client component. Cached server-side already.
export async function GET() {
  const wines = await listInStock()
  return NextResponse.json({ wines })
}
