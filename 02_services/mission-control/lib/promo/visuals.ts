// Promo Pulse — Phase 3.5 visual templates.
//
// Each format = AI-generated atmospheric photo (Nano Banana Pro) as canvas
// background + product PNG composited centered + design-system text overlay.
// Layout switches by composition (3 variants: product-hero / text-hero /
// moment), aspect picks which AI background to use, palette adapts to
// visual_mode so text stays readable.

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
  key:    PromoFormatKey
  label:  string
  width:  number
  height: number
  ext:    'png' | 'pdf'
  // Maps to one of the three NBP-generated backgrounds.
  axis:   'square' | 'portrait' | 'landscape'
}

export const FORMAT_SPECS: FormatSpec[] = [
  { key: 'ig_post',            label: 'IG Post',         width: 1080, height: 1080, ext: 'png', axis: 'square' },
  { key: 'ig_story',           label: 'IG Story',        width: 1080, height: 1920, ext: 'png', axis: 'portrait' },
  { key: 'tg_post',            label: 'TG / WA Post',    width: 1080, height: 1080, ext: 'png', axis: 'square' },
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
      text:     TOKENS.warmWhite,
      muted:    TOKENS.paleStone,
      accent:   TOKENS.amberGold,
      chip:     TOKENS.amberGold,
      chipText: TOKENS.deepBlack,
      logoRed:  TOKENS.wineRed,
      logoFill: TOKENS.warmWhite,
      // Bottom gradient overlay for text legibility.
      veil:     'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 40%, transparent 60%)',
    }
  }
  return {
    text:     TOKENS.deepBlack,
    muted:    TOKENS.graphite,
    accent:   TOKENS.wineRed,
    chip:     TOKENS.wineRed,
    chipText: TOKENS.warmWhite,
    logoRed:  TOKENS.wineRed,
    logoFill: TOKENS.deepBlack,
    veil:     'linear-gradient(to top, rgba(245,240,235,0.92) 0%, rgba(245,240,235,0.55) 40%, transparent 60%)',
  }
}

// ─── Template ──────────────────────────────────────────────────────────────
export type BuildArgs = {
  campaign:           PromoCampaign
  format:             FormatSpec
  // base64 data URLs keyed by SKU slug.
  productDataUrls:    Map<string, string>
  // base64 data URL of the AI-generated background for this format's aspect.
  backgroundDataUrl:  string
}

