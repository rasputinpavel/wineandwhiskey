#!/usr/bin/env python3
"""Build the 'Planning Something?' Instagram/FB Story (1080x1920, animated MP4).

Adaptation of the event-curation poster with a festive animation:
balloons rising + fireworks bursts, in the light travertine brand palette.

The HTML animation is fully DETERMINISTIC — every frame is a pure function of
a time value passed via ?t=<seconds>. We render N stills with headless Chrome
(in parallel), then stitch them into a seamless-loop MP4 with ffmpeg.

Usage:
  python3 build_story.py            # render full MP4 (+ poster still)
  python3 build_story.py --still 3.0   # render one preview frame at t=3.0s
"""
import argparse
import base64
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCRATCH = Path("/private/tmp/claude-501/-Users-pavelrasputin-Desktop-Wine-Whiskey/"
               "19297b28-4652-4b79-bd8e-3c47061b37e8/scratchpad")

STAMP = "2026-07-13"
SLUG = "event-curation-story"
HTML = HERE / f"{SLUG}_{STAMP}.html"
MP4 = HERE / f"{SLUG}_{STAMP}.mp4"
POSTER = HERE / f"{SLUG}_{STAMP}_poster.png"

DURATION = 8.0     # seconds (seamless loop)
FPS = 25
W, H = 1080, 1920


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
<title>Planning Something? — Story</title>
<style>
@font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{bebas}) format('woff2'); font-weight:400; font-display:block; }}
@font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{inter}) format('woff2'); font-weight:500; font-display:block; }}
:root {{
  --wine:#8C1C1C; --black:#1A1A1A; --white:#F5F0EB; --cream:#EDE0D0;
  --gold:#C9A84C; --burgundy:#5C1010; --graphite:#3D3D3D; --stone:#D4C9BC;
}}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:{W}px; height:{H}px; }}
body {{ font-family:'Inter',sans-serif; color:var(--black); background:var(--white);
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }}

.story {{
  position:relative; width:{W}px; height:{H}px; overflow:hidden;
  background:
    radial-gradient(120% 60% at 12% 6%, rgba(237,224,208,.55), transparent 55%),
    radial-gradient(130% 50% at 92% 22%, rgba(212,201,188,.40), transparent 50%),
    radial-gradient(120% 60% at 50% 104%, rgba(212,201,188,.55), transparent 60%),
    linear-gradient(165deg, #F7F3EE 0%, #F1EAE0 55%, #EADFD1 100%);
}}
.story::after {{
  content:''; position:absolute; inset:0; pointer-events:none; opacity:.045;
  background-image:
    repeating-linear-gradient(115deg, rgba(61,61,61,.5) 0 1px, transparent 1px 26px),
    repeating-linear-gradient(28deg, rgba(61,61,61,.35) 0 1px, transparent 1px 34px);
  mix-blend-mode:multiply; z-index:0;
}}
#fx {{ position:absolute; inset:0; z-index:1; }}

.content {{ position:absolute; inset:0; z-index:2; display:flex; flex-direction:column;
  padding:150px 88px 60px; }}

.head img {{ height:90px; width:auto; display:block; }}

.hero {{ margin-top:78px; }}
.cycler {{
  font-family:'Bebas Neue'; font-weight:400; color:var(--wine);
  font-size:164px; line-height:.9; letter-spacing:.01em; text-transform:uppercase;
  white-space:nowrap; height:150px; will-change:opacity,transform;
}}
.subline {{
  margin-top:34px; font-size:47px; line-height:1.12; color:var(--black);
  font-weight:700; letter-spacing:.005em; max-width:900px;
  text-shadow:0 4px 16px rgba(245,240,235,.85);
}}
.subline .em {{ color:var(--wine); }}

.cta {{
  margin:auto 0; display:flex; align-items:center; gap:34px;
  background:var(--black); color:var(--white);
  border-radius:22px; padding:40px 44px;
  box-shadow:0 22px 50px rgba(26,26,26,.30);
}}
.cta .qrwrap {{ display:flex; flex-direction:column; align-items:center; }}
.cta .qr {{ flex:0 0 auto; width:184px; height:184px; background:#fff; border-radius:14px;
  padding:12px; box-shadow:0 6px 16px rgba(0,0,0,.28); }}
.cta .qr img {{ width:100%; height:100%; display:block; }}
.scan {{ font-family:'Inter'; font-weight:500; font-size:15px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--gold); text-align:center; margin-top:12px; width:184px; }}
.cta .msg {{ flex:1; }}
.cta .msg .lead {{ font-family:'Bebas Neue'; font-size:66px; line-height:.94; letter-spacing:.01em; }}
.cta .msg .lead .em {{ color:var(--gold); }}
.cta .msg .sub {{ margin-top:16px; font-size:24px; color:var(--stone); font-weight:500; }}
.cta .msg .wa {{ margin-top:20px; display:inline-flex; align-items:center; gap:16px;
  font-family:'Bebas Neue'; font-size:60px; letter-spacing:.02em; color:#fff; text-decoration:none; }}
.cta .msg .wa .badge {{ font-family:'Inter'; font-weight:500; font-size:18px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--black); background:var(--gold); border-radius:8px; padding:9px 15px; }}
</style>
</head>
<body>
<div class="story">
  <canvas id="fx" width="{W}" height="{H}"></canvas>
  <div class="content">
    <div class="head"><img src="data:image/png;base64,{logo}" alt="Wine &amp; Whiskey"></div>
    <div class="hero">
      <div class="cycler" id="cycler">Birthday</div>
      <p class="subline">Custom <span class="em">Wine &amp; Spirits</span> selections for your occasion</p>
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
</div>

<script>
const W={W}, H={H}, D={DURATION};
const TAU = Math.PI*2;
const COL = {{ wine:'#8C1C1C', gold:'#C9A84C', burg:'#5C1010', graph:'#7A7268' }};
const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');

// ---- balloons: same cycle (=D) so the loop is seamless; varied offset/x/size ----
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
  // body
  ctx.beginPath();
  ctx.ellipse(x, y, r*0.82, r, 0, 0, TAU);
  ctx.fillStyle = hex; ctx.globalAlpha = a*0.42; ctx.fill();
  ctx.globalAlpha = a*0.85; ctx.lineWidth = 3; ctx.strokeStyle = hex; ctx.stroke();
  // highlight
  ctx.beginPath();
  ctx.ellipse(x - r*0.28, y - r*0.34, r*0.20, r*0.30, -0.5, 0, TAU);
  ctx.fillStyle = '#ffffff'; ctx.globalAlpha = a*0.30; ctx.fill();
  // knot
  ctx.beginPath();
  ctx.moveTo(x-6, y+r); ctx.lineTo(x+6, y+r); ctx.lineTo(x, y+r+12); ctx.closePath();
  ctx.fillStyle = hex; ctx.globalAlpha = a*0.85; ctx.fill();
  // string
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
    // fade in near bottom, out near top
    let a = 0.62;
    if (ph < 0.08) a *= ph/0.08;
    if (ph > 0.90) a *= (1-ph)/0.10;
    if (a <= 0.01) continue;
    balloon(x, y, b.r, COL[b.c], a);
  }}
}}

