#!/usr/bin/env python3
"""Build the night-readable "Wine by Glass" A1 poster — three layout variants.

The previous version (2026-08-12) was a light sheet with a photographed glass:
transparent glass on a warm background disappears at a distance, and in a
backlit stand the whole sheet blows out white. This rebuild flips it — a near
black sheet with cream lettering and a drawn glass, so the light elements are
the only thing that glows when the lightbox is on at night, and the contrast
stays brutal in daylight. Same family as the BEER pull-up banner.

A1 portrait (594 x 841 mm). Fonts are embedded, the glass is vector, so the
file is self contained and prints crisp at any size.

Run from inside this folder:
    python3 build.py [a|b|c]
"""
import base64
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DATE = "2026-09-21"
STEM = "wine-by-glass-a1-night"

BEBAS = base64.b64encode((ROOT / "04_brand/logo/fonts/BebasNeue.woff2").read_bytes()).decode()
INTER = base64.b64encode((ROOT / "04_brand/logo/fonts/Inter500.woff2").read_bytes()).decode()

# --- palette (brand tokens, tuned for a backlit box) -------------------------
INK = "#12100F"      # sheet — deep black, a touch warm so the print isn't grey
CREAM = "#F7F2EA"    # the glowing element: lettering, glass outline
WINE = "#B01E1E"     # red wine — lifted from #8C1C1C so it still reads lit
GOLD = "#D9B65A"     # sparkling, hairlines, small caps
STRAW = "#E9D48F"    # white wine


def glass(liquid, level=0.52, bubbles=False, scale_stroke=9):
    """Line-art wine glass, cream outline + glowing liquid. viewBox 400x700."""
    # bowl half-width at the liquid surface, interpolated along the bowl curve
    top = 96 + (378 - 96) * (1 - level)
    hw = 108 * (1 - (1 - level) ** 1.45) * 0.97 + 6
    fizz = ""
    if bubbles:
        for cx, cy, r in ((168, 300, 7), (196, 268, 5), (228, 315, 6), (182, 235, 4),
                          (214, 210, 5), (160, 348, 5), (238, 258, 4), (200, 330, 6),
                          (176, 190, 4), (224, 168, 5)):
            fizz += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{CREAM}" opacity=".75"/>'
    return f'''<svg viewBox="0 0 400 700" xmlns="http://www.w3.org/2000/svg">
  <!-- liquid -->
  <path d="M {200 - hw:.0f},{top:.0f} C {200 - hw + 14:.0f},{top + 60:.0f} {200 - hw + 44:.0f},{top + 130:.0f} 193,378
           L 207,378 C {200 + hw - 44:.0f},{top + 130:.0f} {200 + hw - 14:.0f},{top + 60:.0f} {200 + hw:.0f},{top:.0f} Z"
        fill="{liquid}"/>
  <ellipse cx="200" cy="{top:.0f}" rx="{hw:.0f}" ry="{hw * 0.16:.0f}" fill="{liquid}"/>
  <ellipse cx="200" cy="{top:.0f}" rx="{hw:.0f}" ry="{hw * 0.16:.0f}" fill="#000" opacity=".22"/>
  {fizz}
  <!-- glass -->
  <g fill="none" stroke="{CREAM}" stroke-width="{scale_stroke}" stroke-linecap="round">
    <path d="M 92,96 C 92,252 130,342 193,380 L 193,600"/>
    <path d="M 308,96 C 308,252 270,342 207,380 L 207,600"/>
    <ellipse cx="200" cy="96" rx="108" ry="17"/>
    <path d="M 108,616 C 108,602 140,596 200,596 C 260,596 292,602 292,616
             C 292,630 260,636 200,636 C 140,636 108,630 108,616 Z"/>
  </g>
  <!-- highlight on the bowl -->
  <path d="M 118,140 C 122,240 146,318 186,356" fill="none" stroke="{CREAM}"
        stroke-width="7" opacity=".45" stroke-linecap="round"/>
</svg>'''


