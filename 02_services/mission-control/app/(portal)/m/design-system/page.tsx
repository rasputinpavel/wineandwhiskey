import { statSync } from 'node:fs'
import path from 'node:path'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
// Static import — bundled at build. Source of truth is 04_brand/design-tokens.json,
// mirrored to lib/brand-tokens.json by prebuild (scripts/sync-brand-assets.mjs).
import brandTokens from '@/lib/brand-tokens.json'

export const dynamic = 'force-dynamic'

type Tokens = {
  palette: {
    background: string; primary: string; accent: string; text: string; textSecondary: string; border: string
    extended: Record<string, string>
    rules: string[]
  }
  typography: {
    fonts: { display: string; headline: string; body: string }
    tokens: Record<string, { font: string; size: string; weight: number; tracking?: number; lineHeight?: number; case?: string }>
    rules: string[]
  }
  spacing: { scale: Record<string, string>; safezones: Record<string, Record<string, number>> }
  components: {
    button: Record<string, Record<string, string | number>>
    badge:  Record<string, Record<string, string>>
  }
  brand: {
    name: string; location: string; concept: string; voiceOneLiner: string
    registers: Record<string, string>
    forbiddenPhrases: string[]
    hours: string
  }
}

const REPO = 'https://github.com/rasputinpavel/wineandwhiskey'

const PALETTE_USAGE: Record<string, { title: string; usage: string }> = {
  wineRed:      { title: 'Wine Red',      usage: 'Accent, headings, CTAs' },
  burgundyDeep: { title: 'Burgundy Deep', usage: 'Shadows on red, dark accents' },
  deepBlack:    { title: 'Deep Black',    usage: 'Body text, dark background' },
  warmWhite:    { title: 'Warm White',    usage: 'Light background, padding' },
  cream:        { title: 'Cream',         usage: 'Cards, surfaces' },
  amberGold:    { title: 'Amber Gold',    usage: 'Glass, premium, prices' },
  graphite:     { title: 'Graphite',      usage: 'Secondary text, captions' },
  paleStone:    { title: 'Pale Stone',    usage: 'Dividers, inactive' },
}

const TYPE_TOKEN_ORDER = [
  'display-xl', 'display-lg', 'display-md', 'display-sm',
  'headline-lg', 'headline-md', 'headline-sm',
  'body-lg', 'body-md', 'body-sm',
  'label', 'overline',
] as const

// Primary brand mark = the W&W monogram (channel_avatar_*). All wordmark PNGs
// still contain the legacy "store" element between WINE and & WHISKEY and are
// deprecated since 2026-05-26 until clean files are regenerated.
const MONOGRAM_FILES = [
  { file: 'channel_avatar_light.png', label: 'Monogram, light bg' },
  { file: 'channel_avatar_dark.png',  label: 'Monogram, dark bg' },
]

const DEPRECATED_LOGO_FILES = [
  { file: 'logo_black.png',              label: 'Black, solid' },
  { file: 'logo_black_transparent.png',  label: 'Black, transparent' },
  { file: 'logo_white.png',              label: 'White, solid' },
  { file: 'logo_color.png',              label: 'Color, solid' },
  { file: 'logo_color_transparent.png',  label: 'Color, transparent' },
  { file: 'logo_sq_color.png',           label: 'Square, color' },
  { file: 'logo_sq_black.png',           label: 'Square, black' },
  { file: 'logo_sq_white.png',           label: 'Square, white' },
]

function rgbFromHex(hex: string): string {
  const m = hex.replace('#', '').match(/.{2}/g)
  if (!m) return ''
  return m.map(x => parseInt(x, 16)).join(', ')
}

function getUpdatedAt(): string | null {
  // Best-effort: mtime of the committed mirror. Falls back to null if anything goes wrong.
  try {
    const p = path.join(process.cwd(), 'lib/brand-tokens.json')
    return statSync(p).mtime.toISOString().slice(0, 10)
  } catch {
    return null
  }
}

