import { NextResponse } from 'next/server'
import { SOURCES, type SourceKey } from '@/lib/dataSources'
import { runLoyverseSync } from '@/lib/sync/loyverse'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // Loyverse sync is ~30s; allow up to 5 min on Vercel-like runtimes

export async function POST(_req: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params
  const def = (SOURCES as Record<string, typeof SOURCES[SourceKey]>)[source]
  if (!def) return NextResponse.json({ error: `unknown source ${source}` }, { status: 404 })

  if (def.runnable !== 'server') {
    return NextResponse.json({
      error: `Source "${def.label}" can only be synced from your laptop`,
      reason: 'needs Playwright + persisted browser session',
      command: def.command,
    }, { status: 503 })
  }

  try {
    if (source === 'loyverse_products' || source === 'loyverse_stock') {
      // Both are populated by the same script — running either triggers both.
      const result = await runLoyverseSync()
      return NextResponse.json({ ok: true, source, result })
    }
    return NextResponse.json({ error: `no runner registered for ${source}` }, { status: 501 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
