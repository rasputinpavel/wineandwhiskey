#!/usr/bin/env python3
"""Build the 'Planning Something?' A3 event-curation poster.

Self-contained HTML (fonts + logo + QR embedded as base64) → A3 PDF + preview PNG
via headless Google Chrome. Light travertine brand style.
"""
import base64
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

STAMP = "2026-07-07"
SLUG = "event-curation-poster"
HTML = HERE / f"{SLUG}_{STAMP}.html"
PDF = HERE / f"{SLUG}_{STAMP}.pdf"
PNG = HERE / f"{SLUG}_{STAMP}_preview.png"


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


bebas = b64(ROOT / "04_brand/logo/fonts/BebasNeue.woff2")
inter = b64(ROOT / "04_brand/logo/fonts/Inter500.woff2")
logo = b64(ROOT / "04_brand/logo/logo_sq_color_transparent.png")
qr = b64(HERE / "assets/wa_qr.png")

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Planning Something? — Wine &amp; Whiskey</title>
<style>
@font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{bebas}) format('woff2'); font-weight:400; font-display:block; }}
@font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{inter}) format('woff2'); font-weight:500; font-display:block; }}

:root {{
  --wine:#8C1C1C; --black:#1A1A1A; --white:#F5F0EB; --cream:#EDE0D0;
  --gold:#C9A84C; --burgundy:#5C1010; --graphite:#3D3D3D; --stone:#D4C9BC;
}}
* {{ margin:0; padding:0; box-sizing:border-box; }}

@page {{ size:297mm 420mm; margin:0; }}
html,body {{ width:297mm; height:420mm; }}

body {{
  font-family:'Inter',sans-serif; color:var(--black);
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
  background:var(--white);
}}

