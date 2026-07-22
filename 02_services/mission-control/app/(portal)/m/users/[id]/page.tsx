import { notFound } from 'next/navigation'
import { findItem, SECTIONS } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { listUsers } from '@/lib/portal/users-store'
import { UserForm } from '../UserForm'

export const dynamic = 'force-dynamic'

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = findItem('users')!
  const users = await listUsers()
  const user = users.find(u => u.id === id)
  if (!user) notFound()

  const sections = SECTIONS.map(s => ({ key: s.key, label: s.label, items: s.items.map(i => ({ slug: i.slug, name: i.name })) }))
  return (
    <div>
      <PaneHeader item={item} />
      <div className="p-6">
        <h2 className="mb-4 font-heading text-lg text-deep-black">Edit {user.login}</h2>
        <UserForm sections={sections}
          user={{ id: user.id, login: user.login, is_admin: user.is_admin, disabled: user.disabled, allowed: user.allowed }} />
      </div>
    </div>
  )
}
