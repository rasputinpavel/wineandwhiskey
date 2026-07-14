#!/usr/bin/env python3
"""Animate the two strongest 'Birthday Beverage-Partner' angles into looping
Story MP4s (curate + delivered, EN/RU — 4 videos total).

Adapts the STATIC story layout from build.py (travertine bg, monogram logo,
Bebas/Oswald headline, black CTA strip with WA QR — unchanged, matched
exactly) and the ANIMATION engineering pattern from the sibling
event-curation build_story.py: every frame is a pure function of a time
value passed via ?t=<seconds>, rendered with headless Chrome, then stitched
into a seamless 8s-loop MP4 with ffmpeg.

Motion (subtle, premium — not gimmicky):
  - Rising balloons in brand tints (verbatim from build_story.py — already
    tuned, fully periodic over the loop period so they never jump at the
    seam).
  - Gentle confetti drift, top-to-bottom, brand-tint dots/chips kept in the
    outer margins (same X columns as build.py's static DECOR_ST accents) so
    they never cross the headline — also fully periodic.
  - Headline + subline fade up once at the start of the loop and then hold
    at full opacity for the rest of the 8s. This is intentionally NOT
    periodic: a Story ad is watched once per impression, and a headline
    that faded back out before the loop seam would hide the sell for the
    last second of a normal view. The ambient background (balloons,
    confetti) is what carries the seamless-loop illusion if a viewer lingers
    past 8s; the headline entrance is a one-time "reveal" like build_story's
    own poster-frame convention.

Usage:
  python3 build_anim.py                 # render all 4 MP4s (+ poster stills)
  python3 build_anim.py --still curate en 2.0   # one preview frame @ t=2.0s
"""
import argparse
import base64
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from copy import COPY

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCRATCH = Path("/private/tmp/claude-501/-Users-pavelrasputin-Desktop-Wine-Whiskey/"
               "761447ce-319b-499c-8012-a0fb77ba47cd/scratchpad")
# One persistent Chrome drives every frame via puppeteer-core (no per-frame cold
# starts). PUPPET holds node_modules/puppeteer-core + render_anim.mjs. Mirrors the
# event-curation build_story.py approach; requires a local puppeteer-core install.
PUPPET = SCRATCH / "puppet"
MJS = PUPPET / "render_anim.mjs"

TARGETS = [("curate", "en"), ("curate", "ru"), ("delivered", "en"), ("delivered", "ru")]
DURATION = 8.0   # seconds (seamless-loop background motion)
FPS = 25
W, H = 1080, 1920
WORKERS = 8


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
# Clarifying tagline so a glanceable Story reads as "birthday drinks", not just a logo.
TAGLINE = {
    "en": "Birthday drinks · curated &amp; delivered",
    "ru": "Напитки на праздник · подберём и привезём",
}

# --- shared brand tokens, verbatim from build.py -----------------------
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
.headline { text-transform:uppercase; letter-spacing:.01em; will-change:opacity,transform; }
.headline.lang-en { font-family:'Bebas Neue'; font-weight:400; }
.headline.lang-ru { font-family:'Oswald'; font-weight:500; letter-spacing:.005em; line-height:1.16; }
.subline { will-change:opacity,transform; }
"""

# Static background accents (balloon outlines + confetti dots), unchanged
# from build.py's DECOR_ST — kept as a faint backdrop under the animated
# canvas layer for depth.
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
</svg>
"""

