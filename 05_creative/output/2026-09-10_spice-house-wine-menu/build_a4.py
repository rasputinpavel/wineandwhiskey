#!/usr/bin/env python3
"""Spice House × Wine & Whiskey — the whole list on ONE A4 sheet.

Same fourteen wines as build.py, one page instead of two:

  · the two by-the-glass DUO wines sit in their own block at the top — they are
    also the cheapest bottles, so the list still reads low-to-high;
  · bottles lie on their side, one row per wine, the way a magazine spread
    stacks them (reference #1);
  · no monogram, no "Wine & Whiskey Phuket" foot — only a thin
    "selected by Wine & Whiskey" line under the title.

Fitting fourteen rows on 297 mm costs two lines per wine: the description is cut
to one line, and grapes/producer share a line with the pairing (grapes left,
pairing right). Names, prices and grapes come from build.py — this file only
holds the shortened copy.

Usage:
    python3 build_a4.py           # html + pdf + preview
    python3 build_a4.py --html    # html only
"""
import argparse
import os
import subprocess

from PIL import Image

from build import GLASS, PAGES

HERE = os.path.dirname(os.path.abspath(__file__))
DATE = "2026-09-10"
SLUG = f"spice-house-wine-menu-a4_{DATE}"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# One-line descriptions — the two-page layout has room for three, this one does not.
SHORT = {
    "chateau-tamagne-sparkling-brut-white.png":
        "Green apple and citrus, a fine bead, dry clean finish.",
    "abrau-durso-reserve-brut.png":
        "From Russia's oldest sparkling house, 1870. Ripe apple, dry, elegant.",
    "abrau-durso-victor-dravigny-brut.png":
        "Long ageing on the lees — brioche, hazelnut, a fine mousse.",
    "chateau-tamagne-duo-blanc.png":
        "Pale straw, green apple and citrus, crisp — the easiest pour on the list.",
    "chateau-tamagne-chardonnay.png":
        "Steel-fermented, no oak. White flowers, pear and lemon zest.",
    "chateau-tamagne-grape-dance-blanc.png":
        "An aromatic three-grape blend — peach, meadow herbs, gentle spice.",
    "aristov-riesling.png":
        "Lime, white peach, a flinty edge. Acidity that stands up to chilli.",
    "chateau-tamagne-signature-chardonnay.png":
        "Aged on the lees in steel — riper fruit, creamier texture, long finish.",
    "chateau-tamagne-nature-orange.png":
        "Fermented on the skins — dried apricot, citrus peel, a light grip of tannin.",
    "chateau-tamagne-duo-red.png":
        "Deep ruby, ripe dark berries, soft — the red for the whole table.",
    "chateau-tamagne-cabernet.png":
        "Blackcurrant and bell pepper, medium body, dry finish.",
    "chateau-tamagne-nude-saperavi.png":
        "Neither filtered nor fined — sour cherry, plum, a wild edge.",
    "chateau-tamagne-nature-violet.png":
        "The Nature line, minimal intervention — violets and dark berries.",
    "chateau-tamagne-signature-saperavi.png":
        "Oak-aged, dense black fruit, cocoa and dried herbs, firm finish.",
}

# Grape lists that would wrap onto a second line at this row height.
GRAPES = {
    "chateau-tamagne-duo-red.png": "Saperavi · Krasnostop · Zweigelt",
    "abrau-durso-victor-dravigny-brut.png": "Chardonnay · Pinot Blanc · Riesling",
}

# Pairings that need to be shorter on one line than on the two-page sheet.
PAIR = {
    "chateau-tamagne-nature-orange.png": "Phad Thai · Kharcho",
    "chateau-tamagne-grape-dance-blanc.png": "Phad Thai · Chicken with cashew nuts",
    "chateau-tamagne-signature-chardonnay.png": "White snapper · Salmon steak",
    "chateau-tamagne-duo-blanc.png": "Salmon bruschetta · Vareniki",
}


def flatten():
    """All wines from the two-page layout, keyed by their section label."""
    out = []
    for page in PAGES:
        for sec in page["sections"]:
            for w in sec["wines"]:
                out.append(dict(w, label=sec["label"].split(" · ")[0]))
    return out


def sections():
    wines = flatten()
    by_glass = [w for w in wines if w["glass"]]
    rest = [w for w in wines if not w["glass"]]

    def of(label):
        return [w for w in rest if w["label"] == label]

    return [
        ("By the Glass · По бокалам", "glass", by_glass),
        ("Sparkling · Игристое", "", of("Sparkling")),
        ("White · Белое", "", of("White")),
        ("Orange · Оранжевое", "", of("Orange")),
        ("Red · Красное", "", of("Red")),
    ]


