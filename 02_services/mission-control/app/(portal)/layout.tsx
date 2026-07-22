import { cookies } from 'next/headers'
import { AppShell } from '@/components/shell/AppShell'
import { verifyToken, hasAccess, COOKIE_NAME } from '@/lib/auth'
import { ITEMS } from '@/lib/registry'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  // `users` is admin-only regardless of the allowlist; everything else via hasAccess
  // (admins get all of it because is_admin short-circuits hasAccess).
  const allowedSlugs = user
    ? ITEMS.filter(i => (i.slug === 'users' ? !!user.is_admin : hasAccess(user, i.slug))).map(i => i.slug)
    : []

  return (
    <AppShell allowedSlugs={allowedSlugs} userLogin={user?.login ?? ''}>
      {children}
    </AppShell>
  )
}