# --- story card css, verbatim from build.py's "st" branch --------------
CARD_CSS = f"""
html,body {{ width:{W}px; height:{H}px; }}
.card {{
  position:relative; width:{W}px; height:{H}px; overflow:hidden;
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
#fx {{ position:absolute; inset:0; z-index:0; pointer-events:none; }}

.head {{ flex:0 0 auto; }}
.head img {{ height:140px; width:140px; display:block; border-radius:24px;
  box-shadow:0 12px 30px rgba(26,26,26,.18); }}

.copy {{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; max-width:880px; margin:0 auto; }}
.headline {{ font-size:112px; line-height:1.0; color:var(--black); }}
.headline .em {{ color:var(--wine); }}
.subline {{ margin-top:36px; font-size:40px; line-height:1.3; color:var(--graphite);
  font-weight:500; max-width:760px; }}

.tagline {{ flex:0 0 auto; margin-top:26px; font-family:'Inter'; font-weight:600;
  font-size:25px; letter-spacing:.13em; text-transform:uppercase; color:var(--wine);
  text-align:center; max-width:840px; line-height:1.35; }}

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


# ---- Phuket geo-cue: full-canvas island coastline behind the copy + geopin. ----
PHUKET_D = (HERE / "assets/phuket_path.txt").read_text().strip()
PHUKET_VB = "0 0 300 725"
_PIN = (
    '<svg width="36" height="48" viewBox="0 0 24 32" style="display:block;'
    'filter:drop-shadow(0 3px 5px rgba(26,26,26,.28))">'
    '<path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" '
    'fill="#8C1C1C"/><circle cx="12" cy="11.5" r="4.3" fill="#F5F0EB"/></svg>'
)


def phuket_stamp() -> str:
    isl_h = 1620
    isl_w = round(isl_h * 300 / 725)
    island = (
        f'<div style="position:absolute;z-index:0;left:50%;top:50%;'
        f'transform:translate(-50%,-50%);pointer-events:none;">'
        f'<svg viewBox="{PHUKET_VB}" width="{isl_w}" height="{isl_h}" '
        f'preserveAspectRatio="xMidYMid meet" style="display:block">'
        f'<path d="{PHUKET_D}" fill="rgba(140,28,28,0.05)" '
        f'stroke="rgba(140,28,28,0.32)" stroke-width="2" stroke-linejoin="round"/></svg></div>'
    )
    # Sit the pin below the tagline (which lives right under the logo on video),
    # in the empty band on the island body before the headline.
    pin = (
        f'<div style="position:absolute;z-index:1;top:512px;left:50%;'
        f'transform:translateX(-50%);display:flex;align-items:center;gap:12px;'
        f'pointer-events:none;">{_PIN}'
        f'<span style="font-family:\'DM Sans\',\'Inter\',sans-serif;font-weight:600;'
        f'font-size:36px;color:#8C1C1C;letter-spacing:.01em;">Phuket</span></div>'
    )
    return island + pin


def render_html(angle: str, lang: str) -> str:
    entry = COPY[angle][lang]
    headline = entry["headline"]
    sub = entry["sub"]
    wa_label = WA_LABEL[lang]
    tagline = TAGLINE[lang]
    phuket = phuket_stamp()

    body = f"""
<div class="card">
  {phuket}<div class="decor" aria-hidden="true">{DECOR_ST}</div>
  <canvas id="fx" width="{W}" height="{H}"></canvas>
  <div class="head"><img src="data:image/png;base64,{LOGO}" alt="Wine &amp; Whiskey"></div>
  <div class="tagline">{tagline}</div>
  <div class="copy">
    <h1 class="headline lang-{lang}" id="headline">{headline}</h1>
    <p class="subline" id="subline">{sub}</p>
  </div>
  <div class="cta"><span class="label">{wa_label}</span><span class="arrow">&rarr;</span></div>
</div>
"""

    script = f"""
<script>
const W={W}, H={H}, D={DURATION};
const TAU = Math.PI*2;
const COL = {{ wine:'#8C1C1C', gold:'#C9A84C', burg:'#5C1010', graph:'#7A7268' }};
const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');

// ---- balloons: rising, same cycle (=D) so the loop is seamless ----
// (verbatim tuning from the event-curation build_story.py reference)
const BALLOONS = [
  {{x:150, c:'wine',  r:48, off:0.05, amp:26, sway:1}},
  {{x:900, c:'gold',  r:42, off:0.33, amp:30, sway:1}},
  {{x:520, c:'burg',  r:54, off:0.61, amp:22, sway:1}},
  {{x:300, c:'gold',  r:34, off:0.82, amp:34, sway:2}},
  {{x:740, c:'wine',  r:46, off:0.16, amp:20, sway:1}},
  {{x:1000,c:'graph', r:30, off:0.47, amp:24, sway:2}},
  {{x:60,  c:'gold',  r:32, off:0.72, amp:28, sway:1}},
  {{x:650, c:'wine',  r:38, off:0.90, amp:30, sway:1}},
  {{x:430, c:'gold',  r:28, off:0.25, amp:26, sway:2}},
];
const TRAVEL = H + 420;
const START  = H + 150;