.poster {{
  position:relative; width:297mm; height:420mm; overflow:hidden;
  padding:24mm 22mm 20mm;
  display:flex; flex-direction:column;
  /* travertine: warm-white base with soft stone mottling */
  background:
    radial-gradient(120% 80% at 12% 8%, rgba(237,224,208,.55), transparent 55%),
    radial-gradient(130% 90% at 92% 30%, rgba(212,201,188,.40), transparent 50%),
    radial-gradient(120% 100% at 50% 108%, rgba(212,201,188,.55), transparent 60%),
    linear-gradient(160deg, #F7F3EE 0%, #F1EAE0 60%, #EADFD1 100%);
}}
/* faint stone grain */
.poster::before {{
  content:''; position:absolute; inset:0; pointer-events:none; opacity:.05;
  background-image:
    repeating-linear-gradient(115deg, rgba(61,61,61,.5) 0 1px, transparent 1px 26px),
    repeating-linear-gradient(28deg, rgba(61,61,61,.35) 0 1px, transparent 1px 34px);
  mix-blend-mode:multiply;
}}
.poster > * {{ position:relative; z-index:1; }}

/* ---- party decor (subtle line-art watermark) ---- */
.decor {{ position:absolute; inset:0; z-index:0; pointer-events:none; }}
.decor svg {{ width:100%; height:100%; display:block; }}

/* ---- header ---- */
.head {{ display:flex; align-items:center; gap:26px; }}
.head img {{ height:104px; width:auto; }}
.head .kicker {{
  font-family:'Inter'; font-weight:500; font-size:15px; letter-spacing:.40em;
  text-transform:uppercase; color:var(--graphite);
}}

/* ---- hero ---- */
.hero {{ margin-top:22mm; }}
.hero h1 {{
  font-family:'Bebas Neue'; font-weight:400; color:var(--black);
  font-size:162px; line-height:.85; letter-spacing:.005em;
}}
.hero h1 .em {{ color:var(--wine); }}
.triggers {{
  margin-top:14px; font-family:'Inter'; font-weight:500;
  font-size:20px; letter-spacing:.10em; text-transform:uppercase; color:var(--graphite);
}}
.triggers .dot {{ color:var(--gold); margin:0 9px; font-weight:700; }}

/* ---- body ---- */
.lede {{
  margin-top:18mm; max-width:220mm;
  font-size:50px; line-height:1.1; color:var(--black); font-weight:700; letter-spacing:.005em;
}}
.lede .em {{ color:var(--wine); font-weight:700; }}

/* ---- steps ---- */
.steps {{ margin-top:30mm; margin-bottom:14mm; display:flex; gap:0; }}
.step {{
  flex:1; padding:0 26px; position:relative;
}}
.step + .step::before {{
  content:''; position:absolute; left:0; top:4px; bottom:4px; width:1px;
  background:linear-gradient(var(--stone), transparent);
}}
.step .n {{
  font-family:'Bebas Neue'; font-size:120px; line-height:.9; color:var(--wine);
}}
.step .t {{ margin-top:14px; font-size:27px; line-height:1.24; color:var(--black); font-weight:500; }}

/* ---- CTA ---- */
.cta {{
  margin-top:auto; display:flex; align-items:center; gap:34px;
  background:var(--black); color:var(--white);
  border-radius:16px; padding:38px 42px;
  box-shadow:0 18px 40px rgba(26,26,26,.22);
}}
.cta .qr {{
  flex:0 0 auto; width:190px; height:190px; background:#fff; border-radius:12px;
  padding:11px; box-shadow:0 6px 16px rgba(0,0,0,.28);
}}
.cta .qr img {{ width:100%; height:100%; display:block; }}
.cta .msg {{ flex:1; }}
.cta .msg .lead {{
  font-family:'Bebas Neue'; font-size:64px; line-height:.96; letter-spacing:.01em;
}}
.cta .msg .lead .em {{ color:var(--gold); }}
.cta .msg .sub {{ margin-top:14px; font-size:22px; color:var(--stone); font-weight:500; }}
.cta .msg .wa {{
  margin-top:18px; display:inline-flex; align-items:center; gap:14px;
  font-family:'Bebas Neue'; font-size:56px; letter-spacing:.02em; color:#fff; text-decoration:none;
}}
.cta .msg .wa .badge {{
  font-family:'Inter'; font-weight:500; font-size:16px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--black); background:var(--gold);
  border-radius:7px; padding:7px 13px;
}}
.scan {{
  font-family:'Inter'; font-weight:500; font-size:14px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--gold); text-align:center;
  margin-top:11px; width:190px;
}}
.qrwrap {{ display:flex; flex-direction:column; align-items:center; }}
</style>
</head>
<body>
<div class="poster">

  <div class="decor" aria-hidden="true">
    <svg viewBox="0 0 1000 1414" preserveAspectRatio="xMidYMid slice">
      <!-- balloons: stroke-only line-art with faint fill -->
      <g fill="none">
        <!-- top-right cluster -->
        <g>
          <ellipse cx="855" cy="172" rx="42" ry="52" fill="#8C1C1C" fill-opacity=".055" stroke="#8C1C1C" stroke-opacity=".30" stroke-width="2.4"/>
          <path d="M849 223 L861 223 L855 235 Z" fill="#8C1C1C" fill-opacity=".30"/>
          <path d="M855 235 q13 30 -3 55 q-12 22 5 48" stroke="#8C1C1C" stroke-opacity=".22" stroke-width="1.6"/>
        </g>
        <g>
          <ellipse cx="930" cy="230" rx="34" ry="43" fill="#C9A84C" fill-opacity=".07" stroke="#C9A84C" stroke-opacity=".42" stroke-width="2.4"/>
          <path d="M925 272 L935 272 L930 283 Z" fill="#C9A84C" fill-opacity=".42"/>
          <path d="M930 283 q11 26 -3 48 q-10 19 4 42" stroke="#C9A84C" stroke-opacity=".30" stroke-width="1.6"/>
        </g>
        <g>
          <ellipse cx="792" cy="258" rx="28" ry="36" fill="#3D3D3D" fill-opacity=".05" stroke="#3D3D3D" stroke-opacity=".24" stroke-width="2.2"/>
          <path d="M788 293 L796 293 L792 302 Z" fill="#3D3D3D" fill-opacity=".24"/>
          <path d="M792 302 q10 22 -3 42 q-9 16 3 36" stroke="#3D3D3D" stroke-opacity=".18" stroke-width="1.5"/>
        </g>
        <!-- mid-right pair -->
        <g>
          <ellipse cx="905" cy="605" rx="31" ry="39" fill="#8C1C1C" fill-opacity=".055" stroke="#8C1C1C" stroke-opacity=".28" stroke-width="2.3"/>
          <path d="M900 643 L910 643 L905 654 Z" fill="#8C1C1C" fill-opacity=".28"/>
          <path d="M905 654 q11 24 -3 45 q-9 17 4 38" stroke="#8C1C1C" stroke-opacity=".20" stroke-width="1.5"/>
        </g>
        <g>
          <ellipse cx="952" cy="638" rx="23" ry="29" fill="#C9A84C" fill-opacity=".07" stroke="#C9A84C" stroke-opacity=".40" stroke-width="2.2"/>
          <path d="M948 666 L956 666 L952 675 Z" fill="#C9A84C" fill-opacity=".40"/>
          <path d="M952 675 q9 20 -3 38 q-8 14 3 32" stroke="#C9A84C" stroke-opacity=".28" stroke-width="1.5"/>
        </g>
        <!-- lower-right pair (above CTA) -->
        <g>
          <ellipse cx="905" cy="995" rx="30" ry="38" fill="#8C1C1C" fill-opacity=".05" stroke="#8C1C1C" stroke-opacity=".26" stroke-width="2.3"/>
          <path d="M900 1032 L910 1032 L905 1043 Z" fill="#8C1C1C" fill-opacity=".26"/>
          <path d="M905 1043 q11 22 -3 42 q-9 16 4 35" stroke="#8C1C1C" stroke-opacity=".18" stroke-width="1.5"/>
        </g>
        <g>
          <ellipse cx="950" cy="1028" rx="22" ry="28" fill="#C9A84C" fill-opacity=".065" stroke="#C9A84C" stroke-opacity=".36" stroke-width="2.1"/>
          <path d="M946 1055 L954 1055 L950 1064 Z" fill="#C9A84C" fill-opacity=".36"/>
          <path d="M950 1064 q9 18 -3 35 q-7 13 3 30" stroke="#C9A84C" stroke-opacity=".26" stroke-width="1.4"/>
        </g>
      </g>

      <!-- confetti: scattered small shapes -->
      <g>
        <rect x="720" y="120" width="13" height="13" rx="2" fill="#C9A84C" fill-opacity=".34" transform="rotate(24 726 126)"/>
        <circle cx="770" cy="430" r="5" fill="#8C1C1C" fill-opacity=".28"/>
        <rect x="700" y="360" width="11" height="11" rx="2" fill="#3D3D3D" fill-opacity=".20" transform="rotate(-18 705 365)"/>
        <path d="M960 340 l10 4 l-4 10 Z" fill="#8C1C1C" fill-opacity=".26"/>
        <circle cx="880" cy="430" r="6" fill="#C9A84C" fill-opacity=".34"/>
        <rect x="620" y="500" width="12" height="12" rx="2" fill="#C9A84C" fill-opacity=".28" transform="rotate(40 626 506)"/>
        <circle cx="985" cy="520" r="5" fill="#3D3D3D" fill-opacity=".18"/>
        <path d="M690 700 l10 4 l-4 10 Z" fill="#C9A84C" fill-opacity=".30"/>
        <circle cx="820" cy="760" r="5" fill="#8C1C1C" fill-opacity=".24"/>
        <rect x="930" y="770" width="12" height="12" rx="2" fill="#3D3D3D" fill-opacity=".16" transform="rotate(-30 936 776)"/>
        <circle cx="640" cy="900" r="6" fill="#C9A84C" fill-opacity=".28"/>
        <rect x="770" y="880" width="11" height="11" rx="2" fill="#8C1C1C" fill-opacity=".22" transform="rotate(20 775 885)"/>
        <path d="M985 900 l9 4 l-4 9 Z" fill="#C9A84C" fill-opacity=".28"/>
        <circle cx="700" cy="1050" r="5" fill="#3D3D3D" fill-opacity=".16"/>
        <rect x="820" y="1080" width="12" height="12" rx="2" fill="#C9A84C" fill-opacity=".26" transform="rotate(-22 826 1086)"/>
        <circle cx="590" cy="640" r="5" fill="#8C1C1C" fill-opacity=".20"/>
      </g>
    </svg>
  </div>

  <div class="head">
    <img src="data:image/png;base64,{logo}" alt="Wine &amp; Whiskey">
  </div>

  <div class="hero">
    <h1>PLANNING<br>SOMETHING<span class="em">?</span></h1>
    <div class="triggers">
      Birthday<span class="dot">·</span>House party<span class="dot">·</span>Sunday roast<span class="dot">·</span>BBQ<span class="dot">·</span>Friends over
    </div>
  </div>

  <p class="lede">
    Custom selections for <span class="em">any occasion</span>
  </p>

  <div class="steps">
    <div class="step"><div class="n">1</div><div class="t">Tell us the occasion &amp; date</div></div>
    <div class="step"><div class="n">2</div><div class="t">We suggest the best options</div></div>
    <div class="step"><div class="n">3</div><div class="t">Special price on volume — sorted</div></div>
  </div>

  <div class="cta">
    <div class="qrwrap">
      <div class="qr"><img src="data:image/png;base64,{qr}" alt="WhatsApp QR"></div>
      <div class="scan">Scan to chat</div>
    </div>
    <div class="msg">
      <div class="lead">MESSAGE US <span class="em">ON WHATSAPP</span></div>
      <div class="sub">Tell us what's coming up. We'll take care of the rest.</div>
      <a class="wa" href="https://wa.me/66809020550"><span class="badge">WhatsApp</span> +66 80 902 0550</a>
    </div>
  </div>

</div>
</body>
</html>
"""

HTML.write_text(html, encoding="utf-8")
print("HTML:", HTML)

# ---- render A3 PDF ----
subprocess.run([
    CHROME, "--headless", "--disable-gpu", "--no-sandbox",
    "--no-pdf-header-footer", f"--print-to-pdf={PDF}",
    f"file://{HTML}",
], check=True, capture_output=True)
print("PDF :", PDF)

# ---- render preview PNG (A3 @ ~2x) ----
subprocess.run([
    CHROME, "--headless", "--disable-gpu", "--no-sandbox",
    "--hide-scrollbars", "--force-device-scale-factor=2",
    "--window-size=1123,1587", f"--screenshot={PNG}",
    f"file://{HTML}",
], check=True, capture_output=True)
print("PNG :", PNG)
