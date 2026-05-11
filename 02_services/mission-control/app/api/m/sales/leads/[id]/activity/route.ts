// GET /api/m/sales/leads/[id]/activity
// Activity feed for one lead, newest first. Used by the detail page sidebar.

import { NextResponse } from 'next/server'
import { sbSales } from '@/lib/supabase'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await sbSales
    .from('lead_activity')
    .select('*')
    .eq('lead_id', id)
    .order('at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ activities: data ?? [] })
}