def lay_bottles_down():
    """Rotate each bottle onto its side once, trimmed to the glass."""
    src = os.path.join(HERE, "assets")
    made = []
    for name in sorted(os.listdir(src)):
        if not name.endswith(".png") or name.startswith(("h_", "channel_")):
            continue
        out = os.path.join(src, f"h_{name}")
        if os.path.exists(out):
            continue
        im = Image.open(os.path.join(src, name)).convert("RGBA")
        im = im.rotate(-90, expand=True)          # neck points right, into the text
        box = im.getbbox()
        if box:
            im = im.crop(box)
        im.save(out)
        made.append(f"h_{name}")
    if made:
        print("bottles laid down →", ", ".join(made))


CSS = """
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --ink:#0C0B0A; --panel:#141110; --card:#211C19;
    --rust:#8E3F1E; --rust-deep:#5E2712;
    --gold:#C9A84C; --white:#F7F3ED; --muted:#9C9288;
    --line:rgba(201,168,76,.20);
  }
  html,body{background:#2A2523}
  body{font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;
       display:flex;justify-content:center;padding:26px}

  .sheet{width:210mm;height:297mm;position:relative;overflow:hidden;
         background:var(--rust);padding:4mm;color:var(--white);
         box-shadow:0 14px 50px rgba(0,0,0,.55)}
  .sheet::before{content:"";position:absolute;inset:0;
        background:radial-gradient(ellipse 120% 90% at 50% 0%,
                   rgba(214,120,60,.55) 0%,rgba(0,0,0,0) 62%),
                   linear-gradient(160deg,var(--rust) 0%,var(--rust-deep) 100%)}

  .panel{position:relative;height:100%;border-radius:4mm;overflow:hidden;
         background:var(--ink);padding:7mm 9mm 5mm;
         display:flex;flex-direction:column}
  .panel::before{content:"";position:absolute;inset:0;
        background:radial-gradient(ellipse 90% 50% at 50% -10%,
                   rgba(201,168,76,.16) 0%,rgba(0,0,0,0) 60%),
                   radial-gradient(ellipse 70% 40% at 50% 110%,
                   rgba(142,63,30,.30) 0%,rgba(0,0,0,0) 65%)}
  .panel::after{content:"";position:absolute;inset:0;opacity:.30;
        background-image:url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>\
<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/>\
<feColorMatrix type='saturate' values='0'/></filter>\
<rect width='180' height='180' filter='url(%23n)' opacity='.55'/></svg>");
        mix-blend-mode:overlay}
  .panel > *{position:relative;z-index:2}

  /* ── header ── */
  .head{text-align:center;padding-bottom:2.4mm;border-bottom:.4mm solid var(--line)}
  .head h1{font-family:'Bebas Neue',sans-serif;font-size:26pt;line-height:.9;
           letter-spacing:.14em}
  .head .sel{margin-top:1.3mm;font-size:5.5pt;letter-spacing:.36em;
             text-transform:uppercase;color:var(--muted)}
  .head .sel b{color:var(--gold);font-weight:600}

  .stack{flex:1;display:flex;flex-direction:column;min-height:0}

  /* ── section ── */
  .sec{display:flex;flex-direction:column;margin-top:2mm}
  .sec-head{display:flex;align-items:center;gap:3.5mm;margin-bottom:1.1mm}
  .sec-head span{font-family:'Bebas Neue',sans-serif;font-size:10.5pt;
                 letter-spacing:.22em;color:var(--gold);white-space:nowrap}
  .sec-head i{flex:1;height:.3mm;background:linear-gradient(90deg,
              var(--line),rgba(201,168,76,0))}
  .rows{flex:1;display:flex;flex-direction:column;gap:1mm}

  /* ── one wine ── */
  .row{flex:1;position:relative;background:var(--card);border-radius:2mm;
       border:.25mm solid rgba(255,255,255,.06);
       padding:1.1mm 3mm 1.1mm 1.6mm;
       display:grid;grid-template-columns:47mm 1fr auto;gap:3mm;
       align-items:center;box-shadow:0 1mm 2.6mm rgba(0,0,0,.45)}

  .shot{position:relative;display:flex;align-items:center;justify-content:center}
  .shot::before{content:"";position:absolute;width:42mm;height:9mm;
        border-radius:50%;background:radial-gradient(ellipse at 50% 50%,
        rgba(255,236,196,.20) 0%,rgba(255,236,196,0) 70%)}
  .shot img{position:relative;height:11.5mm;width:auto;
        filter:drop-shadow(0 .9mm 1.1mm rgba(0,0,0,.75))}

  .body{min-width:0}
  .name{display:flex;align-items:baseline;gap:2.4mm;flex-wrap:wrap}
  .en{font-size:7.6pt;font-weight:700;line-height:1.12;color:var(--white)}
  .ru{font-size:6pt;color:var(--gold);line-height:1.2}
  .note{margin-top:.8mm;font-size:6.2pt;line-height:1.3;color:#BDB4A9}
  .line{margin-top:.8mm;display:flex;align-items:baseline;gap:3mm;
        justify-content:space-between}
  .meta{font-size:5.1pt;letter-spacing:.1em;text-transform:uppercase;
        color:var(--muted);line-height:1.4}
  .meta b{color:#CFC5B8;font-weight:600}
  .pair{font-size:5.4pt;line-height:1.4;color:#CFC5B8;text-align:right;
        white-space:nowrap}
  .pair span{color:var(--gold);letter-spacing:.14em;text-transform:uppercase;
             font-size:4.8pt;font-weight:600;margin-right:1.2mm}

  .price{text-align:right;white-space:nowrap}
  .price .b{font-family:'Bebas Neue',sans-serif;font-size:14.5pt;line-height:.86;
            color:var(--gold);letter-spacing:.02em}
  .price .u{font-size:5pt;letter-spacing:.18em;text-transform:uppercase;
            color:var(--muted);margin-top:.5mm}

  /* ── by the glass ── */
  .sec.glass .row{background:linear-gradient(90deg,
        rgba(201,168,76,.14) 0%,rgba(201,168,76,.05) 45%,var(--card) 100%);
        border-color:rgba(201,168,76,.34)}
  .sec.glass .price .b{font-size:16pt}
  .glasspill{margin-top:.7mm;display:inline-block;border:.3mm solid var(--gold);
        border-radius:6mm;padding:.4mm 1.6mm;font-size:5.1pt;font-weight:700;
        letter-spacing:.1em;text-transform:uppercase;color:var(--gold)}

  .foot{margin-top:3.2mm;padding-top:2.2mm;border-top:.4mm solid var(--line);
        display:flex;justify-content:space-between;
        font-size:5.4pt;letter-spacing:.24em;text-transform:uppercase;
        color:var(--muted)}

  @page{size:210mm 297mm;margin:0}
  @media print{html,body{background:#fff}body{padding:0}
               .sheet{box-shadow:none}}
"""


