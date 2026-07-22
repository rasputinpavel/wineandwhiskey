// GET  /api/m/users — list all portal users (no password hashes)
// POST /api/m/users — create a user
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/portal/require-admin'
import { listUsers, createUser } from '@/lib/portal/users-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ users: await listUsers() })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const login = typeof body.login === 'string' ? body.login.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!login || !password) return NextResponse.json({ error: 'login and password required' }, { status: 400 })

  const allowed: '*' | string[] = body.allowed === '*'
    ? '*'
    : Array.isArray(body.allowed) ? body.allowed.filter((s): s is string => typeof s === 'string') : []
  const is_admin = body.is_admin === true

  try {
    const { user, error } = await createUser({ login, password, allowed, is_admin })
    if (error === 'duplicate') return NextResponse.json({ error: 'login already exists' }, { status: 409 })
    if (error) return NextResponse.json({ error }, { status: 503 })
    return NextResponse.json({ user }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}