export default async function DesignSystemPage() {
  const item = findItem('design-system')!
  const tokens = brandTokens as unknown as Tokens
  const updatedAt = getUpdatedAt()

  return (
    <>
      <PaneHeader
        item={item}
        externalHref={`${REPO}/blob/main/04_brand/design-system.md`}
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[1100px] mx-auto px-6 py-8 space-y-12">

          {/* HERO */}
          <section className="space-y-3">
            <div className="overline text-graphite">Design system · v{tokens.palette.extended ? '1.0' : '—'}</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 72, lineHeight: 0.95 }}>
              {tokens.brand.name}
            </h1>
            <p className="font-heading text-graphite max-w-2xl" style={{ fontSize: 20, lineHeight: 1.4 }}>
              {tokens.brand.concept}
            </p>
            <div className="flex flex-wrap gap-3 pt-2 text-xs text-graphite">
              <span>📍 {tokens.brand.location}</span>
              <span>·</span>
              <span>🕒 {tokens.brand.hours}</span>
              {updatedAt && <><span>·</span><span>Updated {updatedAt}</span></>}
              <span>·</span>
              <a href={`${REPO}/blob/main/04_brand/design-system.md`} target="_blank" rel="noopener" className="text-wine-red hover:underline">
                Source (design-system.md) ↗
              </a>
            </div>
          </section>

          {/* PALETTE */}
          <section className="space-y-4">
            <SectionHeader eyebrow="01" title="Palette" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(tokens.palette.extended).map(([key, hex]) => {
                const meta = PALETTE_USAGE[key] ?? { title: key, usage: '' }
                const isLight = ['warmWhite', 'cream', 'paleStone', 'amberGold'].includes(key)
                return (
                  <div key={key} className="bg-warm-white border border-pale-stone rounded-md overflow-hidden shadow-card">
                    <div className="h-28" style={{ backgroundColor: hex }}>
                      <div className="h-full flex items-end p-3" style={{ color: isLight ? '#1A1A1A' : '#F5F0EB' }}>
                        <code className="text-[11px] font-mono opacity-80">{hex.toUpperCase()}</code>
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="font-heading font-semibold text-sm text-deep-black">{meta.title}</div>
                      <div className="text-[11px] text-graphite mt-0.5">rgb({rgbFromHex(hex)})</div>
                      <div className="text-[12px] text-graphite mt-1 leading-tight">{meta.usage}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <Rules title="Rules" items={tokens.palette.rules} />
          </section>

          {/* TYPOGRAPHY */}
          <section className="space-y-4">
            <SectionHeader eyebrow="02" title="Typography" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['display', 'headline', 'body'] as const).map(role => (
                <div key={role} className="bg-cream/50 border border-pale-stone rounded-md p-4">
                  <div className="overline text-graphite mb-1">{role}</div>
                  <div className="font-heading font-semibold text-deep-black">{tokens.typography.fonts[role]}</div>
                </div>
              ))}
            </div>

            <div className="bg-warm-white border border-pale-stone rounded-md divide-y divide-pale-stone">
              {TYPE_TOKEN_ORDER.map(name => {
                const t = tokens.typography.tokens[name]
                if (!t) return null
                const sample = name.startsWith('display')
                  ? 'WINE & WHISKEY'
                  : name.startsWith('headline')
                  ? 'A friend with good taste'
                  : name === 'overline'
                  ? 'NEW ARRIVAL'
                  : name === 'label'
                  ? 'In stock'
                  : 'Editorial wine bar — cinematic dark or alive light, never sterile.'
                const px = parseInt(t.size)
                const fontFamily = t.font === 'Bebas Neue' ? 'Bebas Neue' : t.font === 'DM Sans' ? 'DM Sans' : 'Inter'
                const displaySize = Math.min(px, 64) // cap for layout sanity
                return (
                  <div key={name} className="grid grid-cols-12 gap-4 items-baseline px-4 py-4">
                    <div className="col-span-12 md:col-span-3 space-y-0.5">
                      <code className="text-[12px] text-deep-black font-mono">{name}</code>
                      <div className="text-[11px] text-graphite">
                        {t.font} · {t.size} · {t.weight}
                        {t.tracking !== undefined && <> · tracking {t.tracking}</>}
                      </div>
                    </div>
                    <div className="col-span-12 md:col-span-9 truncate" style={{
                      fontFamily: `"${fontFamily}", system-ui, sans-serif`,
                      fontSize: displaySize,
                      fontWeight: t.weight,
                      letterSpacing: t.tracking ? `${t.tracking / 1000}em` : undefined,
                      textTransform: t.case === 'upper' ? 'uppercase' : undefined,
                      lineHeight: t.lineHeight ?? 1.15,
                      color: '#1A1A1A',
                    }}>
                      {sample}
                    </div>
                  </div>
                )
              })}
            </div>
            <Rules title="Rules" items={tokens.typography.rules} />
          </section>

          {/* LOGO */}
          <section className="space-y-4">
            <SectionHeader eyebrow="03" title="Logo" />
            <p className="text-sm text-graphite max-w-2xl -mt-2">
              Primary brand mark is the W&amp;W monogram. The full wordmark is deprecated until clean files (without the legacy &ldquo;store&rdquo; element) are regenerated.
            </p>

            <h3 className="text-[12px] uppercase tracking-[0.15em] text-graphite pt-2">Monogram — use this</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

            <h3 className="text-[12px] uppercase tracking-[0.15em] text-graphite pt-4">Wordmark — deprecated 2026-05-26</h3>
            <p className="text-[12px] text-graphite max-w-2xl -mt-2">
              All files below still contain the legacy <code className="text-[11px]">store</code> element. Do not use in new materials.
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
          </section>

          {/* COMPONENTS */}
          <section className="space-y-4">
            <SectionHeader eyebrow="04" title="Components" />
            <div className="bg-warm-white border border-pale-stone rounded-md p-6 space-y-6">
              <ComponentRow title="Buttons">
                <button className="bg-wine-red text-warm-white px-6 py-3 rounded-sm font-medium text-sm hover:bg-burgundy-deep transition-colors">Primary</button>
                <button className="bg-transparent text-deep-black border border-deep-black px-6 py-3 rounded-sm font-medium text-sm hover:bg-deep-black hover:text-warm-white transition-colors">Secondary</button>
                <button className="bg-transparent text-wine-red px-6 py-3 rounded-sm font-medium text-sm hover:underline">Ghost</button>
              </ComponentRow>
              <ComponentRow title="Badges">
                <span className="overline bg-wine-red text-warm-white px-2.5 py-1 rounded-sm">New</span>
                <span className="overline bg-amber-gold text-deep-black px-2.5 py-1 rounded-sm">Sale</span>
                <span className="overline bg-cream text-graphite px-2.5 py-1 rounded-sm">In stock</span>
              </ComponentRow>
              <ComponentRow title="Product card">
                <div className="w-56 bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
                  <div className="aspect-square bg-cream rounded-sm flex items-center justify-center mb-3">
                    <span className="font-display text-deep-black text-3xl uppercase tracking-display">W&amp;W</span>
                  </div>
                  <div className="overline text-graphite mb-1">Reserva · Rioja</div>
                  <div className="font-heading font-semibold text-deep-black text-base leading-tight">Marqués de Riscal</div>
                  <div className="font-display text-deep-black uppercase tracking-display mt-2" style={{ fontSize: 28 }}>1,890฿</div>
                </div>
              </ComponentRow>
            </div>
          </section>

          {/* SPACING */}
          <section className="space-y-4">
            <SectionHeader eyebrow="05" title="Spacing" />
            <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
              {Object.entries(tokens.spacing.scale).map(([name, size]) => {
                const px = parseInt(size)
                return (
                  <div key={name} className="bg-warm-white border border-pale-stone rounded-md p-3 flex flex-col items-start gap-2">
                    <div className="bg-wine-red" style={{ width: px, height: px, maxWidth: '100%' }} />
                    <div>
                      <code className="text-[12px] font-mono text-deep-black">{name}</code>
                      <div className="text-[11px] text-graphite">{size}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* VOICE */}
          <section className="space-y-4">
            <SectionHeader eyebrow="06" title="Tone of Voice" />
            <div className="bg-warm-white border border-pale-stone rounded-md p-6 space-y-5">
              <p className="font-heading text-deep-black italic" style={{ fontSize: 22, lineHeight: 1.35 }}>
                «{tokens.brand.voiceOneLiner}»
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(tokens.brand.registers).map(([key, text]) => (
                  <div key={key}>
                    <div className="overline text-wine-red mb-1">{key}</div>
                    <p className="text-sm text-graphite leading-relaxed">{text}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="overline text-graphite mb-2">Forbidden</div>
                <div className="flex flex-wrap gap-2">
                  {tokens.brand.forbiddenPhrases.map(p => (
                    <span key={p} className="text-xs text-graphite bg-cream/60 border border-pale-stone px-2 py-1 rounded-sm line-through">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* SOURCE FILES */}
          <section className="space-y-4">
            <SectionHeader eyebrow="07" title="Files" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <DownloadCard
                href="/brand/design-system.md"
                title="design-system.md"
                meta={updatedAt ? `Markdown · updated ${updatedAt}` : 'Markdown · full spec'}
                description="Full spec: tokens, rules, examples."
              />
              <DownloadCard
                href="/brand/design-tokens.json"
                title="design-tokens.json"
                meta="JSON · machine-readable"
                description="Same tokens, formatted for scripts and AI prompts."
              />
              <DownloadCard
                href={`${REPO}/tree/main/04_brand`}
                external
                title="04_brand/ on GitHub"
                meta="Change history · PR"
                description="Logos, business cards, references in the repo."
              />
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-pale-stone pb-2">
      <span className="overline text-wine-red">{eyebrow}</span>
      <h2 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 32, lineHeight: 1 }}>{title}</h2>
    </div>
  )
}

function Rules({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-cream/40 border border-pale-stone rounded-md p-4">
      <div className="overline text-graphite mb-2">{title}</div>
      <ul className="space-y-1.5 text-sm text-graphite">
        {items.map(r => <li key={r} className="leading-snug">— {r}</li>)}
      </ul>
    </div>
  )
}

function ComponentRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="overline text-graphite mb-3">{title}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

function DownloadCard({
  href, title, meta, description, external,
}: { href: string; title: string; meta: string; description: string; external?: boolean }) {
  const props = external ? { target: '_blank' as const, rel: 'noopener noreferrer' } : { download: true }
  return (
    <a
      href={href}
      {...props}
      className="block bg-warm-white border border-pale-stone rounded-md p-4 hover:border-wine-red hover:shadow-card-hover transition-all"
    >
      <div className="font-heading font-semibold text-deep-black text-sm">{title} {external ? '↗' : '↓'}</div>
      <div className="text-[11px] text-graphite mt-0.5">{meta}</div>
      <p className="text-[13px] text-graphite mt-2 leading-snug">{description}</p>
    </a>
  )
}