def row_html(w):
    pill = (f'<div class="glasspill">Glass · Бокал {w["glass"]}.-</div>'
            if w["glass"] else "")
    return f"""
          <div class="row">
            <div class="shot"><img src="assets/h_{w['shot']}" alt=""></div>
            <div class="body">
              <div class="name">
                <span class="en">{w['en']}</span>
                <span class="ru">{w['ru']}</span>
              </div>
              <div class="note">{SHORT[w['shot']]}</div>
              <div class="line">
                <div class="meta"><b>{GRAPES.get(w['shot'], w['grapes'])}</b> &nbsp;·&nbsp; {w['maker'].split(' · ')[0]}</div>
                <div class="pair"><span>Pairs</span>{PAIR.get(w['shot'], w['pairing'])}</div>
              </div>
            </div>
            <div class="price">
              <div class="b">{w['price']}.-</div>
              <div class="u">Bottle</div>
              {pill}
            </div>
          </div>"""


def build_html():
    secs = []
    for label, cls, wines in sections():
        rows = "".join(row_html(w) for w in wines)
        secs.append(f"""
        <div class="sec {cls}" style="flex:{len(wines)} 1 auto">
          <div class="sec-head"><span>{label}</span><i></i></div>
          <div class="rows">{rows}</div>
        </div>""")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spice House — Wine List (single A4)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
  <div class="sheet">
    <div class="panel">
      <div class="head">
        <h1>Wine List</h1>
        <div class="sel">Selected by <b>Wine &amp; Whiskey</b></div>
      </div>
      <div class="stack">{''.join(secs)}</div>
      <div class="foot">
        <div>All prices in Thai baht</div>
        <div>Ask your waiter for a recommendation</div>
      </div>
    </div>
  </div>
</body>
</html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", action="store_true")
    args = ap.parse_args()

    lay_bottles_down()

    html_path = os.path.join(HERE, f"{SLUG}.html")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(build_html())
    print("html →", html_path)
    if args.html:
        return

    pdf_path = os.path.join(HERE, f"{SLUG}.pdf")
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", f"file://{html_path}"],
                   check=True, capture_output=True)
    print("pdf  →", pdf_path)

    subprocess.run(["pdftoppm", "-png", "-r", "150", "-singlefile", pdf_path,
                    os.path.join(HERE, f"{SLUG}_preview")], check=True)
    print("png  →", os.path.join(HERE, f"{SLUG}_preview.png"))


if __name__ == "__main__":
    main()
