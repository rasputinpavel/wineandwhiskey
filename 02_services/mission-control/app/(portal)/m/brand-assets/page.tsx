import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'

export const dynamic = 'force-dynamic'

const REPO = 'https://github.com/rasputinpavel/wineandwhiskey'

// Logo order mirrors the Design System grid — light-bg variants first, then square marks.
const LOGO_FILES = [
  { file: 'logo_black.png',              label: 'Чёрный, фон' },
  { file: 'logo_black_transparent.png',  label: 'Чёрный, прозрачный' },
  { file: 'logo_white.png',              label: 'Белый, фон' },
  { file: 'logo_color.png',              label: 'Цветной, фон' },
  { file: 'logo_color_transparent.png',  label: 'Цветной, прозрачный' },
  { file: 'logo_sq_color.png',           label: 'Квадрат, цветной' },
  { file: 'logo_sq_black.png',           label: 'Квадрат, чёрный' },
  { file: 'logo_sq_white.png',           label: 'Квадрат, белый' },
]

type FileEntry = { name: string; href: string; size: number; ext: string }

async function listFiles(rel: string, exts?: string[]): Promise<FileEntry[]> {
  const abs = path.join(process.cwd(), 'public', rel)
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }
  const out: FileEntry[] = []
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('_')) continue
    const ext = path.extname(e.name).toLowerCase().slice(1)
    if (exts && !exts.includes(ext)) continue
    const st = await stat(path.join(abs, e.name))
    out.push({ name: e.name, href: `/${rel}/${e.name}`, size: st.size, ext })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function fmtKB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default async function BrandAssetsPage() {
  const item = findItem('brand-assets')!

  const [businessCardFiles, references, products] = await Promise.all([
    listFiles('brand/business_cards', ['png', 'pdf']),
    listFiles('brand/references', ['png', 'jpg', 'jpeg', 'webp']),
    listFiles('brand/products', ['png', 'jpg', 'jpeg', 'webp']),
  ])

  const cardPreview = businessCardFiles.find(f => f.ext === 'png' && /preview/i.test(f.name))
  const cardPdfs = businessCardFiles.filter(f => f.ext === 'pdf')

  return (
    <>
      <PaneHeader
        item={item}
        externalHref={`${REPO}/tree/main/04_brand`}
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[1100px] mx-auto px-6 py-8 space-y-12">

          {/* HERO */}
          <section className="space-y-2">
            <div className="overline text-graphite">Brand & Design</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 48, lineHeight: 1 }}>
              Brand Assets
            </h1>
            <p className="text-sm text-graphite max-w-2xl">
              Скачиваемые файлы из <code className="text-[12px]">04_brand/</code>. Правила использования —
              на странице{' '}
              <a href="/m/design-system" className="text-wine-red hover:underline">Design System</a>.
            </p>
          </section>

          {/* LOGOS */}
          <Section eyebrow="01" title="Логотип" subtitle="PNG, для соцсетей и презентаций. Если нужен SVG — попроси в чате, пересоберём.">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {LOGO_FILES.map(({ file, label }) => {
                const isDarkBg = file.includes('white')
                return (
                  <a
                    key={file}
                    href={`/brand/logo/${file}`}
                    download
                    className="group block border border-pale-stone rounded-md overflow-hidden bg-warm-white hover:shadow-card-hover transition-shadow"
                  >
                    <div className={`aspect-square flex items-center justify-center p-4 ${isDarkBg ? 'bg-deep-black' : 'bg-cream/40'}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/brand/logo/${file}`} alt={label} className="max-h-full max-w-full object-contain" />
                    </div>
                    <div className="px-2 py-1.5 border-t border-pale-stone flex items-center justify-between">
                      <span className="text-[12px] text-graphite truncate">{label}</span>
                      <span className="text-[11px] text-wine-red opacity-0 group-hover:opacity-100 transition-opacity">↓</span>
                    </div>
                  </a>
                )
              })}
            </div>
          </Section>

          {/* BUSINESS CARDS */}
          <Section eyebrow="02" title="Визитки" subtitle="Двусторонняя визитка, light- и dark-варианты. PDF готовы к печати.">
            {cardPreview || cardPdfs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                {cardPreview && (
                  <a
                    href={cardPreview.href}
                    target="_blank"
                    rel="noopener"
                    className="block border border-pale-stone rounded-md overflow-hidden bg-cream/40 hover:shadow-card-hover transition-shadow"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cardPreview.href} alt="Business cards preview" className="w-full h-auto block" />
                  </a>
                )}
                <div className="space-y-3">
                  <div className="text-sm text-graphite">
                    Карточка 85×55 mm. Bleed готов, шрифты embedded. Перед печатью — проверь у типографии.
                  </div>
                  <div className="space-y-2">
                    {cardPdfs.map(f => (
                      <a
                        key={f.href}
                        href={f.href}
                        download
                        className="flex items-center justify-between gap-3 px-4 py-3 border border-pale-stone rounded-sm bg-warm-white hover:border-wine-red hover:text-wine-red transition-colors"
                      >
                        <span className="text-sm font-heading text-deep-black">{prettyCardName(f.name)}</span>
                        <span className="text-[11px] text-graphite">{fmtKB(f.size)} · PDF ↓</span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <Empty hint="04_brand/business_cards/" />
            )}
          </Section>

          {/* REFERENCES */}
          <Section eyebrow="03" title="Референсы" subtitle="Mood-доска: руки, свет, тени, фоны 1904 Maps.">
            {references.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {references.map(f => (
                  <a
                    key={f.href}
                    href={f.href}
                    target="_blank"
                    rel="noopener"
                    className="group block border border-pale-stone rounded-md overflow-hidden bg-cream/40 hover:shadow-card-hover transition-shadow"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.href} alt={f.name} className="w-full aspect-[4/3] object-cover" />
                    <div className="px-2 py-1.5 border-t border-pale-stone flex items-center justify-between">
                      <span className="text-[11px] text-graphite truncate" title={f.name}>{stripExt(f.name)}</span>
                      <span className="text-[11px] text-wine-red opacity-0 group-hover:opacity-100 transition-opacity">↓</span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <Empty hint="04_brand/references/" />
            )}
          </Section>

          {/* PRODUCT PHOTOS */}
          {products.length > 0 && (
            <Section eyebrow="04" title="Фото товаров" subtitle={`${products.length} бутылок на прозрачном фоне. Используются витриной и контентом.`}>
              <details className="border border-pale-stone rounded-md bg-cream/30">
                <summary className="px-4 py-3 cursor-pointer text-sm font-heading font-semibold text-deep-black">
                  Показать все
                </summary>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 p-3 pt-0">
                  {products.map(f => (
                    <a
                      key={f.href}
                      href={f.href}
                      target="_blank"
                      rel="noopener"
                      className="block border border-pale-stone rounded-sm overflow-hidden bg-warm-white aspect-square"
                      title={stripExt(f.name)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.href} alt={f.name} className="w-full h-full object-contain p-2" />
                    </a>
                  ))}
                </div>
              </details>
            </Section>
          )}
        </div>
      </div>
    </>
  )
}

function Section({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3 border-b border-pale-stone pb-2">
        <span className="overline text-wine-red">{eyebrow}</span>
        <h2 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 24 }}>{title}</h2>
      </div>
      {subtitle && <p className="text-sm text-graphite -mt-2">{subtitle}</p>}
      {children}
    </section>
  )
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="text-center py-8 text-graphite text-sm border border-dashed border-pale-stone rounded-md">
      Пусто — положи файлы в <code className="text-xs">{hint}</code> и пересобери (<code className="text-xs">npm run dev</code>).
    </div>
  )
}

function prettyCardName(filename: string): string {
  // wine_whiskey_business_cards_dark.pdf → "Dark"
  const stem = filename.replace(/\.pdf$/i, '')
  const m = stem.match(/_(dark|light|colou?r)$/i)
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return stem
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
