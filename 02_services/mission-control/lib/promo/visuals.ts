// Promo Pulse — Phase 3 visual templates.
//
// Each format renders the SAME composition (chosen by the model in Phase 2)
// adapted to its aspect ratio. CSS uses design tokens from §2/§3 of the
// design system. Layout switches by `composition`; palette switches by
// `visual_mode`. Text scales via vmin so the template auto-fits every
// canvas without per-format size tables.

import type { PromoCampaign, PromoComposition, PromoVisualMode } from './types'

// ─── Format spec ───────────────────────────────────────────────────────────
export type PromoFormatKey =
  | 'ig_post'
  | 'ig_story'
  | 'tg_post'
  | 'poster_a2'
  | 'stand_a3'
  | 'web_banner_desktop'
  | 'web_banner_mobile'

export type FormatSpec = {
  key:       PromoFormatKey
  label:     string
  // px viewport (also drives the PDF page size when ext='pdf' since we set
  // page.pdf({ width: w + 'px', height: h + 'px' })).
  width:     number
  height:    number
  ext:       'png' | 'pdf'
  // Image rotation used by composition: how heavy a photo zone we want.
  // 'wide' lays out photos in a row, 'portrait' stacks them.
  axis:      'square' | 'portrait' | 'landscape'
}

export const FORMAT_SPECS: FormatSpec[] = [
  { key: 'ig_post',            label: 'IG Post',         width: 1080, height: 1080, ext: 'png', axis: 'square' },
  { key: 'ig_story',           label: 'IG Story',        width: 1080, height: 1920, ext: 'png', axis: 'portrait' },
  { key: 'tg_post',            label: 'TG / WA Post',    width: 1080, height: 1080, ext: 'png', axis: 'square' },
  // A2 portrait at 150 DPI-equivalent — same px count as 300 DPI / 2.
  // Puppeteer renders the HTML viewport then exports to PDF at exact px sizes.
  { key: 'poster_a2',          label: 'A2 Poster',       width: 2480, height: 3508, ext: 'pdf', axis: 'portrait' },
  { key: 'stand_a3',           label: 'A3 In-store',     width: 1748, height: 2480, ext: 'pdf', axis: 'portrait' },
  { key: 'web_banner_desktop', label: 'Web Banner (D)',  width: 1920, height: 600,  ext: 'png', axis: 'landscape' },
  { key: 'web_banner_mobile',  label: 'Web Banner (M)',  width: 768,  height: 400,  ext: 'png', axis: 'landscape' },
]

// ─── Design tokens (mirror of 04_brand/design-tokens.json) ─────────────────
const TOKENS = {
  wineRed:    '#8C1C1C',
  deepBlack:  '#1A1A1A',
  warmWhite:  '#F5F0EB',
  cream:      '#EDE0D0',
  amberGold:  '#C9A84C',
  burgundy:   '#5C1010',
  graphite:   '#3D3D3D',
  paleStone:  '#D4C9BC',
}

function palette(mode: PromoVisualMode) {
  if (mode === 'dark') {
    return {
      bg:       TOKENS.deepBlack,
      text:     TOKENS.warmWhite,
      muted:    TOKENS.paleStone,
      accent:   TOKENS.amberGold,
      logoFill: TOKENS.warmWhite,
      logoRed:  TOKENS.wineRed,
    }
  }
  return {
    bg:       TOKENS.warmWhite,
    text:     TOKENS.deepBlack,
    muted:    TOKENS.graphite,
    accent:   TOKENS.wineRed,
    logoFill: TOKENS.deepBlack,
    logoRed:  TOKENS.wineRed,
  }
}

// ─── Template ──────────────────────────────────────────────────────────────
type BuildArgs = {
  campaign:           PromoCampaign
  format:             FormatSpec
  // base64 data URLs keyed by SKU slug.
  productDataUrls:    Map<string, string>
}