CSS = f"""
  @font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{BEBAS}) format('woff2'); font-weight:400; font-display:block; }}
  @font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{INTER}) format('woff2'); font-weight:500; font-display:block; }}
  :root{{ --ink:{INK}; --cream:{CREAM}; --wine:{WINE}; --gold:{GOLD}; --straw:{STRAW}; }}
  *{{box-sizing:border-box;margin:0;padding:0}}
  @page {{ size:594mm 841mm; margin:0; }}
  html,body{{background:#2a2725}}
  body{{font-family:'Inter',sans-serif;display:flex;justify-content:center}}
  @media screen {{ body{{padding:20px}} .sheet{{box-shadow:0 20px 80px rgba(0,0,0,.6)}} }}

  .sheet{{width:594mm;height:841mm;background:var(--ink);color:var(--cream);
    position:relative;overflow:hidden;display:flex;flex-direction:column;
    align-items:center;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  /* a barely-there warm lift in the middle so the black isn't dead flat */
  .sheet::before{{content:"";position:absolute;inset:0;z-index:0;
    background:radial-gradient(ellipse 70% 52% at 50% 46%,rgba(120,92,60,.16) 0%,rgba(0,0,0,0) 72%)}}
  .sheet > *{{position:relative;z-index:2}}

  .bebas{{font-family:'Bebas Neue',sans-serif;text-transform:uppercase}}

  .head{{font-family:'Bebas Neue',sans-serif;text-transform:uppercase;
    line-height:.86;letter-spacing:6px;color:var(--cream)}}
  .rule{{height:3px;background:var(--gold);opacity:.85}}
  .kicker{{font-family:'Inter',sans-serif;text-transform:uppercase;color:var(--gold)}}

  /* colour options row */
  .opts{{display:flex;align-items:center;justify-content:center;gap:44px;
    font-family:'Bebas Neue',sans-serif;text-transform:uppercase;letter-spacing:5px;
    font-size:118px;line-height:1;color:var(--cream)}}
  .opts .it{{display:inline-flex;align-items:center;gap:24px}}
  .dot{{width:50px;height:50px;border-radius:50%;flex:0 0 auto}}
  .dot.rd{{background:var(--wine)}} .dot.wh{{background:var(--straw)}} .dot.sp{{background:var(--gold)}}
  .opts .sep{{color:#5a534b;font-size:92px}}

  /* footer wordmark, set in Bebas per the design system */
  .mark{{font-family:'Bebas Neue',sans-serif;text-transform:uppercase;
    font-size:88px;letter-spacing:14px;line-height:1}}
  .mark .w{{color:var(--wine)}} .mark .s{{color:var(--cream)}}

  .glow{{position:absolute;border-radius:50%;z-index:1;filter:blur(1px)}}
"""


# ---------------------------------------------------------------- variant A --
A = f"""
<div class="sheet">
  <div class="head" style="margin-top:40mm;font-size:305px">Wine by Glass</div>
  <div class="rule" style="width:310mm;margin-top:13mm"></div>

  <div style="position:absolute;top:138mm;left:0;right:0;height:525mm">
    <div class="glow" style="left:20%;top:6%;width:60%;height:64%;
         background:radial-gradient(circle,rgba(176,30,30,.42) 0%,rgba(176,30,30,0) 68%)"></div>
    <div style="position:absolute;left:50%;top:0;transform:translateX(-50%);
         height:100%;aspect-ratio:400/700;z-index:2">{glass(WINE, .55)}</div>

    <!-- price seal: cream disc = the brightest thing on the sheet -->
    <div style="position:absolute;left:2mm;top:104mm;width:250mm;height:250mm;border-radius:50%;
         background:var(--wine);border:5mm solid var(--cream);display:flex;flex-direction:column;
         align-items:center;justify-content:center;z-index:3">
      <div class="bebas" style="font-size:430px;line-height:.76;letter-spacing:1px;color:var(--cream)">
        <span style="font-size:.44em;vertical-align:.44em;margin-right:.03em">฿</span>160</div>
      <div class="kicker" style="font-size:54px;letter-spacing:14px;color:var(--cream);opacity:.85;margin-top:14px">per glass</div>
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:112mm" class="opts">
    <span class="it"><span class="dot rd"></span>Red</span><span class="sep">/</span>
    <span class="it"><span class="dot wh"></span>White</span><span class="sep">/</span>
    <span class="it"><span class="dot sp"></span>Sparkling</span>
  </div>
  <div class="rule" style="position:absolute;left:142mm;bottom:86mm;width:310mm;opacity:.35"></div>
  <div class="mark" style="position:absolute;left:0;right:0;bottom:44mm">
    <span class="w">Wine</span> <span class="s">&amp; Whiskey</span></div>
</div>
"""

