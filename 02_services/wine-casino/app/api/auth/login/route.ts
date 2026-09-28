import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, ADMIN_MAX_AGE, requiredCasinoSecret, signAdminToken } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { password?: string } | null
  const expected = process.env.CASINO_ADMIN_PASSWORD
  if (!expected) return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  if (body?.password !== expected) {
    return NextResponse.json({ error: 'bad_password' }, { status: 401 })
  }

  const token = await signAdminToken(requiredCasinoSecret(), ADMIN_MAX_AGE * 1000)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    maxAge: ADMIN_MAX_AGE, secure: process.env.NODE_ENV === 'production',
  })
  return res
}
