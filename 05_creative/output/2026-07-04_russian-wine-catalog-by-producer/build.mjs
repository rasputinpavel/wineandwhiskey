// Wine & Whiskey "Russian Wine & Spirits" catalog — July 2026, GROUPED BY PRODUCER.
// Within each producer: Sparkling > White > Rosé > Red, then by price. Spirits last.
// Self-contained HTML (base64 images) + multi-page print PDF. Re-run: `node build.mjs`
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dir, '../../..');
const PRODUCTS = join(REPO, '04_brand/products');
const LOGO = join(REPO, '04_brand/logo/channel_avatar_light.png');
const DATE = '2026-07-04';
const OUT_HTML = join(__dir, `russian-wine-catalog-by-producer_${DATE}.html`);

const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const img = (slug) => b64(join(PRODUCTS, `${slug}.png`));
const logo = b64(LOGO);

// Producer sections in display order (Harvest catalog nav order), then Spirits.
const producers = [
  { id: 'abrau', name: 'Abrau-Durso', sub: "Krasnodar · Russia's historic sparkling house" },
  { id: 'aristov', name: 'Aristov', sub: 'Kuban · Taman Peninsula' },
  { id: 'tamagne', name: 'Chateau Tamagne', sub: 'Taman Peninsula · Krasnodar' },
  { id: 'vedernikov', name: 'Vedernikov', sub: 'Don Valley · Rostov' },
  { id: 'visokiy', name: 'Visokiy Bereg', sub: 'Kuban · premium still wines' },
  { id: 'sikory', name: 'Sikory', sub: 'Semigorye · boutique estate' },
  { id: 'spirits', name: 'Spirits', sub: 'Vodka & gin' },
];
const typeOrder = { sparkling: 0, white: 1, rose: 2, red: 3, spirit: 4 };
const typeLabel = { sparkling: 'Sparkling', white: 'White', rose: 'Rosé', red: 'Red' };