// ---- fireworks ----
const RISE = 0.55, BOOM = 1.35;
const BURSTS = [
  {{t0:0.4, x:770, y:430, c:'gold', R:210, n:30}},
  {{t0:1.5, x:300, y:360, c:'wine', R:180, n:26}},
  {{t0:2.7, x:850, y:640, c:'gold', R:190, n:28}},
  {{t0:3.9, x:250, y:560, c:'burg', R:170, n:26}},
  {{t0:5.0, x:600, y:340, c:'gold', R:220, n:32}},
  {{t0:6.1, x:930, y:470, c:'wine', R:170, n:26}},
];

function firework(B, local) {{
  const hex = COL[B.c];
  if (local < RISE) {{
    // launch streak from bottom up to burst point
    const rp = local/RISE;
    const e = 1-(1-rp)*(1-rp);
    const y = H + 40 + (B.y - (H+40))*e;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = COL.gold; ctx.lineWidth = 4; ctx.lineCap='round';
    ctx.globalAlpha = 0.55*(1-rp*0.3);
    ctx.shadowColor = COL.gold; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(B.x, y+46); ctx.lineTo(B.x, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(B.x, y, 5, 0, TAU); ctx.fillStyle = '#fff8e6'; ctx.globalAlpha=0.8; ctx.fill();
    ctx.restore();
    return;
  }}
  const p = (local - RISE)/BOOM;            // 0..1
  if (p > 1) return;
  const ease = 1-(1-p)*(1-p)*(1-p);
  const alpha = Math.max(0, 1-p*p);         // linger, then fade
  const grav = 170*p*p;
  // soft colored bloom for contrast against the light background
  ctx.save();
  const g = ctx.createRadialGradient(B.x, B.y+grav*0.4, 0, B.x, B.y+grav*0.4, B.R*1.15);
  g.addColorStop(0, hex); g.addColorStop(0.45, hex); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.15*alpha; ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(B.x, B.y+grav*0.4, B.R*1.15, 0, TAU); ctx.fill();
  ctx.restore();
  // radiating streaks (classic firework rays) + bright tips
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = hex; ctx.shadowBlur = 8;
  for (let i=0; i<B.n; i++) {{
    const ang = (i/B.n)*TAU + (i%2)*(TAU/B.n/2);
    const ring = (i%2===0) ? 1.0 : 0.7;
    const outer = B.R*ring*ease;
    const inner = outer*0.55;
    const c = Math.cos(ang), s = Math.sin(ang);
    const x1 = B.x + c*inner, y1 = B.y + s*inner + grav;
    const x2 = B.x + c*outer, y2 = B.y + s*outer + grav;
    const col = (i%4===0) ? COL.gold : hex;
    // tapered ray, bright toward the tip
    const lg = ctx.createLinearGradient(x1, y1, x2, y2);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, col);
    ctx.strokeStyle = lg; ctx.lineWidth = 3.4*(1-p*0.6)+1;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    // glowing tip
    ctx.fillStyle = (i%3===0) ? '#fff3d6' : col;
    ctx.globalAlpha = alpha*(0.7 + 0.3*Math.sin(i*1.7));
    ctx.beginPath(); ctx.arc(x2, y2, 3.2*(1-p)+1.4, 0, TAU); ctx.fill();
  }}
  // bright core flash early on
  if (p < 0.28) {{
    const cf = 1-p/0.28;
    ctx.globalAlpha = cf*0.85; ctx.fillStyle = '#fff6e0';
    ctx.shadowColor = COL.gold; ctx.shadowBlur = 26;
    ctx.beginPath(); ctx.arc(B.x, B.y, 16*cf+4, 0, TAU); ctx.fill();
  }}
  ctx.restore();
}}

