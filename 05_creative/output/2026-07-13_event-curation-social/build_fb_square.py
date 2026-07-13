#!/usr/bin/env python3
"""Build the 'Planning Something?' Facebook square post (1080x1080).

Adaptation of the A3 event-curation poster. Self-contained HTML
(fonts + logo + QR embedded as base64) -> PNG via headless Google Chrome.
Light travertine brand style, subtle party decor.
"""
import base64
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

STAMP = "2026-07-13"
SLUG = "event-curation-fb-square"
HTML = HERE / f"{SLUG}_{STAMP}.html"
PNG = HERE / f"{SLUG}_{STAMP}.png"


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
html,body {{ width:1080px; height:1080px; }}
body {{
  font-family:'Inter',sans-serif; color:var(--black);
  -webkit-print-color-adjust:exact; print-color-adjust:exact; background:var(--white);
}}

.card {{
  position:relative; width:1080px; height:1080px; overflow:hidden;
  padding:66px 70px 60px; display:flex; flex-direction:column;
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

.head img {{ height:74px; width:auto; display:block; }}

.hero {{ margin-top:34px; }}
.hero h1 {{
  font-family:'Bebas Neue'; font-weight:400; color:var(--black);
  font-size:118px; line-height:.84; letter-spacing:.005em;
}}
.hero h1 .em {{ color:var(--wine); }}
.triggers {{
  margin-top:14px; font-family:'Inter'; font-weight:500;
  font-size:16px; letter-spacing:.09em; text-transform:uppercase; color:var(--graphite);
}}
.triggers .dot {{ color:var(--gold); margin:0 7px; font-weight:700; }}

.lede {{
  margin-top:44px; font-size:37px; line-height:1.08; color:var(--black);
  font-weight:700; letter-spacing:.005em;
}}
.lede .em {{ color:var(--wine); }}

.steps {{ margin-top:62px; display:flex; gap:0; }}
.step {{ flex:1; padding:0 20px; position:relative; }}
.step:first-child {{ padding-left:0; }}
.step + .step::before {{
  content:''; position:absolute; left:0; top:2px; bottom:2px; width:1px;
  background:linear-gradient(var(--stone), transparent);
}}
.step .n {{
  font-family:'Bebas Neue'; font-size:74px; line-height:.9; color:var(--wine);
}}
.step .t {{ margin-top:10px; font-size:19px; line-height:1.24; color:var(--black); font-weight:500; }}

.cta {{
  margin-top:auto; display:flex; align-items:center; gap:26px;
  background:var(--black); color:var(--white);
  border-radius:16px; padding:26px 30px;
  box-shadow:0 18px 40px rgba(26,26,26,.22);
}}
.cta .qrwrap {{ display:flex; flex-direction:column; align-items:center; }}
.cta .qr {{
  flex:0 0 auto; width:132px; height:132px; background:#fff; border-radius:11px;
  padding:9px; box-shadow:0 6px 16px rgba(0,0,0,.28);
}}
.cta .qr img {{ width:100%; height:100%; display:block; }}
.scan {{
  font-family:'Inter'; font-weight:500; font-size:11px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--gold); text-align:center; margin-top:9px; width:132px;
}}
.cta .msg {{ flex:1; }}
.cta .msg .lead {{ font-family:'Bebas Neue'; font-size:46px; line-height:.96; letter-spacing:.01em; }}
.cta .msg .lead .em {{ color:var(--gold); }}
.cta .msg .sub {{ margin-top:12px; font-size:17px; color:var(--stone); font-weight:500; }}
.cta .msg .wa {{
  margin-top:14px; display:inline-flex; align-items:center; gap:12px;
  font-family:'Bebas Neue'; font-size:42px; letter-spacing:.02em; color:#fff; text-decoration:none;
}}
.cta .msg .wa .badge {{
  font-family:'Inter'; font-weight:500; font-size:13px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--black); background:var(--gold);
  border-radius:6px; padding:6px 11px;
}}
</style>
</head>
<body>
<div class="card">

  <div class="decor" aria-hidden="true">
    <svg viewBox="0 0 1080 1080" preserveAspectRatio="xMidYMid slice">
      <g fill="none">
        <g>
          <ellipse cx="925" cy="150" rx="42" ry="52" fill="#8C1C1C" fill-opacity=".055" stroke="#8C1C1C" stroke-opacity=".30" stroke-width="2.4"/>
          <path d="M919 201 L931 201 L925 213 Z" fill="#8C1C1C" fill-opacity=".30"/>
          <path d="M925 213 q13 30 -3 55 q-12 22 5 48" stroke="#8C1C1C" stroke-opacity=".22" stroke-width="1.6"/>
        </g>
        <g>
          <ellipse cx="1000" cy="205" rx="33" ry="42" fill="#C9A84C" fill-opacity=".07" stroke="#C9A84C" stroke-opacity=".42" stroke-width="2.4"/>
          <path d="M995 246 L1005 246 L1000 257 Z" fill="#C9A84C" fill-opacity=".42"/>
          <path d="M1000 257 q11 26 -3 48 q-10 19 4 42" stroke="#C9A84C" stroke-opacity=".30" stroke-width="1.6"/>
        </g>
        <g>
          <ellipse cx="866" cy="228" rx="27" ry="35" fill="#3D3D3D" fill-opacity=".05" stroke="#3D3D3D" stroke-opacity=".24" stroke-width="2.2"/>
          <path d="M862 262 L870 262 L866 271 Z" fill="#3D3D3D" fill-opacity=".24"/>
          <path d="M866 271 q10 22 -3 42 q-9 16 3 36" stroke="#3D3D3D" stroke-opacity=".18" stroke-width="1.5"/>
        </g>
        <g>
          <ellipse cx="985" cy="560" rx="28" ry="35" fill="#8C1C1C" fill-opacity=".05" stroke="#8C1C1C" stroke-opacity=".24" stroke-width="2.2"/>
          <path d="M981 595 L989 595 L985 605 Z" fill="#8C1C1C" fill-opacity=".24"/>
          <path d="M985 605 q10 22 -3 42 q-8 16 3 36" stroke="#8C1C1C" stroke-opacity=".17" stroke-width="1.5"/>
        </g>
      </g>
      <g>
        <rect x="800" y="120" width="13" height="13" rx="2" fill="#C9A84C" fill-opacity=".34" transform="rotate(24 806 126)"/>
        <circle cx="1035" cy="330" r="5" fill="#8C1C1C" fill-opacity=".26"/>
        <path d="M1030 470 l10 4 l-4 10 Z" fill="#C9A84C" fill-opacity=".30"/>
        <circle cx="905" cy="400" r="5" fill="#3D3D3D" fill-opacity=".18"/>
        <rect x="1000" y="430" width="12" height="12" rx="2" fill="#8C1C1C" fill-opacity=".22" transform="rotate(-24 1006 436)"/>
        <circle cx="960" cy="690" r="5" fill="#C9A84C" fill-opacity=".28"/>
        <path d="M905 620 l9 4 l-4 9 Z" fill="#8C1C1C" fill-opacity=".22"/>
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

  <p class="lede">Custom selections for <span class="em">any occasion</span></p>

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

subprocess.run([
    CHROME, "--headless", "--disable-gpu", "--no-sandbox",
    "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=1080,1080", f"--screenshot={PNG}",
    f"file://{HTML}",
], check=True, capture_output=True)
print("PNG :", PNG)