# ---------------------------------------------------------------- variant B --
B = f"""
<div class="sheet">
  <div class="kicker" style="margin-top:48mm;font-size:54px;letter-spacing:24px">Wine &amp; Whiskey</div>
  <div class="head" style="margin-top:14mm;font-size:232px">Wine by Glass</div>
  <div class="rule" style="width:250mm;margin-top:12mm"></div>

  <!-- the number is the poster; the glass is a watermark behind it -->
  <div style="position:absolute;left:0;right:0;top:206mm;height:400mm">
    <div class="glow" style="left:10%;top:0;width:80%;height:92%;
         background:radial-gradient(ellipse,rgba(217,182,90,.22) 0%,rgba(0,0,0,0) 70%)"></div>
    <div style="position:absolute;left:50%;top:-6mm;transform:translateX(-50%);height:400mm;
         aspect-ratio:400/700;opacity:.26;z-index:1">{glass(WINE, .55)}</div>
    <div class="bebas" style="position:absolute;left:0;right:0;top:6mm;z-index:3;
         font-size:980px;line-height:.78;letter-spacing:-8px;color:var(--cream)">
      <span style="font-size:.34em;vertical-align:.66em;margin-right:.01em;color:var(--wine)">฿</span>160</div>
    <div class="kicker" style="position:absolute;left:0;right:0;top:252mm;z-index:3;
         font-size:84px;letter-spacing:36px">per glass</div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:150mm" class="opts">
    <span class="it"><span class="dot rd"></span>Red</span><span class="sep">/</span>
    <span class="it"><span class="dot wh"></span>White</span><span class="sep">/</span>
    <span class="it"><span class="dot sp"></span>Sparkling</span>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:96mm;background:var(--wine);
       display:flex;align-items:center;justify-content:center">
    <span class="bebas" style="font-size:96px;letter-spacing:18px;color:var(--cream)">Wine &amp; Whiskey</span>
  </div>
</div>
"""

# ---------------------------------------------------------------- variant C --
def _c_glass(color, label, glow_rgba, bubbles=False):
    return f'''<div style="width:178mm;text-align:center">
      <div style="height:320mm;position:relative">
        <div class="glow" style="left:-6%;top:4%;width:112%;height:64%;
             background:radial-gradient(circle,{glow_rgba} 0%,rgba(0,0,0,0) 66%)"></div>
        <div style="position:absolute;left:50%;top:0;transform:translateX(-50%);height:100%;
             aspect-ratio:400/700">{glass(color, .55, bubbles=bubbles)}</div>
      </div>
      <div class="bebas" style="font-size:118px;letter-spacing:7px;margin-top:9mm">{label}</div>
    </div>'''


C = f"""
<div class="sheet">
  <div class="head" style="margin-top:42mm;font-size:272px">Wine by Glass</div>
  <div class="rule" style="width:280mm;margin-top:12mm"></div>

  <div style="position:absolute;left:0;right:0;top:172mm;height:380mm;
       display:flex;align-items:flex-start;justify-content:center;gap:12mm">
    {_c_glass(WINE, 'Red', 'rgba(176,30,30,.42)')}
    {_c_glass(STRAW, 'White', 'rgba(233,212,143,.30)')}
    {_c_glass(GOLD, 'Sparkling', 'rgba(217,182,90,.34)', bubbles=True)}
  </div>

  <!-- price band: wine red ground so the cream digits stay the brightest thing
       on the sheet — a cream slab blooms out under a lightbox and eats the number -->
  <div style="position:absolute;left:0;right:0;bottom:76mm;height:196mm;background:var(--wine);
       display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div class="bebas" style="font-size:470px;line-height:.74;letter-spacing:2px;color:var(--cream)">
      <span style="font-size:.42em;vertical-align:.46em;margin-right:.03em">฿</span>160</div>
    <div class="kicker" style="font-size:60px;letter-spacing:20px;color:var(--cream);opacity:.88;margin-top:12px">per glass</div>
  </div>
  <div class="mark" style="position:absolute;left:0;right:0;bottom:26mm">
    <span class="w">Wine</span> <span class="s">&amp; Whiskey</span></div>
</div>
"""

VARIANTS = {"a": A, "b": B, "c": C}


def build(key: str):
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Wine &amp; Whiskey — Wine by Glass (A1, night)</title>
<style>{CSS}</style></head><body>{VARIANTS[key]}</body></html>"""
    stem = f"{STEM}-{key}_{DATE}"
    html_path = HERE / f"{stem}.html"
    pdf_path = HERE / f"{stem}.pdf"
    html_path.write_text(html, encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", html_path.as_uri()],
                   check=True, capture_output=True)
    subprocess.run(["pdftoppm", "-png", "-r", "72", "-singlefile",
                    str(pdf_path), str(HERE / f"{stem}_preview")], check=True)
    print(f"[{key}] {stem}.pdf + _preview.png")


if __name__ == "__main__":
    keys = sys.argv[1:] or list(VARIANTS)
    for k in keys:
        build(k)
