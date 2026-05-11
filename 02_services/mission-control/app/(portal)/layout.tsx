import { cookies } from 'next/headers'
import { Sidebar } from '@/components/shell/Sidebar'
import { verifyToken, hasAccess, COOKIE_NAME } from '@/lib/auth'
import { ITEMS } from '@/lib/registry'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  const allowedSlugs = user ? ITEMS.filter(i => hasAccess(user, i.slug)).map(i => i.slug) : []

  return (
    <div className="flex min-h-screen bg-warm-white">
      <Sidebar allowedSlugs={allowedSlugs} userLogin={user?.login ?? ''} />
      <div className="flex flex-col flex-1 h-screen overflow-hidden">
        {children}
      </div>
    </div>
  )
}
