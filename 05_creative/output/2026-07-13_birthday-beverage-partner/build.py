#!/usr/bin/env python3
"""Build the 16 'Birthday Beverage-Partner' static ad creatives.

Data-driven renderer: for each angle x lang x format in COPY, emits a
self-contained HTML file (fonts + logo + QR embedded as base64) and
rasterizes it to PNG via headless Google Chrome. Adapted from the
event-curation-social build_fb_square.py / build_story.py brand pattern
(light travertine bg, soft shadows, brand-tint balloon/confetti decor,
no human faces, no bottles).

Font note: Bebas Neue has NO Cyrillic glyphs (verified: renders as tofu
boxes). RU headlines use Oswald 500 (uppercase), which the repo already
ships in both a latin and cyrillic subset for exactly this purpose.
EN headlines use Bebas Neue as usual.

Logo note: 04_brand/design-system.md (2026-05-26) deprecates the
logo_sq_color*/logo_black* wordmark PNG family — it bakes in an obsolete
"store" sub-label between WINE and & WHISKEY — and directs all new
material to the monogram lockups (channel_avatar_light/dark.png). This
script uses channel_avatar_light.png (current, no "store" artifact)
rather than the deprecated file the sibling event-curation scripts used.

Run from inside this folder so the local copy.py shadows any other
copy.py on sys.path:
    cd 05_creative/output/2026-07-13_birthday-beverage-partner
    python3 build.py
"""
import base64
import subprocess
from pathlib import Path

from copy import COPY

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

FORMATS = {"sq": (1080, 1080), "st": (1080, 1920)}
ANGLES = ["curate", "brief", "bulk", "delivered"]
LANGS = ["en", "ru"]


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


BEBAS = b64(ROOT / "04_brand/logo/fonts/BebasNeue.woff2")
OSWALD_LATIN = b64(ROOT / "04_brand/logo/fonts/Oswald500-latin.woff2")
OSWALD_CYRILLIC = b64(ROOT / "04_brand/logo/fonts/Oswald500-cyrillic.woff2")
INTER = b64(ROOT / "04_brand/logo/fonts/Inter500.woff2")
LOGO = b64(ROOT / "04_brand/logo/channel_avatar_light.png")

FONT_FACES = f"""
@font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{BEBAS}) format('woff2'); font-weight:400; font-display:block; }}
@font-face {{ font-family:'Oswald'; src:url(data:font/woff2;base64,{OSWALD_CYRILLIC}) format('woff2'); font-weight:500; font-display:block; unicode-range:U+0400-04FF,U+0500-052F; }}
@font-face {{ font-family:'Oswald'; src:url(data:font/woff2;base64,{OSWALD_LATIN}) format('woff2'); font-weight:500; font-display:block; }}
@font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{INTER}) format('woff2'); font-weight:500; font-display:block; }}
"""

WA_LABEL = {"en": "Message us", "ru": "Напишите нам"}

# Shared brand tokens + decor + base card chrome, split by format below.
BASE_CSS = """
:root {
  --wine:#8C1C1C; --black:#1A1A1A; --white:#F5F0EB; --cream:#EDE0D0;
  --gold:#C9A84C; --burgundy:#5C1010; --graphite:#3D3D3D; --stone:#D4C9BC;
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family:'Inter',sans-serif; color:var(--black);
  -webkit-print-color-adjust:exact; print-color-adjust:exact; background:var(--white);
}
.headline { text-transform:uppercase; letter-spacing:.01em; }
.headline.lang-en { font-family:'Bebas Neue'; font-weight:400; }
.headline.lang-ru { font-family:'Oswald'; font-weight:500; letter-spacing:.005em; line-height:1.16; }
"""

