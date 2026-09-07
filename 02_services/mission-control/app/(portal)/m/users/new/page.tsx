import { findItem, SECTIONS } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { UserForm } from '../UserForm'

export const dynamic = 'force-dynamic'

export default function NewUserPage() {
  const item = findItem('users')!
  const sections = SECTIONS.map(s => ({ key: s.key, label: s.label, items: s.items.map(i => ({ slug: i.slug, name: i.name })) }))
  return (
    <>
      <PaneHeader item={item} />
      {/* AppShell's content column is `h-screen overflow-hidden`, so this page
          has to own its vertical scroll — a plain padded div clips the form
          (the section-access checkboxes fall off the bottom). */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        <h2 className="mb-4 font-heading text-lg text-deep-black">New user</h2>
        <UserForm sections={sections} />
      </div>
    </>
  )
}
