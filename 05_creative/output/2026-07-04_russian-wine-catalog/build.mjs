// Build the Wine & Whiskey "Russian Wine & Spirits" wholesale catalog — July 2026.
// Source: .inbox/Suppliers/Harvest/HC NEW CATALOG JULY 2026 Ph.pdf (wine) + carried-over spirits.
// Self-contained HTML (images embedded as base64) + multi-page print PDF.
// Re-run after editing data below: `node build.mjs`
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dir, '../../..');
const PRODUCTS = join(REPO, '04_brand/products');
const LOGO = join(REPO, '04_brand/logo/channel_avatar_light.png');
const DATE = '2026-07-04';
const OUT_HTML = join(__dir, `russian-wine-catalog_${DATE}.html`);

const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const img = (slug) => b64(join(PRODUCTS, `${slug}.png`));
const logo = b64(LOGO);

// --- Catalog data (prices in ฿, ex-VAT). Grouped White > Rosé > Red > Sparkling > Spirits ---
// Wine: { name, slug, price|prices, variety, producer, abv, best? }
// Spirit: { name, slug, price|prices, detail }
const sections = [
  {
    id: 'white', title: 'White Wine',
    items: [
      { name: 'Chateau Tamagne Duo Blanc', slug: 'chateau-tamagne-duo-blanc', price: '฿490', variety: 'Bianca, Chardonnay', producer: 'Chateau Tamagne', abv: '11.5%' },
      { name: 'Chateau Tamagne Chardonnay', slug: 'chateau-tamagne-chardonnay', prices: [['750 ml', '฿535'], ['187 ml', '฿215']], variety: 'Chardonnay', producer: 'Chateau Tamagne', abv: '11.5%' },
      { name: 'Grape Dance Blanc, Chateau Tamagne', slug: 'chateau-tamagne-grape-dance-blanc', price: '฿550', variety: 'Bianca, Grüner', producer: 'Chateau Tamagne', abv: '10%', best: true },
      { name: 'Vedernikov Sibirkoviy', slug: 'vedernikov-sibirkovyi', price: '฿575', variety: 'Sibirkovyi', producer: 'Vedernikov · Don Valley', abv: '11%' },
      { name: 'Per La Mer Sauvignon Blanc, Chateau Tamagne', slug: 'chateau-tamagne-per-la-mer-sauvignon', price: '฿590', variety: 'Sauvignon Blanc', producer: 'Chateau Tamagne', abv: '11%' },
      { name: 'Aristov Riesling', slug: 'aristov-riesling', price: '฿610', variety: 'Riesling', producer: 'Aristov · Kuban', abv: '11.5%' },
      { name: 'Nature Vert, Chateau Tamagne', slug: 'chateau-tamagne-nature-vert', price: '฿630', variety: 'Muscat', producer: 'Chateau Tamagne', abv: '11%' },
      { name: 'Visokiy Bereg Grüner Veltliner', slug: 'visokiy-bereg-gruner-veltliner', price: '฿650', variety: 'Grüner Veltliner', producer: 'Visokiy Bereg · Kuban', abv: '12%' },
      { name: 'Nature Orange, Chateau Tamagne', slug: 'chateau-tamagne-nature-orange', price: '฿665', variety: 'Orange · skin-contact', producer: 'Chateau Tamagne', abv: '13%' },
      { name: 'Signature Chardonnay, Chateau Tamagne', slug: 'chateau-tamagne-signature-chardonnay', price: '฿750', variety: 'Chardonnay · steel-aged', producer: 'Chateau Tamagne', abv: '12%' },
      { name: 'Abrau-Durso Chardonnay', slug: 'abrau-durso-chardonnay', price: '฿910', variety: 'Chardonnay', producer: 'Abrau-Durso', abv: '11.5%' },
      { name: 'Abrau-Durso Riesling', slug: 'abrau-durso-riesling', price: '฿910', variety: 'Riesling', producer: 'Abrau-Durso', abv: '11.5%' },
    ],
  },
  {
    id: 'rose', title: 'Rosé',
    items: [
      { name: 'Vedernikov Krasnostop Rosé', slug: 'vedernikov-krasnostop-rose', price: '฿625', variety: 'Krasnostop Zolotovsky', producer: 'Vedernikov · Don Valley', abv: '12%' },
      { name: 'Visokiy Bereg Rosé', slug: 'visokiy-bereg-graphite-rose', price: '฿700', variety: 'Cabernet Sauvignon', producer: 'Visokiy Bereg · Kuban', abv: '12%' },
    ],
  },
  {
    id: 'red', title: 'Red Wine',
    items: [
      { name: 'Chateau Tamagne Duo Red', slug: 'chateau-tamagne-duo-red', price: '฿490', variety: 'Saperavi, Zweigelt, Krasnostop', producer: 'Chateau Tamagne', abv: '12%' },
      { name: 'Chateau Tamagne Cabernet', slug: 'chateau-tamagne-cabernet', prices: [['750 ml', '฿535'], ['187 ml', '฿215']], variety: 'Cabernet Sauvignon', producer: 'Chateau Tamagne', abv: '13.5%' },
      { name: 'Terroir Krasnostop-Saperavi, Chateau Tamagne', slug: 'chateau-tamagne-krasnostop-saperavi', price: '฿590', variety: 'Krasnostop, Saperavi', producer: 'Chateau Tamagne', abv: '12.5%' },
      { name: 'Nude Saperavi, Chateau Tamagne', slug: 'chateau-tamagne-nude-saperavi', price: '฿590', variety: 'Saperavi · non-filtered', producer: 'Chateau Tamagne', abv: '12.5%', best: true },
      { name: 'Aristov Cabernet Sauvignon', slug: 'aristov-cabernet-sauvignon', price: '฿615', variety: 'Cabernet Sauvignon', producer: 'Aristov · Kuban', abv: '13%' },
      { name: 'Nature Violet, Chateau Tamagne', slug: 'chateau-tamagne-nature-violet', price: '฿680', variety: 'Cabernet Sauvignon', producer: 'Chateau Tamagne', abv: '14%' },
      { name: 'Chateau Tamagne Cabernet Reserve', slug: 'chateau-tamagne-cabernet-reserve', price: '฿685', variety: 'Cabernet Sauvignon', producer: 'Chateau Tamagne', abv: '13%' },
      { name: 'Chateau Tamagne Premier Rouge Reserve', slug: 'chateau-tamagne-premier-rouge-reserve', price: '฿685', variety: 'Cabernet, Merlot, Krasnostop, Saperavi', producer: 'Chateau Tamagne', abv: '13%' },
      { name: 'Chateau Tamagne Saperavi Reserve', slug: 'chateau-tamagne-saperavi-reserve', price: '฿685', variety: 'Saperavi', producer: 'Chateau Tamagne', abv: '14%' },
      { name: 'Chateau Tamagne Cabernet Krasnostop Reserve', slug: 'chateau-tamagne-krasnostop-reserve', price: '฿685', variety: 'Cabernet, Krasnostop', producer: 'Chateau Tamagne', abv: '12.5%' },
      { name: 'Cuvée Alexander Intenso Rosso, Aristov', slug: 'aristov-cuvee-alexander-intenso-rosso', price: '฿750', variety: 'Ancellotta', producer: 'Aristov · Kuban', abv: '12%' },
      { name: 'Signature Saperavi, Chateau Tamagne', slug: 'chateau-tamagne-signature-saperavi', price: '฿780', variety: 'Saperavi · barrel-aged', producer: 'Chateau Tamagne', abv: '12.5%' },
      { name: 'Signature Cabernet Sauvignon, Chateau Tamagne', slug: 'chateau-tamagne-signature-cabernet', price: '฿790', variety: 'Cabernet Sauvignon · barrel-aged', producer: 'Chateau Tamagne', abv: '13.5%' },
      { name: 'Visokiy Bereg Merlot', slug: 'visokiy-bereg-merlot', price: '฿790', variety: 'Merlot', producer: 'Visokiy Bereg · Kuban', abv: '12.5%' },
      { name: 'Chateau Tamagne Krasnostop Reserve 2016', slug: 'chateau-tamagne-krasnostop-reserve-2016', price: '฿900', variety: 'Krasnostop', producer: 'Chateau Tamagne', abv: '14%' },
      { name: 'Abrau-Durso Pinot Noir', slug: 'abrau-durso-pinot-noir', price: '฿910', variety: 'Pinot Noir', producer: 'Abrau-Durso', abv: '11.5%' },
      { name: 'Vedernikov Krasnostop', slug: 'vedernikov-krasnostop-zolotovsky-oak', price: '฿1,250', variety: 'Krasnostop Zolotovsky · oak-aged', producer: 'Vedernikov · Don Valley', abv: '15%' },
      { name: 'Sikory Cabernet Sauvignon', slug: 'sikory-cabernet-family-reserve', price: '฿1,900', variety: 'Cabernet Sauvignon', producer: 'Sikory · Semigorye', abv: '14%' },
    ],
  },
  {
    id: 'sparkling', title: 'Sparkling',
    items: [
      { name: 'Abrau-Durso Reserve Brut', slug: 'abrau-durso-reserve-brut', price: '฿510', variety: 'Charmat method', producer: 'Abrau-Durso', abv: '11.5%' },
      { name: 'Abrau-Durso Reserve Brut Rosé', slug: 'abrau-durso-reserve-brut-rose', price: '฿510', variety: 'Charmat method', producer: 'Abrau-Durso', abv: '11.5%' },
      { name: 'Chateau Tamagne Brut White', slug: 'chateau-tamagne-sparkling-brut-white', prices: [['750 ml', '฿510'], ['200 ml', '฿250']], variety: 'Charmat method', producer: 'Chateau Tamagne', abv: '11%' },
      { name: 'Chateau Tamagne Brut Rosé', slug: 'chateau-tamagne-sparkling-brut-rose', prices: [['750 ml', '฿510'], ['200 ml', '฿250']], variety: 'Charmat method', producer: 'Chateau Tamagne', abv: '11%' },
      { name: 'Aristov Anima Millesimato Brut', slug: 'aristov-anima-brut-white', price: '฿510', variety: 'Chardonnay, Aligoté, Pinot Blanc, Riesling', producer: 'Aristov · vintage', abv: '11%' },
      { name: 'Aristov Anima Millesimato Brut Rosé', slug: 'aristov-anima-brut-rose', price: '฿510', variety: 'Pinot Noir, Pinot Blanc, Chardonnay', producer: 'Aristov · vintage', abv: '11%' },
      { name: 'Cuvée Alexander Blanc de Blancs Brut, Aristov', slug: 'aristov-cuvee-alexander-brut', price: '฿750', variety: 'Chardonnay · classic method', producer: 'Aristov · Kuban', abv: '12%' },
      { name: 'Victor Dravigny Brut', slug: 'abrau-durso-victor-dravigny-brut', price: '฿820', variety: 'Classic method', producer: 'Abrau-Durso', abv: '12%' },
      { name: 'Victor Dravigny Brut Rosé', slug: 'abrau-durso-victor-dravigny-rose', price: '฿820', variety: 'Classic method', producer: 'Abrau-Durso', abv: '12%' },
      { name: 'Victor Dravigny Extra Brut', slug: 'abrau-durso-victor-dravigny-extra-brut', price: '฿820', variety: 'Classic method', producer: 'Abrau-Durso', abv: '12.5%' },
      { name: "Brut d'Or Blanc de Noir", slug: 'abrau-durso-brut-dor-blanc-de-noir', price: '฿1,000', variety: 'Pinot Noir · classic method', producer: 'Abrau-Durso', abv: '12%' },
      { name: "Brut d'Or Riesling", slug: 'abrau-durso-brut-dor-riesling', price: '฿1,000', variety: 'Riesling · classic method', producer: 'Abrau-Durso', abv: '12.5%' },
      { name: 'Alexander II Brut', slug: 'abrau-durso-alexander-ii-brut-vintage', price: '฿1,200', variety: 'Classic method', producer: 'Abrau-Durso', abv: '12%' },
      { name: 'Alexander II Brut Rosé', slug: 'abrau-durso-alexander-ii-brut-rose', price: '฿1,200', variety: 'Classic method', producer: 'Abrau-Durso', abv: '12%' },
    ],
  },
  {
    id: 'spirits', title: 'Spirits',
    items: [
      { name: 'Ladoga', slug: 'ladoga-vodka', prices: [['1 L', '฿749'], ['0.7 L', '฿599']], detail: 'Premium Russian vodka · St-Petersburg · 40%' },
      { name: "Czar's Original", slug: 'czars-original', prices: [['1 L', '฿810'], ['0.7 L', '฿610']], detail: 'Super-premium Russian vodka · St-Petersburg · 40%' },
      { name: "Czar's Gold", slug: 'czars-gold', prices: [['1 L', '฿1,185'], ['0.7 L', '฿1,060']], detail: 'Luxury Russian vodka · St-Petersburg · 40%' },
      { name: 'Barrister Gin Dry', slug: 'barrister-dry-gin', price: '฿910', detail: 'London dry gin · 0.7 L · 40%' },
      { name: 'Barrister Gin Pink', slug: 'barrister-pink-gin', price: '฿990', detail: 'Pink gin · 0.7 L · 40%' },
      { name: 'Barrister Gin Blue', slug: 'barrister-blue-gin', price: '฿990', detail: 'Blue gin · 0.7 L · 40%' },
      { name: 'Barrister Gin Sloe', slug: 'barrister-sloe-gin', price: '฿990', detail: 'Sloe gin · Limited Edition · 26%' },
    ],
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const priceBlock = (it) => {
  if (it.prices) {
    return `<div class="prices">${it.prices.map(([v, p]) =>
      `<div class="prow"><span class="vol">${esc(v)}</span><span class="pill">${esc(p)}</span></div>`).join('')}</div>`;
  }
  return `<div class="prices"><div class="prow single"><span class="pill">${esc(it.price)}</span></div></div>`;
};

const card = (it) => `
  <article class="card${it.best ? ' is-best' : ''}">
    ${it.best ? '<span class="ribbon">Best Seller</span>' : ''}
    <div class="shot"><img src="${img(it.slug)}" alt="${esc(it.name)}" loading="lazy"></div>
    <h3 class="name">${esc(it.name)}</h3>
    ${it.variety ? `<div class="grape"><span class="glabel">Grape</span><span class="gval">${esc(it.variety)}</span></div>` : ''}
    ${it.variety
      ? `<p class="meta">${esc(it.producer)} · ${esc(it.abv)}</p>`
      : `<p class="meta">${esc(it.detail)}</p>`}
    ${priceBlock(it)}
  </article>`;

const section = (s) => `
  <section class="cat" id="cat-${s.id}">
    <header class="cat-head">
      <h2>${esc(s.title)}</h2>
      <span class="cat-rule"></span>
    </header>
    <div class="grid">${s.items.map(card).join('')}</div>
  </section>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wine &amp; Whiskey — Russian Wine &amp; Spirits</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --wine:#8C1C1C; --burg:#5C1010; --black:#1A1A1A; --white:#F5F0EB;
    --cream:#EDE0D0; --gold:#C9A84C; --graphite:#3D3D3D; --stone:#D4C9BC;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Inter',system-ui,sans-serif;color:var(--black);background:var(--white);line-height:1.5}
  .page{max-width:1180px;margin:0 auto;padding:0 28px}

  /* Cover — full-bleed Warm White (matches the logo's own backplate) */
  .cover{position:relative;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;background:var(--white);padding:72px 28px}
  .cover::before{content:"";position:absolute;inset:22px;border:1px solid var(--stone);pointer-events:none}
  .cover::after{content:"";position:absolute;inset:27px;border:1px solid var(--gold);opacity:.4;pointer-events:none}
  .cover .logo{width:200px;height:200px;object-fit:contain;margin-bottom:30px}
  .cover h1{font-family:'Bebas Neue';font-size:clamp(54px,9vw,112px);line-height:.92;letter-spacing:.02em;color:var(--wine);margin-bottom:6px}
  .cover h1 .amp{color:var(--black)}
  .cover .tagline{font-family:'DM Sans';font-weight:500;font-size:clamp(16px,2.4vw,22px);color:var(--black);max-width:640px;margin:16px auto 0}
  .cover .rule{width:64px;height:3px;background:var(--gold);margin:30px auto 18px;border-radius:2px}
  .cover .sub{font-family:'Inter';font-weight:600;letter-spacing:.2em;text-transform:uppercase;font-size:13px;color:var(--graphite)}

  /* Category */
  .cat{padding:54px 0 8px}
  .cat-head{display:flex;align-items:center;gap:16px;margin-bottom:30px}
  .cat-head h2{font-family:'Bebas Neue';font-size:46px;letter-spacing:.04em;color:var(--wine);line-height:1;text-transform:uppercase}
  .cat-rule{flex:1;height:2px;background:linear-gradient(90deg,var(--stone),transparent)}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:22px}

  .card{position:relative;background:transparent;border:1px solid #cbbfae;border-radius:14px;
    padding:20px 18px 18px;display:flex;flex-direction:column;overflow:hidden}
  .card .shot{height:200px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:14px}
  .card .shot img{max-height:200px;max-width:82%;width:auto;object-fit:contain;filter:drop-shadow(0 8px 14px rgba(26,26,26,.18))}
  .card .name{font-family:'DM Sans';font-weight:600;font-size:16.5px;line-height:1.25;color:var(--black);margin-bottom:8px}
  .grape{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--stone)}
  .grape .glabel{flex:none;font-family:'Inter';font-weight:600;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}
  .grape .gval{font-family:'DM Sans';font-weight:600;font-size:13.5px;line-height:1.3;color:var(--burg)}
  .card .meta{font-family:'Inter';font-size:12.5px;color:var(--graphite);line-height:1.45;margin-bottom:10px}
  .card .prices{margin-top:auto;display:flex;flex-direction:column;gap:6px}
  .prow{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .prow.single{justify-content:flex-start}
  .prow .vol{font-family:'Inter';font-weight:500;font-size:12.5px;color:var(--graphite)}
  .pill{font-family:'Bebas Neue';font-size:22px;letter-spacing:.03em;color:#fff;background:var(--wine);
    border-radius:8px;padding:3px 13px 1px;line-height:1.1;white-space:nowrap}

  /* Flat badge — no rotate/overflow/box-shadow (those can artifact in some browsers) */
  .ribbon{position:absolute;top:14px;left:14px;background:var(--gold);color:var(--black);
    font-family:'Inter';font-weight:700;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;
    padding:5px 10px;border-radius:6px;z-index:2}

  /* Footer */
  .foot{border-top:1px solid var(--stone);margin-top:48px;padding:22px 0 40px;text-align:center;
    font-family:'Inter';font-size:12px;color:var(--graphite);letter-spacing:.04em}
  .foot strong{font-family:'DM Sans';font-weight:700;color:var(--wine);letter-spacing:.02em}
  .foot .sep{color:var(--stone);margin:0 8px}

  /* Print: A4. Cover = full-bleed own page; each category starts a new page. */
  @page{size:A4;margin:14mm 12mm}
  @page cover{margin:0}
  @media print{
    html,body{background:var(--white)}
    .page{max-width:none;padding:0}
    .cover{page:cover;min-height:auto;height:297mm;width:210mm;overflow:hidden;page-break-after:always;padding:0 24mm}
    .cover .logo{width:54mm;height:54mm}
    .cat{page-break-before:always;padding:6mm 0 6px}
    .cat:first-of-type{page-break-before:avoid;padding-top:0}
    .cat-head{page-break-after:avoid;break-after:avoid}
    .grid{grid-template-columns:repeat(3,1fr);gap:10mm 8mm}
    .card{break-inside:avoid;border-radius:10px;padding:12px 12px 12px}
    .card .shot{height:40mm}.card .shot img{max-height:40mm;filter:none}
    /* Sparkling (14) & Spirits (7): compact so rows pack 3-up, no near-empty tail pages */
    #cat-sparkling .card .shot,#cat-spirits .card .shot{height:29mm}
    #cat-sparkling .card .shot img,#cat-spirits .card .shot img{max-height:29mm}
    .foot{page-break-before:avoid;margin-top:14px;padding:16px 0 0}
  }
  @media (max-width:640px){
    .grid{grid-template-columns:repeat(2,1fr);gap:14px}
    .card .shot{height:150px}.card .shot img{max-height:150px}
    .cat-head h2{font-size:36px}
  }
</style>
</head>
<body>
  <div class="cover">
    <img class="logo" src="${logo}" alt="Wine & Whiskey">
    <h1>Russian Wine <span class="amp">&amp;</span> Spirits</h1>
    <p class="tagline">Exclusive distributor of Russian wine and spirits in Phuket</p>
    <div class="rule"></div>
    <div class="sub">Wholesale price list · 2026</div>
  </div>

  <main class="page">
    ${sections.map(section).join('')}
    <footer class="foot">
      <strong>Wine &amp; Whiskey</strong><span class="sep">·</span>wine-whiskey.com<span class="sep">·</span>Prices exclude 7% VAT
    </footer>
  </main>
</body>
</html>`;

writeFileSync(OUT_HTML, html);
const kb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
const count = sections.reduce((n, s) => n + s.items.length, 0);
console.log(`Wrote ${OUT_HTML} (${kb} MB, ${count} products across ${sections.length} sections)`);
