#!/usr/bin/env python3
"""Spice House × Wine & Whiskey — A4 wine menu, two pages.

Selection: everything from page 1 of our Spice House list (BASIC WINE), the
first four of page 2 (CONSIGNMENT) and the orange. Prices are the current shelf
prices — they get replaced with the restaurant's own prices before printing.

Style: high-contrast dark, closer to reference #2 (dark slate, bottles cut out,
white type) than to the cream card layout we use in the shop list. The rust
frame and the letterspaced caps echo Spice House's own food menu so the two
sit on the same table without arguing.

Usage:
    python3 build.py            # html + pdf + page previews
    python3 build.py --html     # html only
"""
import argparse
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DATE = "2026-09-10"
SLUG = f"spice-house-wine-menu_{DATE}"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

GLASS = 200  # by-the-glass price for the two DUO wines

KUBAN = "Kuban-Vino · Taman"
ABRAU = "Abrau-Durso · Novorossiysk"


def wine(shot, en, ru, grapes, maker, note, pairing, price, glass=None):
    return dict(shot=shot, en=en, ru=ru, grapes=grapes, maker=maker,
                note=note, pairing=pairing, price=price, glass=glass)


PAGES = [
    dict(
        kicker="Bubbles & Whites",
        sections=[
            dict(
                label="Sparkling · Игристое", tone="gold",
                wines=[
                    wine(
                        "chateau-tamagne-sparkling-brut-white.png",
                        "Château Tamagne Brut",
                        "Шато Тамань Брют · белое игристое",
                        "White blend", KUBAN,
                        "The house aperitif. Green apple and citrus, a fine "
                        "persistent bead, dry clean finish.",
                        "Salmon bruschetta · Olivier",
                        530),
                    wine(
                        "abrau-durso-reserve-brut.png",
                        "Abrau-Durso Reserve Brut",
                        "Абрау-Дюрсо Резерв Брют · белое игристое",
                        "White blend", ABRAU,
                        "From Russia's oldest sparkling house, founded 1870. "
                        "Ripe apple and white flowers, dry and elegant.",
                        "Boiled beef tongue · Vinaigrette",
                        530),
                    wine(
                        "abrau-durso-victor-dravigny-brut.png",
                        "Abrau-Durso Victor Dravigny Brut",
                        "Абрау-Дюрсо «Виктор Дравиньи» Брют",
                        "Chardonnay · Pinot Blanc · Riesling", ABRAU,
                        "Named after the French cellar master who set the "
                        "house style in 1905. Long lees ageing — brioche, "
                        "hazelnut, fine mousse.",
                        "Salted salmon · Shrimp salad",
                        820),
                ]),
            dict(
                label="White · Белое", tone="white",
                wines=[
                    wine(
                        "chateau-tamagne-duo-blanc.png",
                        "Château Tamagne DUO Blanc",
                        "Шато Тамань «Дуо» · белое сухое",
                        "Pervenets Magaracha · Rkatsiteli", KUBAN,
                        "Pale straw, clean and dry. Green apple, citrus and a "
                        "crisp finish — the easiest pour on the list.",
                        "Salmon bruschetta · Vareniki with potato",
                        499, GLASS),
                    wine(
                        "chateau-tamagne-chardonnay.png",
                        "Château Tamagne Chardonnay",
                        "Шато Тамань Шардоне · белое сухое",
                        "Chardonnay 100%", KUBAN,
                        "Steel-fermented, no oak. White flowers, pear and "
                        "lemon zest; fresh and precise.",
                        "Salmon steak · Chicken soup",
                        549),
                    wine(
                        "chateau-tamagne-grape-dance-blanc.png",
                        "Château Tamagne Grape Dance",
                        "Шато Тамань «Танец винограда» · белое",
                        "Bianca · Grüner Tamanian · Chardonnay", KUBAN,
                        "An aromatic three-grape blend — peach, meadow herbs "
                        "and a gentle spice. Off the beaten path.",
                        "Phad Thai · Fried chicken with cashew nuts",
                        599),
                    wine(
                        "aristov-riesling.png",
                        "Aristov Riesling Meow",
                        "Аристов Рислинг «Мяу» · белое сухое",
                        "Riesling 100%", KUBAN,
                        "Riesling with a cat on the label: lime, white peach, "
                        "a flinty edge. Acidity that stands up to chilli.",
                        "Fried rice with shrimp · Phad Thai",
                        635),
                    wine(
                        "chateau-tamagne-signature-chardonnay.png",
                        "Château Tamagne Signature Chardonnay 2024",
                        "Шато Тамань Signature Шардоне · выдержка в стали",
                        "Chardonnay 100%", KUBAN,
                        "The top of the Chardonnay range, aged on the lees in "
                        "steel — riper fruit, creamier texture, long finish.",
                        "White snapper with vodka sauce · Salmon steak",
                        750),
                ]),
        ]),
    dict(
        kicker="Orange & Reds",
        sections=[
            dict(
                label="Orange · Оранжевое", tone="orange",
                wines=[
                    wine(
                        "chateau-tamagne-nature-orange.png",
                        "Château Tamagne Orange 2024",
                        "Шато Тамань Оранж · белое сухое",
                        "Citronny Magaracha 100%", KUBAN,
                        "White grapes fermented on their skins: amber colour, "
                        "dried apricot and citrus peel, a light grip of "
                        "tannin. A white that behaves like a red.",
                        "Phad Thai · Kharcho · Fried chicken with cashew nuts",
                        680),
                ]),
            dict(
                label="Red · Красное", tone="red",
                wines=[
                    wine(
                        "chateau-tamagne-duo-red.png",
                        "Château Tamagne DUO Rouge",
                        "Шато Тамань «Дуо» · красное сухое",
                        "Saperavi · Krasnostop · Tamansky Zweigelt", KUBAN,
                        "Deep ruby, soft and harmonious. Ripe dark berries "
                        "with no rough edges — the red for the whole table.",
                        "Boiled dumplings · Chicken steak",
                        499, GLASS),
                    wine(
                        "chateau-tamagne-cabernet.png",
                        "Château Tamagne Cabernet Sauvignon",
                        "Шато Тамань Каберне Совиньон · красное сухое",
                        "Cabernet Sauvignon 100%", KUBAN,
                        "Blackcurrant and bell pepper, medium body, dry "
                        "finish. The classic that never argues with the food.",
                        "Pepper beef · Beef burger",
                        549),
                    wine(
                        "chateau-tamagne-nude-saperavi.png",
                        "Château Tamagne NUDE Saperavi",
                        "Шато Тамань NUDE Саперави · нефильтрованное",
                        "Saperavi, unfiltered", KUBAN,
                        "Neither filtered nor fined — dark, juicy and a little "
                        "wild. Sour cherry, plum, a savoury finish.",
                        "Borsch · Dumplings with beef & lamb",
                        599),
                    wine(
                        "chateau-tamagne-nature-violet.png",
                        "Château Tamagne Violet Cabernet Sauvignon",
                        "Шато Тамань Violet Каберне Совиньон · красное сухое",
                        "Cabernet Sauvignon 100%", KUBAN,
                        "From the Nature line, made with minimal intervention: "
                        "violets and dark berries, supple tannin, bright.",
                        "Fried dumplings · Beer beef",
                        699),
                    wine(
                        "chateau-tamagne-signature-saperavi.png",
                        "Château Tamagne Signature Saperavi",
                        "Шато Тамань Signature Саперави · красное сухое",
                        "Saperavi 100%", KUBAN,
                        "The serious Saperavi: oak-aged, dense black fruit, "
                        "cocoa and dried herbs, firm confident finish.",
                        "Burgundy lamb · Pepper beef",
                        790),
                ]),
        ]),
]

