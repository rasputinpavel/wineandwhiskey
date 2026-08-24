#!/usr/bin/env python3
"""Wine & Whiskey bottle-neck shelf labels.
Trim 85 x 80 mm, neck hole 34 mm, optional slit. Builds screen HTML + A4 print HTML."""
import base64, pathlib

ROOT = pathlib.Path("/Users/pavelrasputin/Desktop/Wine_Whiskey")
OUT  = ROOT/"05_creative/output/2026-08-24_neck-labels"
DATE = "2026-08-24"

def b64(p, mime):
    return f"data:{mime};base64," + base64.b64encode(pathlib.Path(p).read_bytes()).decode()

BEBAS = b64(ROOT/"04_brand/logo/fonts/BebasNeue.woff2", "font/woff2")
INTER = b64(ROOT/"04_brand/logo/fonts/Inter500.woff2", "font/woff2")

# ---------- geometry (mm) ----------
W, H      = 85, 80        # trim
HOLE_D    = 34            # neck hole diameter
HOLE_TOP  = 5             # from trim top
BAR_H     = 9             # bottom wordmark bar
RADIUS    = 3             # corner radius
A4_W, A4_H = 210, 297
COLS, ROWS = 2, 3
GRID_W, GRID_H = W*COLS, H*ROWS            # 170 x 240
GX, GY = (A4_W-GRID_W)/2, (A4_H-GRID_H)/2  # 20 / 28.5

# ---------- palette ----------
LABELS = [
  dict(slug="bestseller", bg="#C9A84C", fg="#1A1A1A", accent="#8C1C1C",
       bar_bg="#1A1A1A", bar_fg="#C9A84C", die="rgba(26,26,26,.45)",
       head="BESTSELLER", head_size=15.5, lines=1,
       sub="OUR CUSTOMERS&rsquo; FAVOURITE", flair="&#9733;&#9733;&#9733;&#9733;&#9733;"),
  dict(slug="new", bg="#1A1A1A", fg="#F5F0EB", accent="#C9A84C",
       bar_bg="#F5F0EB", bar_fg="#1A1A1A", die="rgba(245,240,235,.45)",
       head="NEW", head_size=24, lines=1,
       sub="JUST ARRIVED IN STORE", flair=""),
  dict(slug="special-offer", bg="#8C1C1C", fg="#F5F0EB", accent="#C9A84C",
       bar_bg="#F5F0EB", bar_fg="#8C1C1C", die="rgba(245,240,235,.45)",
       head="SPECIAL OFFER", head_size=6.6, lines=1, sub="", flair=""),
  dict(slug="last-bottles", bg="#3D3D3D", fg="#F5F0EB", accent="#C9A84C",
       bar_bg="#C9A84C", bar_fg="#1A1A1A", die="rgba(245,240,235,.45)",
       head="LAST<br>BOTTLES", head_size=13, lines=2,
       sub="WHEN THEY&rsquo;RE GONE, THEY&rsquo;RE GONE", sub_size=2.1, flair=""),
  dict(slug="sommeliers-choice", bg="#EDE0D0", fg="#1A1A1A", accent="#8C1C1C",
       bar_bg="#8C1C1C", bar_fg="#F5F0EB", die="rgba(26,26,26,.45)",
       head="SOMMELIER&rsquo;S<br>CHOICE", head_size=12, lines=2,
       sub="PICKED BY OUR SOMMELIER", flair="RULE"),
]

