import Link from 'next/link'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { sbPromo } from '@/lib/supabase'
import {
  PROMO_STATUS_LABEL, PROMO_MOOD_LABEL,
  type PromoCampaign, type PromoStatus,
} from '@/lib/promo/types'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<PromoStatus, string> = {
  draft:      'bg-cream/60 text-graphite border-pale-stone',
  generating: 'bg-amber-gold/20 text-amber-gold border-amber-gold/40',
  ready:      'bg-wine-red/10 text-wine-red border-wine-red/40',
}

export default async function PromoListPage() {
  const item = findItem('promo')!

  const { data, error } = await sbPromo
    .from('campaign')
    .select('*')
    .order('starts_on', { ascending: false })
    .limit(200)

  if (error) {
    return (
      <>
        <PaneHeader item={item} />
        <div className="p-6 text-sm">
          <div className="bg-wine-red/10 border border-wine-red/40 text-wine-red rounded-md p-4">
            <div className="font-medium">Failed to load promos</div>
            <div className="mt-1 text-xs">{error.message}</div>
            <div className="mt-2 text-xs text-graphite">
              Likely the <code>014_promo_campaigns.sql</code> migration hasn’t run, or the <code>promo</code> schema isn’t under Exposed schemas.
            </div>
          </div>
        </div>
      </>
    )
  }

  const campaigns = (data ?? []) as PromoCampaign[]

  return (
    <>
      <PaneHeader
        item={item}
        rightSlot={
          <Link
            href="/m/promo/new"
            className="text-xs px-3 py-1.5 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep transition-colors"
          >
            + New promo
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="px-6 py-5 space-y-4">
          <header>
            <div className="overline text-graphite">Weekly promo campaigns</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              Promo Pulse
            </h1>
            <p className="text-sm text-graphite mt-1">
              {campaigns.length} {campaigns.length === 1 ? 'campaign' : 'campaigns'} · brief → copy → assets → Creative Library
            </p>
          </header>

          {campaigns.length === 0 ? (
            <div className="text-center py-12 text-graphite text-sm">
              No promos yet. <Link href="/m/promo/new" className="text-wine-red hover:underline">Start the first one</Link>.
            </div>
          ) : (
            <div className="border border-pale-stone rounded-md overflow-hidden bg-warm-white">
              <table className="w-full text-sm">
                <thead className="bg-cream/40 text-xs text-graphite uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Dates</th>
                    <th className="text-left px-3 py-2 font-medium">Theme</th>
                    <th className="text-left px-3 py-2 font-medium">Mechanic</th>
                    <th className="text-left px-3 py-2 font-medium">Mood</th>
                    <th className="text-left px-3 py-2 font-medium">SKUs</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pale-stone">
                  {campaigns.map(c => (
                    <tr key={c.id} className="hover:bg-cream/30 transition-colors">
                      <td className="px-3 py-2 align-top whitespace-nowrap text-graphite">
                        <Link href={`/m/promo/${c.id}`} className="hover:text-wine-red">
                          {fmtRange(c.starts_on, c.ends_on)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Link href={`/m/promo/${c.id}`} className="font-medium text-deep-black hover:text-wine-red">
                          {c.theme}
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-top text-graphite">{c.mechanic}</td>
                      <td className="px-3 py-2 align-top text-graphite text-xs">
                        {PROMO_MOOD_LABEL[c.mood].split(' — ')[0]}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="text-xs text-graphite">{c.sku_slugs.length}</span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`text-[11px] px-2 py-0.5 rounded-sm border ${STATUS_PILL[c.status]}`}>
                          {PROMO_STATUS_LABEL[c.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <PhasesNote />
        </div>
      </div>
    </>
  )
}

function fmtRange(starts: string, ends: string): string {
  if (starts === ends) return starts
  // Trim trailing year if both dates share it for compactness.
  if (starts.slice(0, 4) === ends.slice(0, 4)) {
    return `${starts} → ${ends.slice(5)}`
  }
  return `${starts} → ${ends}`
}

function PhasesNote() {
  return (
    <details className="border border-pale-stone rounded-md bg-cream/30 mt-6">
      <summary className="px-4 py-3 cursor-pointer text-sm font-heading font-semibold text-deep-black">
        How this works
      </summary>
      <div className="px-4 pb-4 text-sm text-graphite space-y-2">
        <p>
          <strong>Phase 1 (now):</strong> capture the brief — theme, mechanic, dates, SKUs, mood. Status flips draft ↔ ready manually.
        </p>
        <p>
          <strong>Phase 2:</strong> «Generate copy» button calls Anthropic, fills headline / subhead / IG &amp; TG captions, picks visual mode and composition from the design system.
        </p>
        <p>
          <strong>Phase 3:</strong> «Generate visuals» renders 6 assets (IG post, IG story, TG post, A2 poster, A3 stand, web banner) via HTML templates + product PNGs, uploads to Supabase Storage.
        </p>
        <p>
          <strong>Phase 4:</strong> <code>npm run promo:sync</code> mirrors finished promos into <code>05_creative/output/promo-&lt;slug&gt;_&lt;date&gt;/</code> so they show up in Creative Library after commit.
        </p>
      </div>
    </details>
  )
}
