import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ADMIN_COOKIE, requiredCasinoSecret, verifyAdminToken } from '@/lib/admin-auth'

// Everything except /admin is public by design: guests, the host and the TV all
// carry their own token in the URL or in localStorage.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  if (!isAdmin) return NextResponse.next()

  const secret = requiredCasinoSecret()
  const ok = await verifyAdminToken(secret, request.cookies.get(ADMIN_COOKIE)?.value)
  if (ok) return NextResponse.next()

  // API routes must 401, never redirect: a redirect returns the login page with
  // HTTP 200 and client `fetch` reads that as success, silently dropping a save.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
