import { findItem, SECTIONS } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { UserForm } from '../UserForm'

export const dynamic = 'force-dynamic'

export default function NewUserPage() {
  const item = findItem('users')!
  const sections = SECTIONS.map(s => ({ key: s.key, label: s.label, items: s.items.map(i => ({ slug: i.slug, name: i.name })) }))
  return (
    <div>
      <PaneHeader item={item} />
      <div className="p-6">
        <h2 className="mb-4 font-heading text-lg text-deep-black">New user</h2>
        <UserForm sections={sections} />
      </div>
    </div>
  )
}
