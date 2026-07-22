import { NextRequest, NextResponse } from 'next/server'
import { checkCredentials, createToken, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { login, password } = await req.json()
  if (typeof login !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const user = await checkCredentials(login, password)
  if (!user) {
    return NextResponse.json({ error: 'Wrong login or password' }, { status: 401 })
  }
  const token = await createToken(user.login)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
  })
  return res
}
