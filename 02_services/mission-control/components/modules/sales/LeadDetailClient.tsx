'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  LEAD_STAGES, LEAD_STAGE_LABEL,
  type Lead, type LeadStage, type LeadActivity,
  staleDays, isStale,
} from '@/lib/sales/types'
import { BUSINESS_KINDS, BUSINESS_KIND_LABEL, type BusinessKind } from '@/lib/sales/config'

const TOUCH_KINDS = [
  { kind: 'call',     icon: '📞', label: 'Call'     },
  { kind: 'whatsapp', icon: '💬', label: 'WhatsApp' },
  { kind: 'email',    icon: '✉',  label: 'Email'    },
  { kind: 'meeting',  icon: '🤝', label: 'Meeting'  },
] as const

const ACTIVITY_LABEL: Record<string, { icon: string; label: string }> = {
  call:         { icon: '📞', label: 'Call'         },
  whatsapp:     { icon: '💬', label: 'WhatsApp'     },
  email:        { icon: '✉',  label: 'Email'        },
  meeting:      { icon: '🤝', label: 'Meeting'      },
  note:         { icon: '📝', label: 'Note'         },
  stage_change: { icon: '↦',  label: 'Stage change' },
  import:       { icon: '⬇',  label: 'Imported'     },
}

export function LeadDetailClient({ lead: initialLead }: { lead: Lead }) {
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [activitiesLoaded, setActivitiesLoaded] = useState(false)
  const [, start] = useTransition()
  const [touchKind, setTouchKind] = useState<typeof TOUCH_KINDS[number]['kind']>('call')
  const [touchNote, setTouchNote] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Fetch activity feed on mount.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/m/sales/leads/${initialLead.id}/activity`)
      if (!res.ok) return
      const { activities: a } = await res.json()
      if (!cancelled) {
        setActivities(a)
        setActivitiesLoaded(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [initialLead.id])

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/m/sales/leads/${lead.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'unknown' }))
      alert(`Update failed: ${error}`)
      return null
    }
    const { lead: fresh } = await res.json()
    setLead(fresh)
    reloadActivity()
    return fresh
  }

  async function reloadActivity() {
    const res = await fetch(`/api/m/sales/leads/${lead.id}/activity`)
    if (res.ok) {
      const { activities: a } = await res.json()
      setActivities(a)
    }
  }

  async function logTouch() {
    const res = await fetch(`/api/m/sales/leads/${lead.id}/contact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: touchKind, note: touchNote.trim() || undefined }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'unknown' }))
      alert(`Failed to log: ${error}`)
      return
    }
    setTouchNote('')
    // last_contact_at changed — refetch lead and activity.
    const lr = await fetch(`/api/m/sales/leads/${lead.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (lr.ok) {
      const { lead: fresh } = await lr.json()
      setLead(fresh)
    }
    await reloadActivity()
    start(() => router.refresh())
  }

  async function saveNote() {
    if (noteDraft.trim() === (lead.notes ?? '').trim()) return
    setNoteSaving('saving')
    const updated = await patch({ notes: noteDraft })
    setNoteSaving(updated ? 'saved' : 'idle')
    if (updated) setTimeout(() => setNoteSaving('idle'), 1500)
  }

  // Keep draft in sync if lead.notes changes externally.
  useEffect(() => { setNoteDraft(lead.notes ?? '') }, [lead.notes])

  const stale = isStale(lead, 5)
  const dayCount = staleDays(lead)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      {/* MAIN */}
      <div className="space-y-5">
        {/* Header card */}
        <section className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-heading font-semibold text-deep-black text-xl leading-tight">{lead.name}</h1>
              <div className="text-xs text-graphite mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {lead.business_kind && <span>{BUSINESS_KIND_LABEL[lead.business_kind]}</span>}
                {lead.district && <span>· {lead.district}</span>}
                {lead.rating != null && <span>· ★ {lead.rating.toFixed(1)} ({lead.reviews_count ?? 0})</span>}
                {lead.price_level && <span>· {lead.price_level}</span>}
              </div>
            </div>
            {lead.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lead.image_url} alt="" className="w-20 h-20 object-cover rounded-sm border border-pale-stone shrink-0" />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {lead.address && <Field label="Address">{lead.address}</Field>}
            {lead.phone   && <Field label="Phone"><a href={`tel:${lead.phone}`} className="text-wine-red hover:underline">{lead.phone}</a></Field>}
            {lead.website && <Field label="Website"><a href={lead.website} target="_blank" rel="noopener" className="text-wine-red hover:underline truncate inline-block max-w-full">{prettyUrl(lead.website)} ↗</a></Field>}
            {lead.menu_url && <Field label="Menu"><a href={lead.menu_url} target="_blank" rel="noopener" className="text-wine-red hover:underline">menu ↗</a></Field>}
            {lead.lat && lead.lng && (
              <Field label="Map">
                <a href={`https://www.google.com/maps/search/?api=1&query=${lead.lat},${lead.lng}`} target="_blank" rel="noopener" className="text-wine-red hover:underline">
                  {lead.lat.toFixed(4)}, {lead.lng.toFixed(4)} ↗
                </a>
              </Field>
            )}
            {lead.google_categories?.length ? <Field label="Categories">{lead.google_categories.join(', ')}</Field> : null}
          </div>
        </section>

        {/* Touch / log activity */}
        <section className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-3">
          <div className="overline text-graphite">Log activity</div>
          <div className="flex flex-wrap gap-2">
            {TOUCH_KINDS.map(t => (
              <button key={t.kind} type="button" onClick={() => setTouchKind(t.kind)}
                className={
                  touchKind === t.kind
                    ? 'text-sm px-3 py-1.5 rounded-sm bg-deep-black text-warm-white'
                    : 'text-sm px-3 py-1.5 rounded-sm bg-cream/40 border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red'
                }
              >{t.icon} {t.label}</button>
            ))}
          </div>
          <textarea
            value={touchNote}
            onChange={e => setTouchNote(e.target.value)}
            placeholder="Optional note (what was discussed, next step…)"
            rows={2}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-3 py-2 focus:outline-none focus:border-wine-red"
          />
          <div className="flex justify-end">
            <button onClick={logTouch}
              className="text-sm px-4 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep">
              Log {TOUCH_KINDS.find(t => t.kind === touchKind)?.label}
            </button>
          </div>
        </section>

        {/* Notes */}
        <section className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="overline text-graphite">Notes</div>
            <span className="text-[11px] text-graphite">
              {noteSaving === 'saving' && 'Saving…'}
              {noteSaving === 'saved'  && 'Saved ✓'}
            </span>
          </div>
          <textarea
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            onBlur={saveNote}
            placeholder="Free-form notes about the lead — owners, decision-maker, dietary, follow-ups…"
            rows={5}
            className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-3 py-2 focus:outline-none focus:border-wine-red leading-relaxed"
          />
        </section>

        {/* Activity log */}
        <section className="bg-warm-white border border-pale-stone rounded-md p-5 space-y-3">
          <div className="overline text-graphite">Activity</div>
          {!activitiesLoaded ? (
            <div className="text-sm text-graphite">Loading…</div>
          ) : activities.length === 0 ? (
            <div className="text-sm text-graphite">No activity yet. Log a call or move the stage to start.</div>
          ) : (
            <ol className="space-y-2.5">
              {activities.map(a => {
                const meta = ACTIVITY_LABEL[a.kind] ?? { icon: '•', label: a.kind }
                const m = a.meta as { from?: string; to?: string } | null
                return (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <div className="w-6 text-center text-base shrink-0">{meta.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-deep-black">{meta.label}</span>
                        <span className="text-[11px] text-graphite shrink-0">{fmtDateTime(a.at)}</span>
                      </div>
                      {a.kind === 'stage_change' && m?.from && m?.to && (
                        <div className="text-xs text-graphite">
                          {LEAD_STAGE_LABEL[m.from as LeadStage] ?? m.from} → {LEAD_STAGE_LABEL[m.to as LeadStage] ?? m.to}
                        </div>
                      )}
                      {a.note && <div className="text-xs text-graphite leading-relaxed mt-0.5 whitespace-pre-wrap">{a.note}</div>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>

      {/* SIDEBAR */}
      <aside className="space-y-4">
        {/* Pipeline */}
        <section className="bg-warm-white border border-pale-stone rounded-md p-4 space-y-3">
          <div className="overline text-graphite">Pipeline</div>

          <label className="block">
            <div className="text-[11px] text-graphite mb-0.5">Stage</div>
            <select
              value={lead.stage}
              onChange={e => patch({ stage: e.target.value as LeadStage })}
              className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
            >
              {LEAD_STAGES.map(s => <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>)}
            </select>
          </label>

          <label className="block">
            <div className="text-[11px] text-graphite mb-0.5">Kind</div>
            <select
              value={lead.business_kind}
              onChange={e => patch({ business_kind: e.target.value as BusinessKind })}
              className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
            >
              {BUSINESS_KINDS.map(k => <option key={k} value={k}>{BUSINESS_KIND_LABEL[k]}</option>)}
            </select>
          </label>

          <label className="block">
            <div className="text-[11px] text-graphite mb-0.5">Assignee</div>
            <input
              defaultValue={lead.assignee ?? ''}
              onBlur={e => {
                const v = e.currentTarget.value.trim()
                if (v !== (lead.assignee ?? '')) patch({ assignee: v || null })
              }}
              placeholder="—"
              className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-graphite mb-0.5">Next action</div>
            <input
              type="date"
              defaultValue={lead.next_action_at ? lead.next_action_at.slice(0, 10) : ''}
              onBlur={e => {
                const v = e.currentTarget.value
                patch({ next_action_at: v ? new Date(v).toISOString() : null })
              }}
              className="w-full text-sm border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
            />
          </label>
        </section>

        {/* Status */}
        <section className="bg-warm-white border border-pale-stone rounded-md p-4 space-y-2 text-sm">
          <div className="overline text-graphite mb-1">Status</div>
          <Row label="Created">{fmtDate(lead.created_at)}</Row>
          {lead.first_taken_at && <Row label="Taken">{fmtDate(lead.first_taken_at)}</Row>}
          <Row label="Last contact" tone={stale ? 'red' : undefined}>
            {lead.last_contact_at ? `${fmtDate(lead.last_contact_at)}${dayCount != null ? ` · ${dayCount}d ago` : ''}` : (dayCount != null ? `never · ${dayCount}d in pipeline` : '—')}
          </Row>
          {stale && (
            <div className="text-[11px] text-wine-red bg-wine-red/8 border border-wine-red/30 rounded-sm px-2 py-1.5">
              Stale — no contact for {dayCount} days
            </div>
          )}
        </section>
      </aside>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-graphite">{label}</div>
      <div className="text-sm text-deep-black truncate">{children}</div>
    </div>
  )
}

function Row({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'red' }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-graphite text-xs">{label}</span>
      <span className={tone === 'red' ? 'text-wine-red text-xs text-right' : 'text-deep-black text-xs text-right'}>{children}</span>
    </div>
  )
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`
}
function prettyUrl(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return url.slice(0, 40) }
}