# Decor: brand-tint balloons + confetti dots, kept out of the safe zone
# (top logo area / bottom CTA strip). Same motif family as event-curation.
DECOR_SQ = """
<svg viewBox="0 0 1080 1080" preserveAspectRatio="xMidYMid slice">
  <g fill="none">
    <g>
      <ellipse cx="930" cy="150" rx="40" ry="50" fill="#8C1C1C" fill-opacity=".055" stroke="#8C1C1C" stroke-opacity=".28" stroke-width="2.2"/>
      <path d="M924 199 L936 199 L930 211 Z" fill="#8C1C1C" fill-opacity=".28"/>
      <path d="M930 211 q12 28 -3 52 q-11 21 4 45" stroke="#8C1C1C" stroke-opacity=".20" stroke-width="1.5"/>
    </g>
    <g>
      <ellipse cx="150" cy="130" rx="32" ry="41" fill="#C9A84C" fill-opacity=".08" stroke="#C9A84C" stroke-opacity=".40" stroke-width="2.2"/>
      <path d="M145 170 L155 170 L150 181 Z" fill="#C9A84C" fill-opacity=".40"/>
      <path d="M150 181 q11 25 -3 46 q-9 18 4 40" stroke="#C9A84C" stroke-opacity=".28" stroke-width="1.5"/>
    </g>
    <g>
      <ellipse cx="60" cy="880" rx="30" ry="38" fill="#3D3D3D" fill-opacity=".05" stroke="#3D3D3D" stroke-opacity=".22" stroke-width="2"/>
      <path d="M55 917 L65 917 L60 927 Z" fill="#3D3D3D" fill-opacity=".22"/>
      <path d="M60 927 q10 24 -3 45 q-9 17 3 38" stroke="#3D3D3D" stroke-opacity=".16" stroke-width="1.4"/>
    </g>
    <g>
      <ellipse cx="1010" cy="640" rx="26" ry="33" fill="#8C1C1C" fill-opacity=".05" stroke="#8C1C1C" stroke-opacity=".22" stroke-width="2"/>
      <path d="M1006 673 L1014 673 L1010 682 Z" fill="#8C1C1C" fill-opacity=".22"/>
      <path d="M1010 682 q9 21 -3 40 q-8 15 3 34" stroke="#8C1C1C" stroke-opacity=".16" stroke-width="1.4"/>
    </g>
  </g>
  <g>
    <rect x="820" y="240" width="12" height="12" rx="2" fill="#C9A84C" fill-opacity=".32" transform="rotate(22 826 246)"/>
    <circle cx="990" cy="330" r="5" fill="#8C1C1C" fill-opacity=".24"/>
    <path d="M120 360 l10 4 l-4 10 Z" fill="#C9A84C" fill-opacity=".30"/>
    <circle cx="945" cy="410" r="4.5" fill="#3D3D3D" fill-opacity=".18"/>
    <rect x="70" y="470" width="11" height="11" rx="2" fill="#8C1C1C" fill-opacity=".20" transform="rotate(-20 76 476)"/>
    <circle cx="140" cy="700" r="5" fill="#C9A84C" fill-opacity=".26"/>
    <path d="M960 760 l9 4 l-4 9 Z" fill="#8C1C1C" fill-opacity=".20"/>
    <circle cx="80" cy="620" r="4" fill="#C9A84C" fill-opacity=".24"/>
  </g>
</svg>
"""

