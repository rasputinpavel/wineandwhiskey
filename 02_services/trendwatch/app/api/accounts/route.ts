import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('trend_accounts')
    .select('*')
    .order('is_active', { ascending: false })
    .order('relevance_score', { ascending: false })
  if (error) {
    console.error('[accounts GET] SUPABASE_URL:', process.env.SUPABASE_URL?.slice(0, 30), 'error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown> & { username?: string }
  const username = body.username
  if (!username || typeof username !== 'string') {
    return NextResponse.json({ error: 'username required' }, { status: 400 })
  }

  // Whitelist columns we know exist in trend_accounts (v1 + v2 + v3)
  const ALLOWED = new Set([
    'display_name', 'category', 'followers_count', 'avg_reel_views', 'relevance_score',
    'is_active',
    'median_reel_views', 'top3_avg_views', 'hit_rate_50k', 'virality_ratio',
    'size_bucket', 'source_clusters', 'sample_size', 'business_model', 'why_matters',
    'top1_median_ratio', 'stability_label', 'confidence_score', 'freshness_score',
    'matched_clusters_count', 'format_copyability', 'production_copyability', 'retail_copyability',
    'tier',
  ])
  const payload: Record<string, unknown> = { username: username.replace('@', '') }
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k) && v !== undefined) payload[k] = v
  }

  const { data, error } = await supabase
    .from('trend_accounts')
    .upsert(payload, { onConflict: 'username' })
    .select()
    .single()

  if (error) {
    console.error('[accounts POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('trend_accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
