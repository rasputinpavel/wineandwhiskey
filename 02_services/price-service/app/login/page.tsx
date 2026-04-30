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
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      setError('Неверный пароль')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-warm-white px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-wine-600 mb-5 shadow-sm">
            <span className="font-display text-3xl text-warm-white tracking-tight leading-none">W</span>
          </div>
          <h1 className="font-display text-3xl tracking-wide leading-none">
            <span className="text-wine-600">WINE</span>
            <span className="text-ink"> &amp; WHISKEY</span>
          </h1>
          <p className="mt-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-graphite">Price Service</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-stone p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-graphite mb-1.5">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone focus:outline-none focus:ring-2 focus:ring-wine-500 focus:border-transparent text-sm"
              placeholder="••••••••"
              autoFocus
              required
            />
          </div>

          {error && (
            <p className="text-sm text-wine-700 bg-wine-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-wine-600 hover:bg-wine-700 disabled:opacity-50 text-warm-white font-medium rounded-xl transition-colors text-sm"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}
