#!/usr/bin/env python3
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

CSS = f"""
@font-face{{font-family:'Bebas';src:url({bebas}) format('woff2');font-weight:400;}}
@font-face{{font-family:'Inter';src:url({inter}) format('woff2');font-weight:500;}}
:root{{--wine:#8C1C1C;--black:#1A1A1A;--white:#F5F0EB;--cream:#EDE0D0;
--gold:#C9A84C;--graphite:#3D3D3D;--stone:#D4C9BC;}}
*{{margin:0;padding:0;box-sizing:border-box;}}
@page{{size:62mm 128mm;margin:0;}}
body{{background:#d0ccc6;display:flex;gap:9mm;padding:9mm;
justify-content:center;font-family:'Inter',sans-serif;}}
.tag{{position:relative;width:62mm;height:128mm;background:var(--white);
overflow:hidden;color:var(--black);display:flex;flex-direction:column;
align-items:center;padding:36mm 5mm 5mm;border:0.2mm solid var(--stone);}}
.hole{{position:absolute;top:7mm;left:50%;transform:translateX(-50%);
width:27mm;height:27mm;border-radius:50%;border:0.3mm dashed var(--stone);}}
.hole::after{{content:"";position:absolute;top:-3.5mm;left:50%;
transform:translateX(-50%);width:0.3mm;height:4.5mm;background:var(--stone);}}
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
/* back */
.wm{{font-family:'Bebas';line-height:0.8;text-align:center;margin-top:0;}}
.wm .w1{{display:block;color:var(--wine);font-size:7.5mm;letter-spacing:0.3mm;}}
.wm .w2{{display:block;color:var(--black);font-size:6mm;letter-spacing:0.3mm;}}
/* merged ask block: headline + request as one unit */
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
@media print{{
 body{{display:block;background:#fff;padding:0;gap:0;}}
 .tag{{page-break-after:always;border:none;}}
 .tag:last-child{{page-break-after:auto;}}
}}
"""

FRONT = f"""
<div class="tag">
  <div class="hole"></div>
  <div class="overline">The owner's cat has a request</div>
  <div class="ol-sub">&mdash; and yes, the wine&rsquo;s his too</div>
  <div class="point">&#8595;</div>
  <img class="photo" src="{cat}" alt="the owner's cat with a glass of wine">
  <div class="headline">ONE REVIEW<br><span class="sub">IS ALL I ASK</span></div>
  <div class="hint">&#8594; turn me over</div>
</div>"""

BACK = f"""
<div class="tag">
  <div class="hole"></div>
  <div class="wm"><span class="w1">WINE</span><span class="w2">&amp; WHISKEY</span></div>
  <div class="ask">
    <div class="back-h">LEAVE US A <span class="accent">REVIEW</span></div>
    <div class="body"><span class="meow">Meow.</span> Liked the wine? Leave us a review on Google Maps &mdash; ten seconds, and you make my whole day. &#128062;</div>
  </div>
  <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
  <img class="qr" src="{qr}" alt="review QR">
  <div class="qrcap">Scan to review us on Google</div>
  <div class="loc">Rawai &middot; Phuket</div>
</div>"""

HTML = f"<!doctype html><html lang=en><head><meta charset=utf-8><style>{CSS}</style></head><body>{FRONT}{BACK}</body></html>"
(OUT/"neck-tag_waiting-cat_2026-07-04.html").write_text(HTML)
print("wrote HTML")