function drawFireworks(t) {{
  for (const B of BURSTS) {{
    const local = t - B.t0;
    if (local >= 0 && local <= RISE+BOOM) firework(B, local);
  }}
}}

function draw(t) {{
  ctx.clearRect(0,0,W,H);
  drawBalloons(t);
  drawFireworks(t);
}}

const WORDS = ['Birthday','House Party','Celebration','Event'];
const SLOT = D / WORDS.length;
const cyc = document.getElementById('cycler');
window.renderAt = (tt) => {{
  const tn = ((tt % D) + D) % D;
  draw(tn);
  const k = Math.floor(tn / SLOT) % WORDS.length;
  const lp = (tn - k*SLOT) / SLOT;           // 0..1 within a word's slot
  cyc.textContent = WORDS[k];
  const IN = 0.16, OUT = 0.84;
  let o, y;
  if (lp < IN)       {{ const p = lp/IN;         o = p;   y = (1-p)*30; }}
  else if (lp > OUT) {{ const p = (lp-OUT)/(1-OUT); o = 1-p; y = -p*30; }}
  else               {{ o = 1; y = 0; }}
  cyc.style.opacity = o.toFixed(3);
  cyc.style.transform = 'translateY(' + y.toFixed(1) + 'px)';
}};
const params = new URLSearchParams(location.search);
const t0 = parseFloat(params.get('t') || '0');
window.renderAt(t0);
document.documentElement.setAttribute('data-ready','1');
</script>
</body>
</html>
"""

HTML.write_text(html, encoding="utf-8")


def render_frame(t: float, out: Path, tag: str):
    udir = SCRATCH / f"cr_{tag}"
    subprocess.run([
        CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
        "--force-device-scale-factor=1", f"--user-data-dir={udir}",
        "--run-all-compositor-stages-before-draw", "--virtual-time-budget=400",
        f"--window-size={W},{H}", f"--screenshot={out}",
        f"file://{HTML}?t={t:.4f}",
    ], check=True, capture_output=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--still", type=float, default=None)
    args = ap.parse_args()

    SCRATCH.mkdir(parents=True, exist_ok=True)

    if args.still is not None:
        render_frame(args.still, POSTER, "still")
        print("STILL:", POSTER, "@ t=", args.still)
        return

    frames_dir = SCRATCH / "story_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for f in frames_dir.glob("*.png"):
        f.unlink()

    n = int(round(DURATION * FPS))
    print(f"Rendering {n} frames (single Chrome via puppeteer) …")

    # One persistent Chrome session drives every frame -> fast, no cold starts.
    node_script = SCRATCH / "puppet" / "render_story.mjs"
    subprocess.run(
        ["node", str(node_script), str(HTML), str(frames_dir), str(n), str(FPS), CHROME],
        check=True, cwd=str(SCRATCH / "puppet"),
    )
    print("Frames done. Encoding MP4 …")

    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(FPS),
        "-i", str(frames_dir / "f_%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(MP4),
    ], check=True, capture_output=True)
    print("MP4  :", MP4)

    # poster still = the frame nearest a visible burst (t=5.95s)
    import shutil
    idx = min(n - 1, int(round(5.95 * FPS)))
    shutil.copy(frames_dir / f"f_{idx:04d}.png", POSTER)
    print("POSTER:", POSTER)


if __name__ == "__main__":
    main()
