'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  PHUKET_DISTRICTS, BUSINESS_KINDS, BUSINESS_KIND_LABEL,
  type District, type BusinessKind,
} from '@/lib/sales/config'
import { LEAD_STAGES, LEAD_STAGE_LABEL, type LeadStage } from '@/lib/sales/types'

export function NewLeadFormClient() {
  const router = useRouter()
  const [name, setName]                 = useState('')
  const [kind, setKind]                 = useState<BusinessKind>('restaurant')
  const [stage, setStage]               = useState<LeadStage>('lead')
  const [district, setDistrict]         = useState<District | ''>('')
  const [address, setAddress]           = useState('')
  const [phone, setPhone]               = useState('')
  const [website, setWebsite]           = useState('')
  const [assignee, setAssignee]         = useState('')
  const [notes, setNotes]               = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/m/sales/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, business_kind: kind, stage,
          district: district || undefined,
          address: address || undefined,
          phone:   phone   || undefined,
          website: website || undefined,
          assignee: assignee || undefined,
          notes:   notes   || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create lead'); return }
      router.push(`/m/sales/${json.lead.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-4">
      <Field label="Name *" required>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Tutto Bene Restaurant"
          className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5 focus:outline-none focus:border-wine-red"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Business kind">
          <select value={kind} onChange={e => setKind(e.target.value as BusinessKind)}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5">
            {BUSINESS_KINDS.map(k => <option key={k} value={k}>{BUSINESS_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Initial stage">
          <select value={stage} onChange={e => setStage(e.target.value as LeadStage)}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5">
            {LEAD_STAGES.map(s => <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="District">
          <select value={district} onChange={e => setDistrict(e.target.value as District | '')}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5">
            <option value="">—</option>
            {PHUKET_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Phone">
          <input value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="+66 ..."
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
          />
        </Field>
        <Field label="Website">
          <input value={website} onChange={e => setWebsite(e.target.value)}
            placeholder="https://…"
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
          />
        </Field>
      </div>

      <Field label="Address">
        <input value={address} onChange={e => setAddress(e.target.value)}
          placeholder="Street, area"
          className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
        />
      </Field>

      <Field label="Assignee">
        <input value={assignee} onChange={e => setAssignee(e.target.value)}
          placeholder="Who's working this lead"
          className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
        />
      </Field>

      <Field label="Notes">
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="Source (referral, event, walk-in…), decision-maker, what's interesting about them"
          className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5 leading-relaxed"
        />
      </Field>

      {error && <div className="text-xs text-wine-red bg-wine-red/8 border border-wine-red/30 rounded-sm px-3 py-2">{error}</div>}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-pale-stone">
        <button type="button" onClick={() => router.back()}
          className="text-sm px-3 py-1.5 border border-pale-stone text-graphite rounded-sm hover:border-wine-red hover:text-wine-red">
          Cancel
        </button>
        <button type="submit" disabled={submitting || !name.trim()}
          className="text-sm px-4 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50">
          {submitting ? 'Creating…' : 'Create lead'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block space-y-1">
      <div className="overline text-graphite">{label}{required && <span className="text-wine-red ml-1">·</span>}</div>
      {children}
    </label>
  )
}
