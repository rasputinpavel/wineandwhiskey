'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Row = {
  id: string; login: string; is_admin: boolean; disabled: boolean
  access: string; created_at: string
}

export function UsersTableClient({ users }: { users: Row[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleDisabled(u: Row) {
    setBusy(u.id); setError(null)
    const res = await fetch(`/api/m/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: !u.disabled }),
    })
    setBusy(null)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Failed'); return }
    router.refresh()
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-wine-red">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pale-stone text-left text-graphite">
            <th className="py-2 pr-4">Login</th>
            <th className="py-2 pr-4">Access</th>
            <th className="py-2 pr-4">Admin</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className="border-b border-pale-stone/60">
              <td className="py-2 pr-4 font-medium">{u.login}</td>
              <td className="py-2 pr-4 text-graphite">{u.access}</td>
              <td className="py-2 pr-4">{u.is_admin ? '✓' : ''}</td>
              <td className="py-2 pr-4">{u.disabled ? <span className="text-wine-red">disabled</span> : 'active'}</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">
                <Link href={`/m/users/${u.id}`} className="text-deep-black underline mr-3">Edit</Link>
                <button onClick={() => toggleDisabled(u)} disabled={busy === u.id} className="text-graphite underline">
                  {u.disabled ? 'Enable' : 'Disable'}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr><td colSpan={5} className="py-6 text-center text-graphite">No users yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
