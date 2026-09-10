#!/usr/bin/env python3
"""Spice House × Wine & Whiskey — the whole list on ONE A4 sheet.

Same fourteen wines as build.py, one page instead of two, bottles lying down.
Names, prices and grapes are read from build.py; this file holds the shortened
copy the one-line rows need, and everything about the layout.

What the sheet does:

  · nothing of ours appears on it — no monogram, no credit line: it is the
    restaurant's menu, and the wine is the restaurant's to sell;
  · By the Glass sits on top — the two DUO wines, also the two cheapest, so the
    list climbs from 1290 to 2190 as the guest reads down;
  · prices live in two columns, glass first and bottle second, so a wine poured
    by the glass reads "250 | 1 290" and every bottle price lines up under one
    edge;
  · each group carries a colour — a solid band with the name centred in it, and
    a bar down the left of every row — because five stacks of identical rows
    blur together;
  · every bottle is scaled to the same length, runs from the coloured bar to
    the text and dissolves into that bar at its base, so the eye starts at the
    label;
  · two icons carry what used to be words: grapes before the variety, fork and
    knife before the pairing.

Themes: dark (on the table) and light (--theme light) — the print-friendly one,
little ink and no fingerprints.

Usage:
    python3 build_a4.py                  # dark
    python3 build_a4.py --theme light
    python3 build_a4.py --theme both
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

# ── bottle normalisation ────────────────────────────────────────────────
# Every bottle ends in the same box: same thickness, same length, base fading
# out to the left. Real bottles differ by a centimetre here and there, and in a
# stacked column that difference reads as sloppiness.
LAY_W = 1330     # length, px — every bottle is scaled to exactly this, so it
                 # spans from the coloured bar to the text on its own, with
                 # nothing stretched and no label ever cropped.
LAY_H = 352      # the diameter a bottle of average build ends up with
DAMP = 0.5       # how far a bottle's real thickness is pulled towards that
                 # average: 1 keeps life-size differences (a fat sparkling
                 # bottle beside a slim Riesling reads as an accident), 0 makes
                 # them identical and visibly squashed. Halfway looks natural.
FADE = 0.18      # the left of the canvas dissolves, so the bottle comes out of
                 # the coloured bar instead of floating in the middle of a row

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

# Two names are long enough to push their row onto a second line. The vintage
# and the varietal they give up are carried by the Russian name instead.
NAME = {
    "chateau-tamagne-signature-chardonnay.png": "Château Tamagne Signature Chardonnay",
    "chateau-tamagne-nature-violet.png": "Château Tamagne Violet Cabernet",
}
RU = {
    "chateau-tamagne-signature-chardonnay.png":
        "Signature Шардоне 2024 · выдержка в стали",
    "chateau-tamagne-nature-violet.png":
        "Violet Каберне Совиньон · красное сухое",
}

# Grape lists that would wrap onto a second line at this row height.
GRAPES = {
    "chateau-tamagne-duo-red.png": "Saperavi · Krasnostop · Zweigelt",
    "abrau-durso-victor-dravigny-brut.png": "Chardonnay · Pinot Blanc · Riesling",
}

# Pairings that need to be shorter on one line than on the two-page sheet.
PAIR = {
    "chateau-tamagne-nature-orange.png": "Phad Thai · Kharcho",
    "chateau-tamagne-grape-dance-blanc.png": "Phad Thai · Cashew chicken",
    "chateau-tamagne-signature-chardonnay.png": "White snapper · Salmon steak",
    "chateau-tamagne-duo-blanc.png": "Salmon bruschetta · Vareniki",
    "chateau-tamagne-duo-red.png": "Dumplings · Chicken steak",
    "chateau-tamagne-nude-saperavi.png": "Borsch · Lamb dumplings",
    "abrau-durso-reserve-brut.png": "Beef tongue · Vinaigrette",
}

# Group colours. Dark and light need different values of the same hue: what
# glows on black turns to mud on paper.
ACCENT = {
    "glass":     ("#D8B45C", "#9A7420"),
    "sparkling": ("#E2C97A", "#A8842F"),
    "white":     ("#CFC08A", "#8C7A3A"),
    "orange":    ("#DE8C3A", "#B4611A"),
    "red":       ("#C0453C", "#8C1C1C"),
}

ICON_GRAPES = ("<svg viewBox='0 0 24 24' fill='currentColor'>"
               "<circle cx='9' cy='13' r='2.6'/><circle cx='15' cy='13' r='2.6'/>"
               "<circle cx='12' cy='17.6' r='2.6'/><circle cx='12' cy='8.6' r='2.6'/>"
               "<path d='M12.8 6.2c0-2 .9-3.4 2.6-4.2l.7 1.4c-1.1.5-1.7 1.4-1.7 2.8z'/>"
               "</svg>")
ICON_FORK = ("<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' "
             "stroke-width='2' stroke-linecap='round'>"
             "<path d='M6 2v7a2.5 2.5 0 0 0 5 0V2M8.5 11.5V22'/>"
             "<path d='M17.5 2c-1.7 1.4-2.5 3.3-2.5 5.6 0 1.9.8 3 2.5 3.4V22'/>"
             "</svg>")
ICON_GLASS = ("<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' "
              "stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>"
              "<path d='M6 3h12l-1 6a5 5 0 0 1-10 0z'/><path d='M12 14v6M8.5 20h7'/>"
              "</svg>")
ICON_BOTTLE = ("<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' "
               "stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>"
               "<path d='M10 2h4v4.5c0 1.2 2.5 2.6 2.5 5V21a1 1 0 0 1-1 1h-7a1 1 "
               "0 0 1-1-1v-9.5c0-2.4 2.5-3.8 2.5-5z'/></svg>")


def flatten():
    """All wines from the two-page layout, tagged with their section."""
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
        ("Sparkling · Игристое", "sparkling", of("Sparkling")),
        ("White · Белое", "white", of("White")),
        ("Orange · Оранжевое", "orange", of("Orange")),
        ("Red · Красное", "red", of("Red")),
    ]


def lay_bottles_down():
    """Rotate, scale and fade every bottle into one shared silhouette."""
    src = os.path.join(HERE, "assets")
    made = 0
    for name in sorted(os.listdir(src)):
        if not name.endswith(".png") or name.startswith(("lay_", "channel_")):
            continue
        out = os.path.join(src, f"lay_{name}")
        if os.path.exists(out):
            continue

        im = Image.open(os.path.join(src, name)).convert("RGBA")
        im = im.rotate(-90, expand=True)          # neck to the right, into the text
        box = im.getbbox()
        if box:
            im = im.crop(box)

        # Every bottle is scaled to the same length, so each one runs from the
        # coloured bar to the text with its own base, shoulder and neck —
        # nothing stretched, nothing cropped, no label lost. Scaled honestly a
        # slim Riesling would come out much thinner than a fat sparkling
        # bottle, so the diameter is pulled part of the way to the average.
        true_h = LAY_W * im.height / im.width
        height = max(1, round(LAY_H * (true_h / LAY_H) ** DAMP))
        canvas = im.resize((LAY_W, height), Image.LANCZOS)

        # the base dissolves into the bar it comes out of
        alpha = canvas.getchannel("A")
        edge = max(1, int(LAY_W * FADE))
        ramp = Image.new("L", (LAY_W, 1))
        ramp.putdata([min(255, int(255 * (x / edge) ** 1.15)) if x < edge else 255
                      for x in range(LAY_W)])
        canvas.putalpha(Image.composite(alpha, Image.new("L", alpha.size, 0),
                                        ramp.resize((LAY_W, height))))
        canvas.save(out)
        made += 1
    if made:
        print(f"bottles laid down → {made} files")


CSS = """
  *{box-sizing:border-box;margin:0;padding:0}

  /* ── dark: the on-table version ── */
  .sheet.dark{
    --ink:#0C0B0A; --card:#211C19; --band:rgba(255,255,255,.05);
    --frame:#8E3F1E; --frame2:#5E2712;
    --text:#F7F3ED; --note:#BDB4A9; --muted:#9C9288;
    --price:#C9A84C; --rule:rgba(201,168,76,.20); --onaccent:#17130F;
    --edge:rgba(255,255,255,.06); --shadow:rgba(0,0,0,.45);
  }
  /* ── light: the print version ── */
  .sheet.light{
    --ink:#FBF7EF; --card:#FFFFFF; --band:rgba(142,63,30,.08);
    --frame:#A9552B; --frame2:#7E3A17;
    --text:#231F1B; --note:#4E463D; --muted:#877C6E;
    --price:#8C1C1C; --rule:rgba(142,63,30,.28); --onaccent:#FFF6EA;
    --edge:rgba(35,31,27,.13); --shadow:rgba(90,60,35,.13);
  }

  html,body{background:#2A2523}
  body{font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;
       display:flex;flex-direction:column;align-items:center;gap:26px;padding:26px}

  .sheet{width:210mm;height:297mm;position:relative;overflow:hidden;
         background:var(--frame);padding:4mm;color:var(--text);
         box-shadow:0 14px 50px rgba(0,0,0,.55)}
  .sheet::before{content:"";position:absolute;inset:0;
        background:radial-gradient(ellipse 120% 90% at 50% 0%,
                   rgba(214,120,60,.55) 0%,rgba(0,0,0,0) 62%),
                   linear-gradient(160deg,var(--frame) 0%,var(--frame2) 100%)}

  .panel{position:relative;height:100%;border-radius:4mm;overflow:hidden;
         background:var(--ink);padding:6mm 8mm 4.5mm;
         display:flex;flex-direction:column}
  .panel > *{position:relative;z-index:2}
  .sheet.dark .panel::before{content:"";position:absolute;inset:0;
        background:radial-gradient(ellipse 90% 50% at 50% -10%,
                   rgba(201,168,76,.16) 0%,rgba(0,0,0,0) 60%),
                   radial-gradient(ellipse 70% 40% at 50% 110%,
                   rgba(142,63,30,.30) 0%,rgba(0,0,0,0) 65%)}
  .sheet.dark .panel::after{content:"";position:absolute;inset:0;opacity:.30;
        background-image:url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>\
<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/>\
<feColorMatrix type='saturate' values='0'/></filter>\
<rect width='180' height='180' filter='url(%23n)' opacity='.55'/></svg>");
        mix-blend-mode:overlay}
  .sheet.light .panel::before{content:"";position:absolute;inset:0;
        background:radial-gradient(ellipse 80% 40% at 50% -6%,
                   rgba(169,85,43,.10) 0%,rgba(0,0,0,0) 62%)}

  /* ── header ── */
  .head{text-align:center;padding-bottom:1.8mm;border-bottom:.4mm solid var(--rule)}
  .head h1{font-family:'Bebas Neue',sans-serif;font-size:23pt;line-height:.9;
           letter-spacing:.14em}

  .stack{flex:1;display:flex;flex-direction:column;min-height:0}

  /* ── group ── */
  .sec{display:flex;flex-direction:column;margin-top:1.6mm}
  .sec:first-child{margin-top:1.4mm}
  .sec-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;
            margin-bottom:.8mm;padding:.7mm 3mm;border-radius:1.4mm;
            background:var(--accent);color:var(--onaccent)}
  .sec-head > span{grid-column:2;justify-self:center;
                   font-family:'Bebas Neue',sans-serif;font-size:11.5pt;
                   letter-spacing:.24em;color:var(--onaccent);white-space:nowrap}
  .cols{grid-column:3;justify-self:end;display:flex;font-size:4.9pt;
        letter-spacing:.16em;text-transform:uppercase;color:var(--onaccent);
        opacity:.72}
  .cols u{text-decoration:none;display:flex;align-items:center;
          justify-content:flex-end;gap:1mm}
  .cols u.g{width:13mm}
  .cols u.b{width:19mm}
  .cols svg{width:2.1mm;height:2.1mm}

  .rows{flex:1;display:flex;flex-direction:column;gap:.8mm}

  /* ── one wine ── */
  .row{flex:1;position:relative;background:var(--card);border-radius:1.8mm;
       border:.25mm solid var(--edge);border-left:1.5mm solid var(--accent);
       padding:.6mm 2.6mm .6mm 0;
       display:grid;grid-template-columns:50mm 1fr auto;gap:2.5mm;
       align-items:center;box-shadow:0 1mm 2.4mm var(--shadow)}

  .shot{position:relative;display:flex;align-items:center;justify-content:center}
  .shot img{position:relative;width:50mm;height:auto;display:block}
  .sheet.dark .shot img{filter:drop-shadow(0 .9mm 1.1mm rgba(0,0,0,.75))}
  .sheet.light .shot img{filter:drop-shadow(0 .7mm .9mm rgba(90,60,35,.30))}

  .body{min-width:0}
  .name{display:flex;align-items:baseline;gap:2.4mm;flex-wrap:wrap}
  .en{font-size:7.6pt;font-weight:700;line-height:1.12;color:var(--text)}
  .ru{font-size:6pt;color:var(--price);line-height:1.2}
  .sheet.light .ru{color:#7A4A22}
  .note{margin-top:.6mm;font-size:6.2pt;line-height:1.22;color:var(--note)}
  .line{margin-top:.6mm;display:flex;align-items:center;gap:3mm;
        justify-content:space-between}
  .meta,.pair{display:flex;align-items:center;gap:1.1mm;line-height:1.32}
  .meta{flex:1 1 auto;min-width:0;font-size:4.7pt;letter-spacing:.05em;
        text-transform:uppercase;color:var(--muted)}
  .meta b{color:var(--note);font-weight:600}
  .pair{flex:0 0 auto;font-size:5.3pt;color:var(--note);white-space:nowrap}
  .ic{flex:0 0 auto;width:2.5mm;height:2.5mm;color:var(--accent)}
  .ic svg{width:100%;height:100%;display:block}

  /* ── prices: glass column, bottle column ── */
  .price{display:flex;align-items:baseline}
  .price u{text-decoration:none;display:block;text-align:right}
  .price u.g{width:13mm}
  .price u.b{width:19mm}
  .price span{font-family:'Bebas Neue',sans-serif;font-size:15pt;
              line-height:.9;color:var(--price);letter-spacing:.02em}
  .price u.g span{font-size:13.5pt;opacity:.92}

  .sec.glass .row{background:linear-gradient(90deg,
        color-mix(in srgb,var(--accent) 15%,var(--card)) 0%,var(--card) 62%)}

  /* ── foot ── */
  .foot{margin-top:2.4mm;padding-top:1.8mm;border-top:.4mm solid var(--rule);
        display:flex;justify-content:space-between;
        font-size:5.4pt;letter-spacing:.24em;text-transform:uppercase;
        color:var(--muted)}

  @page{size:210mm 297mm;margin:0}
  @media print{html,body{background:#fff}body{gap:0;padding:0}
               .sheet{box-shadow:none;break-after:page}
               .sheet:last-child{break-after:auto}}
"""


def ru_name(w):
    """The Russian name without the house, which the English name just said.

    "Château Tamagne Chardonnay · Шато Тамань Шардоне" spends a third of the
    line saying the same words twice, and it is exactly the third that pushes
    the longest names onto a second line.
    """
    ru = RU.get(w["shot"], w["ru"])
    for house in ("Шато Тамань ", "Абрау-Дюрсо ", "Аристов "):
        if ru.startswith(house):
            return ru[len(house):]
    return ru


def baht(price):
    """1290 → 1 290, with a space that never breaks the line."""
    return f"{price:,}".replace(",", "\u202f")


def row_html(w):
    glass = (f'<u class="g"><span>{baht(w["glass"])}</span></u>' if w["glass"]
             else '<u class="g"></u>')
    return f"""
          <div class="row">
            <div class="shot"><img src="assets/lay_{w['shot']}" alt=""></div>
            <div class="body">
              <div class="name">
                <span class="en">{NAME.get(w['shot'], w['en'])}</span>
                <span class="ru">{ru_name(w)}</span>
              </div>
              <div class="note">{SHORT[w['shot']]}</div>
              <div class="line">
                <div class="meta"><i class="ic">{ICON_GRAPES}</i>
                  <span><b>{GRAPES.get(w['shot'], w['grapes'])}</b>
                  &nbsp;·&nbsp; {w['maker'].split(' · ')[0]}</span></div>
                <div class="pair"><i class="ic">{ICON_FORK}</i>
                  <span>{PAIR.get(w['shot'], w['pairing'])}</span></div>
              </div>
            </div>
            <div class="price">
              {glass}
              <u class="b"><span>{baht(w['price'])}</span></u>
            </div>
          </div>"""


def sheet_html(theme):
    secs = []
    for label, key, wines in sections():
        accent = ACCENT[key][0 if theme == "dark" else 1]
        cols = (f'<div class="cols"><u class="g">{ICON_GLASS}Glass</u>'
                f'<u class="b">{ICON_BOTTLE}Bottle</u></div>' if key == "glass"
                else f'<div class="cols"><u class="g"></u>'
                     f'<u class="b">{ICON_BOTTLE}Bottle</u></div>')
        rows = "".join(row_html(w) for w in wines)
        secs.append(f"""
        <div class="sec {key}" style="--accent:{accent};flex:{len(wines)} 1 auto">
          <div class="sec-head"><span>{label}</span>{cols}</div>
          <div class="rows">{rows}</div>
        </div>""")
    return f"""
  <div class="sheet {theme}">
    <div class="panel">
      <div class="head">
        <h1>Wine List</h1>
      </div>
      <div class="stack">{''.join(secs)}</div>
      <div class="foot">
        <div>All prices in Thai baht</div>
        <div>Ask your waiter for a recommendation</div>
      </div>
    </div>
  </div>"""


def build_html(themes):
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
<body>{''.join(sheet_html(t) for t in themes)}
</body>
</html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--theme", choices=("dark", "light", "both"), default="dark")
    ap.add_argument("--html", action="store_true")
    args = ap.parse_args()

    lay_bottles_down()

    themes = ("dark", "light") if args.theme == "both" else (args.theme,)
    for theme in themes:
        slug = SLUG if theme == "dark" else f"{SLUG}-light"
        html_path = os.path.join(HERE, f"{slug}.html")
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(build_html([theme]))
        print("html →", html_path)
        if args.html:
            continue

        pdf_path = os.path.join(HERE, f"{slug}.pdf")
        subprocess.run([CHROME, "--headless", "--disable-gpu",
                        "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}",
                        f"file://{html_path}"], check=True, capture_output=True)
        print("pdf  →", pdf_path)
        subprocess.run(["pdftoppm", "-png", "-r", "150", "-singlefile", pdf_path,
                        os.path.join(HERE, f"{slug}_preview")], check=True)
        print("png  →", os.path.join(HERE, f"{slug}_preview.png"))


if __name__ == "__main__":
    main()
