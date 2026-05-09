'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setLoading(false)
    if (res.ok) { router.push('/'); router.refresh() }
    else { setError('Wrong password') }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-warm-white px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="flex items-baseline justify-center gap-1 mb-2">
            <span className="font-display text-4xl tracking-display text-wine-red leading-none">WINE</span>
            <span className="font-display text-4xl tracking-display text-deep-black leading-none ml-1">&amp; WHISKEY</span>
          </div>
          <div className="overline text-graphite mt-3">Internal Portal · Phuket</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-warm-white border border-pale-stone rounded-sm text-deep-black placeholder-graphite/60 focus:outline-none focus:border-wine-red"
            autoFocus
          />
          {error && <p className="text-wine-red text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-wine-red hover:bg-burgundy-deep text-warm-white font-medium rounded-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
