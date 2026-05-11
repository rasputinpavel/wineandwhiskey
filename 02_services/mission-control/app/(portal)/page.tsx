import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { verifyToken, hasAccess, COOKIE_NAME } from '@/lib/auth'
import { ITEMS, DEFAULT_ROUTE } from '@/lib/registry'

export default async function PortalIndex() {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  if (!user) redirect('/login')

  const defaultItem = ITEMS.find(i => i.route === DEFAULT_ROUTE)
  if (defaultItem && hasAccess(user, defaultItem.slug)) redirect(DEFAULT_ROUTE)

  const firstAllowed = ITEMS.find(i => hasAccess(user, i.slug))
  if (firstAllowed) redirect(firstAllowed.route)

  return (
    <div className="flex-1 flex items-center justify-center text-graphite">
      <div className="text-center max-w-sm px-6">
        <div className="text-base mb-2 text-deep-black">No sections assigned</div>
        <div className="text-sm">Your account ({user.login}) has no portal access. Ask the admin to grant sections in <code>MC_USERS</code>.</div>
      </div>
    </div>
  )
}