BASE_CSS = f"""
@font-face{{font-family:'Bebas';src:url({BEBAS}) format('woff2');font-weight:400;}}
@font-face{{font-family:'Inter';src:url({INTER}) format('woff2');font-weight:500;}}
*{{margin:0;padding:0;box-sizing:border-box;}}
body{{font-family:'Inter',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}

.tag{{position:relative;width:{W}mm;height:{H}mm;border-radius:{RADIUS}mm;
overflow:hidden;background:var(--bg);color:var(--fg);}}

/* neck hole cut guide */
.hole{{position:absolute;top:{HOLE_TOP}mm;left:50%;transform:translateX(-50%);
width:{HOLE_D}mm;height:{HOLE_D}mm;border-radius:50%;
border:0.35mm dashed var(--die);}}
.slit{{position:absolute;top:0;left:50%;transform:translateX(-50%);
width:0;height:{HOLE_TOP}mm;border-left:0.35mm dashed var(--die);}}

/* content below the hole */
.body{{position:absolute;left:0;right:0;top:{HOLE_TOP+HOLE_D}mm;bottom:{BAR_H}mm;
display:flex;flex-direction:column;align-items:center;justify-content:center;
padding:0 4mm;text-align:center;}}
.flair{{font-size:3.4mm;letter-spacing:1.1mm;color:var(--accent);
line-height:1;margin-bottom:1.4mm;}}
.rule{{width:14mm;height:0.5mm;background:var(--accent);margin-bottom:2.2mm;
border-radius:0.3mm;}}
.head{{font-family:'Bebas';line-height:0.86;letter-spacing:0.35mm;
color:var(--fg);white-space:nowrap;}}
.sub{{font-size:2.35mm;letter-spacing:0.65mm;text-transform:uppercase;
font-weight:500;color:var(--fg);opacity:.78;margin-top:1.8mm;line-height:1.25;}}

/* inset keyline frame */
.keyline{{position:absolute;top:2.4mm;left:2.4mm;right:2.4mm;bottom:{BAR_H+2.4}mm;
border:0.3mm solid var(--fg);opacity:.28;border-radius:1.4mm;pointer-events:none;}}

/* bottom wordmark bar */
.bar{{position:absolute;left:0;right:0;bottom:0;height:{BAR_H}mm;
background:var(--barbg);color:var(--barfg);display:flex;align-items:center;
justify-content:center;font-family:'Bebas';font-size:5.4mm;letter-spacing:1.1mm;
line-height:1;padding-top:0.5mm;}}

/* ---- special offer price panel ---- */
.so-head{{font-family:'Bebas';font-size:7mm;letter-spacing:1.3mm;
line-height:1;color:var(--fg);margin:0 0 2mm;}}
.panel{{width:71mm;height:22.5mm;display:flex;gap:2.4mm;align-items:stretch;}}
.cell{{flex:1;border-radius:1.6mm;padding:1.4mm 1.6mm 1.6mm;
display:flex;flex-direction:column;align-items:stretch;}}
.cell.was{{background:#E7E0D7;}}
.cell.now{{background:#FFFDF9;box-shadow:inset 0 0 0 0.5mm #C9A84C;}}
.lab{{font-size:2.1mm;letter-spacing:0.8mm;text-transform:uppercase;
font-weight:500;line-height:1;text-align:center;}}
.cell.was .lab{{color:#7E756A;}}
.cell.now .lab{{color:#8C1C1C;}}
.zone{{flex:1;position:relative;margin-top:1.1mm;
border-bottom:0.35mm solid rgba(26,26,26,.22);}}
.baht{{position:absolute;left:0.4mm;bottom:0.4mm;font-family:'Bebas';
font-size:6mm;line-height:1;}}
.cell.was .baht{{color:#A79C8E;}}
.cell.now .baht{{color:#8C1C1C;opacity:.42;}}
.strike{{position:absolute;left:0.8mm;right:0.8mm;top:52%;height:0.45mm;
background:#B0342F;transform:rotate(-9deg);opacity:.8;border-radius:0.3mm;}}
"""

def tag_html(L, die=True):
    style = (f"--bg:{L['bg']};--fg:{L['fg']};--accent:{L['accent']};"
             f"--barbg:{L['bar_bg']};--barfg:{L['bar_fg']};--die:{L['die']}")
    cut = f'<div class="slit"></div><div class="hole"></div>' if die else ''
    if L['slug'] != 'special-offer':
        cut += '<div class="keyline"></div>'
    bar = ('<div class="bar">WINE &amp; WHISKEY</div>')
    if L['slug'] == 'special-offer':
        inner = f"""
      <div class="so-head">SPECIAL OFFER</div>
      <div class="panel">
        <div class="cell was"><div class="lab">Was</div>
          <div class="zone"><span class="baht">&#3647;</span><div class="strike"></div></div>
        </div>
        <div class="cell now"><div class="lab">Now</div>
          <div class="zone"><span class="baht">&#3647;</span></div>
        </div>
      </div>"""
    else:
        if L["flair"] == "RULE":
            flair = '<div class="rule"></div>'
        elif L["flair"]:
            flair = f'<div class="flair">{L["flair"]}</div>'
        else:
            flair = ''
        ss    = L.get("sub_size", 2.35)
        sub   = f'<div class="sub" style="font-size:{ss}mm">{L["sub"]}</div>' if L["sub"] else ''
        inner = f'{flair}<div class="head" style="font-size:{L["head_size"]}mm">{L["head"]}</div>{sub}'
    return f'<div class="tag" style="{style}">{cut}<div class="body">{inner}</div>{bar}</div>'

