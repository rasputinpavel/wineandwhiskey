'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

export function CallStaffButton() {
  const pathname = usePathname()
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  // Hide on the home screen — staff is presumably nearby when nobody is in flow.
  if (pathname === '/') return null

  async function call() {
    if (state !== 'idle') return
    setState('sending')
    try {
      await fetch('/api/call-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathname }),
      })
      setState('sent')
      setTimeout(() => setState('idle'), 10_000)
    } catch {
      setState('idle')
    }
  }

  return (
    <button
      onClick={call}
      className="fixed bottom-6 right-6 h-20 px-8 rounded-lg bg-wine-red text-warm-white font-heading font-semibold text-2xl shadow-lg active:bg-burgundy-deep disabled:opacity-60"
      disabled={state !== 'idle'}
    >
      {state === 'sent' ? 'Staff notified ✓' : state === 'sending' ? '…' : 'Позвать продавца'}
    </button>
  )
}
