/**
 * Business cards generator — Wine & Whiskey
 * Renders 3 vertical 55x85mm two-sided cards as print-ready PDF + PNG previews.
 * Uses locally embedded fonts and inline-generated QR SVG.
 *
 * Run: node build.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, unlinkSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FONT_DIR = join(__dirname, '..', 'logo', 'fonts');
const OUT_DIR = __dirname;

const bebasB64 = readFileSync(join(FONT_DIR, 'BebasNeue.woff2')).toString('base64');
const interB64 = readFileSync(join(FONT_DIR, 'Inter500.woff2')).toString('base64');

const FONT_FACE = `
  @font-face {
    font-family: 'Bebas Neue';
    src: url('data:font/woff2;base64,${bebasB64}') format('woff2');
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: 'Inter';
    src: url('data:font/woff2;base64,${interB64}') format('woff2');
    font-weight: 500;
    font-style: normal;
  }
`;

// ─── WhatsApp targets (per card) ────────────────────────────────────────────
// Each card's QR opens a direct WhatsApp chat. wa.me wants the number in
// international format with no '+' and no spaces.
const WHATSAPP = {
  pavel:   { url: 'https://wa.me/66809020550', display: '+66 80 902 0550' },
  irina:   { url: 'https://wa.me/66939140004', display: '+66 93 914 0004' },
  general: { url: 'https://wa.me/66809020550', display: '+66 80 902 0550' },
};

// ─── QR (per target, two color variants — picked per mode) ──────────────────
// Dark mode card  → dark dots on cream tile (cream tile sits on black bg)
// Light mode card → cream dots on dark tile (dark tile sits on cream bg)
async function makeQr(url, dark, light) {
  // 'H' (30% recovery) so the centered WhatsApp logo never breaks the scan.
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 0,
    color: { dark, light },
  });
  return svg.replace(/<\?xml.*?\?>/, '').trim();
}

// WhatsApp glyph (bubble + handset) on a bright disc — dropped into the QR
// center so it reads unmistakably as "scan to chat on WhatsApp".
function waLogo() {
  return `
    <div class="qr-logo">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path fill="#25D366" d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
      </svg>
    </div>`;
}
const QR = {};
for (const [key, { url }] of Object.entries(WHATSAPP)) {
  QR[key] = {
    dark:  await makeQr(url, '#1A1A1A', '#F5F0EB'),
    light: await makeQr(url, '#F5F0EB', '#1A1A1A'),
  };
}

// Website QR — shared across all cards, shown as the second (lower) code.
const WEB_URL = 'https://wine-whiskey.com';
const QR_WEB = {
  dark:  await makeQr(WEB_URL, '#1A1A1A', '#F5F0EB'),
  light: await makeQr(WEB_URL, '#F5F0EB', '#1A1A1A'),
};

// ─── Wine glass SVG ───────────────────────────────────────────────────────────
// Bordeaux-style red wine glass: wide rounded bowl, narrow rim, long stem.
// Path covers full glass (x: 0..120). viewBox is clipped to the LEFT half
// "0 0 60 320" so only that half shows at the card's right edge.
//
// Chrome's print-to-pdf engine quietly drops inline SVG that lives inside
// absolute-positioned divs sized with `width:100%`. Workaround: emit the SVG
// with explicit mm dimensions and unique gradient ids per render.
let _glassUid = 0;
function glassSvg({ stroke = '#C9A84C', wineColor = '#8C1C1C', widthMm = 16, heightMm = 85 } = {}) {
  const uid = ++_glassUid;
  const wineId = `wine-${uid}`;
  const hlId = `hl-${uid}`;
  return `
  <svg width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 60 320" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMid meet">
    <defs>
      <linearGradient id="${wineId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${wineColor}" stop-opacity="0.30"/>
        <stop offset="55%" stop-color="${wineColor}" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#5C1010" stop-opacity="0.95"/>
      </linearGradient>
      <linearGradient id="${hlId}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.0"/>
        <stop offset="40%" stop-color="${stroke}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <!-- Bordeaux bowl: wide, round, tapers in toward rim and stem -->
    <!-- Left side: rim x=42 → widest x=20 around y=85 → stem x=60 at y=170 -->
    <!-- Right side mirror: rim x=78 → widest x=100 → stem x=60 -->
    <path d="
      M 42 18
      C 30 28, 18 55, 20 95
      C 22 130, 38 162, 60 170
      C 82 162, 98 130, 100 95
      C 102 55, 90 28, 78 18
      Z"
      fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>
    <!-- Top rim ellipse (open top) -->
    <ellipse cx="60" cy="18" rx="18" ry="2.8" fill="none" stroke="${stroke}" stroke-width="1.6"/>
    <!-- Wine fill: fills lower 2/3 of bowl -->
    <path d="
      M 24 80
      C 24 128, 40 161, 60 168
      C 80 161, 96 128, 96 80
      C 88 95, 72 100, 60 100
      C 48 100, 32 95, 24 80
      Z"
      fill="url(#${wineId})"/>
    <!-- Wine surface ellipse -->
    <ellipse cx="60" cy="82" rx="32" ry="3" fill="#5C1010"/>
    <ellipse cx="60" cy="81" rx="28" ry="1.4" fill="${wineColor}" opacity="0.7"/>
    <!-- Glass highlight on left curve -->
    <path d="M 28 50 C 24 75, 28 110, 38 145"
          fill="none" stroke="${stroke}" stroke-width="0.6" opacity="0.55"/>
    <!-- Stem -->
    <line x1="60" y1="170" x2="60" y2="285" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>
    <!-- Base -->
    <ellipse cx="60" cy="288" rx="26" ry="3.2" fill="none" stroke="${stroke}" stroke-width="1.6"/>
    <line x1="34" y1="288" x2="86" y2="288" stroke="${stroke}" stroke-width="1.6"/>
  </svg>`;
}

// ─── Logo lockup (vertical) ───────────────────────────────────────────────────
function logoLockup({ wineColor = '#8C1C1C', whiskyColor = '#F5F0EB', size = 38 }) {
  return `
    <div class="logo" style="--logo-size:${size}px;">
      <span class="logo-wine" style="color:${wineColor}">WINE</span>
      <span class="logo-whisky" style="color:${whiskyColor}">&amp; WHISKEY</span>
    </div>`;
}

// ─── Card content ─────────────────────────────────────────────────────────────
// Mode is set per build run — see MODE constant below.
const PEOPLE = {
  pavel: { name: 'Pavel Rasputin', role: 'Owner', phone: '+66 80 902 0550', email: 'p@wine-whiskey.com' },
  irina: { name: 'Irina Rasputina', role: 'Owner', phone: '+66 93 914 0004', email: 'i@wine-whiskey.com' },
};
const COMPANY = { tagline: 'Fine wine and spirits', address: 'Phuket, Rawai', hours: 'Open daily 11:00 — 22:00' };

const cards = [
  { id: 'pavel-front',   side: 'front',         person: PEOPLE.pavel },
  { id: 'pavel-back',    side: 'back',          who: 'pavel' },
  { id: 'irina-front',   side: 'front',         person: PEOPLE.irina },
  { id: 'irina-back',    side: 'back',          who: 'irina' },
  { id: 'generic-front', side: 'front-generic', company: COMPANY },
  { id: 'generic-back',  side: 'back-generic',  who: 'general' },
];

// ─── Glass as <img src="data:image/svg+xml;..."> ────────────────────────────
// Chrome's print-to-pdf engine does not reliably render inline absolutely-
// positioned <svg>. Embedding the same SVG via a data URL on an <img> tag
// always works because <img> is a replaced element with intrinsic dimensions.
function glassImg(opts = {}) {
  const svg = glassSvg(opts);
  const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return `<img class="glass-img" src="${dataUrl}" alt="" />`;
}

// ─── Mode-aware palettes for logo + QR ──────────────────────────────────────
function logoColors(mode) {
  if (mode === 'light') {
    return { wineColor: '#8C1C1C', whiskyColor: '#1A1A1A' };
  }
  return { wineColor: '#8C1C1C', whiskyColor: '#F5F0EB' };
}

function renderFrontPersonal({ name, role, phone, email }, mode) {
  const lc = logoColors(mode);
  return `
    <div class="card card-${mode}">
      <div class="bleed-bg"></div>
      ${glassImg(mode === 'light' ? { stroke: '#3D3D3D' } : {})}
      <div class="safe">
        <div class="card-top">
          ${logoLockup({ ...lc, size: 26 })}
        </div>
        <div class="card-bottom">
          <div class="hairline"></div>
          <div class="name">${name}</div>
          <div class="role">${role}</div>
          <div class="contact">
            <div>${phone}</div>
            <div>${email}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderFrontGeneric({ tagline, address, hours }, mode) {
  const lc = logoColors(mode);
  return `
    <div class="card card-${mode}">
      <div class="bleed-bg"></div>
      ${glassImg(mode === 'light' ? { stroke: '#3D3D3D' } : {})}
      <div class="safe">
        <div class="card-top">
          ${logoLockup({ ...lc, size: 30 })}
        </div>
        <div class="card-bottom card-bottom-generic">
          <div class="hairline"></div>
          <div class="overline">FINE WINE AND SPIRITS</div>
          <div class="generic-line">${address}</div>
          <div class="generic-line dim">${hours}</div>
        </div>
      </div>
    </div>`;
}

// Two stacked QR codes: WhatsApp (with center logo) on top, website below.
function renderDualBack(mode, who) {
  const lc = logoColors(mode);
  const wa = QR[who][mode];
  const web = QR_WEB[mode];
  return `
    <div class="card card-${mode} card-back">
      <div class="bleed-bg"></div>
      <div class="safe safe-back safe-back-dual">
        <div class="qr-block">
          <div class="qr-caption">Message us on WhatsApp</div>
          <div class="qr qr-dual">${wa}${waLogo()}</div>
        </div>
        <div class="qr-divider"></div>
        <div class="qr-block">
          <div class="qr-caption">More wine and wine events in Phuket</div>
          <div class="qr qr-dual">${web}</div>
          <div class="qr-url">wine-whiskey.com</div>
        </div>
        <div class="back-footer">
          ${logoLockup({ ...lc, size: 14 })}
        </div>
      </div>
    </div>`;
}

function renderBackWholesale(mode, who) {
  return renderDualBack(mode, who);
}

function renderBackGeneric(mode, who) {
  return renderDualBack(mode, who);
}

function renderCard(c, mode) {
  if (c.side === 'front') return renderFrontPersonal(c.person, mode);
  if (c.side === 'front-generic') return renderFrontGeneric(c.company, mode);
  if (c.side === 'back') return renderBackWholesale(mode, c.who);
  if (c.side === 'back-generic') return renderBackGeneric(mode, c.who);
  return '';
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  ${FONT_FACE}

  :root {
    --wine: #8C1C1C;
    --black: #1A1A1A;
    --warm-white: #F5F0EB;
    --cream: #EDE0D0;
    --amber: #C9A84C;
    --burgundy: #5C1010;
    --graphite: #3D3D3D;
    --pale-stone: #D4C9BC;
  }

  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background: #2a2a2a; }

  /* ── Card geometry ─────────────────────────────────────────
     Trim:  55 x 85 mm
     Bleed: +3mm on each side  =>  61 x 91 mm
     Safe:  -5mm from trim     =>  45 x 75 mm  (content inside trim)
  */
  .card {
    position: relative;
    width: 61mm;
    height: 91mm;
    overflow: hidden;
    color: var(--warm-white);
    page-break-after: always;
    break-after: page;
  }
  .card:last-child { page-break-after: auto; break-after: auto; }

  .card-dark .bleed-bg {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse at 70% 30%, rgba(201,168,76,0.08), transparent 50%),
      radial-gradient(ellipse at 20% 100%, rgba(140,28,28,0.18), transparent 60%),
      var(--black);
  }
  .card-light { color: var(--black); }
  .card-light .bleed-bg {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse at 80% 20%, rgba(140,28,28,0.06), transparent 55%),
      radial-gradient(ellipse at 15% 110%, rgba(61,61,61,0.08), transparent 55%),
      linear-gradient(180deg, #F5F0EB 0%, #EDE0D0 100%);
  }

  /* trim guides — only render in screen mode for preview */
  .card::after {
    content: "";
    position: absolute;
    left: 3mm; top: 3mm; right: 3mm; bottom: 3mm;
    border: 0; /* set in preview mode */
    pointer-events: none;
  }
  body.preview .card::after {
    border: 0.2mm dashed rgba(245,240,235,0.18);
  }

  .safe {
    position: absolute;
    left: 8mm; top: 8mm; right: 8mm; bottom: 8mm;   /* 3mm bleed + 5mm safe */
    display: flex; flex-direction: column; justify-content: space-between;
  }
  /* On the front, text column is constrained so the half-glass on the right
     never collides with names, role, or contact lines. */
  .card:not(.card-back) .card-top,
  .card:not(.card-back) .card-bottom { max-width: 42mm; }

  /* ── Logo ─────────────────────────────────────────────── */
  .logo { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 0; line-height: 1; }
  .logo-wine { font-family: 'Bebas Neue', sans-serif; font-weight: 400; font-size: var(--logo-size); letter-spacing: 0.01em; line-height: 1; }
  .logo-whisky { font-family: 'Bebas Neue', sans-serif; font-weight: 400; font-size: var(--logo-size); letter-spacing: 0.01em; line-height: 1; margin-top: -0.04em; }

  /* ── Front: glass element ─────────────────────────────── */
  /* Bordeaux glass is 32mm wide; we anchor its center on the right card edge
     so exactly half the glass is visible inside the card and the other half
     is cropped off. Text never crosses into the glass band. */
  .glass-wrap {
    position: absolute;
    pointer-events: none;
  }
  /* Glass as <img>. Anchored at the card's right edge (extends 2mm into the
     bleed so the bowl visually meets the trim). SVG viewBox already clips to
     the left half of the glass — only that half is drawn. */
  .glass-img {
    position: absolute;
    right: 0;
    top: 10mm;
    width: 16mm;
    height: 75mm;
    opacity: 0.95;
    pointer-events: none;
  }
  .card-light .glass-img { opacity: 0.85; }

  /* ── Front: bottom block ──────────────────────────────── */
  .card-top { position: relative; z-index: 2; }
  .card-bottom { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 1.4mm; }
  .hairline {
    width: 6mm; height: 0; border-top: 0.3mm solid var(--amber);
    margin-bottom: 1.5mm;
  }
  .name {
    font-family: 'Bebas Neue', sans-serif;
    font-weight: 400;
    font-size: 6.4mm;
    letter-spacing: 0.04em;
    color: var(--warm-white);
    line-height: 1.05;
    text-transform: uppercase;
  }
  .role {
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 2.5mm;
    letter-spacing: 0.02em;
    color: var(--amber);
    margin-top: 0.5mm;
    margin-bottom: 1.5mm;
  }
  .contact {
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 2.6mm;
    line-height: 1.45;
    color: var(--pale-stone);
    letter-spacing: 0.01em;
  }
  .contact div { white-space: nowrap; }

  /* Light-mode text overrides */
  .card-light .name        { color: var(--black); }
  .card-light .role        { color: var(--wine); }
  .card-light .contact     { color: var(--graphite); }
  .card-light .hairline    { border-top-color: var(--wine); }

  /* ── Front: generic ──────────────────────────────────── */
  .card-bottom-generic .overline {
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 2.2mm;
    letter-spacing: 0.22em;
    color: var(--amber);
    text-transform: uppercase;
    margin-bottom: 2.2mm;
  }
  .generic-line {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 4.2mm;
    letter-spacing: 0.04em;
    color: var(--warm-white);
    line-height: 1.15;
    text-transform: uppercase;
  }
  .generic-line.dim {
    color: var(--pale-stone);
    font-size: 3.6mm;
    margin-top: 0.4mm;
  }
  .card-light .generic-line     { color: var(--black); }
  .card-light .generic-line.dim { color: var(--graphite); }

  /* ── Back ────────────────────────────────────────────── */
  .safe-back {
    align-items: center;
    text-align: center;
  }
  .back-header { display: flex; flex-direction: column; align-items: center; gap: 1.5mm; }
  .overline {
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 2.4mm;
    letter-spacing: 0.28em;
    color: var(--amber);
    text-transform: uppercase;
  }
  .back-email {
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 2.8mm;
    color: var(--warm-white);
    letter-spacing: 0.005em;
    white-space: nowrap;
  }
  .card-light .overline    { color: var(--wine); }
  .card-light .back-email  { color: var(--black); }
  .card-light .qr-caption  { color: var(--graphite); }
  .card-light .qr-url      { color: var(--black); }
  .card-light .qr {
    background: var(--black);
    box-shadow: 0 0 0 0.3mm rgba(140,28,28,0.5);
  }
  .qr-wrap {
    display: flex; flex-direction: column; align-items: center; gap: 2mm;
  }
  .qr {
    position: relative;
    width: 26mm; height: 26mm;
    background: var(--warm-white);
    padding: 2mm;
    border-radius: 0.5mm;
    box-shadow: 0 0 0 0.3mm rgba(201,168,76,0.6);
  }
  .qr-large { width: 32mm; height: 32mm; padding: 2.5mm; }
  .qr-dual  { width: 21mm; height: 21mm; padding: 1.6mm; }
  .qr > svg { width: 100%; height: 100%; display: block; shape-rendering: crispEdges; }

  /* Two-QR back layout */
  .safe-back-dual { justify-content: space-between; gap: 1mm; }
  .qr-block { display: flex; flex-direction: column; align-items: center; gap: 1.4mm; }
  .qr-divider {
    width: 10mm; height: 0;
    border-top: 0.25mm solid rgba(201,168,76,0.5);
  }
  .card-light .qr-divider { border-top-color: rgba(140,28,28,0.45); }
  /* WhatsApp logo punched into the QR center (QR uses 'H' recovery). */
  .qr-logo {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 28%; height: 28%;
    background: #FFFFFF;
    border-radius: 22%;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 0 0.4mm #FFFFFF;
  }
  .qr-logo svg { width: 80%; height: 80%; display: block; shape-rendering: auto; }
  .qr-caption {
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 2.4mm;
    color: var(--pale-stone);
    letter-spacing: 0.04em;
  }
  .qr-sub {
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 2.2mm;
    line-height: 1.3;
    color: var(--pale-stone);
    letter-spacing: 0.01em;
    max-width: 40mm;
  }
  .card-light .qr-sub { color: var(--graphite); }
  .qr-url {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 3.6mm;
    letter-spacing: 0.06em;
    color: var(--warm-white);
    text-transform: uppercase;
  }
  .back-footer { display: flex; align-items: center; justify-content: center; }

  /* ── Print pages ─────────────────────────────────────── */
  @page {
    size: 61mm 91mm;
    margin: 0;
  }

  /* ── Preview layout (screen) ─────────────────────────── */
  body.preview {
    display: grid;
    grid-template-columns: repeat(3, 61mm);
    grid-auto-rows: auto;
    column-gap: 10mm;
    row-gap: 14mm;
    padding: 14mm;
    background: #1f1f1f;
    color: var(--warm-white);
    font-family: 'Inter', sans-serif;
    width: max-content;
  }
  body.preview .card { box-shadow: 0 4mm 8mm rgba(0,0,0,0.6); }
  body.preview .cell { width: 61mm; height: 91mm; }
  .preview-label {
    position: absolute;
    bottom: -7mm; left: 0; right: 0;
    text-align: center;
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 2.6mm;
    color: var(--pale-stone);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .mode-label {
    grid-column: 1 / -1;
    font-family: 'Bebas Neue', sans-serif;
    font-size: 6mm;
    letter-spacing: 0.2em;
    color: var(--amber);
    border-bottom: 0.3mm solid rgba(201,168,76,0.4);
    padding-bottom: 2mm;
    margin-top: 4mm;
  }
`;

// ─── HTML pages ───────────────────────────────────────────────────────────────
function buildPrintHtml(mode) {
  const body = cards.map((c) => renderCard(c, mode)).join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>W&W Business Cards — Print (${mode})</title>
<style>${CSS}</style>
</head>
<body>
${body}
</body></html>`;
}

