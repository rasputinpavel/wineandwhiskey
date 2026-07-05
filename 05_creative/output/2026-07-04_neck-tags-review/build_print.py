#!/usr/bin/env python3
"""Press-ready build: 62x128mm trim + 3mm bleed = 68x134mm page, crop marks, die-line guide."""
import base64, pathlib

ROOT = pathlib.Path("/Users/pavelrasputin/Desktop/Wine_Whiskey")
OUT  = ROOT/"05_creative/output/2026-07-04_neck-tags-review"
A    = OUT/"assets"

def b64(p, mime):
    return f"data:{mime};base64," + base64.b64encode(pathlib.Path(p).read_bytes()).decode()

bebas = b64(ROOT/"04_brand/logo/fonts/BebasNeue.woff2", "font/woff2")
inter = b64(ROOT/"04_brand/logo/fonts/Inter500.woff2", "font/woff2")
cat   = b64(A/"cat_glass.jpg", "image/jpeg")
qr    = b64(A/"qr_review.png", "image/png")

# geometry (mm)
TRIM_W, TRIM_H = 62, 128
BLEED = 3
PAGE_W, PAGE_H = TRIM_W + 2*BLEED, TRIM_H + 2*BLEED   # 68 x 134
HOLE_D = 27
HOLE_TOP = 7          # from trim top
HOLE_CX = TRIM_W/2    # 31

CSS = f"""
@font-face{{font-family:'Bebas';src:url({bebas}) format('woff2');font-weight:400;}}
@font-face{{font-family:'Inter';src:url({inter}) format('woff2');font-weight:500;}}
:root{{--wine:#8C1C1C;--black:#1A1A1A;--white:#F5F0EB;--gold:#C9A84C;
--graphite:#3D3D3D;--stone:#D4C9BC;--die:#E5007E;}}
*{{margin:0;padding:0;box-sizing:border-box;}}
@page{{size:{PAGE_W}mm {PAGE_H}mm;margin:0;}}
body{{margin:0;font-family:'Inter',sans-serif;}}
.sheet{{position:relative;width:{PAGE_W}mm;height:{PAGE_H}mm;
background:var(--white);overflow:hidden;page-break-after:always;}}
.sheet:last-child{{page-break-after:auto;}}
/* trim area holds all artwork, inset by bleed */
.trim{{position:absolute;top:{BLEED}mm;left:{BLEED}mm;
width:{TRIM_W}mm;height:{TRIM_H}mm;display:flex;flex-direction:column;
align-items:center;padding:36mm 5mm 5mm;color:var(--black);}}
/* crop marks (L at each trim corner, sitting in bleed) */
.cm{{position:absolute;background:#111;}}
.cm.h{{width:{BLEED-1}mm;height:0.18mm;}}
.cm.v{{width:0.18mm;height:{BLEED-1}mm;}}
.tl-h{{top:{BLEED}mm;left:0;}} .tl-v{{top:0;left:{BLEED}mm;}}
.tr-h{{top:{BLEED}mm;right:0;}} .tr-v{{top:0;right:{BLEED}mm;}}
.bl-h{{bottom:{BLEED}mm;left:0;}} .bl-v{{bottom:0;left:{BLEED}mm;}}
.br-h{{bottom:{BLEED}mm;right:0;}} .br-v{{bottom:0;right:{BLEED}mm;}}
/* content styles (mirror of the approved tag) */
.overline{{font-size:2.5mm;letter-spacing:0.8mm;font-weight:500;
text-transform:uppercase;color:var(--graphite);text-align:center;}}
.ol-sub{{font-size:2.6mm;font-style:italic;color:var(--graphite);
text-align:center;margin-top:1mm;font-weight:500;}}
.point{{font-size:5mm;color:var(--graphite);line-height:0.8;margin-top:1mm;}}
.photo{{width:51mm;height:48mm;object-fit:cover;object-position:center;
border-radius:2.5mm;display:block;margin-top:1mm;
box-shadow:0 1mm 3mm rgba(26,26,26,.28);}}
.headline{{font-family:'Bebas';font-weight:400;font-size:10mm;line-height:0.9;
letter-spacing:0.3mm;text-align:center;color:var(--wine);margin-top:3mm;}}
.headline .sub{{color:var(--black);}}
.hint{{font-size:2.4mm;letter-spacing:0.5mm;color:var(--graphite);
text-transform:uppercase;margin-top:auto;font-weight:500;}}
.wm{{font-family:'Bebas';line-height:0.8;text-align:center;}}
.wm .w1{{display:block;color:var(--wine);font-size:7.5mm;letter-spacing:0.3mm;}}
.wm .w2{{display:block;color:var(--black);font-size:6mm;letter-spacing:0.3mm;}}
.ask{{margin-top:6mm;display:flex;flex-direction:column;align-items:center;}}
.back-h{{font-family:'Bebas';font-weight:400;font-size:9.5mm;line-height:0.84;
letter-spacing:0.3mm;text-align:center;color:var(--black);}}
.back-h .accent{{color:var(--wine);}}
.body{{font-size:3mm;line-height:1.38;text-align:center;color:var(--black);
margin-top:1mm;padding:0 1mm;font-weight:500;}}
.body .meow{{color:var(--wine);font-style:italic;}}
.stars{{color:var(--gold);font-size:3.8mm;letter-spacing:0.8mm;margin-top:3.5mm;}}
.qr{{width:18mm;height:18mm;display:block;margin-top:2mm;}}
.qrcap{{font-size:2.3mm;letter-spacing:0.2mm;color:var(--graphite);white-space:nowrap;
margin-top:1mm;text-transform:uppercase;font-weight:500;}}
.loc{{font-size:2.2mm;letter-spacing:0.8mm;color:var(--graphite);
text-transform:uppercase;margin-top:1.5mm;font-weight:500;}}
/* die-line guide page */
.guide{{position:absolute;top:{BLEED}mm;left:{BLEED}mm;
width:{TRIM_W}mm;height:{TRIM_H}mm;}}
.die-outline{{position:absolute;inset:0;border:0.4mm solid var(--die);border-radius:3mm;}}
.die-hole{{position:absolute;top:{HOLE_TOP}mm;left:50%;transform:translateX(-50%);
width:{HOLE_D}mm;height:{HOLE_D}mm;border:0.4mm solid var(--die);border-radius:50%;}}
.die-slit{{position:absolute;top:0;left:50%;transform:translateX(-50%);
width:2mm;height:{HOLE_TOP}mm;border-left:0.4mm solid var(--die);
border-right:0.4mm solid var(--die);}}
.g-title{{position:absolute;top:44mm;left:0;right:0;text-align:center;
font-family:'Bebas';font-size:7mm;color:var(--black);}}
.g-list{{position:absolute;top:56mm;left:6mm;right:6mm;font-size:2.9mm;
line-height:1.7;color:var(--black);}}
.g-list b{{color:var(--wine);}}
.g-swatch{{display:inline-block;width:4mm;height:0;border-top:0.4mm solid var(--die);
vertical-align:middle;margin-right:1mm;}}
"""

