'use client'

import { useMemo, useState } from 'react'
import type { ReactivationCustomer } from '@/lib/reactivation/data'

// Seasonal hero banner shown above every reactivation message — single
// shared image for now. The empty spotlight on the bar is a deliberate
// placeholder where a customer's favourite bottle could later be composited
// per-customer; the server endpoint /api/m/reactivation/banner exists and
// works (see lib/reactivation/composite.ts), but bottle-PNG coverage in
// 04_brand/products/ is too low to switch over yet, so the modal points
// at the static base banner. Re-enable the dynamic URL once coverage is up.
//
// Generator script: scripts/gen-reactivation-banner.mjs
const BANNER_URL = '/creative/reactivation-rainy-season_2026-05.png'

type LapsedFilter = 'all' | '30' | '60' | '90' | '180'
type SortKey = 'name' | 'last' | 'days' | 'visits' | 'spent' | 'category'
type SortDir = 'asc' | 'desc'

// First-click direction per column: numeric/date columns descend (biggest /
// most recent first), name and category ascend.
const FIRST_DIR: Record<SortKey, SortDir> = {
  name: 'asc', last: 'desc', days: 'desc', visits: 'desc', spent: 'desc', category: 'asc',
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function topCategory(c: ReactivationCustomer): string {
  return c.byCategory[0]?.category ?? '—'
}

function topProductsLabel(c: ReactivationCustomer): string {
  return c.topProducts.slice(0, 3).map(p => `${p.name} ×${Math.round(p.qty)}`).join('; ') || '—'
}

function compareBy(sort: SortKey, dir: SortDir) {
  const mult = dir === 'asc' ? 1 : -1
  return (a: ReactivationCustomer, b: ReactivationCustomer): number => {
    let cmp = 0
    switch (sort) {
      case 'name':     cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); break
      case 'last':     cmp = a.lastVisit.localeCompare(b.lastVisit); break
      case 'days':     cmp = a.daysSinceLastVisit - b.daysSinceLastVisit; break
      case 'visits':   cmp = a.receipts - b.receipts; break
      case 'spent':    cmp = a.totalSpent - b.totalSpent; break
      case 'category': cmp = topCategory(a).localeCompare(topCategory(b)); break
    }
    return cmp * mult
  }
}

export function ReactivationTable({ customers }: { customers: ReactivationCustomer[] }) {
  const [search, setSearch] = useState('')
  const [lapsed, setLapsed] = useState<LapsedFilter>('30')
  const [sort, setSort] = useState<SortKey>('spent')
  const [dir, setDir] = useState<SortDir>('desc')
  const [modal, setModal] = useState<{ customer: ReactivationCustomer; message: string | null; loading: boolean; error: string | null } | null>(null)
  const [copied, setCopied] = useState(false)

  function onHeaderClick(col: SortKey) {
    if (col === sort) {
      setDir(dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(col)
      setDir(FIRST_DIR[col])
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const minDays = lapsed === 'all' ? -Infinity : Number(lapsed)
    const result = customers.filter(c => {
      if (c.daysSinceLastVisit < minDays) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) ||
             (c.phone ?? '').toLowerCase().includes(q) ||
             (c.email ?? '').toLowerCase().includes(q)
    })
    result.sort(compareBy(sort, dir))
    return result
  }, [customers, search, lapsed, sort, dir])

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
              <SortableTh col="name"     label="Customer"    align="left"  sort={sort} dir={dir} onClick={onHeaderClick} />
              <SortableTh col="last"     label="Last visit"  align="left"  sort={sort} dir={dir} onClick={onHeaderClick} />
              <SortableTh col="days"     label="Days"        align="right" sort={sort} dir={dir} onClick={onHeaderClick} />
              <SortableTh col="visits"   label="Visits"      align="right" sort={sort} dir={dir} onClick={onHeaderClick} />
              <SortableTh col="spent"    label="Spent (THB)" align="right" sort={sort} dir={dir} onClick={onHeaderClick} />
              <SortableTh col="category" label="Top category" align="left" sort={sort} dir={dir} onClick={onHeaderClick} />
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
              <div className="rounded-sm overflow-hidden border border-pale-stone bg-cream">
                <img src={BANNER_URL} alt="Rainy season banner" className="w-full block" />
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <a
                  href={BANNER_URL}
                  download="wine-whiskey-rainy-season.png"
                  className="px-3 py-1.5 text-xs rounded-sm border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red"
                >
                  Download image
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
                  className="w-full min-h-[200px] border border-pale-stone rounded-sm bg-warm-white p-3 text-sm text-deep-black leading-relaxed whitespace-pre-wrap focus:outline-none focus:border-wine-red"
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

function SortableTh({
  col, label, align, sort, dir, onClick,
}: {
  col: SortKey
  label: string
  align: 'left' | 'right'
  sort: SortKey
  dir: SortDir
  onClick: (col: SortKey) => void
}) {
  const active = sort === col
  const arrow = active ? (dir === 'asc' ? '↑' : '↓') : ''
  return (
    <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 hover:text-wine-red ${active ? 'text-deep-black' : ''}`}
      >
        {label}
        <span className="text-[10px] opacity-70 w-2 inline-block text-center">{arrow}</span>
      </button>
    </th>
  )
}
