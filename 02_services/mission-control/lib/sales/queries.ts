// Server-side helpers for sales schema. Keeps the API routes thin and
// concentrates Supabase wire shape in one place.

import { sbSales } from '@/lib/supabase'
import type { ApifyPlaceItem, Lead, LeadStage, ScrapeInput, ScrapeRun } from './types'
import type { BusinessKind, District } from './config'

export async function createScrapeRun(input: ScrapeInput): Promise<ScrapeRun> {
  const { data, error } = await sbSales
    .from('scrape_run')
    .insert({ input, status: 'pending' })
    .select()
    .single()
  if (error) throw error
  return data as ScrapeRun
}

export async function setRunStarted(id: string, apifyRunId: string, datasetId: string) {
  const { error } = await sbSales
    .from('scrape_run')
    .update({ apify_run_id: apifyRunId, apify_dataset_id: datasetId, status: 'running' })
    .eq('id', id)
  if (error) throw error
}

export async function setRunStatus(id: string, status: ScrapeRun['status'], error?: string | null) {
  const patch: Record<string, unknown> = { status }
  if (error !== undefined) patch.error = error
  if (status === 'succeeded' || status === 'failed' || status === 'aborted' || status === 'imported') {
    patch.finished_at = new Date().toISOString()
  }
  const { error: dbErr } = await sbSales.from('scrape_run').update(patch).eq('id', id)
  if (dbErr) throw dbErr
}

export async function setRunImportCounts(
  id: string,
  counts: { scraped: number; imported: number; duplicate: number; rejected: number },
) {
  const { error } = await sbSales
    .from('scrape_run')
    .update({
      scraped_count:   counts.scraped,
      imported_count:  counts.imported,
      duplicate_count: counts.duplicate,
      rejected_count:  counts.rejected,
      status:          'imported',
      finished_at:     new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function getScrapeRun(id: string): Promise<ScrapeRun | null> {
  const { data, error } = await sbSales.from('scrape_run').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as ScrapeRun | null
}

// Map Apify place → lead row. Preserves the entire item in `raw` so we can
// retro-fit new fields without re-running the scrape.
export function placeToLead(
  p: ApifyPlaceItem,
  ctx: { business_kind: BusinessKind; district: District | null; source_run_id: string },
): Partial<Lead> & { google_place_id: string | null; name: string } {
  return {
    google_place_id:   p.placeId ?? null,
    name:              p.title ?? '(unnamed)',
    business_kind:     ctx.business_kind,
    google_categories: p.categories ?? (p.categoryName ? [p.categoryName] : null),
    address:           p.address ?? null,
    district:          ctx.district,
    lat:               p.location?.lat ?? null,
    lng:               p.location?.lng ?? null,
    phone:             p.phone ?? p.phoneUnformatted ?? null,
    website:           p.website ?? null,
    rating:            p.totalScore ?? null,
    reviews_count:     p.reviewsCount ?? null,
    price_level:       p.price ?? null,
    opening_hours:     p.openingHours ?? null,
    menu_url:          typeof p.menu === 'string' ? p.menu : (p.menu?.link ?? null),
    image_url:         p.imageUrl ?? p.imageUrls?.[0] ?? null,
    raw:               p,
    source_run_id:     ctx.source_run_id,
  }
}

// Upsert with dedup-by-google_place_id. New row → insert; existing → update
// every Google-derived field, but leave pipeline state (stage, assignee,
// first_taken_at, last_contact_at, notes, customer_id) untouched.
export async function upsertLeads(
  rows: Array<Partial<Lead> & { google_place_id: string | null; name: string }>,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0
  let updated  = 0

  // Place_id is the only stable dedup key. Rows without one are inserted
  // as new — Google sometimes omits placeId for very fresh listings.
  const withId    = rows.filter(r => r.google_place_id)
  const withoutId = rows.filter(r => !r.google_place_id)

  if (withId.length > 0) {
    // Find existing place_ids in one query.
    const ids = withId.map(r => r.google_place_id!) as string[]
    const { data: existing, error } = await sbSales
      .from('lead')
      .select('id, google_place_id')
      .in('google_place_id', ids)
    if (error) throw error
    const existsMap = new Map((existing as Array<{ id: string; google_place_id: string }>).map(e => [e.google_place_id, e.id]))

    const toInsert = withId.filter(r => !existsMap.has(r.google_place_id!))
    const toUpdate = withId.filter(r => existsMap.has(r.google_place_id!))

    if (toInsert.length > 0) {
      const { error: insErr } = await sbSales.from('lead').insert(toInsert)
      if (insErr) throw insErr
      inserted += toInsert.length
    }

    // Update Google-derived fields only — never touch stage/pipeline state.
    for (const row of toUpdate) {
      const patch = { ...row }
      // Strip pipeline fields just in case caller pre-populated them.
      delete (patch as Record<string, unknown>).stage
      delete (patch as Record<string, unknown>).assignee
      delete (patch as Record<string, unknown>).first_taken_at
      delete (patch as Record<string, unknown>).last_contact_at
      delete (patch as Record<string, unknown>).next_action_at
      delete (patch as Record<string, unknown>).notes
      delete (patch as Record<string, unknown>).customer_id
      const { error: updErr } = await sbSales.from('lead').update(patch).eq('google_place_id', row.google_place_id!)
      if (updErr) throw updErr
      updated++
    }
  }

  if (withoutId.length > 0) {
    const { error } = await sbSales.from('lead').insert(withoutId)
    if (error) throw error
    inserted += withoutId.length
  }

  return { inserted, updated }
}

export async function logActivity(
  leadId: string,
  kind: string,
  note?: string | null,
  meta?: Record<string, unknown> | null,
) {
  const { error } = await sbSales.from('lead_activity').insert({
    lead_id: leadId, kind, note: note ?? null, meta: meta ?? null,
  })
  if (error) throw error
}

// Stage transition with side-effects:
//   • first_taken_at on first move out of 'lead'
//   • last_contact_at bumped on contact-y stages
//   • logs a 'stage_change' activity
export async function transitionStage(leadId: string, toStage: LeadStage): Promise<void> {
  const { data: lead, error: fetchErr } = await sbSales
    .from('lead').select('*').eq('id', leadId).single()
  if (fetchErr) throw fetchErr
  const current = lead as Lead

  if (current.stage === toStage) return

  const patch: Record<string, unknown> = { stage: toStage }
  // First taken into work — clock starts here.
  if (current.stage === 'lead' && toStage !== 'lead' && !current.first_taken_at) {
    patch.first_taken_at = new Date().toISOString()
  }
  // Contact-y stages also count as a "fresh touch".
  if (toStage === 'contacted' || toStage === 'meeting_set' || toStage === 'meeting_done' || toStage === 'negotiating') {
    patch.last_contact_at = new Date().toISOString()
  }

  const { error: updErr } = await sbSales.from('lead').update(patch).eq('id', leadId)
  if (updErr) throw updErr
  await logActivity(leadId, 'stage_change', null, { from: current.stage, to: toStage })
}
