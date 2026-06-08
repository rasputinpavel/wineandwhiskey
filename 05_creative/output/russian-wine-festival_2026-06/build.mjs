/**
 * Russian Wine & Spirits — A5 booth flyer (Wine & Whiskey)
 *
 * Double-sided A5, colour, print-ready.
 *   Side 1 (front) — Russian
 *   Side 2 (back)  — English
 *
 * One simple message: Russian wine & spirits are stocked at the Wine & Whiskey
 * store on Rawai. Three QR codes per side: WhatsApp · Russian-wine catalog ·
 * how to find us (Google Maps). Light festival mention (Russian Food Festival ×
 * Central Phuket, 12–14 June 2026, Phuket Outdoor Arena).
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

const bebasB64 = readFileSync(join(FONT_DIR, 'BebasNeue.woff2')).toString('base64');
const interB64 = readFileSync(join(FONT_DIR, 'Inter500.woff2')).toString('base64');

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
`;

// ─── Targets (the three QR codes) ───────────────────────────────────────────
// NOTE: confirm the two TODO urls before the final print run, then re-run.
const LINKS = {
  // Store WhatsApp — Pavel / general store line (same as business cards).
  whatsapp: 'https://wa.me/66809020550',
  // Russian-wine catalog landing (public route on the portal).
  catalog:  'https://mission-control-production.up.railway.app/russian-wine',
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
function logo(size = 54) {
  return `
    <div class="logo" style="--logo-size:${size}px;">
      <span class="logo-wine">WINE</span>
      <span class="logo-whisky">&amp; WHISKEY</span>
    </div>`;
}

// ─── Copy (RU / EN) ─────────────────────────────────────────────────────────
const COPY = {
  ru: {
    overline: 'Вино и спириты России',
    h1a: 'РУССКОЕ ВИНО',
    h1b: '& СПИРИТЫ',
    lead: 'Игристое, красное, белое, розе и водка из Краснодара, Тамани, Дона и долины Абрау — в нашем магазине на Раваи.',
    range: 'Абрау-Дюрсо · Шато Тамань · Аристов · Ведерниковъ · Высокий Берег · Sikory · Ladoga · Barrister',
    qr: {
      whatsapp: ['WhatsApp', 'Написать нам'],
      catalog:  ['Каталог', 'Русские вина'],
      maps:     ['Как добраться', 'Мы на карте'],
    },
    store: 'Rawai, Пхукет · Ежедневно 11:00–22:00',
    festival: 'На фестивале Russian Food Festival × Central Phuket · 12–14 июня 2026 · Phuket Outdoor Arena',
  },
  en: {
    overline: 'Wine & spirits of Russia',
    h1a: 'RUSSIAN WINE',
    h1b: '& SPIRITS',
    lead: 'Sparkling, red, white, rosé and vodka from Krasnodar, Taman, the Don and Abrau valley — at our store in Rawai.',
    range: 'Abrau-Durso · Château Tamagne · Aristov · Vedernikov · Visokiy Bereg · Sikory · Ladoga · Barrister',
    qr: {
      whatsapp: ['WhatsApp', 'Message us'],
      catalog:  ['Catalog', 'Russian wines'],
      maps:     ['Find us', 'On the map'],
    },
    store: 'Rawai, Phuket · Open daily 11:00–22:00',
    festival: 'At the Russian Food Festival × Central Phuket · 12–14 June 2026 · Phuket Outdoor Arena',
  },
};

function qrBlock(kind, labels) {
  return `
    <div class="qr-cell">
      <div class="qr">${QR[kind]}</div>
      <div class="qr-cap">${labels[0]}</div>
      <div class="qr-sub">${labels[1]}</div>
    </div>`;
}

function renderSide(lang) {
  const c = COPY[lang];
  return `
  <div class="page">
    <div class="bg"></div>
    ${glassImg()}
    <div class="safe">

      <header class="top">
        ${logo(54)}
        <div class="overline">${c.overline}</div>
      </header>

      <section class="hero">
        <h1><span class="h1a">${c.h1a}</span><span class="h1b">${c.h1b}</span></h1>
        <div class="rule"></div>
        <p class="lead">${c.lead}</p>
        <p class="range">${c.range}</p>
      </section>

      <section class="qr-row">
        ${qrBlock('whatsapp', c.qr.whatsapp)}
        ${qrBlock('catalog',  c.qr.catalog)}
        ${qrBlock('maps',     c.qr.maps)}
      </section>

      <footer class="bottom">
        <div class="store">${c.store}</div>
        <div class="festival">${c.festival}</div>
      </footer>

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

  /* A5 trim 148×210mm + 3mm bleed → 154×216mm. Safe inset 8mm from bleed. */
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
    position:absolute; right:0; top:54mm; width:30mm; height:150mm;
    opacity:0.5; pointer-events:none; z-index:1;
  }

  .safe {
    position:absolute; left:14mm; top:14mm; right:14mm; bottom:14mm;
    display:flex; flex-direction:column; justify-content:space-between;
    z-index:2;
  }

  /* ── Logo ── */
  .logo { display:inline-flex; flex-direction:column; align-items:flex-start; line-height:0.92; }
  .logo-wine   { font-family:'Bebas Neue'; font-size:var(--logo-size); letter-spacing:0.01em; color:var(--wine); }
  .logo-whisky { font-family:'Bebas Neue'; font-size:var(--logo-size); letter-spacing:0.01em; color:var(--black); margin-top:-0.06em; }

  .top { display:flex; flex-direction:column; gap:3mm; }
  .overline {
    font-family:'Inter'; font-weight:500; font-size:3mm; letter-spacing:0.26em;
    text-transform:uppercase; color:var(--graphite);
  }

  /* ── Hero ── */
  .hero { max-width:118mm; }
  h1 { display:flex; flex-direction:column; line-height:0.9; }
  .h1a { font-family:'Bebas Neue'; font-size:21mm; letter-spacing:0.01em; color:var(--black); }
  .h1b { font-family:'Bebas Neue'; font-size:21mm; letter-spacing:0.01em; color:var(--wine); margin-top:-0.04em; }
  .rule { width:22mm; height:0; border-top:0.6mm solid var(--amber); margin:6mm 0 5mm; }
  .lead {
    font-family:'Inter'; font-weight:500; font-size:4.4mm; line-height:1.45;
    color:var(--graphite); max-width:96mm;
  }
  .range {
    font-family:'Inter'; font-weight:500; font-size:3.1mm; letter-spacing:0.02em;
    color:var(--wine); margin-top:5mm;
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
    font-family:'Bebas Neue'; font-size:5mm; letter-spacing:0.05em;
    color:var(--black); margin-top:2.6mm; text-transform:uppercase;
  }
  .qr-sub {
    font-family:'Inter'; font-weight:500; font-size:2.7mm; letter-spacing:0.03em;
    color:var(--graphite); margin-top:0.6mm;
  }

  /* ── Footer ── */
  .bottom { display:flex; flex-direction:column; gap:2.4mm; }
  .store {
    font-family:'Bebas Neue'; font-size:5mm; letter-spacing:0.05em;
    color:var(--black); text-transform:uppercase;
  }
  .festival {
    font-family:'Inter'; font-weight:500; font-size:2.8mm; letter-spacing:0.02em;
    color:var(--graphite); padding-top:2.4mm; border-top:0.3mm solid var(--stone);
  }

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
