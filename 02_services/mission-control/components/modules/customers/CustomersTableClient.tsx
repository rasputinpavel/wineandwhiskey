'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CustomerTermsCell, CustomerConsignmentCell } from './CustomerEditCell'

export type Stats = {
  open: number
  overdue: number
  thisYearTotal: number
  thisYearCount: number
  lastYearTotal: number
  lastYearCount: number
}

export type CustomerRow = {
  id: string
  name: string
  isConsignment: boolean
  paymentTermsDays: number
  groupId: string | null
  stats: Stats
}

export type GroupRow = {
  id: string
  name: string
  members: CustomerRow[]
  agg: Stats
}

export function CustomersTableClient({
  groups,
  standalone,
  thisYear,
  lastYear,
  sortHeaders,
}: {
  groups: GroupRow[]
  standalone: CustomerRow[]
  thisYear: number
  lastYear: number
  sortHeaders: React.ReactNode  // server-rendered SortHeader cells
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [showNameInput, setShowNameInput] = useState(false)

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  const allSelectedIds = Array.from(selected)
  const someInGroup = allSelectedIds.some(id =>
    [...standalone, ...groups.flatMap(g => g.members)].find(c => c.id === id)?.groupId != null
  )

  async function createGroup() {
    const trimmed = groupName.trim()
    if (!trimmed || allSelectedIds.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/m/customer-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, member_ids: allSelectedIds }),
      })
      if (res.ok) {
        setSelected(new Set())
        setGroupName('')
        setShowNameInput(false)
        router.refresh()
      } else {
        const j = await res.json().catch(() => ({}))
        alert(j?.error ?? `HTTP ${res.status}`)
      }
    } finally { setBusy(false) }
  }

  async function ungroupSelected() {
    if (allSelectedIds.length === 0) return
    setBusy(true)
    try {
      // Сбрасываем group_id у каждого выбранного. Если в группе никого не осталось,
      // ничего страшного — пустая группа сама не отрисуется на следующем рендере,
      // но в БД останется. Если хочешь полную чистку — добавлю позже.
      await Promise.all(allSelectedIds.map(id =>
        fetch('/api/m/customers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, group_id: null }),
        })
      ))
      setSelected(new Set())
      router.refresh()
    } finally { setBusy(false) }
  }

  async function deleteGroup(groupId: string, groupName: string) {
    if (!confirm(`Удалить группу «${groupName}»? Members останутся, просто разгруппируются.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/m/customer-groups/${groupId}`, { method: 'DELETE' })
      if (res.ok) router.refresh()
    } finally { setBusy(false) }
  }

  async function renameGroup(groupId: string, currentName: string) {
    const next = prompt('Новое имя группы:', currentName)
    if (!next || next.trim() === currentName) return
    setBusy(true)
    try {
      const res = await fetch(`/api/m/customer-groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next.trim() }),
      })
      if (res.ok) router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="w-8 py-2 px-3"></th>
              {sortHeaders}
            </tr>
          </thead>
          <tbody>
            {/* GROUPS */}
            {groups.map(g => (
              <GroupBlock
                key={g.id}
                group={g}
                selected={selected}
                onToggle={toggle}
                onRename={() => renameGroup(g.id, g.name)}
                onDelete={() => deleteGroup(g.id, g.name)}
                disabled={busy}
              />
            ))}
            {/* STANDALONE */}
            {standalone.map(c => (
              <CustomerRowComp
                key={c.id}
                row={c}
                selected={selected.has(c.id)}
                onToggle={() => toggle(c.id)}
                disabled={busy}
              />
            ))}
            {groups.length === 0 && standalone.length === 0 && (
              <tr><td colSpan={10} className="py-6 text-center text-graphite text-sm">
                Клиентов нет.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sticky action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 bg-deep-black text-warm-white rounded-md shadow-card-hover text-xs">
          <span><span className="font-medium tabular-nums">{selected.size}</span> selected</span>

          {!showNameInput ? (
            <>
              <button
                onClick={() => setShowNameInput(true)}
                disabled={busy}
                className="px-3 py-1 bg-wine-red hover:opacity-80 rounded-sm disabled:opacity-50"
              >
                Group selected
              </button>
              {someInGroup && (
                <button
                  onClick={ungroupSelected}
                  disabled={busy}
                  className="px-3 py-1 border border-warm-white/40 hover:bg-warm-white/10 rounded-sm disabled:opacity-50"
                >
                  Ungroup
                </button>
              )}
              <button
                onClick={() => setSelected(new Set())}
                disabled={busy}
                className="text-warm-white/60 hover:text-warm-white"
              >
                Clear
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-2">
              <input
                autoFocus
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createGroup()
                  if (e.key === 'Escape') { setShowNameInput(false); setGroupName('') }
                }}
                placeholder="Group name (e.g. Fine Cusine)"
                className="px-2 py-1 bg-warm-white/10 border border-warm-white/40 rounded-sm text-warm-white placeholder:text-warm-white/40 w-56 focus:outline-none focus:border-warm-white"
              />
              <button onClick={createGroup} disabled={busy || !groupName.trim()}
                      className="px-3 py-1 bg-wine-red rounded-sm disabled:opacity-50">
                {busy ? '…' : 'Create'}
              </button>
              <button onClick={() => { setShowNameInput(false); setGroupName('') }}
                      className="text-warm-white/60 hover:text-warm-white">✕</button>
            </span>
          )}
        </div>
      )}
    </>
  )
}

// ─── Group block — group header row + member rows ─────────────────────────

function GroupBlock({ group, selected, onToggle, onRename, onDelete, disabled }: {
  group: GroupRow
  selected: Set<string>
  onToggle: (id: string) => void
  onRename: () => void
  onDelete: () => void
  disabled: boolean
}) {
  const s = group.agg
  return (
    <>
      <tr className="border-b border-pale-stone/40 bg-amber-gold/10">
        <td className="w-8 py-2 px-3"></td>
        <td className="py-2 px-4">
          <span className="font-medium text-deep-black">{group.name}</span>
          <span className="ml-2 text-[10px] text-graphite">
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
          </span>
          <button onClick={onRename} disabled={disabled} className="ml-2 text-[10px] text-graphite hover:text-wine-red disabled:opacity-50">✎</button>
          <button onClick={onDelete} disabled={disabled} className="ml-1 text-[10px] text-graphite hover:text-wine-red disabled:opacity-50">✕</button>
        </td>
        <td className="py-2 px-4 text-graphite text-[11px]">— group —</td>
        <td className="py-2 px-4"></td>
        <td className="py-2 px-4 text-right tabular-nums font-medium">{s.open ? `฿${fmt(s.open)}` : '—'}</td>
        <td className={`py-2 px-4 text-right tabular-nums font-medium ${s.overdue > 0 ? 'text-wine-red' : ''}`}>
          {s.overdue ? `฿${fmt(s.overdue)}` : '—'}
        </td>
        <td className="py-2 px-4 text-right tabular-nums font-medium">{s.thisYearTotal ? `฿${fmt(s.thisYearTotal)}` : '—'}</td>
        <td className="py-2 px-4 text-right tabular-nums font-medium">{s.lastYearTotal ? `฿${fmt(s.lastYearTotal)}` : '—'}</td>
        <td className="py-2 px-4 text-right tabular-nums text-graphite">{s.thisYearCount}/{s.lastYearCount}</td>
      </tr>
      {group.members.map(c => (
        <CustomerRowComp
          key={c.id}
          row={c}
          selected={selected.has(c.id)}
          onToggle={() => onToggle(c.id)}
          indented
          disabled={disabled}
        />
      ))}
    </>
  )
}

function CustomerRowComp({ row, selected, onToggle, indented, disabled }: {
  row: CustomerRow
  selected: boolean
  onToggle: () => void
  indented?: boolean
  disabled?: boolean
}) {
  const s = row.stats
  return (
    <tr className={`border-b border-pale-stone/40 hover:bg-cream/40 ${indented ? 'text-[12px]' : ''}`}>
      <td className={`w-8 py-${indented ? '1.5' : '2'} px-3`}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={disabled}
          className="accent-wine-red cursor-pointer"
        />
      </td>
      <td className={`py-${indented ? '1.5' : '2'} ${indented ? 'pl-10 pr-4 text-graphite' : 'px-4'}`}>
        {indented && '↳ '}
        <Link href={`/m/customers/${row.id}`} className="hover:text-wine-red">{row.name}</Link>
      </td>
      <td className={`py-${indented ? '1.5' : '2'} px-4`}>
        <CustomerConsignmentCell customerId={row.id} initial={row.isConsignment} />
      </td>
      <td className={`py-${indented ? '1.5' : '2'} px-4`}>
        <CustomerTermsCell customerId={row.id} initial={row.paymentTermsDays} />
      </td>
      <td className={`py-${indented ? '1.5' : '2'} px-4 text-right tabular-nums ${indented ? 'text-graphite' : ''}`}>{s.open ? `฿${fmt(s.open)}` : '—'}</td>
      <td className={`py-${indented ? '1.5' : '2'} px-4 text-right tabular-nums ${s.overdue > 0 ? 'text-wine-red font-medium' : indented ? 'text-graphite' : ''}`}>
        {s.overdue ? `฿${fmt(s.overdue)}` : '—'}
      </td>
      <td className={`py-${indented ? '1.5' : '2'} px-4 text-right tabular-nums ${indented ? 'text-graphite' : ''}`}>{s.thisYearTotal ? `฿${fmt(s.thisYearTotal)}` : '—'}</td>
      <td className={`py-${indented ? '1.5' : '2'} px-4 text-right tabular-nums ${indented ? 'text-graphite' : ''}`}>{s.lastYearTotal ? `฿${fmt(s.lastYearTotal)}` : '—'}</td>
      <td className={`py-${indented ? '1.5' : '2'} px-4 text-right tabular-nums ${indented ? 'text-graphite/70' : 'text-graphite'}`}>{s.thisYearCount}/{s.lastYearCount}</td>
    </tr>
  )
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
