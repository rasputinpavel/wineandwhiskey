import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'

export const dynamic = 'force-dynamic'

const REPO = 'https://github.com/rasputinpavel/wineandwhiskey'

type LogoEntry = { file: string; label: string; deprecated?: boolean }

// Primary brand mark = the W&W monogram (channel_avatar_*). All wordmark PNGs
// still contain the legacy "store" element between WINE and & WHISKEY and are
// deprecated since 2026-05-26 until clean files are regenerated.
const MONOGRAM_FILES: LogoEntry[] = [
  { file: 'channel_avatar_light.png', label: 'Monogram, light bg' },
  { file: 'channel_avatar_dark.png',  label: 'Monogram, dark bg' },
]

const DEPRECATED_LOGO_FILES: LogoEntry[] = [
  { file: 'logo_black.png',              label: 'Black, solid',        deprecated: true },
  { file: 'logo_black_transparent.png',  label: 'Black, transparent',  deprecated: true },
  { file: 'logo_white.png',              label: 'White, solid',        deprecated: true },
  { file: 'logo_color.png',              label: 'Color, solid',        deprecated: true },
  { file: 'logo_color_transparent.png',  label: 'Color, transparent',  deprecated: true },
  { file: 'logo_sq_color.png',           label: 'Square, color',       deprecated: true },
  { file: 'logo_sq_black.png',           label: 'Square, black',       deprecated: true },
  { file: 'logo_sq_white.png',           label: 'Square, white',       deprecated: true },
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
              Downloadable files from <code className="text-[12px]">04_brand/</code>. Usage rules
              live on the{' '}
              <a href="/m/design-system" className="text-wine-red hover:underline">Design System</a> page.
            </p>
          </section>

          {/* LOGOS */}
          <Section eyebrow="01" title="Logo" subtitle="Primary brand mark is the W&W monogram. Wordmark PNGs are deprecated until clean files are regenerated without the legacy 'store' element.">
            <h3 className="text-[12px] uppercase tracking-[0.15em] text-graphite mb-3">Monogram — use this</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              {MONOGRAM_FILES.map(({ file, label }) => {
                const isDarkBg = file.includes('dark')
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

            <h3 className="text-[12px] uppercase tracking-[0.15em] text-graphite mb-1">Wordmark — deprecated 2026-05-26</h3>
            <p className="text-[12px] text-graphite mb-3 max-w-2xl">
              All files below still contain the legacy <code className="text-[11px]">store</code> element between WINE and &amp; WHISKEY. Do not use in new materials. Clean wordmark files will be regenerated; until then, use the monogram or set the wordmark by hand in Bebas Neue.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {DEPRECATED_LOGO_FILES.map(({ file, label }) => {
                const isDarkBg = file.includes('white')
                return (
                  <a
                    key={file}
                    href={`/brand/logo/${file}`}
                    download
                    className="group block border border-pale-stone rounded-md overflow-hidden bg-warm-white hover:shadow-card-hover transition-shadow opacity-50 hover:opacity-80"
                  >
                    <div className={`aspect-square flex items-center justify-center p-4 relative ${isDarkBg ? 'bg-deep-black' : 'bg-cream/40'}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/brand/logo/${file}`} alt={label} className="max-h-full max-w-full object-contain grayscale" />
                      <span className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded-sm bg-wine-red text-warm-white">
                        Deprecated
                      </span>
                    </div>
                    <div className="px-2 py-1.5 border-t border-pale-stone flex items-center justify-between">
                      <span className="text-[12px] text-graphite truncate line-through">{label}</span>
                      <span className="text-[11px] text-wine-red opacity-0 group-hover:opacity-100 transition-opacity">↓</span>
                    </div>
                  </a>
                )
              })}
            </div>
          </Section>

          {/* BUSINESS CARDS */}
          <Section eyebrow="02" title="Business Cards" subtitle="Double-sided card, light and dark variants. PDFs ready for print.">
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
                    85×55 mm card. Bleed in place, fonts embedded. Double-check with the print shop before sending to press.
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
          <Section eyebrow="03" title="References" subtitle="Mood board: hands, light, shadows, 1904 Maps backgrounds.">
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
            <Section eyebrow="04" title="Product Photos" subtitle={`${products.length} bottles on transparent background. Used by the storefront and social content.`}>
              <details className="border border-pale-stone rounded-md bg-cream/30">
                <summary className="px-4 py-3 cursor-pointer text-sm font-heading font-semibold text-deep-black">
                  Show all
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
      Empty — drop files into <code className="text-xs">{hint}</code> and rebuild (<code className="text-xs">npm run dev</code>).
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