DECOR_ST = """
<svg viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice">
  <g fill="none">
    <g>
      <ellipse cx="940" cy="330" rx="46" ry="58" fill="#8C1C1C" fill-opacity=".06" stroke="#8C1C1C" stroke-opacity=".28" stroke-width="2.4"/>
      <path d="M934 386 L946 386 L940 399 Z" fill="#8C1C1C" fill-opacity=".28"/>
      <path d="M940 399 q13 32 -3 58 q-12 24 4 50" stroke="#8C1C1C" stroke-opacity=".20" stroke-width="1.6"/>
    </g>
    <g>
      <ellipse cx="130" cy="290" rx="34" ry="43" fill="#C9A84C" fill-opacity=".08" stroke="#C9A84C" stroke-opacity=".40" stroke-width="2.2"/>
      <path d="M125 331 L135 331 L130 342 Z" fill="#C9A84C" fill-opacity=".40"/>
      <path d="M130 342 q11 26 -3 48 q-9 19 4 42" stroke="#C9A84C" stroke-opacity=".28" stroke-width="1.5"/>
    </g>
    <g>
      <ellipse cx="80" cy="1520" rx="32" ry="40" fill="#3D3D3D" fill-opacity=".05" stroke="#3D3D3D" stroke-opacity=".22" stroke-width="2.1"/>
      <path d="M75 1558 L85 1558 L80 1569 Z" fill="#3D3D3D" fill-opacity=".22"/>
      <path d="M80 1569 q10 25 -3 47 q-9 18 3 40" stroke="#3D3D3D" stroke-opacity=".16" stroke-width="1.5"/>
    </g>
    <g>
      <ellipse cx="1000" cy="1470" rx="28" ry="35" fill="#8C1C1C" fill-opacity=".05" stroke="#8C1C1C" stroke-opacity=".22" stroke-width="2"/>
      <path d="M996 1503 L1004 1503 L1000 1513 Z" fill="#8C1C1C" fill-opacity=".22"/>
      <path d="M1000 1513 q10 23 -3 43 q-8 17 3 37" stroke="#8C1C1C" stroke-opacity=".16" stroke-width="1.4"/>
    </g>
  </g>
  <g>
    <rect x="850" y="460" width="13" height="13" rx="2" fill="#C9A84C" fill-opacity=".32" transform="rotate(22 856 466)"/>
    <circle cx="1000" cy="600" r="5.5" fill="#8C1C1C" fill-opacity=".24"/>
    <path d="M110 620 l11 4 l-4 11 Z" fill="#C9A84C" fill-opacity=".30"/>
    <circle cx="960" cy="720" r="5" fill="#3D3D3D" fill-opacity=".18"/>
    <rect x="70" y="820" width="12" height="12" rx="2" fill="#8C1C1C" fill-opacity=".20" transform="rotate(-20 76 826)"/>
    <circle cx="130" cy="1180" r="5.5" fill="#C9A84C" fill-opacity=".26"/>
    <path d="M950 1300 l10 4 l-4 10 Z" fill="#8C1C1C" fill-opacity=".20"/>
    <circle cx="90" cy="1050" r="4.5" fill="#C9A84C" fill-opacity=".24"/>
  </g>
</svg>
"""


# ---- Phuket geo-cue: full-canvas island coastline (accurate, from Thailand
# provinces GeoJSON) behind the copy + a wine-red geopin labelled "Phuket". ----
PHUKET_D = (HERE / "assets/phuket_path.txt").read_text().strip()
PHUKET_VB = "0 0 300 725"  # real Phuket proportions (tall & narrow)
_PIN = (
    '<svg width="{w}" height="{h}" viewBox="0 0 24 32" style="display:block;'
    'filter:drop-shadow(0 3px 5px rgba(26,26,26,.28))">'
    '<path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" '
    'fill="#8C1C1C"/><circle cx="12" cy="11.5" r="4.3" fill="#F5F0EB"/></svg>'
)


def phuket_stamp(fmt: str) -> str:
    isl_h = 960 if fmt == "sq" else 1620
    isl_w = round(isl_h * 300 / 725)
    island = (
        f'<div style="position:absolute;z-index:0;left:50%;top:50%;'
        f'transform:translate(-50%,-50%);pointer-events:none;">'
        f'<svg viewBox="{PHUKET_VB}" width="{isl_w}" height="{isl_h}" '
        f'preserveAspectRatio="xMidYMid meet" style="display:block">'
        f'<path d="{PHUKET_D}" fill="rgba(140,28,28,0.05)" '
        f'stroke="rgba(140,28,28,0.32)" stroke-width="2" stroke-linejoin="round"/></svg></div>'
    )
    pw, ph = (30, 40) if fmt == "sq" else (36, 48)
    lab = 30 if fmt == "sq" else 36
    top = 250 if fmt == "sq" else 372
    pin = (
        f'<div style="position:absolute;z-index:1;top:{top}px;left:50%;'
        f'transform:translateX(-50%);display:flex;align-items:center;gap:12px;'
        f'pointer-events:none;">{_PIN.format(w=pw, h=ph)}'
        f'<span style="font-family:\'DM Sans\',\'Inter\',sans-serif;font-weight:600;'
        f'font-size:{lab}px;color:#8C1C1C;letter-spacing:.01em;">Phuket</span></div>'
    )
    return island + pin


