'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Section/item shape passed from the server (from lib/registry SECTIONS).
export type SectionOpt = { key: string; label: string; items: { slug: string; name: string }[] }

export type ExistingUser = {
  id: string; login: string; is_admin: boolean; disabled: boolean; allowed: '*' | string[]
}

type Props = { sections: SectionOpt[]; user?: ExistingUser }

export function UserForm({ sections, user }: Props) {
  const router = useRouter()
  const isEdit = !!user

  const [login, setLogin] = useState(user?.login ?? '')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(user?.is_admin ?? false)
  const [fullAccess, setFullAccess] = useState(user?.allowed === '*')
  const [selected, setSelected] = useState<Set<string>>(
    new Set(Array.isArray(user?.allowed) ? user!.allowed : []),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function buildAllowed(): '*' | string[] {
    if (fullAccess) return '*'
    return [...selected]
  }

  async function submit() {
    setBusy(true); setError(null)
    const allowed = buildAllowed()
    try {
      if (isEdit) {
        const body: Record<string, unknown> = { allowed, is_admin: isAdmin }
        if (password) body.password = password
        const res = await fetch(`/api/m/users/${user!.id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Failed'); setBusy(false); return }
        router.push('/m/users'); router.refresh()
      } else {
        const res = await fetch('/api/m/users', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ login, password, allowed, is_admin: isAdmin }),
        })
        if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Failed'); setBusy(false); return }
        // Show the password once, then let the admin return to the list.
        setCreatedPassword(password); setBusy(false)
      }
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  if (createdPassword) {
    return (
      <div className="max-w-md">
        <p className="mb-2 text-sm">User <strong>{login}</strong> created.</p>
        <p className="mb-4 text-sm text-graphite">
          Password (shown once — copy it now and hand it over):
        </p>
        <code className="block rounded bg-pale-stone/40 px-3 py-2 text-sm">{createdPassword}</code>
        <button onClick={() => { router.push('/m/users'); router.refresh() }}
          className="mt-4 rounded-md bg-deep-black px-4 py-2 text-sm text-warm-white">
          Back to users
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      {error && <p className="mb-3 text-sm text-wine-red">{error}</p>}

      <label className="mb-1 block text-sm font-medium">Login</label>
      <input value={login} onChange={e => setLogin(e.target.value)} disabled={isEdit}
        className="mb-4 w-full rounded border border-pale-stone px-3 py-2 text-sm disabled:bg-pale-stone/30" />

      <label className="mb-1 block text-sm font-medium">{isEdit ? 'New password (leave blank to keep)' : 'Password'}</label>
      <input value={password} onChange={e => setPassword(e.target.value)} type="text" autoComplete="off"
        className="mb-4 w-full rounded border border-pale-stone px-3 py-2 text-sm" />

      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} />
        Admin (can manage users; implies full access)
      </label>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fullAccess} onChange={e => setFullAccess(e.target.checked)} />
        Full access to all sections
      </label>

      {!fullAccess && !isAdmin && (
        <div className="mb-4 rounded border border-pale-stone p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-graphite">Section access</p>
          {sections.map(s => (
            <div key={s.key} className="mb-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggle(s.key)} />
                {s.label} <span className="text-xs text-graphite">(whole section)</span>
              </label>
              {!selected.has(s.key) && (
                <div className="ml-6 mt-1">
                  {s.items.map(it => (
                    <label key={it.slug} className="flex items-center gap-2 text-sm text-graphite">
                      <input type="checkbox" checked={selected.has(it.slug)} onChange={() => toggle(it.slug)} />
                      {it.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={submit} disabled={busy || (!isEdit && (!login || !password))}
        className="rounded-md bg-deep-black px-4 py-2 text-sm text-warm-white disabled:opacity-40">
        {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
      </button>
    </div>
  )
}