export function buildHtml(args: BuildArgs): string {
  const { campaign, format, productDataUrls, backgroundDataUrl } = args
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
  html, body {
    width: ${format.width}px;
    height: ${format.height}px;
    background-image: url("${backgroundDataUrl}");
    background-size: cover;
    background-position: center;
    color: ${pal.text};
    font-family: 'Inter', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    position: relative;
  }
  .veil {
    position: absolute; inset: 0;
    background: ${pal.veil};
    pointer-events: none;
    z-index: 1;
  }
  .stage {
    position: relative; z-index: 2;
    width: 100%; height: 100%;
    padding: 6vmin;
    display: flex; flex-direction: column;
  }

  /* Typography (Bebas Neue display + DM Sans headline + Inter body) */
  .t-display-xl { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.04em; text-transform: uppercase; line-height: 0.9; }
  .t-display-lg { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.04em; text-transform: uppercase; line-height: 0.95; }
  .t-headline   { font-family: 'DM Sans', sans-serif; font-weight: 600; line-height: 1.15; }
  .t-body       { font-family: 'Inter', sans-serif; font-weight: 400; line-height: 1.4; }
  .t-overline   { font-family: 'Inter', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.15em; }

  .accent { color: ${pal.accent}; }
  .muted  { color: ${pal.muted}; }

  /* Logo */
  .logo { display: inline-flex; align-items: baseline; gap: 0.2em; font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.05em; text-transform: uppercase; line-height: 1; }
  .logo .red { color: ${pal.logoRed}; }
  .logo .blk { color: ${pal.logoFill}; text-shadow: 0 0 12px ${mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.4)'}; }

  /* Products */
  .product-row { display: flex; gap: 4vmin; align-items: flex-end; justify-content: center; }
  .product img { object-fit: contain; filter: drop-shadow(0 2vmin 3vmin rgba(0,0,0,0.55)); }

  /* Mechanic chip */
  .chip {
    display: inline-block;
    padding: 1.2vmin 2.4vmin;
    background: ${pal.chip};
    color: ${pal.chipText};
    font-family: 'Inter', sans-serif; font-weight: 600;
    letter-spacing: 0.05em; text-transform: uppercase;
    font-size: 2.2vmin;
    box-shadow: 0 0.8vmin 2vmin rgba(0,0,0,0.3);
  }

  /* Text-zone helper — used by zayavka and tsena layouts */
  .text-zone { position: relative; }
</style>
</head>
<body>
  <div class="veil"></div>
  ${stage}
</body>
</html>`
}

// ─── Layouts ───────────────────────────────────────────────────────────────
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
  // Group 5 compositions into 3 actual layout strategies. Honors the model's
  // choice while keeping templates manageable.
  switch (a.composition) {
    case 'moment':
      return layoutMoment(a)
    case 'zayavka':
      return layoutTextHero(a)
    case 'vitrina':
    case 'tsena':
    case 'kartochka':
    default:
      return layoutProductHero(a)
  }
}

// PRODUCT HERO — product PNG dominates center, text band at bottom over veil.
// Default for vitrina / tsena / kartochka.
function layoutProductHero(a: StageArgs): string {
  const productHeight = a.format.axis === 'landscape' ? '70%' : '55%'
  const headlineSize  = headlineSizeFor(a.format, a.headline.length)
  return `
<div class="stage">
  <header style="display: flex; justify-content: space-between; align-items: flex-start;">
    ${logoMark()}
    <div class="chip">${escape(a.mechanic)}</div>
  </header>
  <main style="flex: 1; display: flex; align-items: center; justify-content: center;">
    <div class="product-row">
      ${productsHtml(a.products, productHeight)}
    </div>
  </main>
  <footer>
    <div class="t-overline accent" style="font-size: 1.8vmin; margin-bottom: 1.2vmin;">${escape(a.dates)}</div>
    <div class="t-display-lg" style="font-size: ${headlineSize};">${escape(a.headline)}</div>
    <div class="t-body" style="font-size: 2.2vmin; margin-top: 1.2vmin; max-width: 80%; color: ${a.pal.text};">${escape(a.subhead)}</div>
  </footer>
</div>`
}

// TEXT HERO — headline dominates center, product small bottom-right, full AI
// background visible behind type. For zayavka.
function layoutTextHero(a: StageArgs): string {
  const headlineSize = headlineSizeFor(a.format, a.headline.length, 1.4)
  return `
<div class="stage">
  <header style="display: flex; justify-content: space-between; align-items: flex-start;">
    ${logoMark()}
    <div class="chip">${escape(a.mechanic)}</div>
  </header>
  <main style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
    <div class="t-overline accent" style="font-size: 2vmin; margin-bottom: 1.5vmin;">${escape(a.dates)}</div>
    <div class="t-display-xl" style="font-size: ${headlineSize}; max-width: 90%; text-shadow: 0 0.4vmin 1.5vmin rgba(0,0,0,0.5);">${escape(a.headline)}</div>
    <div class="t-body" style="font-size: 2.4vmin; margin-top: 2.5vmin; max-width: 65%; color: ${a.pal.text};">${escape(a.subhead)}</div>
  </main>
  <footer style="display: flex; justify-content: flex-end; align-items: flex-end;">
    <div class="product-row">
      ${productsHtml(a.products.slice(0, 2), '32%')}
    </div>
  </footer>
</div>`
}

// MOMENT — atmospheric photo speaks for itself. Just logo + dates corner.
// No product overlay so the photo composition isn't interrupted.
function layoutMoment(a: StageArgs): string {
  const headlineSize = headlineSizeFor(a.format, a.headline.length)
  return `
<div class="stage" style="padding: 5vmin;">
  <header style="display: flex; justify-content: space-between; align-items: flex-start;">
    ${logoMark()}
    <div class="t-overline" style="color: ${a.pal.text}; font-size: 1.6vmin; text-shadow: 0 0 1vmin rgba(0,0,0,0.6);">${escape(a.dates)}</div>
  </header>
  <main style="flex: 1;"></main>
  <footer style="text-align: center;">
    <div class="t-display-lg" style="font-size: ${headlineSize}; text-shadow: 0 0.4vmin 1.5vmin rgba(0,0,0,0.6);">${escape(a.headline)}</div>
    <div class="chip" style="margin-top: 2vmin;">${escape(a.mechanic)}</div>
  </footer>
</div>`
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function headlineSizeFor(format: FormatSpec, chars: number, scale = 1): string {
  // Scale headline font-size by character count — short headlines like
  // "2 FOR 1" should fill the canvas, long ones like "BRUNELLO WEEK" sit lower.
  const baseVmin = format.axis === 'landscape' ? 7 : 11
  const fit = chars <= 8 ? 1.2 : chars <= 14 ? 1.0 : chars <= 20 ? 0.8 : 0.65
  return (baseVmin * fit * scale).toFixed(1) + 'vmin'
}

function logoMark(): string {
  return `<div class="logo" style="font-size: 4vmin;"><span class="red">WINE</span><span class="blk">&amp; WHISKEY</span></div>`
}

function productsHtml(products: { slug: string; src: string }[], heightCss: string): string {
  if (products.length === 0) return ''
  return products
    .map(p => `<div class="product"><img src="${p.src}" style="height: ${heightCss}; max-height: ${heightCss};" /></div>`)
    .join('')
}

function formatDateRange(starts: string, ends: string): string {
  if (starts === ends) return formatDate(starts)
  return `${formatDate(starts)} → ${formatDate(ends)}`
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[m - 1]} ${d}`
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