function buildSinglePrintHtml(card, mode) {
  const body = renderCard(card, mode);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>W&W ${card.id} (${mode})</title>
<style>${CSS}</style>
</head>
<body>
${body}
</body></html>`;
}

function buildPreviewHtml() {
  // Layout: 4 rows × 3 cols
  //   Row 1: Pavel/Irina/Generic — Dark Front
  //   Row 2: Pavel/Irina/Generic — Dark Back
  //   Row 3: Pavel/Irina/Generic — Light Front
  //   Row 4: Pavel/Irina/Generic — Light Back
  const labels = {
    'pavel-front':   'Pavel — Front',
    'pavel-back':    'Pavel — Back',
    'irina-front':   'Irina — Front',
    'irina-back':    'Irina — Back',
    'generic-front': 'Generic — Front',
    'generic-back':  'Generic — Back',
  };
  const rowOrder = [
    ['pavel-front',   'irina-front',   'generic-front'],
    ['pavel-back',    'irina-back',    'generic-back'],
  ];
  function rowBlock(mode) {
    return rowOrder.map((row) =>
      row.map((id) => {
        const c = cards.find((x) => x.id === id);
        return `<div class="cell" style="position:relative;">${renderCard(c, mode)}<div class="preview-label">${labels[id]}</div></div>`;
      }).join('\n')
    ).join('\n');
  }
  const body = `
    <div class="mode-label">DARK MODE</div>
    ${rowBlock('dark')}
    <div class="mode-label">LIGHT MODE</div>
    ${rowBlock('light')}
  `;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>W&W Business Cards — Preview</title>
<style>${CSS}</style>
</head>
<body class="preview">
${body}
</body></html>`;
}

