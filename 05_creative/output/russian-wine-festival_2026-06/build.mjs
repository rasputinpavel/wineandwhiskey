/**
 * Russian Wine & Spirits — A5 booth flyer (Wine & Whiskey)
 *
 * Double-sided A5, colour, print-ready.
 *   Side 1 (front) — Russian
 *   Side 2 (back)  — English
 *
 * Main headline on top: "Russian wine & spirits in Phuket". Below it the two
 * categories (Wine / Spirits), each listing its styles AND its producers
 * (wine houses under Wine; Ladoga & Barrister under Spirits). Then the three
 * QR codes (WhatsApp · Russian-wine catalog · Maps). The WINE & WHISKEY
 * wordmark sits at the very bottom as the store sign-off, next to the address —
 * the flyer leads with the Russian offer, not the store brand.
 *
 * Outputs (committed so Railway/printer can see them):
 *   russian_wine_flyer_2026-06.pdf      — 2-page print PDF (154×216mm, 3mm bleed)
 *   russian_wine_flyer_front_2026-06.pdf / _back_…  — per-side print PDFs
 *   russian_wine_flyer_preview_2026-06.png — both sides side-by-side
 *
 * Run: node build.mjs   (needs `qrcode` — `npm install` in this folder first)
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FONT_DIR = join(__dirname, '..', '..', '..', '04_brand', 'logo', 'fonts');
const OUT_DIR = __dirname;

const bebasB64    = readFileSync(join(FONT_DIR, 'BebasNeue.woff2')).toString('base64');
const interB64    = readFileSync(join(FONT_DIR, 'Inter500.woff2')).toString('base64');
// Oswald — condensed Bebas-alike WITH Cyrillic (Bebas Neue is Latin-only, so
// the Russian side's display headings need it). Two subsets, one family.
const oswaldCyrB64 = readFileSync(join(FONT_DIR, 'Oswald500-cyrillic.woff2')).toString('base64');
const oswaldLatB64 = readFileSync(join(FONT_DIR, 'Oswald500-latin.woff2')).toString('base64');

const FONT_FACE = `
  @font-face {
    font-family: 'Bebas Neue';
    src: url('data:font/woff2;base64,${bebasB64}') format('woff2');
    font-weight: 400; font-style: normal;
  }
  @font-face {
    font-family: 'Inter';
    src: url('data:font/woff2;base64,${interB64}') format('woff2');
    font-weight: 500; font-style: normal;
  }
  @font-face {
    font-family: 'Oswald';
    src: url('data:font/woff2;base64,${oswaldCyrB64}') format('woff2');
    font-weight: 500; font-style: normal;
    unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
  }
  @font-face {
    font-family: 'Oswald';
    src: url('data:font/woff2;base64,${oswaldLatB64}') format('woff2');
    font-weight: 500; font-style: normal;
  }
`;

// ─── Targets (the three QR codes) ───────────────────────────────────────────
const LINKS = {
  // Store WhatsApp — Pavel / general store line (same as business cards).
  whatsapp: 'https://wa.me/66809020550',
  // Russian-wine catalog landing (public route on the portal).
  catalog:  'https://price-service.up.railway.app/russian-wine',
  // Google Maps pin for the Rawai store (share link from the user).
  maps:     'https://maps.app.goo.gl/KjDb42GC4AAZ6mKKA',
};

// QR: dark dots on a cream tile (light flyer) — same recipe as the light card.
async function makeQr(url) {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: '#1A1A1A', light: '#F3ECE2' },
  });
  return svg.replace(/<\?xml.*?\?>/, '').trim();
}
const QR = {
  whatsapp: await makeQr(LINKS.whatsapp),
  catalog:  await makeQr(LINKS.catalog),
  maps:     await makeQr(LINKS.maps),
};

// ─── Decorative wine glass (left-half clipped, sits at the right edge) ───────
let _g = 0;
function glassImg({ stroke = '#C9A84C', wineColor = '#8C1C1C', widthMm = 30, heightMm = 150 } = {}) {
  const uid = ++_g;
  const svg = `
  <svg width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 60 320" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMid meet">
    <defs>
      <linearGradient id="w${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${wineColor}" stop-opacity="0.22"/>
        <stop offset="55%" stop-color="${wineColor}" stop-opacity="0.72"/>
        <stop offset="100%" stop-color="#5C1010" stop-opacity="0.9"/>
      </linearGradient>
    </defs>
    <path d="M 42 18 C 30 28, 18 55, 20 95 C 22 130, 38 162, 60 170 C 82 162, 98 130, 100 95 C 102 55, 90 28, 78 18 Z"
      fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/>
    <ellipse cx="60" cy="18" rx="18" ry="2.8" fill="none" stroke="${stroke}" stroke-width="1.4"/>
    <path d="M 24 80 C 24 128, 40 161, 60 168 C 80 161, 96 128, 96 80 C 88 95, 72 100, 60 100 C 48 100, 32 95, 24 80 Z"
      fill="url(#w${uid})"/>
    <ellipse cx="60" cy="82" rx="32" ry="3" fill="#5C1010"/>
    <line x1="60" y1="170" x2="60" y2="285" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/>
    <ellipse cx="60" cy="288" rx="26" ry="3.2" fill="none" stroke="${stroke}" stroke-width="1.4"/>
    <line x1="34" y1="288" x2="86" y2="288" stroke="${stroke}" stroke-width="1.4"/>
  </svg>`;
  const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return `<img class="glass-img" src="${dataUrl}" alt="" />`;
}

// ─── Logo lockup (manual wordmark — wordmark PNGs are deprecated) ────────────
function logo(size = 30) {
  return `
    <div class="logo" style="--logo-size:${size}px;">
      <span class="logo-wine">WINE</span>
      <span class="logo-whisky">&amp; WHISKEY</span>
    </div>`;
}

// ─── Copy (RU / EN) ─────────────────────────────────────────────────────────
const COPY = {
  ru: {
    h1a: 'РУССКОЕ ВИНО',
    h1b: 'И КРЕПКИЕ НАПИТКИ',
    loc: 'на Пхукете',
    cats: [
      { key: 'Вино',    types: 'игристое · красное · белое · розе',
        houses: 'Абрау-Дюрсо · Шато Тамань · Аристов · Ведерниковъ · Высокий Берег · Sikory' },
      { key: 'Крепкое', types: 'водка · джин',
        houses: 'Ladoga · Barrister' },
    ],
    qr: {
      whatsapp: ['WhatsApp', 'Написать нам'],
      catalog:  ['Каталог', 'Русские вина'],
      maps:     ['Мы на карте', ''],
    },
    addr: 'Rawai, Пхукет',
    hours: 'Ежедневно 11:00–22:00',
  },
  en: {
    h1a: 'RUSSIAN WINE',
    h1b: '& SPIRITS',
    loc: 'in Phuket',
    cats: [
      { key: 'Wine',    types: 'sparkling · red · white · rosé',
        houses: 'Abrau-Durso · Château Tamagne · Aristov · Vedernikov · Visokiy Bereg · Sikory' },
      { key: 'Spirits', types: 'vodka · gin',
        houses: 'Ladoga · Barrister' },
    ],
    qr: {
      whatsapp: ['WhatsApp', 'Message us'],
      catalog:  ['Catalog', 'Russian wines'],
      maps:     ['Find us', 'On the map'],
    },
    addr: 'Rawai, Phuket',
    hours: 'Open daily 11:00–22:00',
  },
};

function catBlock({ key, types, houses }) {
  return `
    <div class="cat">
      <div class="cat-head">
        <span class="cat-key">${key}</span>
        <span class="cat-types">${types}</span>
      </div>
      <div class="cat-houses">${houses}</div>
    </div>`;
}

function qrBlock(kind, labels) {
  const sub = labels[1] ? `<div class="qr-sub">${labels[1]}</div>` : '';
  return `
    <div class="qr-cell">
      <div class="qr">${QR[kind]}</div>
      <div class="qr-cap">${labels[0]}</div>
      ${sub}
    </div>`;
}

function renderSide(lang) {
  const c = COPY[lang];
  return `
  <div class="page page-${lang}">
    <div class="bg"></div>
    ${glassImg()}
    <div class="safe">

      <section class="hero">
        <h1><span class="h1a">${c.h1a}</span><span class="h1b">${c.h1b}</span></h1>
        <div class="h1loc">${c.loc}</div>
        <div class="rule"></div>
      </section>

      <section class="cats">
        ${c.cats.map(catBlock).join('')}
      </section>

      <div class="bottom-group">
        <section class="qr-row">
          ${qrBlock('whatsapp', c.qr.whatsapp)}
          ${qrBlock('catalog',  c.qr.catalog)}
          ${qrBlock('maps',     c.qr.maps)}
        </section>
        <footer class="foot">
          ${logo(30)}
          <div class="addr"><span>${c.addr}</span><span class="dim">${c.hours}</span></div>
        </footer>
      </div>

    </div>
  </div>`;
}

// ─── CSS ────────────────────────────────────────────────────────────────────
const CSS = `
  ${FONT_FACE}
  :root {
    --wine:#8C1C1C; --black:#1A1A1A; --warm:#F5F0EB; --cream:#EDE0D0;
    --amber:#C9A84C; --burgundy:#5C1010; --graphite:#3D3D3D; --stone:#D4C9BC;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:#2a2a2a; }

  /* A5 trim 148×210mm + 3mm bleed → 154×216mm. Safe inset 14mm from bleed. */
  .page {
    position:relative; width:154mm; height:216mm; overflow:hidden;
    color:var(--black);
    page-break-after:always; break-after:page;
  }
  .page:last-child { page-break-after:auto; break-after:auto; }

  .bg {
    position:absolute; inset:0;
    background:
      radial-gradient(ellipse at 82% 14%, rgba(140,28,28,0.07), transparent 55%),
      radial-gradient(ellipse at 12% 108%, rgba(61,61,61,0.07), transparent 55%),
      linear-gradient(180deg, #F7F2EC 0%, #EFE3D4 100%);
  }
  .glass-img {
    position:absolute; right:0; top:78mm; width:30mm; height:150mm;
    opacity:0.42; pointer-events:none; z-index:1;
  }

  .safe {
    position:absolute; left:14mm; top:14mm; right:14mm; bottom:14mm;
    display:flex; flex-direction:column; justify-content:space-between;
    z-index:2;
  }

  /* Display typeface: Bebas Neue for EN, Oswald (has Cyrillic) for RU. */
  .page-en .h1a, .page-en .h1b, .page-en .cat-key, .page-en .qr-cap {
    font-family:'Bebas Neue';
  }
  .page-ru .h1a, .page-ru .h1b, .page-ru .cat-key, .page-ru .qr-cap {
    font-family:'Oswald'; font-weight:500;
  }

  /* ── Hero (headline leads at the very top) ── */
  .hero { max-width:122mm; }
  h1 { display:flex; flex-direction:column; line-height:0.94; }
  .h1a { font-size:19mm; letter-spacing:0.005em; color:var(--black); }
  .h1b { font-size:19mm; letter-spacing:0.005em; color:var(--wine); margin-top:-0.01em; }
  .page-ru .h1a, .page-ru .h1b { font-size:14mm; letter-spacing:0; }
  .h1loc {
    font-family:'Inter'; font-weight:500; font-size:4.8mm; letter-spacing:0.02em;
    color:var(--graphite); margin-top:2.6mm;
  }
  .rule { width:24mm; height:0; border-top:0.6mm solid var(--amber); margin-top:7mm; }

  /* ── Categories — each lists its styles AND its producers ── */
  .cats { display:flex; flex-direction:column; gap:9mm; max-width:120mm; }
  .cat-head { display:flex; align-items:baseline; gap:5mm; }
  .cat-key {
    font-size:7mm; letter-spacing:0.03em; color:var(--wine);
    text-transform:uppercase; min-width:30mm;
  }
  .cat-types {
    font-family:'Inter'; font-weight:500; font-size:3.6mm; letter-spacing:0.01em;
    color:var(--graphite); text-transform:uppercase; letter-spacing:0.04em;
  }
  .cat-houses {
    font-family:'Inter'; font-weight:500; font-size:4.1mm; line-height:1.4;
    letter-spacing:0.005em; color:var(--black); margin-top:2.8mm;
  }

  /* ── QR row ── */
  .qr-row { display:flex; gap:7mm; }
  .qr-cell { display:flex; flex-direction:column; align-items:center; text-align:center; width:34mm; }
  .qr {
    width:32mm; height:32mm; background:#F3ECE2; padding:2.4mm; border-radius:1mm;
    box-shadow:0 0 0 0.35mm rgba(140,28,28,0.45);
  }
  .qr svg { width:100%; height:100%; display:block; shape-rendering:crispEdges; }
  .qr-cap {
    font-size:5mm; letter-spacing:0.04em; color:var(--black);
    margin-top:2.6mm; text-transform:uppercase;
  }
  .qr-sub {
    font-family:'Inter'; font-weight:500; font-size:2.7mm; letter-spacing:0.03em;
    color:var(--graphite); margin-top:0.6mm;
  }

  /* ── Store sign-off (brand goes to the bottom) ── */
  .bottom-group { display:flex; flex-direction:column; gap:11mm; }
  .foot {
    display:flex; align-items:flex-end; justify-content:space-between;
    padding-top:5mm; border-top:0.3mm solid var(--stone);
  }
  .logo { display:inline-flex; flex-direction:column; align-items:flex-start; line-height:0.9; }
  .logo-wine   { font-family:'Bebas Neue'; font-size:var(--logo-size); letter-spacing:0.01em; color:var(--wine); }
  .logo-whisky { font-family:'Bebas Neue'; font-size:var(--logo-size); letter-spacing:0.01em; color:var(--black); margin-top:-0.06em; }
  .addr {
    display:flex; flex-direction:column; text-align:right; gap:0.8mm;
    font-family:'Inter'; font-weight:500;
  }
  .addr span { font-size:3.4mm; letter-spacing:0.01em; color:var(--black); }
  .addr .dim { font-size:3mm; color:var(--graphite); }

  @page { size:154mm 216mm; margin:0; }

  /* Preview (screen) — both sides side by side */
  body.preview {
    display:flex; gap:14mm; padding:14mm; background:#1f1f1f; width:max-content;
  }
  body.preview .page { box-shadow:0 6mm 14mm rgba(0,0,0,0.55); }
`;

function htmlDoc(bodyClass, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>W&W Russian Wine Flyer</title><style>${CSS}</style></head>
<body class="${bodyClass}">${body}</body></html>`;
}