# ---------------- screen preview ----------------
screen_css = BASE_CSS + f"""
body{{background:#CFCAC3;padding:12mm;display:flex;flex-wrap:wrap;gap:10mm;
justify-content:center;align-items:flex-start;width:{W*3+20+24}mm;}}
.tag{{box-shadow:0 1.5mm 5mm rgba(0,0,0,.3);}}
"""
screen = ("<!doctype html><html lang=en><head><meta charset=utf-8>"
          f"<title>W&amp;W neck labels</title><style>{screen_css}</style></head><body>"
          + "".join(tag_html(L) for L in LABELS) + "</body></html>")
(OUT/f"neck-labels_{DATE}.html").write_text(screen)

# ---------------- A4 print sheets ----------------
marks = []
MK = 0.18   # mark thickness mm
MLEN = 4    # mark length mm
for c in range(COLS+1):
    x = GX + c*W
    marks.append(f'<div class="cm" style="left:{x-MK/2}mm;top:{GY-MLEN-1}mm;width:{MK}mm;height:{MLEN}mm"></div>')
    marks.append(f'<div class="cm" style="left:{x-MK/2}mm;top:{GY+GRID_H+1}mm;width:{MK}mm;height:{MLEN}mm"></div>')
for r in range(ROWS+1):
    y = GY + r*H
    marks.append(f'<div class="cm" style="top:{y-MK/2}mm;left:{GX-MLEN-1}mm;height:{MK}mm;width:{MLEN}mm"></div>')
    marks.append(f'<div class="cm" style="top:{y-MK/2}mm;left:{GX+GRID_W+1}mm;height:{MK}mm;width:{MLEN}mm"></div>')
MARKS = "".join(marks)

print_css = BASE_CSS + f"""
@page{{size:A4;margin:0;}}
body{{background:#fff;}}
.sheet{{position:relative;width:{A4_W}mm;height:{A4_H}mm;background:#fff;
page-break-after:always;overflow:hidden;}}
.sheet:last-child{{page-break-after:auto;}}
.grid{{position:absolute;left:{GX}mm;top:{GY}mm;width:{GRID_W}mm;height:{GRID_H}mm;
display:grid;grid-template-columns:repeat({COLS},{W}mm);
grid-template-rows:repeat({ROWS},{H}mm);}}
.grid .tag{{border-radius:0;}}
.cm{{position:absolute;background:#111;}}
.foot{{position:absolute;left:{GX}mm;right:{GX}mm;bottom:8mm;
font-size:2.6mm;letter-spacing:0.4mm;color:#666;text-transform:uppercase;
display:flex;justify-content:space-between;}}
/* guide page */
.gwrap{{position:absolute;inset:16mm 18mm;color:#1A1A1A;}}
.gt{{font-family:'Bebas';font-size:10mm;letter-spacing:0.6mm;line-height:1;}}
.gs{{font-size:3.1mm;letter-spacing:0.4mm;color:#555;margin-top:1.5mm;
text-transform:uppercase;}}
.gp{{font-size:3.2mm;line-height:1.6;margin-top:6mm;}}
.gp b{{font-family:'Bebas';font-size:4.6mm;letter-spacing:0.4mm;font-weight:400;}}
table{{border-collapse:collapse;margin-top:5mm;font-size:3.1mm;width:100%;}}
td,th{{border:0.2mm solid #CFC7BC;padding:1.6mm 2mm;text-align:left;}}
th{{background:#F2ECE4;font-weight:500;}}
.gauge{{display:flex;gap:8mm;margin-top:8mm;align-items:flex-end;}}
.ring{{text-align:center;}}
.ring .c{{border:0.5mm solid #E5007E;border-radius:50%;}}
.ring .n{{font-family:'Bebas';font-size:5mm;margin-top:2mm;letter-spacing:0.4mm;}}
.dieline{{position:relative;width:{W}mm;height:{H}mm;margin-top:10mm;
border:0.4mm solid #E5007E;}}
.dieline .dh{{position:absolute;top:{HOLE_TOP}mm;left:50%;transform:translateX(-50%);
width:{HOLE_D}mm;height:{HOLE_D}mm;border:0.4mm solid #E5007E;border-radius:50%;}}
.dieline .ds{{position:absolute;top:0;left:50%;transform:translateX(-50%);
width:0;height:{HOLE_TOP}mm;border-left:0.4mm dashed #E5007E;}}
.dieline .cap{{position:absolute;left:0;right:0;bottom:3mm;text-align:center;
font-size:2.6mm;color:#E5007E;letter-spacing:0.4mm;}}
"""

