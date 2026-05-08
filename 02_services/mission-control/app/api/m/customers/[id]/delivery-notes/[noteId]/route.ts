import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { noteId } = await params
  // Cascade-deletes the lines via FK ON DELETE CASCADE.
  const { error } = await sbInventory
    .from('delivery_note')
    .delete()
    .eq('id', noteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