// ─── Render via Chrome headless ─────────────────────────────────────────────
function chromePdf(htmlPath, pdfPath) {
  execSync(
    `"${CHROME}" --headless --disable-gpu --no-sandbox ` +
    `--print-to-pdf-no-header --no-pdf-header-footer ` +
    `--print-to-pdf="${pdfPath}" "file://${htmlPath}"`,
    { stdio: 'inherit' }
  );
}

const front = renderSide('ru');
const back  = renderSide('en');

// Combined 2-page print PDF
const printPath = join(OUT_DIR, '_print.html');
writeFileSync(printPath, htmlDoc('', front + '\n' + back));
const pdfPath = join(OUT_DIR, 'russian_wine_flyer_2026-06.pdf');
console.log('→ Rendering 2-page A5 print PDF…');
chromePdf(printPath, pdfPath);

// Per-side print PDFs
for (const [name, body] of [['front', front], ['back', back]]) {
  const h = join(OUT_DIR, `_print_${name}.html`);
  writeFileSync(h, htmlDoc('', body));
  chromePdf(h, join(OUT_DIR, `russian_wine_flyer_${name}_2026-06.pdf`));
  try { unlinkSync(h); } catch {}
}

// Preview PNG (both sides)
const previewPath = join(OUT_DIR, '_preview.html');
writeFileSync(previewPath, htmlDoc('preview', front + '\n' + back));
const pngPath = join(OUT_DIR, 'russian_wine_flyer_preview_2026-06.png');
console.log('→ Rendering preview PNG…');
execSync(
  `"${CHROME}" --headless --disable-gpu --no-sandbox --hide-scrollbars ` +
  `--force-device-scale-factor=2 --window-size=1380,1010 ` +
  `--screenshot="${pngPath}" "file://${previewPath}"`,
  { stdio: 'inherit' }
);

console.log('✓ Generated:');
console.log('  ' + pdfPath);
console.log('  russian_wine_flyer_front_2026-06.pdf / _back_2026-06.pdf');
console.log('  ' + pngPath);