// ─── Render via Chrome headless ───────────────────────────────────────────────
const printDarkPath  = join(OUT_DIR, '_print_dark.html');
const printLightPath = join(OUT_DIR, '_print_light.html');
const previewPath    = join(OUT_DIR, '_preview.html');

writeFileSync(printDarkPath,  buildPrintHtml('dark'));
writeFileSync(printLightPath, buildPrintHtml('light'));
writeFileSync(previewPath,    buildPreviewHtml());

const pdfDarkPath  = join(OUT_DIR, 'wine_whiskey_business_cards_dark.pdf');
const pdfLightPath = join(OUT_DIR, 'wine_whiskey_business_cards_light.pdf');
const pngPath      = join(OUT_DIR, 'wine_whiskey_business_cards_preview.png');

function chromePdf(htmlPath, pdfPath) {
  execSync(
    `"${CHROME}" --headless --disable-gpu --no-sandbox ` +
      `--print-to-pdf-no-header --no-pdf-header-footer ` +
      `--print-to-pdf="${pdfPath}" "file://${htmlPath}"`,
    { stdio: 'inherit' }
  );
}

console.log('→ Rendering Dark PDF (61x91mm with 3mm bleed)...');
chromePdf(printDarkPath, pdfDarkPath);
console.log('→ Rendering Light PDF (61x91mm with 3mm bleed)...');
chromePdf(printLightPath, pdfLightPath);

