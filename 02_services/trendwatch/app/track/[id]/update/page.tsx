'use client'

import { useState, use } from 'react'
import Shell from '@/components/Shell'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function UpdateMetricsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [form, setForm] = useState({
    views_7d: '',
    views_14d: '',
    views_30d: '',
    likes_count: '',
    followers_gained: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  function set(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const payload: Record<string, number | string | null> = {}
    for (const [k, v] of Object.entries(form)) {
      if (k === 'notes') {
        payload[k] = v || null
      } else {
        payload[k] = v ? parseInt(v) : null
      }
    }

    await fetch(`/api/our-reels/${id}/metrics`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    setSaving(false)
    router.push('/track')
  }

  const fields = [
    { key: 'views_7d', label: '7-day views' },
    { key: 'views_14d', label: '14-day views' },
    { key: 'views_30d', label: '30-day views' },
    { key: 'likes_count', label: 'Likes' },
    { key: 'followers_gained', label: 'Followers gained' },
  ]

  return (
    <Shell>
      <div className="p-8 max-w-lg">
        <Link href="/track" className="text-gray-500 text-sm hover:text-gray-300 mb-6 inline-block">← Track</Link>
        <h1 className="text-2xl font-bold text-white mb-6">Update metrics</h1>

        <form onSubmit={handleSave} className="space-y-4">
          {fields.map(({ key, label }) => (
            <div key={key}>
              <label className="block text-xs text-gray-400 mb-1">{label}</label>
              <input
                type="number"
                value={form[key as keyof typeof form]}
                onChange={e => set(key, e.target.value)}
                placeholder="—"
                className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm resize-none"
              placeholder="Observations…"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save metrics'}
            </button>
            <Link href="/track" className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </Shell>
  )
}