CSS = """
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --ink:#0C0B0A;          /* page black                */
    --panel:#141110;        /* inner panel               */
    --card:#211C19;         /* wine card                 */
    --rust:#8E3F1E;         /* Spice House frame         */
    --rust-deep:#5E2712;
    --gold:#C9A84C;
    --white:#F7F3ED;
    --muted:#9C9288;
    --line:rgba(201,168,76,.20);
  }

  html,body{background:#2A2523}
  body{font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;
       display:flex;flex-direction:column;align-items:center;gap:26px;padding:26px}

  .sheet{width:210mm;height:297mm;position:relative;overflow:hidden;
         background:var(--rust);padding:5mm;color:var(--white);
         box-shadow:0 14px 50px rgba(0,0,0,.55)}
  .sheet::before{content:"";position:absolute;inset:0;
        background:radial-gradient(ellipse 120% 90% at 50% 0%,
                   rgba(214,120,60,.55) 0%,rgba(0,0,0,0) 62%),
                   linear-gradient(160deg,var(--rust) 0%,var(--rust-deep) 100%)}

  .panel{position:relative;height:100%;border-radius:5mm;overflow:hidden;
         background:var(--ink);padding:9mm 9mm 7mm;
         display:flex;flex-direction:column}
  .panel::before{content:"";position:absolute;inset:0;
        background:radial-gradient(ellipse 90% 55% at 50% -8%,
                   rgba(201,168,76,.16) 0%,rgba(0,0,0,0) 60%),
                   radial-gradient(ellipse 70% 40% at 50% 108%,
                   rgba(142,63,30,.30) 0%,rgba(0,0,0,0) 65%)}
  .panel::after{content:"";position:absolute;inset:0;opacity:.32;
        background-image:url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>\
<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/>\
<feColorMatrix type='saturate' values='0'/></filter>\
<rect width='180' height='180' filter='url(%23n)' opacity='.55'/></svg>");
        mix-blend-mode:overlay}
  .panel > *{position:relative;z-index:2}

  /* ─── header ─── */
  .head{display:flex;align-items:center;justify-content:space-between;
        padding-bottom:3.2mm;border-bottom:.4mm solid var(--line)}
  .head .mark{height:17mm;width:auto;border-radius:1.4mm;
              border:.3mm solid rgba(201,168,76,.30)}
  .head .mid{text-align:center;flex:1}
  .head h1{font-family:'Bebas Neue',sans-serif;font-size:31pt;line-height:.92;
           letter-spacing:.10em;color:var(--white)}
  .head .kicker{font-size:6.4pt;letter-spacing:.42em;text-transform:uppercase;
                color:var(--gold);margin-top:2.2mm}
  .head .house{text-align:right;font-size:6.2pt;letter-spacing:.26em;
               text-transform:uppercase;color:var(--muted);line-height:1.9;
               width:34mm}
  .head .house b{color:var(--white);font-weight:600}

  /* ─── section ─── */
  .stack{flex:1;display:flex;flex-direction:column;min-height:0}
  .sec{margin-top:4.4mm;display:flex;flex-direction:column;min-height:0}
  .sec-head{display:flex;align-items:center;gap:4mm;margin-bottom:2.8mm}
  .sec-head span{font-family:'Bebas Neue',sans-serif;font-size:12.5pt;
                 letter-spacing:.24em;color:var(--gold);white-space:nowrap}
  .sec-head i{flex:1;height:.35mm;background:linear-gradient(90deg,
              var(--line),rgba(201,168,76,0))}

  .grid{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:3.4mm 4mm;
        grid-auto-rows:minmax(0,1fr);align-content:stretch}
  .grid.solo{grid-template-columns:1fr}
  .card.wide{grid-column:1 / -1;grid-template-columns:22mm 1fr;
             padding:3.2mm 4mm 3.2mm 2.6mm}
  .card.wide .shot img{height:34mm}
  .card.wide .shot::before{width:19mm;height:34mm}
  .card.wide .en{font-size:9.4pt}
  .card.wide .ru{font-size:7pt}
  .card.wide .note{font-size:7pt}
  .card.wide .price .b{font-size:20pt}

  /* ─── wine card ─── */
  .card{position:relative;background:var(--card);border-radius:2.4mm;
        border:.3mm solid rgba(255,255,255,.07);
        padding:2.8mm 3.2mm 2.8mm 2.2mm;
        display:grid;grid-template-columns:16mm 1fr;gap:2.4mm;align-items:center;
        box-shadow:0 1.6mm 4mm rgba(0,0,0,.5)}

  .shot{position:relative;height:auto;
        display:flex;align-items:center;justify-content:center}
  .shot::before{content:"";position:absolute;width:15mm;height:30mm;
        border-radius:50%;background:radial-gradient(ellipse at 50% 50%,
        rgba(255,236,196,.22) 0%,rgba(255,236,196,0) 72%)}
  .shot img{position:relative;height:31mm;width:auto;
        filter:drop-shadow(-1.2mm 1.4mm 1.6mm rgba(0,0,0,.75))}
  .card.tall .shot img{height:38mm}

  .body{min-width:0}
  .top{display:flex;align-items:flex-start;justify-content:space-between;gap:3mm}
  .en{font-size:8.6pt;font-weight:700;line-height:1.16;letter-spacing:.012em;
      color:var(--white)}
  .ru{font-size:6.5pt;font-weight:400;color:var(--gold);margin-top:.8mm;
      line-height:1.22}
  .meta{margin-top:1.4mm;font-size:5.5pt;letter-spacing:.13em;
        text-transform:uppercase;color:var(--muted);line-height:1.6}
  .meta b{color:#CFC5B8;font-weight:600}
  .note{margin-top:1.4mm;font-size:6.7pt;line-height:1.42;color:#BDB4A9}
  .pair{margin-top:1.7mm;padding-top:1.4mm;border-top:.25mm solid rgba(255,255,255,.08);
        font-size:6.3pt;line-height:1.32;color:#D8D0C4}
  .pair span{color:var(--gold);letter-spacing:.18em;text-transform:uppercase;
             font-size:5.4pt;font-weight:600;margin-right:1.4mm}

  .price{text-align:right;white-space:nowrap;flex:0 0 auto}
  .price .b{font-family:'Bebas Neue',sans-serif;font-size:18pt;line-height:.86;
            color:var(--gold);letter-spacing:.02em}
  .price .u{font-size:5.6pt;letter-spacing:.2em;text-transform:uppercase;
            color:var(--muted);margin-top:.6mm}

  .glass{margin-top:1.4mm;display:inline-block;border:.3mm solid var(--gold);
         border-radius:6mm;padding:.7mm 2mm;font-size:5.6pt;font-weight:600;
         letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}

  /* ─── foot ─── */
  .foot{margin-top:auto;padding-top:3.4mm;display:flex;
        align-items:flex-end;justify-content:space-between;
        border-top:.4mm solid var(--line);
        font-size:5.8pt;letter-spacing:.24em;text-transform:uppercase;
        color:var(--muted)}
  .foot .r{text-align:right;line-height:1.9}
  .foot .r b{color:var(--gold);font-weight:600}

  @page{size:210mm 297mm;margin:0}
  @media print{
    html,body{background:#fff}
    body{gap:0;padding:0}
    .sheet{box-shadow:none;break-after:page}
    .sheet:last-child{break-after:auto}
  }
"""


