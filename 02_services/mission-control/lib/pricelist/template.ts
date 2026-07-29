import type { Page, PageSettings, LineItem, Row, PlaqueZone } from './types'
import { zoneToken, PLAQUE_LABELS } from './plaques'
import { countryToFlag } from './flags'

export type BuildHtmlArgs = {
  pages: Page[]
  settings: PageSettings
  imageDataUrls?: Map<string, string> // key: imageSlug → data URL (render step)
  qrDataUrl?: string
  wordmarkDataUrl?: string
  interactive?: boolean // preview only: number badges + click-to-jump; never in the exported PNG
}

type Ctx = { images?: Map<string, string>; interactive: boolean; idx: Map<string, number> }

const A4 = { w: 794, h: 1123 } // px @ 96dpi

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

function priceHtml(p: number | null): string {
  // The render route trusts raw JSON, so treat price as untrusted: only a
  // finite number reaches the DOM, never an interpolated string.
  if (typeof p !== 'number' || !Number.isFinite(p)) return `<span class="price">—</span>`
  return `<span class="price">${p}<span class="price__suf">.-</span></span>`
}

const KNOWN_ZONES: PlaqueZone[] = ['white', 'red', 'sparkling', 'champagne', 'rose', 'spirits']
function safeZone(z: unknown): PlaqueZone {
  return (KNOWN_ZONES as string[]).includes(z as string) ? (z as PlaqueZone) : 'white'
}

// imageUrl is user-controlled (CSV column / raw POST body). Allow only http(s)
// and image data URLs; anything else (javascript:, breakout attempts) → dropped.
// Map values are our own on-disk data URLs and are trusted.
function safeUserUrl(u: string): string {
  return /^(https?:\/\/|data:image\/)/i.test(u.trim()) ? u.trim() : ''
}

function imgSrc(it: LineItem, images?: Map<string, string>): string {
  if (it.imageUrl) return safeUserUrl(it.imageUrl)
  if (it.imageSlug && images?.get(it.imageSlug)) return images.get(it.imageSlug)!
  return '' // template shows the silhouette placeholder when empty
}

// Auto-fit the name: short names stay big and impactful, long ones shrink so a
// "…Victor Dravigny Premium Brut Rose" doesn't wrap to five lines.
function nameCls(name: string): string {
  const n = name.length
  if (n > 40) return 'name name--xs'
  if (n > 26) return 'name name--sm'
  return 'name'
}

function cardHtml(it: LineItem, wide: boolean, ctx: Ctx): string {
  const zone = safeZone(it.zone)
  const src = imgSrc(it, ctx.images)
  const meta = [
    it.country || it.region ? `<div class="meta"><span class="ico">${countryToFlag(it.country)}</span>${esc([it.country, it.region].filter(Boolean).join(', '))}</div>` : '',
    it.grape ? `<div class="meta"><span class="ico">🍇</span>${esc(it.grape)}</div>` : '',
    it.volume ? `<div class="meta"><span class="ico">🍾</span>${esc(it.volume)}</div>` : '',
  ].join('')
  const n = ctx.idx.get(it.id)
  const badge = ctx.interactive && n ? `<div class="idx">${n}</div>` : ''
  const attrs = ctx.interactive ? ` data-item-id="${esc(it.id)}"` : ''
  return `
    <div class="card ${wide ? 'card--wide' : ''} ${ctx.interactive ? 'card--interactive' : ''} zone--${zone}" style="--plaque:${zoneToken(zone)}"${attrs}>
      ${badge}
      <div class="plaque"><span>${PLAQUE_LABELS[zone]}</span></div>
      <div class="bottle">${src ? `<img src="${esc(src)}" alt="">` : `<div class="bottle__ph"></div>`}</div>
      <div class="body">
        <div class="${nameCls(it.name)}">${esc(it.name)}</div>
        ${meta}
      </div>
      <div class="pricecol">${priceHtml(it.price)}</div>
    </div>`
}

function rowHtml(r: Row, ctx: Ctx): string {
  if (r.kind === 'divider') return `<div class="divider">${esc(r.label)}</div>`
  if (r.kind === 'solo-wide') return `<div class="row row--solo">${cardHtml(r.item, true, ctx)}</div>`
  const [a, b] = r.items
  return `<div class="row">${cardHtml(a, false, ctx)}${b ? cardHtml(b, false, ctx) : '<div class="card card--empty"></div>'}</div>`
}

function pageHtml(page: Page, s: PageSettings, isFirst: boolean, args: BuildHtmlArgs, ctx: Ctx): string {
  const header = isFirst ? `
    <div class="header">
      <div class="header__left">
        ${args.qrDataUrl ? `<img class="qr" src="${args.qrDataUrl}" alt="">` : ''}
        <div class="cta"><div class="cta__t">PLACE AN ORDER ›</div><div class="cta__ru">СДЕЛАТЬ ЗАКАЗ</div><div class="cta__c">${esc(s.headerContact)}</div></div>
      </div>
      <div class="wordmark">${args.wordmarkDataUrl ? `<img src="${args.wordmarkDataUrl}" alt="WINE & WHISKEY">` : `<span class="wm1">WINE</span><span class="wm2">&amp; WHISKEY</span>`}</div>
    </div>` : ''
  return `<section class="page">${header}<div class="grid">${page.rows.map(r => rowHtml(r, ctx)).join('')}</div><div class="vat">${esc(s.vatNote)}</div></section>`
}

