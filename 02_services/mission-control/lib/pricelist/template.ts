import type { Page, PageSettings, LineItem, Row, PlaqueZone } from './types'
import { zoneToken, PLAQUE_LABELS } from './plaques'
import { countryToFlag } from './flags'

export type BuildHtmlArgs = {
  pages: Page[]
  settings: PageSettings
  imageDataUrls?: Map<string, string> // key: imageSlug → data URL (render step)
  qrDataUrl?: string
  wordmarkDataUrl?: string
}

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

function cardHtml(it: LineItem, images: Map<string, string> | undefined, wide: boolean): string {
  const zone = safeZone(it.zone)
  const src = imgSrc(it, images)
  const meta = [
    it.country || it.region ? `<div class="meta"><span class="ico">${countryToFlag(it.country)}</span>${esc([it.country, it.region].filter(Boolean).join(', '))}</div>` : '',
    it.grape ? `<div class="meta"><span class="ico">🍇</span>${esc(it.grape)}</div>` : '',
    it.volume ? `<div class="meta"><span class="ico">🍾</span>${esc(it.volume)}</div>` : '',
  ].join('')
  return `
    <div class="card ${wide ? 'card--wide' : ''} zone--${zone}" style="--plaque:${zoneToken(zone)}">
      <div class="plaque"><span>${PLAQUE_LABELS[zone]}</span></div>
      <div class="bottle">${src ? `<img src="${esc(src)}" alt="">` : `<div class="bottle__ph"></div>`}</div>
      <div class="body">
        <div class="${nameCls(it.name)}">${esc(it.name)}</div>
        ${meta}
      </div>
      <div class="pricecol">${priceHtml(it.price)}</div>
    </div>`
}

function rowHtml(r: Row, images?: Map<string, string>): string {
  if (r.kind === 'divider') return `<div class="divider">${esc(r.label)}</div>`
  if (r.kind === 'solo-wide') return `<div class="row row--solo">${cardHtml(r.item, images, true)}</div>`
  const [a, b] = r.items
  return `<div class="row">${cardHtml(a, images, false)}${b ? cardHtml(b, images, false) : '<div class="card card--empty"></div>'}</div>`
}

function pageHtml(page: Page, s: PageSettings, isFirst: boolean, args: BuildHtmlArgs): string {
  const header = isFirst ? `
    <div class="header">
      <div class="header__left">
        ${args.qrDataUrl ? `<img class="qr" src="${args.qrDataUrl}" alt="">` : ''}
        <div class="cta"><div class="cta__t">PLACE AN ORDER ›</div><div class="cta__ru">СДЕЛАТЬ ЗАКАЗ</div><div class="cta__c">${esc(s.headerContact)}</div></div>
      </div>
      <div class="wordmark">${args.wordmarkDataUrl ? `<img src="${args.wordmarkDataUrl}" alt="WINE & WHISKEY">` : `<span class="wm1">WINE</span><span class="wm2">&amp; WHISKEY</span>`}</div>
    </div>` : ''
  return `<section class="page">${header}<div class="grid">${page.rows.map(r => rowHtml(r, args.imageDataUrls)).join('')}</div><div class="vat">${esc(s.vatNote)}</div></section>`
}

export function buildHtml(args: BuildHtmlArgs): string {
  const { pages, settings } = args
  const body = pages.map((p, i) => pageHtml(p, settings, i === 0, args)).join('')
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
</style></head><body>${body}</body></html>`
}
