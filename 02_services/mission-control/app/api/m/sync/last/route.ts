import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// Returns the most recent successful sync timestamp per source. Used by
// the client-side <DataFreshness> bar to refresh its badges after the
// user clicks "Sync now".

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sources = (url.searchParams.get('sources') ?? '').split(',').filter(Boolean)
  if (sources.length === 0) return NextResponse.json({ items: {} })

  const out: Record<string, { finished_at: string | null; ok: boolean | null; error: string | null }> = {}
  for (const source of sources) {
    const { data } = await sbInventory
      .from('sync_log')
      .select('finished_at, ok, error')
      .eq('source', source)
      .order('finished_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    out[source] = data ?? { finished_at: null, ok: null, error: null }
  }
  return NextResponse.json({ items: out })
}
