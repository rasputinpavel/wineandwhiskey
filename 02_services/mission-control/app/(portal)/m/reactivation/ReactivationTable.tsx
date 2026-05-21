'use client'

import { useMemo, useState } from 'react'
import type { ReactivationCustomer } from '@/lib/reactivation/data'

// Seasonal hero banner shown above every reactivation message.
//  - bannerUrlFor(customerId) → server composites the customer's favourite
//    in-stock bottle into the spotlight (Sharp). Falls back to the empty
//    base banner if the bottle PNG isn't on disk yet.
//  - Generator script: scripts/gen-reactivation-banner.mjs
const BANNER_BASE = '/creative/reactivation-rainy-season_2026-05.png'
const bannerUrlFor = (customerId: string) =>
  `/api/m/reactivation/banner?customerId=${encodeURIComponent(customerId)}`

type LapsedFilter = 'all' | '30' | '60' | '90' | '180'

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function topCategory(c: ReactivationCustomer): string {
  return c.byCategory[0]?.category ?? '—'
}

function topProductsLabel(c: ReactivationCustomer): string {
  return c.topProducts.slice(0, 3).map(p => `${p.name} ×${Math.round(p.qty)}`).join('; ') || '—'
}

export function ReactivationTable({ customers }: { customers: ReactivationCustomer[] }) {
  const [search, setSearch] = useState('')
  const [lapsed, setLapsed] = useState<LapsedFilter>('30')
  const [modal, setModal] = useState<{ customer: ReactivationCustomer; message: string | null; loading: boolean; error: string | null } | null>(null)
  const [copied, setCopied] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const minDays = lapsed === 'all' ? -Infinity : Number(lapsed)
    return customers.filter(c => {
      if (c.daysSinceLastVisit < minDays) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) ||
             (c.phone ?? '').toLowerCase().includes(q) ||
             (c.email ?? '').toLowerCase().includes(q)
    })
  }, [customers, search, lapsed])

  async function openMessage(c: ReactivationCustomer) {
    setCopied(false)
    setModal({ customer: c, message: null, loading: true, error: null })
    try {
      const res = await fetch('/api/m/reactivation/generate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: c.customerId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setModal({ customer: c, message: null, loading: false, error: j.error ?? `HTTP ${res.status}` })
        return
      }
      setModal({ customer: c, message: j.message ?? '', loading: false, error: null })
    } catch (e) {
      setModal({ customer: c, message: null, loading: false, error: (e as Error).message })
    }
  }

  async function regenerate() {
    if (!modal) return
    await openMessage(modal.customer)
  }

  async function copyMessage() {
    if (!modal?.message) return
    try {
      await navigator.clipboard.writeText(modal.message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {/* noop */}
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name / phone / email"
          className="px-3 py-1.5 rounded-sm border border-pale-stone bg-warm-white text-sm w-64 focus:outline-none focus:border-wine-red"
        />
        <div className="flex gap-1 text-xs">
          {(['all', '30', '60', '90', '180'] as const).map(v => {
            const active = lapsed === v
            return (
              <button key={v} onClick={() => setLapsed(v)}
                className={`px-3 py-1.5 rounded-sm border transition-colors ${
                  active
                    ? 'bg-wine-red text-warm-white border-wine-red'
                    : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
                }`}>
                {v === 'all' ? 'All' : `${v}+ days lapsed`}
              </button>
            )
          })}
        </div>
        <div className="text-xs text-graphite ml-auto">
          {filtered.length} of {customers.length} customers
        </div>
      </div>

      <div className="border border-pale-stone rounded-md overflow-hidden bg-warm-white">
        <table className="w-full text-sm">
          <thead className="bg-cream/50 border-b border-pale-stone text-graphite text-left">
            <tr>
              <th className="px-3 py-2 font-medium w-10 text-right">#</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Last visit</th>
              <th className="px-3 py-2 font-medium text-right">Days</th>
              <th className="px-3 py-2 font-medium text-right">Visits</th>
              <th className="px-3 py-2 font-medium text-right">Spent (THB)</th>
              <th className="px-3 py-2 font-medium">Top category</th>
              <th className="px-3 py-2 font-medium">Top products</th>
              <th className="px-3 py-2 font-medium w-32"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-graphite text-sm">No customers match the current filter.</td></tr>
            )}
            {filtered.map((c, i) => {
              const cold = c.daysSinceLastVisit >= 90
              return (
                <tr key={c.customerId} className={`border-t border-pale-stone ${cold ? 'bg-wine-red/[0.03]' : ''}`}>
                  <td className="px-3 py-2 text-right text-graphite">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-deep-black">{c.name}</div>
                    <div className="text-[11px] text-graphite flex flex-wrap gap-2 mt-0.5">
                      {c.phone && <a href={`tel:${c.phone}`} className="hover:text-wine-red">{c.phone}</a>}
                      {c.email && <a href={`mailto:${c.email}`} className="hover:text-wine-red">{c.email}</a>}
                      {!c.phone && !c.email && <span className="text-graphite/60">no contact</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-graphite">{c.lastVisit.slice(0, 10)}</td>
                  <td className={`px-3 py-2 text-right ${cold ? 'text-wine-red font-medium' : 'text-graphite'}`}>{c.daysSinceLastVisit}</td>
                  <td className="px-3 py-2 text-right text-graphite">{c.receipts}</td>
                  <td className="px-3 py-2 text-right text-deep-black">{fmt(c.totalSpent)}</td>
                  <td className="px-3 py-2 text-graphite">{topCategory(c)}</td>
                  <td className="px-3 py-2 text-graphite text-xs truncate max-w-md" title={topProductsLabel(c)}>{topProductsLabel(c)}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => openMessage(c)}
                      disabled={!c.phone && !c.email}
                      className="px-3 py-1.5 text-xs rounded-sm border border-wine-red text-wine-red hover:bg-wine-red hover:text-warm-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={!c.phone && !c.email ? 'no contact on file' : 'Generate English reactivation message'}
                    >
                      Message
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <div
          className="fixed inset-0 bg-deep-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-warm-white rounded-md border border-pale-stone max-w-xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-heading text-lg text-deep-black">Reactivation message</h3>
                <div className="text-sm text-graphite mt-0.5">
                  {modal.customer.name}
                  {modal.customer.phone && <span className="ml-2 text-graphite/70">· {modal.customer.phone}</span>}
                </div>
                <div className="text-xs text-graphite/70 mt-0.5">
                  Last visit {modal.customer.lastVisit.slice(0, 10)} ({modal.customer.daysSinceLastVisit}d ago) · top: {topCategory(modal.customer)}
                </div>
              </div>
              <button onClick={() => setModal(null)} className="text-graphite hover:text-deep-black text-xl leading-none">×</button>
            </div>

            <div className="mb-4">
              <div className="relative rounded-sm overflow-hidden border border-pale-stone bg-cream">
                <img
                  src={bannerUrlFor(modal.customer.customerId)}
                  alt={`Rainy season banner for ${modal.customer.name}`}
                  className="w-full block"
                />
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <a
                  href={bannerUrlFor(modal.customer.customerId)}
                  download={`wine-whiskey-rainy-season-${modal.customer.name.replace(/\s+/g, '-').toLowerCase()}.png`}
                  className="px-3 py-1.5 text-xs rounded-sm border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red"
                >
                  Download image
                </a>
                <a
                  href={BANNER_BASE}
                  download="wine-whiskey-rainy-season.png"
                  className="px-3 py-1.5 text-xs rounded-sm border border-pale-stone/60 text-graphite/70 hover:border-wine-red hover:text-wine-red"
                  title="Generic banner without a bottle"
                >
                  Download empty
                </a>
                <span className="text-[11px] text-graphite/70">
                  Attach manually — WhatsApp doesn&apos;t pre-fill image + text together.
                </span>
              </div>
            </div>

            {modal.loading && (
              <div className="text-sm text-graphite py-8 text-center">Asking Claude for a warm reminder…</div>
            )}
            {modal.error && (
              <div className="text-sm text-wine-red border border-wine-red/30 bg-wine-red/5 rounded-sm p-3">
                {modal.error}
              </div>
            )}
            {modal.message && (
              <>
                <textarea
                  value={modal.message}
                  onChange={e => setModal({ ...modal, message: e.target.value })}
                  className="w-full min-h-[140px] border border-pale-stone rounded-sm bg-warm-white p-3 text-sm text-deep-black font-mono leading-relaxed focus:outline-none focus:border-wine-red"
                />
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <button
                    onClick={copyMessage}
                    className="px-3 py-1.5 text-xs rounded-sm border border-wine-red bg-wine-red text-warm-white hover:opacity-90"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={regenerate}
                    className="px-3 py-1.5 text-xs rounded-sm border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red"
                  >
                    Regenerate
                  </button>
                  {modal.customer.phone && (
                    <a
                      href={`https://wa.me/${modal.customer.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(modal.message)}`}
                      target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 text-xs rounded-sm border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red ml-auto"
                    >
                      Open in WhatsApp ↗
                    </a>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
