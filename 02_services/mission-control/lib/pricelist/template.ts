import type { Page, PageSettings, LineItem, Row } from './types'
import { zoneToken, PLAQUE_LABELS } from './plaques'

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
  if (p == null) return `<span class="price">—</span>`
  return `<span class="price">${p}<span class="price__suf">.-</span></span>`
}

function imgSrc(it: LineItem, images?: Map<string, string>): string {
  if (it.imageUrl) return it.imageUrl
  if (it.imageSlug && images?.get(it.imageSlug)) return images.get(it.imageSlug)!
  return '' // template shows the silhouette placeholder when empty
}

function cardHtml(it: LineItem, images: Map<string, string> | undefined, wide: boolean): string {
  const zone = it.zone
  const src = imgSrc(it, images)
  const meta = [
    it.country || it.region ? `<div class="meta"><span class="ico">🌍</span>${esc([it.country, it.region].filter(Boolean).join(', '))}</div>` : '',
    it.grape ? `<div class="meta"><span class="ico">🍇</span>${esc(it.grape)}</div>` : '',
    it.volume ? `<div class="meta"><span class="ico">🍾</span>${esc(it.volume)}</div>` : '',
  ].join('')
  return `
    <div class="card ${wide ? 'card--wide' : ''} zone--${zone}" style="--plaque:${zoneToken(zone)}">
      <div class="plaque"><span>${PLAQUE_LABELS[zone]}</span></div>
      <div class="bottle">${src ? `<img src="${src}" alt="">` : `<div class="bottle__ph"></div>`}</div>
      <div class="body">
        <div class="name">${esc(it.name)}</div>
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
  .card { position:relative; display:grid; grid-template-columns:22px 78px 1fr auto; align-items:center; gap:10px;
          background:#fff; border:1px solid #E4DBCE; border-radius:14px; padding:10px 14px 10px 0; min-height:96px; }
  .card--wide { grid-template-columns:22px 100px 1fr auto; }
  .card--empty { visibility:hidden; }
  .plaque { background:var(--plaque); border-radius:14px 0 0 14px; height:100%; width:22px;
            display:flex; align-items:center; justify-content:center; }
  .plaque span { writing-mode:vertical-rl; transform:rotate(180deg); color:#fff; font-family:'DM Sans'; font-weight:700;
                 font-size:11px; letter-spacing:.14em; }
  .zone--sparkling .plaque { background:
      radial-gradient(circle at 30% 20%, rgba(255,255,255,.55) 2px, transparent 3px),
      radial-gradient(circle at 60% 60%, rgba(255,255,255,.45) 2.5px, transparent 3.5px),
      radial-gradient(circle at 40% 85%, rgba(255,255,255,.5) 2px, transparent 3px),
      var(--plaque); }
  .bottle { display:flex; align-items:center; justify-content:center; height:90px; }
  .bottle img { max-height:90px; max-width:100%; }
  .bottle__ph { width:30px; height:80px; border-radius:6px 6px 3px 3px; background:linear-gradient(#e9e2d6,#d8cdbc); }
  .name { font-family:'DM Sans'; font-weight:700; font-size:16px; text-transform:uppercase; line-height:1.05; }
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
