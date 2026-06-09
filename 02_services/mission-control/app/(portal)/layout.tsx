import { cookies } from 'next/headers'
import { AppShell } from '@/components/shell/AppShell'
import { verifyToken, hasAccess, COOKIE_NAME } from '@/lib/auth'
import { ITEMS } from '@/lib/registry'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  const allowedSlugs = user ? ITEMS.filter(i => hasAccess(user, i.slug)).map(i => i.slug) : []

  return (
    <AppShell allowedSlugs={allowedSlugs} userLogin={user?.login ?? ''}>
      {children}
    </AppShell>
  )
}
