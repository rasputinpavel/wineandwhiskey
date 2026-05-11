'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  useDraggable, useDroppable,
  useSensor, useSensors, PointerSensor, TouchSensor,
} from '@dnd-kit/core'
import {
  LEAD_STAGES, LEAD_STAGE_LABEL,
  type Lead, type LeadStage,
  staleDays, isStale,
} from '@/lib/sales/types'

export function LeadsKanbanClient({ leads: initial }: { leads: Lead[] }) {
  const router = useRouter()
  const [leads, setLeads] = useState(initial)
  const [activeId, setActiveId] = useState<string | null>(null)

  // PointerSensor activation distance of 5px means a click doesn't fire drag —
  // the <Link> on each card stays clickable for navigation to the detail page.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const byStage = useMemo(() => {
    const m = new Map<LeadStage, Lead[]>()
    for (const s of LEAD_STAGES) m.set(s, [])
    for (const l of leads) m.get(l.stage)?.push(l)
    return m
  }, [leads])

  function onDragStart(e: DragStartEvent) {
    setActiveId(e.active.id as string)
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const leadId = e.active.id as string
    const toStage = e.over?.id as LeadStage | undefined
    if (!toStage) return
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.stage === toStage) return

    // Optimistic update — flip immediately, revert on API failure.
    const prevStage = lead.stage
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: toStage } : l))

    const res = await fetch(`/api/m/sales/leads/${leadId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: toStage }),
    })
    if (!res.ok) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: prevStage } : l))
      const { error } = await res.json().catch(() => ({ error: 'unknown' }))
      alert(`Stage update failed: ${error}`)
      return
    }
    const { lead: fresh } = await res.json()
    setLeads(prev => prev.map(l => l.id === leadId ? fresh : l))
    // Refresh server state too so /m/sales server component (table view) is in sync.
    router.refresh()
  }

  const activeLead = activeId ? leads.find(l => l.id === activeId) ?? null : null

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-6 px-6">
        {LEAD_STAGES.map(stage => (
          <Column key={stage} stage={stage} leads={byStage.get(stage) ?? []} />
        ))}
      </div>
      <DragOverlay>{activeLead && <CardChrome lead={activeLead} dragging />}</DragOverlay>
    </DndContext>
  )
}

function Column({ stage, leads }: { stage: LeadStage; leads: Lead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  // Stage-specific accent so columns are visually distinct without being noisy.
  const tone =
    stage === 'first_purchase' ? 'bg-amber-gold/15 border-amber-gold/40' :
    stage === 'rejected'       ? 'bg-graphite/5 border-pale-stone' :
    stage === 'lead'           ? 'bg-cream/40 border-pale-stone' :
                                 'bg-warm-white border-pale-stone'
  return (
    <div className="w-[260px] shrink-0 flex flex-col">
      <div className={`rounded-t-md px-3 py-2 border ${tone} ${isOver ? 'ring-2 ring-wine-red ring-inset' : ''} flex items-center justify-between`}>
        <span className="overline text-graphite truncate">{LEAD_STAGE_LABEL[stage]}</span>
        <span className="text-[11px] text-graphite shrink-0 ml-2">{leads.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 border-x border-b border-pale-stone rounded-b-md p-2 space-y-2 min-h-[160px] transition-colors ${isOver ? 'bg-wine-red/5' : 'bg-warm-white/30'}`}
      >
        {leads.map(lead => <DraggableCard key={lead.id} lead={lead} />)}
      </div>
    </div>
  )
}

function DraggableCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`touch-none ${isDragging ? 'opacity-30' : ''}`}
    >
      <CardChrome lead={lead} />
    </div>
  )
}

function CardChrome({ lead, dragging }: { lead: Lead; dragging?: boolean }) {
  const stale = isStale(lead, 5)
  const dayCount = staleDays(lead)
  return (
    <div className={`bg-warm-white border ${stale ? 'border-wine-red/50' : 'border-pale-stone'} rounded-sm p-2.5 shadow-card ${dragging ? 'cursor-grabbing shadow-card-hover' : 'cursor-grab'} hover:shadow-card-hover transition-shadow`}>
      <div className="flex items-start gap-1.5">
        {stale && <span className="text-wine-red text-xs leading-none mt-0.5 shrink-0" title={`${dayCount}d since last contact`}>●</span>}
        <Link
          href={`/m/sales/${lead.id}`}
          onClick={e => e.stopPropagation()}
          className="font-medium text-sm text-deep-black truncate hover:text-wine-red flex-1 leading-tight"
          title={lead.name}
        >
          {lead.name}
        </Link>
      </div>
      <div className="text-[11px] text-graphite flex items-center gap-1.5 mt-1.5 flex-wrap">
        {lead.rating != null && <span>★ {lead.rating.toFixed(1)}<span className="opacity-60"> ({lead.reviews_count ?? 0})</span></span>}
        {lead.district && <span>· {lead.district}</span>}
        {lead.price_level && <span>· {lead.price_level}</span>}
      </div>
      {(lead.assignee || lead.last_contact_at) && (
        <div className={`text-[10px] mt-1.5 flex items-center justify-between ${stale ? 'text-wine-red' : 'text-graphite'}`}>
          {lead.assignee && <span className="truncate">{lead.assignee}</span>}
          {dayCount != null && (
            <span className="shrink-0">{lead.last_contact_at ? `${dayCount}d ago` : `${dayCount}d in pipeline`}</span>
          )}
        </div>
      )}
    </div>
  )
}
