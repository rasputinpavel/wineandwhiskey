import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, hasAccess, COOKIE_NAME } from '@/lib/auth'
import { ITEMS } from '@/lib/registry'

// Public, unauthenticated routes. `/russian-wine` is the consumer-facing
// Russian-wine festival landing (QR target) — must bypass the portal login,
// and `/brand/products/` serves the bottle images it embeds.
const PUBLIC = ['/login', '/api/auth/login', '/api/health', '/api/public/', '/russian-wine', '/brand/products/']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next()

  const token = request.cookies.get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  if (!user) {
    // API routes must fail loudly with 401 — never a redirect. A redirect to
    // /login returns the login page with HTTP 200, which `fetch` follows and
    // client code reads as success, silently dropping the mutation (e.g. a
    // supplier Terms save that "saved" but never reached the DB).
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Section-level access check for /m/<slug>/...
  if (pathname.startsWith('/m/')) {
    const slug = pathname.split('/')[2]
    if (slug && ITEMS.some(i => i.slug === slug) && !hasAccess(user, slug)) {
      // Same rule for API: 403 JSON, not an HTML redirect.
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