// Number cards in the exact order they appear on the page (post-grouping), so a
// badge cross-references the editor and clicking one can jump straight to it.
function indexCards(pages: Page[]): Map<string, number> {
  const idx = new Map<string, number>()
  let n = 0
  for (const p of pages) for (const r of p.rows) {
    if (r.kind === 'solo-wide') idx.set(r.item.id, ++n)
    else if (r.kind === 'pair') for (const it of r.items) if (it) idx.set(it.id, ++n)
  }
  return idx
}

export function buildHtml(args: BuildHtmlArgs): string {
  const { pages, settings } = args
  const ctx: Ctx = { images: args.imageDataUrls, interactive: !!args.interactive, idx: indexCards(pages) }
  const body = pages.map((p, i) => pageHtml(p, settings, i === 0, args, ctx)).join('')
  // Preview only: clicking a card tells the parent which item it is, so the
  // editor can scroll to and highlight that position.
  const clickScript = ctx.interactive
    ? `<script>document.addEventListener('click',function(e){var c=e.target.closest&&e.target.closest('[data-item-id]');if(c&&window.parent&&window.parent!==window){window.parent.postMessage({t:'pl-card',id:c.getAttribute('data-item-id')},'*')}})</script>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  :root { --warm-white:#F5F0EB; --cream:#EDE0D0; --ink:#1A1A1A; --graphite:#3D3D3D; }
  body { font-family:'Inter',sans-serif; color:var(--ink); background:var(--warm-white); }
  .page { width:${A4.w}px; min-height:${A4.h}px; padding:28px 32px; display:flex; flex-direction:column; page-break-after:always; }
  .header { display:flex; justify-content:space-between; align-items:center; border:1px solid var(--ink); border-radius:14px; padding:14px 20px; margin-bottom:18px; }
  .header__left { display:flex; gap:14px; align-items:center; }
  .qr { width:56px; height:56px; }
  .cta__t { color:#8C1C1C; font-weight:700; font-size:13px; letter-spacing:.04em; }
  .cta__ru { font-weight:700; font-size:12px; }
  .cta__c { font-size:11px; color:var(--graphite); }
  .wordmark { text-align:right; line-height:.9; }
  .wm1 { font-family:'Bebas Neue'; color:#8C1C1C; font-size:34px; display:block; letter-spacing:.02em; }
  .wm2 { font-family:'Bebas Neue'; font-size:34px; display:block; }
  .grid { display:flex; flex-direction:column; gap:12px; flex:1; }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .row--solo { grid-template-columns:1fr; }
  .card { position:relative; display:grid; grid-template-columns:30px 82px 1fr auto; align-items:center; gap:12px;
          background:#fff; border:1px solid #E7DFD2; border-radius:16px; overflow:hidden; min-height:106px; padding:0 20px 0 0;
          box-shadow:0 1px 2px rgba(60,40,20,.04); }
  .card--interactive { cursor:pointer; }
  .card--interactive:hover { border-color:#8C1C1C; }
  .idx { position:absolute; top:6px; right:10px; z-index:2; min-width:18px; height:18px; padding:0 4px;
         border-radius:9px; background:rgba(26,26,26,.72); color:#fff; font-family:'DM Sans'; font-weight:700;
         font-size:11px; line-height:18px; text-align:center; }
  .card--wide { grid-template-columns:30px 108px 1fr auto; }
  .card--empty { visibility:hidden; }
  /* Full-height flush band; the card's overflow:hidden clips its corners to the radius. */
  .plaque { align-self:stretch; background:var(--plaque); display:flex; align-items:center; justify-content:center; }
  .plaque span { writing-mode:vertical-rl; transform:rotate(180deg); color:#fff; font-family:'DM Sans'; font-weight:600;
                 font-size:10px; letter-spacing:.22em; text-transform:uppercase; }
  /* Champagne — golden gradient with a metallic sheen; slight shadow keeps the
     white caption legible over the lighter gold. */
  .zone--champagne .plaque { background:linear-gradient(150deg,#F0DC94 0%,#D4AF37 38%,#B8901F 68%,#8C6E1A 100%); }
  .zone--champagne .plaque span { color:#5a4610; text-shadow:0 1px 0 rgba(255,255,255,.35); }
  .bottle { display:flex; align-items:center; justify-content:center; height:94px; padding:8px 0; }
  .bottle img { max-height:94px; max-width:100%; object-fit:contain; }
  .bottle__ph { width:26px; height:74px; border-radius:7px 7px 3px 3px; background:linear-gradient(160deg,#efe9df,#dcd2c2); }
  .name { font-family:'DM Sans'; font-weight:700; font-size:16px; text-transform:uppercase; line-height:1.06; }
  .name--sm { font-size:13.5px; line-height:1.05; }
  .name--xs { font-size:11.5px; line-height:1.04; letter-spacing:.01em; }
  .meta { font-size:11px; color:var(--graphite); margin-top:4px; display:flex; gap:6px; align-items:center; }
  .meta .ico { opacity:.8; }
  .pricecol { padding-right:6px; }
  .price { font-family:'Bebas Neue'; font-size:46px; line-height:1; }
  .price__suf { font-size:22px; vertical-align:baseline; }
  .divider { font-family:'DM Sans'; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
             font-size:13px; color:var(--graphite); padding:6px 2px 2px; border-bottom:2px solid var(--plaque,#8C1C1C); }
  .vat { text-align:center; font-family:'DM Sans'; font-weight:700; letter-spacing:.1em; font-size:13px; margin-top:16px; }
</style></head><body>${body}${clickScript}</body></html>`
}