def render_html(angle: str, lang: str, fmt: str) -> str:
    """Build the full self-contained HTML for one angle/lang/format combo."""
    entry = COPY[angle][lang]
    headline = entry["headline"]
    sub = entry["sub"]
    w, h = FORMATS[fmt]
    wa_label = WA_LABEL[lang]

    if fmt == "sq":
        card_css = f"""
html,body {{ width:{w}px; height:{h}px; }}
.card {{
  position:relative; width:{w}px; height:{h}px; overflow:hidden;
  padding:72px 84px 56px; display:flex; flex-direction:column; align-items:center;
  background:
    radial-gradient(120% 80% at 12% 8%, rgba(237,224,208,.55), transparent 55%),
    radial-gradient(130% 90% at 92% 30%, rgba(212,201,188,.40), transparent 50%),
    radial-gradient(120% 100% at 50% 108%, rgba(212,201,188,.55), transparent 60%),
    linear-gradient(160deg, #F7F3EE 0%, #F1EAE0 60%, #EADFD1 100%);
}}
.card::before {{
  content:''; position:absolute; inset:0; pointer-events:none; opacity:.05;
  background-image:
    repeating-linear-gradient(115deg, rgba(61,61,61,.5) 0 1px, transparent 1px 26px),
    repeating-linear-gradient(28deg, rgba(61,61,61,.35) 0 1px, transparent 1px 34px);
  mix-blend-mode:multiply;
}}
.card > * {{ position:relative; z-index:1; }}
.decor {{ position:absolute; inset:0; z-index:0; pointer-events:none; }}
.decor svg {{ width:100%; height:100%; display:block; }}

.head {{ flex:0 0 auto; }}
.head img {{ height:112px; width:112px; display:block; border-radius:20px;
  box-shadow:0 10px 26px rgba(26,26,26,.16); }}

.copy {{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; max-width:900px; margin:0 auto; }}
.headline {{ font-size:104px; line-height:.98; color:var(--black); }}
.headline .em {{ color:var(--wine); }}
.subline {{ margin-top:30px; font-size:34px; line-height:1.28; color:var(--graphite);
  font-weight:500; max-width:760px; }}

.cta {{
  flex:0 0 auto; align-self:center; display:inline-flex; align-items:center; gap:16px;
  background:var(--black); color:var(--white);
  border-radius:999px; padding:24px 52px;
  font-family:'Inter'; font-weight:600; font-size:30px; letter-spacing:.05em;
  text-transform:uppercase; box-shadow:0 18px 40px rgba(26,26,26,.22);
}}
.cta .arrow {{ color:var(--gold); font-weight:700; }}
"""
        body = f"""
<div class="card">
  <div class="decor" aria-hidden="true">{DECOR_SQ}</div>
  <div class="head"><img src="data:image/png;base64,{LOGO}" alt="Wine &amp; Whiskey"></div>
  <div class="copy">
    <h1 class="headline lang-{lang}">{headline}</h1>
    <p class="subline">{sub}</p>
  </div>
  <div class="cta"><span class="label">{wa_label}</span><span class="arrow">&rarr;</span></div>
</div>
"""
    else:  # story
        card_css = f"""
html,body {{ width:{w}px; height:{h}px; }}
.card {{
  position:relative; width:{w}px; height:{h}px; overflow:hidden;
  padding:230px 96px 300px; display:flex; flex-direction:column; align-items:center;
  background:
    radial-gradient(120% 60% at 12% 6%, rgba(237,224,208,.55), transparent 55%),
    radial-gradient(130% 50% at 92% 22%, rgba(212,201,188,.40), transparent 50%),
    radial-gradient(120% 60% at 50% 104%, rgba(212,201,188,.55), transparent 60%),
    linear-gradient(165deg, #F7F3EE 0%, #F1EAE0 55%, #EADFD1 100%);
}}
.card::before {{
  content:''; position:absolute; inset:0; pointer-events:none; opacity:.045;
  background-image:
    repeating-linear-gradient(115deg, rgba(61,61,61,.5) 0 1px, transparent 1px 26px),
    repeating-linear-gradient(28deg, rgba(61,61,61,.35) 0 1px, transparent 1px 34px);
  mix-blend-mode:multiply;
}}
.card > * {{ position:relative; z-index:1; }}
.decor {{ position:absolute; inset:0; z-index:0; pointer-events:none; }}
.decor svg {{ width:100%; height:100%; display:block; }}

.head {{ flex:0 0 auto; }}
.head img {{ height:140px; width:140px; display:block; border-radius:24px;
  box-shadow:0 12px 30px rgba(26,26,26,.18); }}

.copy {{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; max-width:880px; margin:0 auto; }}
.headline {{ font-size:112px; line-height:1.0; color:var(--black); }}
.headline .em {{ color:var(--wine); }}
.subline {{ margin-top:36px; font-size:40px; line-height:1.3; color:var(--graphite);
  font-weight:500; max-width:760px; }}

.cta {{
  position:absolute; left:0; right:0; bottom:280px; margin:0 auto; width:max-content;
  display:inline-flex; align-items:center; gap:20px;
  background:var(--black); color:var(--white);
  border-radius:999px; padding:32px 68px;
  font-family:'Inter'; font-weight:600; font-size:42px; letter-spacing:.05em;
  text-transform:uppercase; box-shadow:0 22px 50px rgba(26,26,26,.28);
}}
.cta .arrow {{ color:var(--gold); font-weight:700; }}
"""
        body = f"""
<div class="card">
  <div class="decor" aria-hidden="true">{DECOR_ST}</div>
  <div class="head"><img src="data:image/png;base64,{LOGO}" alt="Wine &amp; Whiskey"></div>
  <div class="copy">
    <h1 class="headline lang-{lang}">{headline}</h1>
    <p class="subline">{sub}</p>
  </div>
  <div class="cta"><span class="label">{wa_label}</span><span class="arrow">&rarr;</span></div>
</div>
"""

    body = body.replace(
        '<div class="decor" aria-hidden="true">',
        phuket_stamp(fmt) + '<div class="decor" aria-hidden="true">',
        1,
    )

    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{headline} — Wine &amp; Whiskey</title>
<style>
{FONT_FACES}
{BASE_CSS}
{card_css}
</style>
</head>
<body>
{body}
</body>
</html>
"""


def render_png(html_path: Path, png_path: Path, w: int, h: int) -> None:
    subprocess.run([
        CHROME, "--headless", "--disable-gpu", "--no-sandbox",
        "--hide-scrollbars", "--force-device-scale-factor=1",
        f"--window-size={w},{h}", f"--screenshot={png_path}",
        f"file://{html_path}",
    ], check=True, capture_output=True)


def main() -> None:
    count = 0
    for angle in ANGLES:
        for lang in LANGS:
            for fmt, (w, h) in FORMATS.items():
                slug = f"bd_{angle}_{lang}_{fmt}_v01"
                html_path = HERE / f"{slug}.html"
                png_path = HERE / f"{slug}.png"
                html = render_html(angle, lang, fmt)
                html_path.write_text(html, encoding="utf-8")
                render_png(html_path, png_path, w, h)
                print("PNG:", png_path.name)
                count += 1
    print(f"total {count} PNGs")


if __name__ == "__main__":
    main()
