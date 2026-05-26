/**
 * Logo generator — Wine & Whiskey
 * Uses locally downloaded fonts for reliable offline rendering
 * Run: node generate_logos.mjs
 *
 * NOTE (2026-05-26): the "store" element between WINE and & WHISKEY is
 * deprecated. The primary brand mark is now the monogram in
 * channel_avatar_light.png / channel_avatar_dark.png. The wordmark generator
 * below is kept so we can re-export clean wordmark files when needed — without
 * the "store" word.
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

const CHROME  = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = '/Users/pavelrasputin/Desktop/Wine_Whiskey/brand/logo';
const FONT_DIR = join(OUT_DIR, 'fonts');

// Embed fonts as base64 so Chrome headless doesn't need network
const antonB64 = readFileSync(join(FONT_DIR, 'Anton.ttf')).toString('base64');
const interB64 = readFileSync(join(FONT_DIR, 'Inter500.woff2')).toString('base64');

const FONT_FACE = `
  @font-face {
    font-family: 'Anton';
    src: url('data:font/ttf;base64,${antonB64}') format('truetype');
    font-weight: 400;
  }
  @font-face {
    font-family: 'Inter';
    src: url('data:font/woff2;base64,${interB64}') format('woff2');
    font-weight: 500;
  }
`;

// ─── HTML builders ────────────────────────────────────────────────────────────

function buildVertical({ bgColor, wineColor, whiskyColor, fontSize = 130 }) {
  const W = Math.round(fontSize * 4.3);
  const H = Math.round(fontSize * 2.15);

  return { width: W, height: H, html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  ${FONT_FACE}
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:${bgColor};
    display:flex; align-items:center; justify-content:center; }
  .logo { display:inline-flex; flex-direction:column; align-items:flex-start; gap:0; }
  .wine  { font-family:'Anton',sans-serif; font-size:${fontSize}px;
    color:${wineColor}; line-height:1; }
  .whisky { font-family:'Anton',sans-serif; font-size:${fontSize}px;
    color:${whiskyColor}; line-height:1;
    margin-top:${Math.round(fontSize*-0.02)}px; }
</style></head>
<body>
  <div class="logo">
    <span class="wine">WINE</span>
    <span class="whisky">&amp;&nbsp;WHISKEY</span>
  </div>
</body></html>` };
}

function buildHorizontal({ bgColor, wineColor, whiskyColor, fontSize = 100 }) {
  const W = Math.round(fontSize * 10);
  const H = Math.round(fontSize * 1.6);

  return { width: W, height: H, html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  ${FONT_FACE}
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; background:${bgColor};
    display:flex; align-items:center; justify-content:center; }
  .logo { display:inline-flex; align-items:flex-end; gap:18px;
    padding-bottom:${Math.round(fontSize*0.05)}px; }
  .wine  { font-family:'Anton',sans-serif; font-size:${fontSize}px;
    color:${wineColor}; letter-spacing:0px; line-height:1; }
  .whisky { font-family:'Anton',sans-serif; font-size:${fontSize}px;
    color:${whiskyColor}; letter-spacing:0px; line-height:1; }
</style></head>
<body>
  <div class="logo">
    <span class="wine">WINE</span>
    <span class="whisky">&amp;&nbsp;WHISKEY</span>
  </div>
</body></html>` };
}

// ─── Variants ─────────────────────────────────────────────────────────────────

const variants = [
  { name: 'logo_color',
    ...buildVertical({ bgColor:'#FFFFFF', wineColor:'#8C1C1C', whiskyColor:'#1A1A1A', storeColor:'#1A1A1A' }) },
  { name: 'logo_white',
    ...buildVertical({ bgColor:'#1A1A1A', wineColor:'#FFFFFF', whiskyColor:'#FFFFFF', storeColor:'#FFFFFF' }) },
  { name: 'logo_black',
    ...buildVertical({ bgColor:'#FFFFFF', wineColor:'#1A1A1A', whiskyColor:'#1A1A1A', storeColor:'#1A1A1A' }) },
];

// ─── Transparent variants ─────────────────────────────────────────────────────

const transparentVariants = [
  // Square (vertical)
  { name: 'logo_sq_color_transparent', transparent: true,
    ...buildVertical({ bgColor:'transparent', wineColor:'#8C1C1C', whiskyColor:'#1A1A1A', storeColor:'#1A1A1A' }) },
  { name: 'logo_sq_black_transparent', transparent: true,
    ...buildVertical({ bgColor:'transparent', wineColor:'#1A1A1A', whiskyColor:'#1A1A1A', storeColor:'#1A1A1A' }) },
  // Horizontal (rectangular)
  { name: 'logo_color_transparent', transparent: true,
    ...buildHorizontal({ bgColor:'transparent', wineColor:'#8C1C1C', whiskyColor:'#1A1A1A', storeColor:'#1A1A1A' }) },
  { name: 'logo_black_transparent', transparent: true,
    ...buildHorizontal({ bgColor:'transparent', wineColor:'#1A1A1A', whiskyColor:'#1A1A1A', storeColor:'#1A1A1A' }) },
];

// ─── Render ───────────────────────────────────────────────────────────────────

for (const v of [...variants, ...transparentVariants]) {
  const htmlPath = join(OUT_DIR, `_tmp_${v.name}.html`);
  const pngPath  = join(OUT_DIR, `${v.name}.png`);

  writeFileSync(htmlPath, v.html);

  const headlessMode = v.transparent ? '--headless=old' : '--headless=new';
  const transparentFlag = v.transparent ? '--default-background-color=00000000' : '';

  try {
    execSync(
      `"${CHROME}" ${headlessMode} --disable-gpu --no-sandbox \
        --screenshot="${pngPath}" \
        --window-size=${v.width},${v.height} \
        --hide-scrollbars \
        --force-device-scale-factor=2 \
        ${transparentFlag} \
        "file://${htmlPath}"`,
      { stdio: 'pipe' }
    );
    console.log(`✓  ${v.name}.png  (${v.width}×${v.height} @2x)`);
  } catch (e) {
    console.error(`✗  ${v.name}: ${e.stderr?.toString().slice(0,200)}`);
  }

  unlinkSync(htmlPath);
}

console.log('\nDone → brand/logo/');