function balloon(x, y, r, hex, a) {{
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.ellipse(x, y, r*0.82, r, 0, 0, TAU);
  ctx.fillStyle = hex; ctx.globalAlpha = a*0.42; ctx.fill();
  ctx.globalAlpha = a*0.85; ctx.lineWidth = 3; ctx.strokeStyle = hex; ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x - r*0.28, y - r*0.34, r*0.20, r*0.30, -0.5, 0, TAU);
  ctx.fillStyle = '#ffffff'; ctx.globalAlpha = a*0.30; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x-6, y+r); ctx.lineTo(x+6, y+r); ctx.lineTo(x, y+r+12); ctx.closePath();
  ctx.fillStyle = hex; ctx.globalAlpha = a*0.85; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y+r+12);
  ctx.quadraticCurveTo(x+16, y+r+60, x-6, y+r+108);
  ctx.quadraticCurveTo(x-22, y+r+150, x+8, y+r+190);
  ctx.globalAlpha = a*0.5; ctx.lineWidth = 1.6; ctx.strokeStyle = hex; ctx.stroke();
  ctx.restore();
}}

function drawBalloons(t) {{
  for (const b of BALLOONS) {{
    let ph = ((t/D) + b.off) % 1;
    const y = START - ph*TRAVEL;
    const x = b.x + Math.sin(ph*TAU*b.sway) * b.amp;
    let a = 0.55;
    if (ph < 0.08) a *= ph/0.08;
    if (ph > 0.90) a *= (1-ph)/0.10;
    if (a <= 0.01) continue;
    balloon(x, y, b.r, COL[b.c], a);
  }}
}}

// ---- confetti: gentle top-to-bottom drift, kept to the outer margins
// (same X columns as the static DECOR_ST accents) so it never crosses the
// centered headline/subline text. Fully periodic over D -> seamless.
const CONFETTI = [
  {{x:945, c:'gold', s:13, off:0.02, sway:20, spin:1.4, shape:'sq'}},
  {{x:1005,c:'wine', s:9,  off:0.19, sway:16, spin:-1.1,shape:'ci'}},
  {{x:60,  c:'gold', s:11, off:0.38, sway:22, spin:1.0, shape:'tr'}},
  {{x:120, c:'graph',s:8,  off:0.55, sway:18, spin:-1.3,shape:'ci'}},
  {{x:990, c:'burg', s:10, off:0.71, amp:0, sway:24, spin:1.2, shape:'sq'}},
  {{x:85,  c:'wine', s:9,  off:0.86, sway:20, spin:-0.9,shape:'sq'}},
  {{x:965, c:'graph',s:7,  off:0.10, sway:14, spin:1.6, shape:'ci'}},
  {{x:100, c:'gold', s:12, off:0.63, sway:26, spin:-1.5,shape:'tr'}},
  {{x:1020,c:'wine', s:8,  off:0.44, sway:18, spin:1.1, shape:'ci'}},
  {{x:50,  c:'burg', s:10, off:0.27, sway:20, spin:-1.2,shape:'sq'}},
];
const CTRAVEL = H + 300;
const CSTART  = -150;

function confetto(x, y, s, hex, rot, a, shape) {{
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = a;
  ctx.fillStyle = hex;
  if (shape === 'sq') {{
    ctx.fillRect(-s/2, -s/2, s, s);
  }} else if (shape === 'ci') {{
    ctx.beginPath(); ctx.arc(0, 0, s/2, 0, TAU); ctx.fill();
  }} else {{
    ctx.beginPath();
    ctx.moveTo(0, -s/2); ctx.lineTo(s/2, s/2); ctx.lineTo(-s/2, s/2); ctx.closePath();
    ctx.fill();
  }}
  ctx.restore();
}}

function drawConfetti(t) {{
  for (const p of CONFETTI) {{
    let ph = ((t/D) + p.off) % 1;
    const y = CSTART + ph*CTRAVEL;
    const x = p.x + Math.sin(ph*TAU*2) * p.sway;
    const rot = ph*TAU*p.spin;
    let a = 0.30;
    if (ph < 0.10) a *= ph/0.10;
    if (ph > 0.88) a *= (1-ph)/0.12;
    if (a <= 0.01) continue;
    confetto(x, y, p.s, COL[p.c], rot, a, p.shape);
  }}
}}

function draw(t) {{
  ctx.clearRect(0,0,W,H);
  drawBalloons(t);
  drawConfetti(t);
}}

