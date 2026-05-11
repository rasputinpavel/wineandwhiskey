import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, hasAccess, COOKIE_NAME } from '@/lib/auth'
import { ITEMS } from '@/lib/registry'

const PUBLIC = ['/login', '/api/auth/login', '/api/health', '/api/public/']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next()

  const token = request.cookies.get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Section-level access check for /m/<slug>/...
  if (pathname.startsWith('/m/')) {
    const slug = pathname.split('/')[2]
    if (slug && ITEMS.some(i => i.slug === slug) && !hasAccess(user, slug)) {
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
