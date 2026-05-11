'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LEAD_STAGES, LEAD_STAGE_LABEL,
  type Lead, type LeadStage, staleDays, isStale,
} from '@/lib/sales/types'
import { BUSINESS_KINDS, BUSINESS_KIND_LABEL, type BusinessKind } from '@/lib/sales/config'

export function LeadsTableClient({ leads }: { leads: Lead[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editingNote, setEditingNote] = useState<string | null>(null)

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/m/sales/leads/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'unknown' }))
      alert(`Update failed: ${error}`)
    } else {
      start(() => router.refresh())
    }
  }

  async function logContact(id: string, kind: 'call' | 'meeting' | 'whatsapp' | 'email') {
    const res = await fetch(`/api/m/sales/leads/${id}/contact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'unknown' }))
      alert(`Failed to log contact: ${error}`)
    } else {
      start(() => router.refresh())
    }
  }

  if (leads.length === 0) {
    return (
      <div className="border border-pale-stone rounded-md bg-warm-white p-8 text-center text-graphite text-sm">
        No leads yet. Hit «New scrape ↗» above to import some.
      </div>
    )
  }

  return (
    <div className="border border-pale-stone rounded-md overflow-hidden bg-warm-white">
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[110px]" />
          <col className="w-[100px]" />
          <col className="w-[90px]" />
          <col className="w-[140px]" />
          <col className="w-[110px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
        </colgroup>
        <thead className="bg-cream/50 border-b border-pale-stone">
          <tr className="text-left text-graphite">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-2 py-2 font-medium">Kind</th>
            <th className="px-2 py-2 font-medium">District</th>
            <th className="px-2 py-2 font-medium text-right">Rating</th>
            <th className="px-2 py-2 font-medium">Stage</th>
            <th className="px-2 py-2 font-medium">Assignee</th>
            <th className="px-2 py-2 font-medium">Last contact</th>
            <th className="px-2 py-2 font-medium">Touch</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(lead => {
            const stale = isStale(lead, 5)
            const dayCount = staleDays(lead)
            return (
              <tr key={lead.id} className={`border-t border-pale-stone ${stale ? 'bg-wine-red/5' : ''}`}>
                <td className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    {stale && <span className="text-wine-red text-base leading-none mt-0.5" title={`${dayCount}d since last contact`}>●</span>}
                    <div className="min-w-0">
                      <Link href={`/m/sales/${lead.id}`} className="font-medium text-deep-black truncate hover:text-wine-red block" title={lead.name}>
                        {lead.name}
                      </Link>
                      <div className="text-[11px] text-graphite flex flex-wrap gap-2 mt-0.5">
                        {lead.phone && <a href={`tel:${lead.phone}`} className="hover:text-wine-red">{lead.phone}</a>}
                        {lead.website && <a href={lead.website} target="_blank" rel="noopener" className="hover:text-wine-red truncate max-w-[180px]">site ↗</a>}
                        {lead.menu_url && <a href={lead.menu_url} target="_blank" rel="noopener" className="hover:text-wine-red">menu ↗</a>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <select
                    defaultValue={lead.business_kind}
                    disabled={pending}
                    onChange={e => patch(lead.id, { business_kind: e.target.value as BusinessKind })}
                    className="bg-transparent border-0 text-xs text-graphite hover:text-deep-black focus:outline-none"
                  >
                    {BUSINESS_KINDS.map(k => <option key={k} value={k}>{BUSINESS_KIND_LABEL[k]}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2 text-xs text-graphite">{lead.district ?? '—'}</td>
                <td className="px-2 py-2 text-xs text-right whitespace-nowrap">
                  {lead.rating != null ? (
                    <span className="text-deep-black">{lead.rating.toFixed(1)} <span className="text-graphite">({lead.reviews_count ?? 0})</span></span>
                  ) : '—'}
                </td>
                <td className="px-2 py-2">
                  <select
                    defaultValue={lead.stage}
                    disabled={pending}
                    onChange={e => patch(lead.id, { stage: e.target.value as LeadStage })}
                    className="text-xs px-1.5 py-0.5 border border-pale-stone rounded-sm bg-warm-white"
                  >
                    {LEAD_STAGES.map(s => <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    defaultValue={lead.assignee ?? ''}
                    disabled={pending}
                    placeholder="—"
                    onBlur={e => {
                      const v = e.currentTarget.value.trim()
                      if (v !== (lead.assignee ?? '')) patch(lead.id, { assignee: v || null })
                    }}
                    className="text-xs w-24 bg-transparent border-0 focus:outline-none focus:border-b focus:border-wine-red"
                  />
                </td>
                <td className={`px-2 py-2 text-xs whitespace-nowrap ${stale ? 'text-wine-red font-medium' : 'text-graphite'}`}>
                  {lead.last_contact_at
                    ? `${new Date(lead.last_contact_at).toISOString().slice(0, 10)}${dayCount != null ? ` (${dayCount}d)` : ''}`
                    : (dayCount != null ? `never, ${dayCount}d` : '—')}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <button onClick={() => logContact(lead.id, 'call')}     disabled={pending} title="Call"     className="text-[11px] px-1.5 py-0.5 border border-pale-stone rounded-sm text-graphite hover:border-wine-red hover:text-wine-red">📞</button>
                    <button onClick={() => logContact(lead.id, 'whatsapp')} disabled={pending} title="WhatsApp" className="text-[11px] px-1.5 py-0.5 border border-pale-stone rounded-sm text-graphite hover:border-wine-red hover:text-wine-red">💬</button>
                    <button onClick={() => logContact(lead.id, 'email')}    disabled={pending} title="Email"    className="text-[11px] px-1.5 py-0.5 border border-pale-stone rounded-sm text-graphite hover:border-wine-red hover:text-wine-red">✉</button>
                    <button onClick={() => logContact(lead.id, 'meeting')}  disabled={pending} title="Meeting"  className="text-[11px] px-1.5 py-0.5 border border-pale-stone rounded-sm text-graphite hover:border-wine-red hover:text-wine-red">🤝</button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Notes drawer would live here in a follow-up — for now, click name to open detail page (Phase 3). */}
      {editingNote && <div className="hidden">{editingNote}</div>}
      {!editingNote && null}
    </div>
  )
}