// ---- headline/subline: one-time fade-up at loop start, then hold ----
const headline = document.getElementById('headline');
const subline = document.getElementById('subline');
function textReveal(t, el, delay, dur) {{
  const lt = t - delay;
  if (lt <= 0) {{ el.style.opacity = 0; el.style.transform = 'translateY(22px)'; return; }}
  if (lt >= dur) {{ el.style.opacity = 1; el.style.transform = 'translateY(0px)'; return; }}
  const p = lt/dur;
  const e = 1-(1-p)*(1-p)*(1-p); // ease-out cubic
  el.style.opacity = e.toFixed(3);
  el.style.transform = 'translateY(' + ((1-e)*22).toFixed(1) + 'px)';
}}

window.renderAt = (tt) => {{
  const tn = ((tt % D) + D) % D;
  draw(tn);
  textReveal(tn, headline, 0.10, 0.95);
  textReveal(tn, subline, 0.30, 0.95);
}};
const params = new URLSearchParams(location.search);
const t0 = parseFloat(params.get('t') || '0');
window.renderAt(t0);
document.documentElement.setAttribute('data-ready','1');
</script>
"""

    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{headline} — Wine &amp; Whiskey — Story Animation</title>
<style>
{FONT_FACES}
{BASE_CSS}
{CARD_CSS}
</style>
</head>
<body>
{body}
{script}
</body>
</html>
"""


def render_frame(html_path: Path, t: float, out: Path, tag: str) -> None:
    udir = SCRATCH / f"cr_{tag}"
    subprocess.run([
        CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
        "--force-device-scale-factor=1", f"--user-data-dir={udir}",
        "--run-all-compositor-stages-before-draw", "--virtual-time-budget=400",
        f"--window-size={W},{H}", f"--screenshot={out}",
        f"file://{html_path}?t={t:.4f}",
    ], check=True, capture_output=True)


def encode_mp4(frames_dir: Path, mp4_path: Path) -> None:
    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(FPS),
        "-i", str(frames_dir / "f_%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(mp4_path),
    ], check=True, capture_output=True)


def build_one(angle: str, lang: str) -> Path:
    slug = f"bd_{angle}_{lang}_stv_v01"
    html_path = HERE / f"{slug}_anim.html"
    mp4_path = HERE / f"{slug}.mp4"
    poster_path = HERE / f"{slug}_poster.png"

    html_path.write_text(render_html(angle, lang), encoding="utf-8")

    frames_dir = SCRATCH / f"anim_frames_{angle}_{lang}"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for f in frames_dir.glob("*.png"):
        f.unlink()

    n = int(round(DURATION * FPS))
    print(f"[{slug}] rendering {n} frames (single Chrome via puppeteer) …")

    # One Chrome session renders every frame by calling window.renderAt(t) — fast,
    # no cold starts. render_anim.mjs takes (html, outDir, n, fps, chromePath).
    subprocess.run(
        ["node", str(MJS), str(html_path), str(frames_dir), str(n), str(FPS), CHROME],
        check=True, cwd=str(PUPPET),
    )

    print(f"[{slug}] frames done. Encoding MP4 …")
    encode_mp4(frames_dir, mp4_path)
    print(f"[{slug}] MP4:", mp4_path)

    # poster = frame once the headline/subline are fully revealed (t=1.4s)
    idx = min(n - 1, int(round(1.4 * FPS)))
    shutil.copy(frames_dir / f"f_{idx:04d}.png", poster_path)
    print(f"[{slug}] poster:", poster_path)

    return mp4_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--still", nargs=3, metavar=("ANGLE", "LANG", "T"), default=None)
    args = ap.parse_args()

    SCRATCH.mkdir(parents=True, exist_ok=True)

    if args.still is not None:
        angle, lang, t = args.still[0], args.still[1], float(args.still[2])
        html_path = HERE / f"bd_{angle}_{lang}_stv_v01_anim.html"
        html_path.write_text(render_html(angle, lang), encoding="utf-8")
        out = HERE / f"bd_{angle}_{lang}_stv_v01_preview.png"
        render_frame(html_path, t, out, tag=f"still_{angle}_{lang}")
        print("STILL:", out, "@ t=", t)
        return

    for angle, lang in TARGETS:
        build_one(angle, lang)

    print(f"total {len(TARGETS)} MP4s")


if __name__ == "__main__":
    main()
