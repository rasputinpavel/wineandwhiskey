import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'

export const dynamic = 'force-dynamic'

const PUBLIC_DIR = path.join(process.cwd(), 'public', 'sales-playbook')

async function readPitch(): Promise<string | null> {
  try {
    return await readFile(path.join(PUBLIC_DIR, 'messenger_pitch.md'), 'utf8')
  } catch {
    return null
  }
}

export default async function SalesPlaybookPage() {
  const item = findItem('sales-playbook')!
  const pitch = await readPitch()

  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-6">

          <header>
            <div className="overline text-graphite">B2B outreach materials</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              Sales Playbook
            </h1>
            <p className="text-sm text-graphite mt-1">
              Everything a rep needs for a first meeting: the partner offer to leave behind, a call script with memory anchors, the price list, and copy-paste pitches.
            </p>
          </header>

          <a
            href="/sales-playbook/partner_offer.pdf"
            target="_blank"
            rel="noopener"
            className="block bg-deep-black text-warm-white rounded-md p-6 shadow-card hover:shadow-card-hover transition-all"
          >
            <div className="overline text-amber-gold">The leave-behind · 9 pages · PDF</div>
            <h3 className="font-display uppercase tracking-display mt-1" style={{ fontSize: 30, lineHeight: 1 }}>
              Partner Offer
            </h3>
            <p className="text-sm text-pale-stone mt-2 max-w-[70ch]">
              All four offers in one document — the whole cellar from one supplier (~300 wines, 15+ countries),
              the exclusive Russian range, a wine list rebuilt around cost-in, and the pop-up wine bar the venue
              runs at zero risk. Send it after the call, print it for the meeting.
            </p>
            <div className="text-xs text-amber-gold mt-4">Open PDF ↗</div>
          </a>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <DocCard
              title="Partner Offer (web)"
              subtitle="Same nine pages, in the browser"
              href="/sales-playbook/partner_offer.html"
              hint="Open offer"
            />
            <DocCard
              title="Call Script"
              subtitle="15–20 min phone intro"
              href="/sales-playbook/sales_playbook.html"
              hint="Open playbook"
            />
            <DocCard
              title="B2B Price List"
              subtitle="May 2026 — Sparkling / Gin / Wines"
              href="/sales-playbook/price_list.html"
              hint="Open price list"
            />
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-heading text-deep-black text-lg">Messenger / Email pitch</h2>
              <a
                href="/sales-playbook/messenger_pitch.md"
                target="_blank"
                rel="noopener"
                className="text-xs text-graphite hover:text-wine-red transition-colors"
              >
                Download .md ↗
              </a>
            </div>
            {pitch ? (
              <pre className="bg-cream/40 border border-pale-stone rounded-md p-4 text-sm text-deep-black whitespace-pre-wrap font-sans leading-relaxed">
                {pitch}
              </pre>
            ) : (
              <div className="text-sm text-graphite border border-pale-stone rounded-md p-4 bg-cream/30">
                <code>10_sales/sales_playbook/messenger_pitch.md</code> not found. Make sure
                <code> npm run sync-brand-assets</code> has run.
              </div>
            )}
          </section>

        </div>
      </div>
    </>
  )
}

function DocCard({
  title, subtitle, href, hint,
}: { title: string; subtitle: string; href: string; hint: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="block bg-warm-white border border-pale-stone rounded-md p-5 shadow-card hover:shadow-card-hover hover:border-wine-red transition-all"
    >
      <h3 className="font-heading font-semibold text-deep-black text-base">{title}</h3>
      <p className="text-sm text-graphite mt-1">{subtitle}</p>
      <div className="text-xs text-wine-red mt-3">{hint} ↗</div>
    </a>
  )
}