FRONT = f"""
<div class="sheet">
  <div class="cm h tl-h"></div><div class="cm v tl-v"></div>
  <div class="cm h tr-h"></div><div class="cm v tr-v"></div>
  <div class="cm h bl-h"></div><div class="cm v bl-v"></div>
  <div class="cm h br-h"></div><div class="cm v br-v"></div>
  <div class="trim">
    <div class="overline">The owner's cat has a request</div>
    <div class="ol-sub">&mdash; and yes, the wine&rsquo;s his too</div>
    <div class="point">&#8595;</div>
    <img class="photo" src="{cat}" alt="the owner's cat with a glass of wine">
    <div class="headline">ONE REVIEW<br><span class="sub">IS ALL I ASK</span></div>
    <div class="hint">&#8594; turn me over</div>
  </div>
</div>"""

BACK = f"""
<div class="sheet">
  <div class="cm h tl-h"></div><div class="cm v tl-v"></div>
  <div class="cm h tr-h"></div><div class="cm v tr-v"></div>
  <div class="cm h bl-h"></div><div class="cm v bl-v"></div>
  <div class="cm h br-h"></div><div class="cm v br-v"></div>
  <div class="trim">
    <div class="wm"><span class="w1">WINE</span><span class="w2">&amp; WHISKEY</span></div>
    <div class="ask">
      <div class="back-h">LEAVE US A <span class="accent">REVIEW</span></div>
      <div class="body"><span class="meow">Meow.</span> Liked the wine? Leave us a review on Google Maps &mdash; ten seconds, and you make my whole day. &#128062;</div>
    </div>
    <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
    <img class="qr" src="{qr}" alt="review QR">
    <div class="qrcap">Scan to review us on Google</div>
    <div class="loc">Rawai &middot; Phuket</div>
  </div>
</div>"""

GUIDE = f"""
<div class="sheet">
  <div class="cm h tl-h"></div><div class="cm v tl-v"></div>
  <div class="cm h tr-h"></div><div class="cm v tr-v"></div>
  <div class="cm h bl-h"></div><div class="cm v bl-v"></div>
  <div class="cm h br-h"></div><div class="cm v br-v"></div>
  <div class="guide">
    <div class="die-outline"></div>
    <div class="die-hole"></div>
    <div class="die-slit"></div>
    <div class="g-title">DIE-LINE / CUT GUIDE</div>
    <div class="g-list">
      <div><span class="g-swatch"></span><b>magenta</b> = cut line (does not print)</div>
      <div>Trim size: <b>{TRIM_W} &times; {TRIM_H} mm</b></div>
      <div>Bleed: <b>{BLEED} mm</b> all sides</div>
      <div>Neck hole: <b>&#8709; {HOLE_D} mm</b>, top-centered</div>
      <div>Slit to top edge: lets it slip onto a filled bottle</div>
      <div>Double-sided; hole aligns front/back</div>
      <div>Stock: 300&ndash;350 gsm matte card</div>
    </div>
  </div>
</div>"""

HTML = f"<!doctype html><html lang=en><head><meta charset=utf-8><style>{CSS}</style></head><body>{FRONT}{BACK}{GUIDE}</body></html>"
(OUT/"neck-tag_waiting-cat_2026-07-04_PRINT.html").write_text(HTML)
print("wrote PRINT html; page", PAGE_W, "x", PAGE_H, "mm")