// Per-card print files. Each card side is its own one-page PDF for the
// printer (61x91mm with 3mm bleed already included; trim at 55x85mm).
console.log('→ Rendering 6 per-card print PDFs (Dark + Light)...');
mkdirSync(join(OUT_DIR, 'print'), { recursive: true });
const fileSafe = {
  'pavel-front':   '1_pavel_front',
  'pavel-back':    '2_pavel_back',
  'irina-front':   '3_irina_front',
  'irina-back':    '4_irina_back',
  'generic-front': '5_generic_front',
  'generic-back':  '6_generic_back',
};
for (const mode of ['dark', 'light']) {
  for (const card of cards) {
    const tmpHtml = join(OUT_DIR, `_print_${mode}_${card.id}.html`);
    const outPdf  = join(OUT_DIR, 'print', `${fileSafe[card.id]}_${mode}.pdf`);
    writeFileSync(tmpHtml, buildSinglePrintHtml(card, mode));
    chromePdf(tmpHtml, outPdf);
    try { unlinkSync(tmpHtml); } catch {}
  }
}

console.log('→ Rendering combined preview (Dark + Light, 12 panels)...');
// Canvas math:
//   width  = 3*61mm + 2*10mm + 2*14mm = 231mm ≈ 873px @ 96dpi
//   height ≈ 4 rows * (91mm + ~9mm label) + 3 row-gaps * 14mm
//          + 2 mode-labels (~16mm) + 2*14mm padding ≈ 510mm ≈ 1928px
// scale=2 → ~3856px tall. Window must contain unscaled layout.
execSync(
  `"${CHROME}" --headless --disable-gpu --no-sandbox ` +
    `--hide-scrollbars --force-device-scale-factor=2 ` +
    `--window-size=900,1980 ` +
    `--screenshot="${pngPath}" "file://${previewPath}"`,
  { stdio: 'inherit' }
);

// (intermediate HTML kept for debugging)

console.log('✓ Generated:');
console.log('  ' + pdfDarkPath);
console.log('  ' + pdfLightPath);
console.log('  ' + pngPath);
console.log('  ' + join(OUT_DIR, 'print') + '/  (12 per-card PDFs)');
