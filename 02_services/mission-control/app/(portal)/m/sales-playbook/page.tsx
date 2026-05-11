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
            <div className="overline text-graphite">Материалы для B2B-питча</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              Sales Playbook
            </h1>
            <p className="text-sm text-graphite mt-1">
              Всё, что нужно менеджеру для первой встречи: call-script с якорями, прайс и шаблон сообщения.
            </p>
          </header>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DocCard
              title="Call Script"
              subtitle="15–20-минутный intro по телефону"
              href="/sales-playbook/sales_playbook.html"
              hint="Открыть playbook"
            />
            <DocCard
              title="B2B Price List"
              subtitle="Прайс 2026-05 — Sparkling / Gin / Wines"
              href="/sales-playbook/price_list.html"
              hint="Открыть прайс"
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
                Скачать .md ↗
              </a>
            </div>
            {pitch ? (
              <pre className="bg-cream/40 border border-pale-stone rounded-md p-4 text-sm text-deep-black whitespace-pre-wrap font-sans leading-relaxed">
                {pitch}
              </pre>
            ) : (
              <div className="text-sm text-graphite border border-pale-stone rounded-md p-4 bg-cream/30">
                Файл <code>10_sales/sales_playbook/messenger_pitch.md</code> не нашёлся. Проверь, что
                <code> npm run sync-brand-assets</code> отработал.
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