def card_html(w, tall=False, wide=False):
    glass = (f'<div class="glass">Glass · Бокал {w["glass"]}.-</div>'
             if w["glass"] else "")
    return f"""
        <div class="card{' tall' if tall else ''}{' wide' if wide else ''}">
          <div class="shot"><img src="assets/{w['shot']}" alt=""></div>
          <div class="body">
            <div class="top">
              <div>
                <div class="en">{w['en']}</div>
                <div class="ru">{w['ru']}</div>
              </div>
              <div class="price">
                <div class="b">{w['price']}.-</div>
                <div class="u">Bottle</div>
                {glass}
              </div>
            </div>
            <div class="meta"><b>{w['grapes']}</b> &nbsp;·&nbsp; {w['maker']}</div>
            <div class="note">{w['note']}</div>
            <div class="pair"><span>Pairs with</span>{w['pairing']}</div>
          </div>
        </div>"""


def page_html(page, idx):
    secs = []
    for sec in page["sections"]:
        n = len(sec["wines"])
        solo = n == 1
        cards = "".join(
            card_html(w, tall=solo, wide=(not solo and n % 2 and i == n - 1))
            for i, w in enumerate(sec["wines"]))
        rows = (n + 1) // 2
        secs.append(f"""
      <div class="sec" style="flex:{rows} 1 auto">
        <div class="sec-head"><span>{sec['label']}</span><i></i></div>
        <div class="grid{' solo' if solo else ''}">{cards}</div>
      </div>""")
    return f"""
  <div class="sheet">
    <div class="panel">
      <div class="head">
        <img class="mark" src="assets/channel_avatar_dark.png" alt="">
        <div class="mid">
          <h1>Wine List</h1>
          <div class="kicker">{page['kicker']}</div>
        </div>
        <div class="house">Selected by<br><b>Wine &amp; Whiskey</b><br>for Spice House</div>
      </div>
      <div class="stack">{''.join(secs)}</div>
      <div class="foot">
        <div>All wines available by the bottle · Page {idx} of 2</div>
        <div class="r">Ask your waiter for a recommendation<br>
          <b>Wine &amp; Whiskey Phuket</b></div>
      </div>
    </div>
  </div>"""


def build_html():
    pages = "".join(page_html(p, i + 1) for i, p in enumerate(PAGES))
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spice House — Wine List by Wine &amp; Whiskey</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>{pages}
</body>
</html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", action="store_true", help="write html only")
    args = ap.parse_args()

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

    subprocess.run(["pdftoppm", "-png", "-r", "150", pdf_path,
                    os.path.join(HERE, f"{SLUG}_page")], check=True)
    print("png  → page previews")

    from PIL import Image
    pages = [Image.open(os.path.join(HERE, f"{SLUG}_page-{i}.png")) for i in (1, 2)]
    gap, pad = 40, 40
    w = sum(p.width for p in pages) + gap + pad * 2
    h = max(p.height for p in pages) + pad * 2
    sheet = Image.new("RGB", (w, h), (42, 37, 35))
    x = pad
    for pg in pages:
        sheet.paste(pg, (x, pad))
        x += pg.width + gap
    sheet.thumbnail((2400, 2400))
    preview = os.path.join(HERE, f"{SLUG}_preview.png")
    sheet.save(preview)
    print("png  →", preview)


if __name__ == "__main__":
    main()
