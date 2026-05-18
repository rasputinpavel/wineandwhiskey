import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { sbPromo } from '@/lib/supabase'
import {
  PROMO_STATUS_LABEL, PROMO_MOOD_LABEL,
  type PromoCampaign,
} from '@/lib/promo/types'
import { PromoActionsClient } from '@/components/modules/promo/PromoActionsClient'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export default async function PromoDetailPage({ params }: Ctx) {
  const { id } = await params
  const item = findItem('promo')!

  const { data, error } = await sbPromo
    .from('campaign').select('*').eq('id', id).single()
  if (error || !data) notFound()
  const c = data as PromoCampaign

  return (
    <>
      <PaneHeader
        item={item}
        rightSlot={
          <Link href="/m/promo" className="text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm">
            ← Back
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[880px] mx-auto px-6 py-6 space-y-5">

          <header className="flex items-start justify-between gap-4">
            <div>
              <div className="overline text-graphite">
                {fmtRange(c.starts_on, c.ends_on)} · <code className="text-[11px]">{c.slug}</code>
              </div>
              <h1 className="font-display text-deep-black uppercase tracking-display mt-1" style={{ fontSize: 36, lineHeight: 1 }}>
                {c.theme}
              </h1>
              <p className="text-sm text-graphite mt-1">{c.mechanic} · {PROMO_MOOD_LABEL[c.mood].split(' — ')[0]}</p>
            </div>
            <PromoActionsClient
              id={c.id}
              status={c.status}
              hasCopy={!!c.headline}
            />
          </header>

          <section className="grid grid-cols-2 gap-5">
            <KV label="Status" value={PROMO_STATUS_LABEL[c.status]} />
            <KV label="Mood" value={PROMO_MOOD_LABEL[c.mood]} />
            <KV label="Created" value={fmtDateTime(c.created_at)} />
            <KV label="Synced to git" value={c.synced_at ? fmtDateTime(c.synced_at) : '— not yet'} />
          </section>

          <section>
            <div className="overline text-graphite mb-2">SKUs · {c.sku_slugs.length}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {c.sku_slugs.map(slug => (
                <div key={slug} className="bg-cream/30 border border-pale-stone rounded-sm p-2 flex flex-col items-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/brand/products/${slug}.png`} alt={slug} className="w-full h-20 object-contain" />
                  <span className="text-[10px] text-graphite truncate w-full text-center">{slug}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-graphite mt-2">
              Missing images render as broken — they probably live in a batch subfolder like <code>16_may/</code>. Phase 3 resolver will check both.
            </p>
          </section>

          <section className="bg-cream/30 border border-pale-stone rounded-md p-4">
            <div className="overline text-graphite mb-1">Generated copy</div>
            {c.headline ? (
              <div className="text-sm text-deep-black space-y-2">
                <div><strong>Headline:</strong> {c.headline}</div>
                {c.subhead    && <div><strong>Subhead:</strong>     {c.subhead}</div>}
                {c.caption_ig && <div><strong>IG caption:</strong>  <p className="whitespace-pre-wrap">{c.caption_ig}</p></div>}
                {c.caption_tg && <div><strong>TG caption:</strong>  <p className="whitespace-pre-wrap">{c.caption_tg}</p></div>}
                {c.visual_mode && <div><strong>Visual mode:</strong> {c.visual_mode}</div>}
                {c.composition && <div><strong>Composition:</strong> {c.composition}</div>}
              </div>
            ) : (
              <p className="text-sm text-graphite italic">
                No copy yet — Phase 2 will fill this via Anthropic API.
              </p>
            )}
          </section>

          <section className="bg-cream/30 border border-pale-stone rounded-md p-4">
            <div className="overline text-graphite mb-1">Assets</div>
            {c.assets && Object.keys(c.assets).length > 0 ? (
              <ul className="text-xs text-graphite space-y-1">
                {Object.entries(c.assets).map(([k, v]) => (
                  <li key={k}><strong>{k}:</strong> {v}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-graphite italic">
                No visuals yet — Phase 3 will render IG post, IG story, TG post, A2 poster, A3 stand, web banner.
              </p>
            )}
          </section>

        </div>
      </div>
    </>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="overline text-graphite">{label}</div>
      <div className="text-sm text-deep-black mt-0.5">{value}</div>
    </div>
  )
}

function fmtRange(starts: string, ends: string): string {
  if (starts === ends) return starts
  if (starts.slice(0, 4) === ends.slice(0, 4)) return `${starts} → ${ends.slice(5)}`
  return `${starts} → ${ends}`
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 16).replace('T', ' ')
}
