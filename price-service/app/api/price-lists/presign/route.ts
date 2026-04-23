import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { filename } = await req.json()
  const safeName = `${Date.now()}_${(filename as string).replace(/[^a-z0-9._-]/gi, '_')}`

  const { data, error } = await supabase.storage
    .from('price-pdfs')
    .createSignedUploadUrl(safeName)

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Storage error' }, { status: 500 })
  }

  return NextResponse.json({ signedUrl: data.signedUrl, path: data.path })
}