// Flat item list. { winery, type, name, slug, price|prices, variety?, abv?, detail?, best? }
const items = [
  // --- Abrau-Durso ---
  { winery: 'abrau', type: 'sparkling', name: 'Abrau-Durso Reserve Brut', slug: 'abrau-durso-reserve-brut', price: '฿510', variety: 'Charmat method', abv: '11.5%' },
  { winery: 'abrau', type: 'sparkling', name: 'Abrau-Durso Reserve Brut Rosé', slug: 'abrau-durso-reserve-brut-rose', price: '฿510', variety: 'Charmat method', abv: '11.5%' },
  { winery: 'abrau', type: 'sparkling', name: 'Victor Dravigny Brut', slug: 'abrau-durso-victor-dravigny-brut', price: '฿820', variety: 'Classic method', abv: '12%' },
  { winery: 'abrau', type: 'sparkling', name: 'Victor Dravigny Brut Rosé', slug: 'abrau-durso-victor-dravigny-rose', price: '฿820', variety: 'Classic method', abv: '12%' },
  { winery: 'abrau', type: 'sparkling', name: 'Victor Dravigny Extra Brut', slug: 'abrau-durso-victor-dravigny-extra-brut', price: '฿820', variety: 'Classic method', abv: '12.5%' },
  { winery: 'abrau', type: 'sparkling', name: "Brut d'Or Blanc de Noir", slug: 'abrau-durso-brut-dor-blanc-de-noir', price: '฿1,000', variety: 'Pinot Noir · classic method', abv: '12%' },
  { winery: 'abrau', type: 'sparkling', name: "Brut d'Or Riesling", slug: 'abrau-durso-brut-dor-riesling', price: '฿1,000', variety: 'Riesling · classic method', abv: '12.5%' },
  { winery: 'abrau', type: 'sparkling', name: 'Alexander II Brut', slug: 'abrau-durso-alexander-ii-brut-vintage', price: '฿1,200', variety: 'Classic method', abv: '12%' },
  { winery: 'abrau', type: 'sparkling', name: 'Alexander II Brut Rosé', slug: 'abrau-durso-alexander-ii-brut-rose', price: '฿1,200', variety: 'Classic method', abv: '12%' },
  { winery: 'abrau', type: 'white', name: 'Abrau-Durso Chardonnay', slug: 'abrau-durso-chardonnay', price: '฿910', variety: 'Chardonnay', abv: '11.5%' },
  { winery: 'abrau', type: 'white', name: 'Abrau-Durso Riesling', slug: 'abrau-durso-riesling', price: '฿910', variety: 'Riesling', abv: '11.5%' },
  { winery: 'abrau', type: 'red', name: 'Abrau-Durso Pinot Noir', slug: 'abrau-durso-pinot-noir', price: '฿910', variety: 'Pinot Noir', abv: '11.5%' },

  // --- Aristov ---
  { winery: 'aristov', type: 'sparkling', name: 'Aristov Anima Millesimato Brut', slug: 'aristov-anima-brut-white', price: '฿510', variety: 'Chardonnay, Aligoté, Pinot Blanc, Riesling', abv: '11%' },
  { winery: 'aristov', type: 'sparkling', name: 'Aristov Anima Millesimato Brut Rosé', slug: 'aristov-anima-brut-rose', price: '฿510', variety: 'Pinot Noir, Pinot Blanc, Chardonnay', abv: '11%' },
  { winery: 'aristov', type: 'sparkling', name: 'Cuvée Alexander Blanc de Blancs Brut', slug: 'aristov-cuvee-alexander-brut', price: '฿750', variety: 'Chardonnay · classic method', abv: '12%' },
  { winery: 'aristov', type: 'white', name: 'Aristov Riesling', slug: 'aristov-riesling', price: '฿610', variety: 'Riesling', abv: '11.5%' },
  { winery: 'aristov', type: 'red', name: 'Aristov Cabernet Sauvignon', slug: 'aristov-cabernet-sauvignon', price: '฿615', variety: 'Cabernet Sauvignon', abv: '13%' },
  { winery: 'aristov', type: 'red', name: 'Cuvée Alexander Intenso Rosso', slug: 'aristov-cuvee-alexander-intenso-rosso', price: '฿750', variety: 'Ancellotta', abv: '12%' },

  // --- Chateau Tamagne ---
  { winery: 'tamagne', type: 'sparkling', name: 'Chateau Tamagne Brut White', slug: 'chateau-tamagne-sparkling-brut-white', prices: [['750 ml', '฿510'], ['200 ml', '฿250']], variety: 'Charmat method', abv: '11%' },
  { winery: 'tamagne', type: 'sparkling', name: 'Chateau Tamagne Brut Rosé', slug: 'chateau-tamagne-sparkling-brut-rose', prices: [['750 ml', '฿510'], ['200 ml', '฿250']], variety: 'Charmat method', abv: '11%' },
  { winery: 'tamagne', type: 'white', name: 'Chateau Tamagne Duo Blanc', slug: 'chateau-tamagne-duo-blanc', price: '฿490', variety: 'Bianca, Chardonnay', abv: '11.5%' },
  { winery: 'tamagne', type: 'white', name: 'Chateau Tamagne Chardonnay', slug: 'chateau-tamagne-chardonnay', prices: [['750 ml', '฿535'], ['187 ml', '฿215']], variety: 'Chardonnay', abv: '11.5%' },
  { winery: 'tamagne', type: 'white', name: 'Grape Dance Blanc', slug: 'chateau-tamagne-grape-dance-blanc', price: '฿550', variety: 'Bianca, Grüner', abv: '10%', best: true },
  { winery: 'tamagne', type: 'white', name: 'Per La Mer Sauvignon Blanc', slug: 'chateau-tamagne-per-la-mer-sauvignon', price: '฿590', variety: 'Sauvignon Blanc', abv: '11%' },
  { winery: 'tamagne', type: 'white', name: 'Nature Vert', slug: 'chateau-tamagne-nature-vert', price: '฿630', variety: 'Muscat', abv: '11%' },
  { winery: 'tamagne', type: 'white', name: 'Nature Orange', slug: 'chateau-tamagne-nature-orange', price: '฿665', variety: 'Orange · skin-contact', abv: '13%' },
  { winery: 'tamagne', type: 'white', name: 'Signature Chardonnay', slug: 'chateau-tamagne-signature-chardonnay', price: '฿750', variety: 'Chardonnay · steel-aged', abv: '12%' },
  { winery: 'tamagne', type: 'red', name: 'Chateau Tamagne Duo Red', slug: 'chateau-tamagne-duo-red', price: '฿490', variety: 'Saperavi, Zweigelt, Krasnostop', abv: '12%' },
  { winery: 'tamagne', type: 'red', name: 'Chateau Tamagne Cabernet', slug: 'chateau-tamagne-cabernet', prices: [['750 ml', '฿535'], ['187 ml', '฿215']], variety: 'Cabernet Sauvignon', abv: '13.5%' },
  { winery: 'tamagne', type: 'red', name: 'Terroir Krasnostop-Saperavi', slug: 'chateau-tamagne-krasnostop-saperavi', price: '฿590', variety: 'Krasnostop, Saperavi', abv: '12.5%' },
  { winery: 'tamagne', type: 'red', name: 'Nude Saperavi', slug: 'chateau-tamagne-nude-saperavi', price: '฿590', variety: 'Saperavi · non-filtered', abv: '12.5%', best: true },
  { winery: 'tamagne', type: 'red', name: 'Nature Violet', slug: 'chateau-tamagne-nature-violet', price: '฿680', variety: 'Cabernet Sauvignon', abv: '14%' },
  { winery: 'tamagne', type: 'red', name: 'Cabernet Reserve', slug: 'chateau-tamagne-cabernet-reserve', price: '฿685', variety: 'Cabernet Sauvignon', abv: '13%' },
  { winery: 'tamagne', type: 'red', name: 'Premier Rouge Reserve', slug: 'chateau-tamagne-premier-rouge-reserve', price: '฿685', variety: 'Cabernet, Merlot, Krasnostop, Saperavi', abv: '13%' },
  { winery: 'tamagne', type: 'red', name: 'Saperavi Reserve', slug: 'chateau-tamagne-saperavi-reserve', price: '฿685', variety: 'Saperavi', abv: '14%' },
  { winery: 'tamagne', type: 'red', name: 'Cabernet Krasnostop Reserve', slug: 'chateau-tamagne-krasnostop-reserve', price: '฿685', variety: 'Cabernet, Krasnostop', abv: '12.5%' },
  { winery: 'tamagne', type: 'red', name: 'Signature Saperavi', slug: 'chateau-tamagne-signature-saperavi', price: '฿780', variety: 'Saperavi · barrel-aged', abv: '12.5%' },
  { winery: 'tamagne', type: 'red', name: 'Signature Cabernet Sauvignon', slug: 'chateau-tamagne-signature-cabernet', price: '฿790', variety: 'Cabernet Sauvignon · barrel-aged', abv: '13.5%' },
  { winery: 'tamagne', type: 'red', name: 'Krasnostop Reserve 2016', slug: 'chateau-tamagne-krasnostop-reserve-2016', price: '฿900', variety: 'Krasnostop', abv: '14%' },

  // --- Vedernikov ---
  { winery: 'vedernikov', type: 'white', name: 'Vedernikov Sibirkoviy', slug: 'vedernikov-sibirkovyi', price: '฿575', variety: 'Sibirkovyi', abv: '11%' },
  { winery: 'vedernikov', type: 'rose', name: 'Vedernikov Krasnostop Rosé', slug: 'vedernikov-krasnostop-rose', price: '฿625', variety: 'Krasnostop Zolotovsky', abv: '12%' },
  { winery: 'vedernikov', type: 'red', name: 'Vedernikov Krasnostop', slug: 'vedernikov-krasnostop-zolotovsky-oak', price: '฿1,250', variety: 'Krasnostop Zolotovsky · oak-aged', abv: '15%' },

  // --- Visokiy Bereg ---
  { winery: 'visokiy', type: 'white', name: 'Visokiy Bereg Grüner Veltliner', slug: 'visokiy-bereg-gruner-veltliner', price: '฿650', variety: 'Grüner Veltliner', abv: '12%' },
  { winery: 'visokiy', type: 'rose', name: 'Visokiy Bereg Rosé', slug: 'visokiy-bereg-graphite-rose', price: '฿700', variety: 'Cabernet Sauvignon', abv: '12%' },
  { winery: 'visokiy', type: 'red', name: 'Visokiy Bereg Merlot', slug: 'visokiy-bereg-merlot', price: '฿790', variety: 'Merlot', abv: '12.5%' },

  // --- Sikory ---
  { winery: 'sikory', type: 'red', name: 'Sikory Cabernet Sauvignon', slug: 'sikory-cabernet-family-reserve', price: '฿1,900', variety: 'Cabernet Sauvignon', abv: '14%' },

  // --- Spirits ---
  { winery: 'spirits', type: 'spirit', stype: 'vodka', name: 'Ladoga', slug: 'ladoga-vodka', prices: [['1 L', '฿749'], ['0.7 L', '฿599']], detail: 'Premium Russian vodka · St-Petersburg · 40%' },
  { winery: 'spirits', type: 'spirit', stype: 'vodka', name: "Czar's Original", slug: 'czars-original', prices: [['1 L', '฿810'], ['0.7 L', '฿610']], detail: 'Super-premium Russian vodka · St-Petersburg · 40%' },
  { winery: 'spirits', type: 'spirit', stype: 'vodka', name: "Czar's Gold", slug: 'czars-gold', prices: [['1 L', '฿1,185'], ['0.7 L', '฿1,060']], detail: 'Luxury Russian vodka · St-Petersburg · 40%' },
  { winery: 'spirits', type: 'spirit', stype: 'gin', name: 'Barrister Gin Dry', slug: 'barrister-dry-gin', price: '฿910', detail: 'London dry gin · 0.7 L · 40%' },
  { winery: 'spirits', type: 'spirit', stype: 'gin', name: 'Barrister Gin Pink', slug: 'barrister-pink-gin', price: '฿990', detail: 'Pink gin · 0.7 L · 40%' },
  { winery: 'spirits', type: 'spirit', stype: 'gin', name: 'Barrister Gin Blue', slug: 'barrister-blue-gin', price: '฿990', detail: 'Blue gin · 0.7 L · 40%' },
  { winery: 'spirits', type: 'spirit', stype: 'gin', name: 'Barrister Gin Sloe', slug: 'barrister-sloe-gin', price: '฿990', detail: 'Sloe gin · Limited Edition · 26%' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const priceNum = (it) => Number((it.price || (it.prices && it.prices[0][1]) || '0').replace(/[^0-9.]/g, ''));

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
    <div class="info">
      <h3 class="name">${esc(it.name)}</h3>
      ${it.variety ? `<div class="grape"><span class="glabel">Grape</span><span class="gval">${esc(it.variety)}</span></div>` : ''}
      ${it.type === 'spirit'
        ? `<p class="meta">${esc(it.detail)}</p>`
        : `<p class="meta">ABV ${esc(it.abv)}</p>`}
      ${priceBlock(it)}
    </div>
  </article>`;

const producerSection = (p) => {
  const list = items.filter((it) => it.winery === p.id);
  let body;
  if (p.id === 'spirits') {
    body = [['vodka', 'Vodka'], ['gin', 'Gin']].map(([s, label]) => {
      const g = list.filter((it) => it.stype === s).sort((a, b) => priceNum(a) - priceNum(b));
      if (!g.length) return '';
      return `<h3 class="subhead"><span class="sdot sdot-spirit"></span>${label}</h3><div class="grid">${g.map(card).join('')}</div>`;
    }).join('');
  } else {
    const sorted = list.sort((a, b) => (typeOrder[a.type] - typeOrder[b.type]) || (priceNum(a) - priceNum(b)));
    const types = ['sparkling', 'white', 'rose', 'red'].filter((t) => sorted.some((it) => it.type === t));
    const showSub = types.length > 1;
    body = types.map((t) => {
      const g = sorted.filter((it) => it.type === t);
      const sub = showSub ? `<h3 class="subhead"><span class="sdot sdot-${t}"></span>${typeLabel[t]}</h3>` : '';
      return `${sub}<div class="grid">${g.map(card).join('')}</div>`;
    }).join('');
  }
  return `
  <section class="prod" id="prod-${p.id}">
    <header class="prod-head">
      <h2>${esc(p.name)}</h2>
      <p class="prod-sub">${esc(p.sub)}</p>
      <span class="prod-rule"></span>
    </header>
    ${body}
  </section>`;
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wine &amp; Whiskey — Russian Wine &amp; Spirits · by Producer</title>
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

  /* Cover */
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

  /* Producer section */
  .prod{padding:46px 0 8px}
  .prod-head{margin-bottom:26px}
  .prod-head h2{font-family:'Bebas Neue';font-size:48px;letter-spacing:.04em;color:var(--wine);line-height:1;text-transform:uppercase}
  .prod-sub{font-family:'Inter';font-weight:600;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--graphite);margin-top:4px}
  .prod-rule{display:block;height:2px;background:linear-gradient(90deg,var(--wine) 0%,var(--stone) 30%,transparent 100%);margin-top:12px}
  .subhead{display:flex;align-items:center;gap:9px;font-family:'Inter';font-weight:600;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--graphite);margin:22px 0 14px}
  .sdot{width:9px;height:9px;border-radius:50%;flex:none}
  .sdot-sparkling{background:#c8a94c}.sdot-white{background:#a7b56a}.sdot-rose{background:#d08a99}.sdot-red{background:var(--wine)}.sdot-spirit{background:#7a8a99}

  /* Horizontal cards: bottle at full height on the left, info on the right */
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}

  .card{position:relative;display:flex;align-items:center;gap:14px;background:transparent;border:1px solid #cbbfae;
    border-radius:12px;padding:14px 16px;overflow:hidden}
  .card .shot{flex:0 0 78px;display:flex;align-items:center;justify-content:center}
  .card .shot img{height:160px;max-width:78px;width:auto;object-fit:contain;filter:drop-shadow(0 6px 12px rgba(26,26,26,.16))}
  .info{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}
  .card .name{font-family:'DM Sans';font-weight:600;font-size:14.5px;line-height:1.22;color:var(--black);margin-bottom:7px}
  .grape{display:flex;align-items:baseline;gap:6px;margin-bottom:6px;padding-bottom:7px;border-bottom:1px solid var(--stone)}
  .grape .glabel{flex:none;font-family:'Inter';font-weight:600;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold)}
  .grape .gval{font-family:'DM Sans';font-weight:600;font-size:12.5px;line-height:1.3;color:var(--burg)}
  .card .meta{font-family:'Inter';font-size:11.5px;color:var(--graphite);line-height:1.4;margin:0 0 9px}
  .card .prices{display:flex;flex-direction:column;gap:5px}
  .prow{display:flex;align-items:center;justify-content:flex-start;gap:9px}
  .prow .vol{font-family:'Inter';font-weight:500;font-size:11.5px;color:var(--graphite);min-width:32px}
  .pill{font-family:'Bebas Neue';font-size:20px;letter-spacing:.03em;color:#fff;background:var(--wine);
    border-radius:7px;padding:2px 12px 0;line-height:1.15;white-space:nowrap}

  .ribbon{position:absolute;top:10px;right:10px;background:var(--gold);color:var(--black);
    font-family:'Inter';font-weight:700;font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;
    padding:4px 8px;border-radius:5px;z-index:2}

  .foot{border-top:1px solid var(--stone);margin-top:48px;padding:22px 0 40px;text-align:center;
    font-family:'Inter';font-size:12px;color:var(--graphite);letter-spacing:.04em}
  .foot strong{font-family:'DM Sans';font-weight:700;color:var(--wine);letter-spacing:.02em}
  .foot .sep{color:var(--stone);margin:0 8px}

  /* Print: cover full-bleed own page; producers flow continuously */
  @page{size:A4;margin:0}
  @media print{
    html,body{background:var(--white)}
    .page{max-width:none;padding:0 12mm}
    .cover{min-height:auto;height:297mm;width:210mm;overflow:hidden;page-break-after:always;padding:0 24mm}
    .cover .logo{width:54mm;height:54mm}
    /* page breaks fall on producer boundaries */
    .prod{page-break-before:always;padding:13mm 0 8mm}
    .prod:first-of-type{page-break-before:avoid}
    .prod-head{break-after:avoid;page-break-after:avoid}
    .subhead{page-break-after:avoid;break-after:avoid;margin:5mm 0 4mm}
    .grid{grid-template-columns:repeat(2,1fr);gap:6mm 9mm}
    .card{break-inside:avoid;border-radius:9px;padding:8px 12px}
    .card .name{font-size:12.5px;margin-bottom:5px}
    .grape{margin-bottom:4px;padding-bottom:5px}.grape .gval{font-size:11px}
    .card .meta{margin-bottom:6px}
    .card .shot{flex:0 0 17mm}.card .shot img{height:38mm;max-width:17mm;filter:none}
    .pill{font-size:17px}
    .foot{page-break-before:avoid;padding:8mm 0 0;margin-top:8mm}
  }
  @media (max-width:640px){
    .grid{grid-template-columns:repeat(2,1fr);gap:14px}
    .card .shot{height:150px}.card .shot img{max-height:150px}
    .prod-head h2{font-size:38px}
  }
</style>
</head>
<body>
  <div class="cover">
    <img class="logo" src="${logo}" alt="Wine & Whiskey">
    <h1>Russian Wine <span class="amp">&amp;</span> Spirits</h1>
    <p class="tagline">Exclusive distributor of Russian wine and spirits in Phuket</p>
    <div class="rule"></div>
    <div class="sub">Wholesale price list · by producer · 2026</div>
  </div>

  <main class="page">
    ${producers.map(producerSection).join('')}
    <footer class="foot">
      <strong>Wine &amp; Whiskey</strong><span class="sep">·</span>wine-whiskey.com<span class="sep">·</span>Prices exclude 7% VAT
    </footer>
  </main>
</body>
</html>`;

writeFileSync(OUT_HTML, html);
const kb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
console.log(`Wrote ${OUT_HTML} (${kb} MB, ${items.length} products across ${producers.length} producers)`);
