'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) router.push('/admin')
    else setError('Wrong password')
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="font-display text-4xl tracking-display text-amber-gold">WINE CASINO</h1>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Admin password"
          className="w-full rounded-md bg-graphite/40 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-gold"
        />
        {error && <p className="text-wine-red text-sm">{error}</p>}
        <button className="w-full rounded-md bg-amber-gold py-3 font-heading text-deep-black">
          Sign in
        </button>
      </form>
    </main>
  )
}