sheets = []
for L in LABELS:
    cells = "".join(tag_html(L) for _ in range(COLS*ROWS))
    sheets.append(f"""<div class="sheet">{MARKS}
  <div class="grid">{cells}</div>
  <div class="foot"><span>W&amp;W neck label &middot; {L['slug']}</span>
  <span>{W}&times;{H} mm &middot; hole &#216;{HOLE_D} mm &middot; {DATE}</span></div>
</div>""")

rings = "".join(
    f'<div class="ring"><div class="c" style="width:{d}mm;height:{d}mm"></div>'
    f'<div class="n">&#216;{d}</div></div>' for d in (32,34,36,38))

guide = f"""<div class="sheet">
 <div class="gwrap">
  <div class="gt">NECK LABELS &mdash; CUT &amp; PRINT GUIDE</div>
  <div class="gs">Wine &amp; Whiskey &middot; {DATE}</div>
  <div class="gp">
   <b>1 &middot; Specification</b>
   <table>
    <tr><th>Trim size</th><td>{W} &times; {H} mm (landscape)</td></tr>
    <tr><th>Neck hole</th><td>&#216; {HOLE_D} mm, top-centred, {HOLE_TOP} mm from trim top</td></tr>
    <tr><th>Slit</th><td>Straight cut from top edge to hole &mdash; <em>optional</em>, lets the
        label slip onto a bottle already on the shelf</td></tr>
    <tr><th>Corners</th><td>square cut. Optional: round to R{RADIUS} mm with a corner punch &mdash;
        the sheets are butted, so the guillotine cut is square</td></tr>
    <tr><th>Layout</th><td>{COLS} &times; {ROWS} = {COLS*ROWS} labels per A4 sheet, butted (no gutter)</td></tr>
    <tr><th>Sheets</th><td>1 Bestseller &middot; 2 New &middot; 3 Special offer &middot;
        4 Last bottles &middot; 5 Sommelier&rsquo;s choice</td></tr>
    <tr><th>Stock</th><td>250&ndash;300 gsm matte card. Matte is required &mdash; the
        SPECIAL OFFER panel is written on by hand</td></tr>
    <tr><th>Sides</th><td>single-sided (back stays blank white)</td></tr>
    <tr><th>Colour</th><td>file is RGB &mdash; convert to CMYK for press</td></tr>
    <tr><th>Print at</th><td>100 % / &ldquo;Actual size&rdquo;. Do NOT use &ldquo;Fit to page&rdquo;
        &mdash; it changes the hole diameter</td></tr>
   </table>
  </div>
  <div class="gp">
   <b>2 &middot; Fit gauge &mdash; test before the full run</b><br>
   Cut these rings out and slide them over your actual bottles. The previous batch used
   &#216;27 mm and had to be trimmed by hand; these ship at &#216;34 mm, which clears a standard
   still-wine capsule. If sparkling bottles need more, tell us the winning diameter and
   we re-issue the file.
  </div>
  <div class="gauge">{rings}</div>
 </div>
</div>
<div class="sheet">
 <div class="gwrap">
  <div class="gt">DIE-LINE &mdash; ACTUAL SIZE</div>
  <div class="gs">{W} &times; {H} mm &middot; hole &#216;{HOLE_D} mm &middot; magenta = cut, does not print</div>
  <div class="dieline"><div class="ds"></div><div class="dh"></div>
    <div class="cap">{W} &times; {H} mm &middot; hole &#216;{HOLE_D} mm &middot; square cut</div></div>
  <div class="gp" style="margin-top:8mm">
   Solid magenta = trim &amp; hole (die-cut or punch).<br>
   Corners are square; round them to R{RADIUS} mm with a corner punch if you want a softer look.<br>
   Dashed magenta = optional slit from top edge to hole.<br>
   Hole centre sits {HOLE_TOP + HOLE_D/2} mm from the trim top, on the vertical centreline.
  </div>
 </div>
</div>"""

printhtml = ("<!doctype html><html lang=en><head><meta charset=utf-8>"
             f"<title>W&amp;W neck labels &mdash; print</title><style>{print_css}</style>"
             f"</head><body>{''.join(sheets)}{guide}</body></html>")
(OUT/f"neck-labels_{DATE}_PRINT.html").write_text(printhtml)
print("wrote screen + print HTML")
