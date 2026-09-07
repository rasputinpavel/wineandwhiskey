import Link from 'next/link'
import { findItem, SECTIONS } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { listUsers } from '@/lib/portal/users-store'
import { UsersTableClient } from './UsersTableClient'

export const dynamic = 'force-dynamic'

// Human-readable summary of an `allowed` value using registry labels.
function accessSummary(allowed: '*' | string[]): string {
  if (allowed === '*') return 'Full access'
  if (allowed.length === 0) return 'No access'
  const labels = allowed.map(key => {
    const section = SECTIONS.find(s => s.key === key)
    if (section) return section.label
    const item = findItem(key)
    return item ? item.name : key
  })
  return labels.join(', ')
}

export default async function UsersPage() {
  const item = findItem('users')!
  const users = await listUsers()

  return (
    <>
      <PaneHeader item={item} />
      {/* AppShell's content column is `h-screen overflow-hidden`, so this page
          has to own its vertical scroll — a plain padded div clips the list. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="mb-4">
          <Link href="/m/users/new" className="inline-block rounded-md bg-deep-black px-4 py-2 text-sm text-warm-white">
            + New user
          </Link>
        </div>
        <UsersTableClient
          users={users.map(u => ({
            id: u.id, login: u.login, is_admin: u.is_admin, disabled: u.disabled,
            access: accessSummary(u.allowed), created_at: u.created_at,
          }))}
        />
      </div>
    </>
  )
}