export function buildHtml({ campaign, format, productDataUrls }: BuildArgs): string {
  const mode = campaign.visual_mode ?? 'dark'
  const composition = campaign.composition ?? 'vitrina'
  const pal = palette(mode)

  const products = campaign.sku_slugs
    .map(slug => ({ slug, src: productDataUrls.get(slug) }))
    .filter(p => p.src) as { slug: string; src: string }[]

  const headline = (campaign.headline ?? campaign.theme).toUpperCase()
  const subhead  = campaign.subhead ?? campaign.mechanic
  const mechanic = campaign.mechanic
  const dates    = formatDateRange(campaign.starts_on, campaign.ends_on)

  const stage = renderStage({ composition, products, headline, subhead, mechanic, dates, pal, format })

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page { size: ${format.width}px ${format.height}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${format.width}px; height: ${format.height}px; background: ${pal.bg}; color: ${pal.text}; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; overflow: hidden; }

  /* Type scale — vmin so it adapts across formats */
  .t-display-xl { font-family: 'Bebas Neue', sans-serif; font-weight: 400; letter-spacing: 0.04em; text-transform: uppercase; line-height: 0.9; }
  .t-display-lg { font-family: 'Bebas Neue', sans-serif; font-weight: 400; letter-spacing: 0.04em; text-transform: uppercase; line-height: 0.95; }
  .t-headline   { font-family: 'DM Sans', sans-serif; font-weight: 600; line-height: 1.15; }
  .t-body       { font-family: 'Inter', sans-serif; font-weight: 400; line-height: 1.4; }
  .t-overline   { font-family: 'Inter', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.15em; }
  .t-label      { font-family: 'Inter', sans-serif; font-weight: 500; }

  .accent { color: ${pal.accent}; }
  .muted  { color: ${pal.muted}; }

  .stage { width: 100%; height: 100%; padding: 6vmin; position: relative; display: flex; flex-direction: column; }

  /* Logo */
  .logo { display: inline-flex; align-items: baseline; gap: 0.2em; font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.05em; text-transform: uppercase; line-height: 1; }
  .logo .red { color: ${pal.logoRed}; }
  .logo .blk { color: ${pal.logoFill}; }

  /* Product cards */
  .product-row { display: flex; gap: 4vmin; align-items: flex-end; justify-content: center; }
  .product { display: flex; flex-direction: column; align-items: center; gap: 1.5vmin; }
  .product img { object-fit: contain; filter: drop-shadow(0 1.5vmin 2vmin rgba(0,0,0,0.35)); }
  .product .name { font-size: 1.6vmin; opacity: 0.7; max-width: 14vmin; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Mechanic chip */
  .chip { display: inline-block; padding: 1.2vmin 2.4vmin; background: ${pal.accent}; color: ${mode === 'dark' ? TOKENS.deepBlack : TOKENS.warmWhite}; font-family: 'Inter', sans-serif; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-size: 2.2vmin; }
</style>
</head>
<body>
${stage}
</body>
</html>`
}

// ─── Composition renderers ─────────────────────────────────────────────────
type StageArgs = {
  composition: PromoComposition
  products:    { slug: string; src: string }[]
  headline:    string
  subhead:     string
  mechanic:    string
  dates:       string
  pal:         ReturnType<typeof palette>
  format:      FormatSpec
}

function renderStage(a: StageArgs): string {
  switch (a.composition) {
    case 'vitrina':   return renderVitrina(a)
    case 'tsena':     return renderTsena(a)
    case 'zayavka':   return renderZayavka(a)
    case 'moment':    return renderMoment(a)
    case 'kartochka': return renderKartochka(a)
  }
}

// Witrina — product hero, photo dominates (80%), text band at bottom
function renderVitrina(a: StageArgs): string {
  const productHeight = a.format.axis === 'landscape' ? '70%' : '60%'
  return `
<div class="stage">
  <div style="flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center;">
    ${logoMark()}
    <div class="chip">${escape(a.mechanic)}</div>
  </div>
  <div style="flex: 1 1 auto; display: flex; align-items: center; justify-content: center;">
    <div class="product-row">
      ${productsHtml(a.products, productHeight)}
    </div>
  </div>
  <div style="flex: 0 0 auto;">
    <div class="t-overline accent" style="font-size: 2vmin; margin-bottom: 1.5vmin;">${escape(a.dates)}</div>
    <div class="t-display-lg" style="font-size: 9vmin;">${escape(a.headline)}</div>
    <div class="t-body muted" style="font-size: 2.4vmin; margin-top: 1vmin;">${escape(a.subhead)}</div>
  </div>
</div>`
}

// Tsena — big number (mechanic) center, product secondary
function renderTsena(a: StageArgs): string {
  return `
<div class="stage" style="justify-content: space-between;">
  <div style="display: flex; justify-content: space-between; align-items: center;">
    ${logoMark()}
    <div class="t-overline accent" style="font-size: 2vmin;">${escape(a.dates)}</div>
  </div>
  <div style="text-align: center;">
    <div class="t-overline muted" style="font-size: 2.2vmin; margin-bottom: 2vmin;">${escape(a.headline)}</div>
    <div class="t-display-xl accent" style="font-size: 18vmin;">${escape(a.mechanic)}</div>
    <div class="t-headline" style="font-size: 3vmin; margin-top: 2vmin;">${escape(a.subhead)}</div>
  </div>
  <div class="product-row" style="margin-bottom: 2vmin;">
    ${productsHtml(a.products, '32%')}
  </div>
</div>`
}

// Zayavka — text-driven statement, product as small corner detail
function renderZayavka(a: StageArgs): string {
  return `
<div class="stage" style="justify-content: space-between;">
  <div style="display: flex; justify-content: space-between; align-items: center;">
    ${logoMark()}
    <div class="chip">${escape(a.mechanic)}</div>
  </div>
  <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
    <div class="t-overline accent" style="font-size: 2.2vmin; margin-bottom: 2vmin;">${escape(a.dates)}</div>
    <div class="t-display-xl" style="font-size: 13vmin; max-width: 85%;">${escape(a.headline)}</div>
    <div class="t-body muted" style="font-size: 2.6vmin; margin-top: 3vmin; max-width: 60%;">${escape(a.subhead)}</div>
  </div>
  <div style="position: absolute; bottom: 6vmin; right: 6vmin; display: flex; gap: 2vmin; align-items: flex-end;">
    ${productsHtml(a.products.slice(0, 2), '28%')}
  </div>
</div>`
}

// Moment — full-bleed, minimal text. Single product front and center.
function renderMoment(a: StageArgs): string {
  return `
<div class="stage" style="padding: 0; position: relative;">
  <div style="position: absolute; inset: 6vmin 6vmin auto 6vmin; display: flex; justify-content: space-between; align-items: center; z-index: 2;">
    ${logoMark()}
    <div class="t-overline" style="color: ${a.pal.text}; font-size: 1.8vmin;">${escape(a.dates)}</div>
  </div>
  <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">
    <div class="product-row">
      ${productsHtml(a.products.slice(0, 1), '70%')}
    </div>
  </div>
  <div style="position: absolute; bottom: 6vmin; left: 6vmin; right: 6vmin; z-index: 2; text-align: center;">
    <div class="t-display-lg" style="font-size: 7vmin;">${escape(a.headline)}</div>
  </div>
</div>`
}

// Kartochka — 2-column for square/landscape, 2-row for portrait
function renderKartochka(a: StageArgs): string {
  const isPortrait = a.format.axis === 'portrait'
  const grid = isPortrait
    ? 'grid-template-rows: 1fr 1fr;'
    : 'grid-template-columns: 1fr 1fr;'
  return `
<div class="stage">
  <div style="flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4vmin;">
    ${logoMark()}
    <div class="chip">${escape(a.mechanic)}</div>
  </div>
  <div style="flex: 1; display: grid; ${grid} gap: 4vmin; align-items: center;">
    <div style="display: flex; align-items: center; justify-content: center;">
      <div class="product-row">${productsHtml(a.products, '60%')}</div>
    </div>
    <div>
      <div class="t-overline accent" style="font-size: 2vmin; margin-bottom: 2vmin;">${escape(a.dates)}</div>
      <div class="t-display-lg" style="font-size: 8vmin; margin-bottom: 3vmin;">${escape(a.headline)}</div>
      <div class="t-body" style="font-size: 2.6vmin;">${escape(a.subhead)}</div>
    </div>
  </div>
</div>`
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function logoMark(): string {
  // SVG-free logo mark — uses Bebas Neue web font. Big and unmissable, per
  // the memory: "лого W&W должно быть крупным и заметным".
  return `<div class="logo" style="font-size: 4.5vmin;"><span class="red">WINE</span><span class="blk">&amp; WHISKEY</span></div>`
}

function productsHtml(products: { slug: string; src: string }[], heightCss: string): string {
  if (products.length === 0) return ''
  return products
    .map(p => `
      <div class="product">
        <img src="${p.src}" style="height: ${heightCss}; max-height: ${heightCss};" />
      </div>`)
    .join('')
}

function formatDateRange(starts: string, ends: string): string {
  if (starts === ends) return formatDate(starts)
  return `${formatDate(starts)} → ${formatDate(ends)}`
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[m - 1]} ${d}`
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
