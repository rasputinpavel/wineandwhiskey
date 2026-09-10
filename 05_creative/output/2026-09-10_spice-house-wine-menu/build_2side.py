#!/usr/bin/env python3
"""Spice House × Wine & Whiskey — the list as a two-sided A4 card.

The same fourteen wines as build_a4.py, but with room to breathe: bottles stand
up and get big, and each side has a shape of its own instead of fourteen equal
rows.

  FRONT   the top third is By the Glass — two wide cards, both prices side by
          side. The remaining two thirds go to Sparkling (three across) and
          Orange (one wide card, the only skin-contact wine on the list, so it
          gets the full width).

  BACK    White and Red, four bottles each, laid out four across and staggered:
          every second card drops a step, so the eye walks the page instead of
          reading a table.

Content, colours, icons and prices all come from build.py / build_a4.py — this
file is layout only.

Usage:
    python3 build_2side.py                  # dark
    python3 build_2side.py --theme light
    python3 build_2side.py --theme both
"""
import argparse
import os
import subprocess

from build import PAGES
from build_a4 import (ACCENT, GRAPES, ICON_BOTTLE, ICON_FORK, ICON_GLASS,
                      ICON_GRAPES, NAME, PAIR, RU, SHORT, baht, flatten,
                      ru_name)

HERE = os.path.dirname(os.path.abspath(__file__))
DATE = "2026-09-10"
SLUG = f"spice-house-wine-menu-2side_{DATE}"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def groups():
    wines = flatten()
    by_glass = [w for w in wines if w["glass"]]
    rest = [w for w in wines if not w["glass"]]

    def of(label):
        return [w for w in rest if w["label"] == label]

    return dict(glass=by_glass, sparkling=of("Sparkling"), white=of("White"),
                orange=of("Orange"), red=of("Red"))


CSS = """
  *{box-sizing:border-box;margin:0;padding:0}

  .sheet.dark{
    --ink:#0C0B0A; --card:#211C19; --band:rgba(255,255,255,.05);
    --frame:#8E3F1E; --frame2:#5E2712;
    --text:#F7F3ED; --note:#BDB4A9; --muted:#9C9288;
    --price:#C9A84C; --rule:rgba(201,168,76,.20); --onaccent:#17130F;
    --edge:rgba(255,255,255,.06); --shadow:rgba(0,0,0,.45);
    --glow:rgba(255,236,196,.13); --floor:rgba(0,0,0,.55);
  }
  .sheet.light{
    --ink:#FBF7EF; --card:#FFFFFF; --band:rgba(142,63,30,.08);
    --frame:#A9552B; --frame2:#7E3A17;
    --text:#231F1B; --note:#4E463D; --muted:#877C6E;
    --price:#8C1C1C; --rule:rgba(142,63,30,.28); --onaccent:#FFF6EA;
    --edge:rgba(35,31,27,.13); --shadow:rgba(90,60,35,.13);
    --glow:rgba(169,85,43,.07); --floor:rgba(90,60,35,.20);
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
         background:var(--ink);padding:6mm 8mm 5mm;
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
  .head{text-align:center;padding-bottom:2mm;border-bottom:.4mm solid var(--rule)}
  .head h1{font-family:'Bebas Neue',sans-serif;font-size:23pt;line-height:.9;
           letter-spacing:.14em}
  .head .side{margin-top:.8mm;font-size:5.2pt;letter-spacing:.4em;
              text-transform:uppercase;color:var(--muted)}

  .stack{flex:1;display:flex;flex-direction:column;min-height:0}

  /* ── group band ── */
  .band{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;
        padding:.9mm 3mm;border-radius:1.4mm;
        background:var(--accent);color:var(--onaccent)}
  .band > span{grid-column:2;justify-self:center;
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

  .sec{display:flex;flex-direction:column;margin-top:3mm}
  .sec:first-child{margin-top:2.4mm}

  /* ── shared bits of a card ── */
  .en{font-weight:700;line-height:1.14;color:var(--text)}
  .ru{color:var(--price);line-height:1.22}
  .sheet.light .ru{color:#7A4A22}
  .note{color:var(--note)}
  .meta,.pair{display:flex;align-items:center;gap:1.3mm;line-height:1.3}
  .meta{font-size:5.2pt;letter-spacing:.06em;text-transform:uppercase;
        color:var(--muted)}
  .meta b{color:var(--note);font-weight:600}
  .pair{font-size:5.8pt;color:var(--note)}
  .ic{flex:0 0 auto;width:2.6mm;height:2.6mm;color:var(--accent)}
  .ic svg{width:100%;height:100%;display:block}

  .price{display:flex;align-items:baseline}
  .price u{text-decoration:none;display:block;text-align:right}
  .price u.g{width:13mm}
  .price u.b{width:19mm}
  .price span{font-family:'Bebas Neue',sans-serif;font-size:17pt;line-height:.9;
              color:var(--price);letter-spacing:.02em}
  .price u.g span{font-size:15pt;opacity:.92}

  /* a standing bottle, lit from behind and standing on its own shadow */
  .stand{position:relative;display:flex;align-items:flex-end;
         justify-content:center}
  .stand::before{content:"";position:absolute;left:50%;top:6%;
        width:26mm;height:88%;margin-left:-13mm;border-radius:50%;
        background:radial-gradient(ellipse at 50% 50%,
                   var(--glow) 0%,rgba(255,236,196,0) 70%)}
  .stand::after{content:"";position:absolute;bottom:-.6mm;left:50%;
        width:20mm;height:3.4mm;margin-left:-10mm;border-radius:50%;
        background:radial-gradient(ellipse at 50% 50%,
                   var(--floor) 0%,rgba(0,0,0,0) 72%)}
  .stand img{position:relative;width:auto;display:block}
  .sheet.dark .stand img{filter:drop-shadow(-1.4mm 1.2mm 1.6mm rgba(0,0,0,.7))}
  .sheet.light .stand img{filter:drop-shadow(-1mm 1mm 1.4mm rgba(90,60,35,.26))}

  /* ── wide card: bottle left, copy right (glass pours, orange) ── */
  .wide{background:var(--card);border-radius:2mm;border:.25mm solid var(--edge);
        border-left:1.5mm solid var(--accent);box-shadow:0 1mm 3mm var(--shadow);
        padding:3mm 3.4mm 3mm 2mm;display:grid;grid-template-columns:26mm 1fr;
        gap:3mm;align-items:stretch}
  .wide .body{display:flex;flex-direction:column;height:100%}
  .wide.solo{grid-template-columns:26mm 1fr auto;align-items:center}
  .wide.solo .price{margin-top:0;padding-top:0}
  .wide.solo .note{max-width:118mm}
  .wide.solo .stand img{height:40mm}   /* the strip is shorter than a glass card */
  .wide .price{margin-top:auto;padding-top:2mm;justify-content:flex-end}
  .wide .stand img{height:52mm}
  .wide .en{font-size:9.4pt}
  .wide .ru{font-size:6.8pt;margin-top:.8mm}
  .wide .note{font-size:6.8pt;line-height:1.4;margin-top:1.6mm}
  .wide .meta{margin-top:1.8mm}
  .wide .pair{margin-top:1.4mm}

  /* ── tall card: bottle above, copy below ── */
  .tall{background:var(--card);border-radius:2mm;border:.25mm solid var(--edge);
        border-top:1.5mm solid var(--accent);box-shadow:0 1mm 3mm var(--shadow);
        padding:2.6mm 2.8mm 2.8mm;display:flex;flex-direction:column;
        align-items:center;text-align:center}
  .tall .stand{flex:1;width:100%}
  .tall .en{font-size:7.6pt;margin-top:2.2mm}
  .tall .ru{font-size:6pt;margin-top:.7mm}
  .tall .note{font-size:6pt;line-height:1.32;margin-top:1.4mm}
  .tall .meta,.tall .pair{justify-content:center;text-align:center}
  .tall .meta{margin-top:1.6mm;font-size:5pt}
  .tall .pair{margin-top:1mm;font-size:5.6pt}
  .tall .price{margin-top:1.8mm;justify-content:center}
  .tall .price u.b{width:auto;text-align:center}
  .tall .price span{font-size:15pt}

  .row3{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;flex:1}
  .row4{display:grid;grid-template-columns:repeat(4,1fr);gap:3.4mm;flex:1}
  .row4 .tall:nth-child(even){margin-top:7mm}
  .row4 .tall:nth-child(odd){margin-bottom:7mm}
  .row4 .stand img{height:60mm}
  .row3 .stand img{height:70mm}

  /* ── foot ── */
  .foot{margin-top:3mm;padding-top:2mm;border-top:.4mm solid var(--rule);
        display:flex;justify-content:space-between;
        font-size:5.4pt;letter-spacing:.24em;text-transform:uppercase;
        color:var(--muted)}

  @page{size:210mm 297mm;margin:0}
  @media print{html,body{background:#fff}body{gap:0;padding:0}
               .sheet{box-shadow:none;break-after:page}
               .sheet:last-child{break-after:auto}}
"""


def prices(w):
    glass = (f'<u class="g"><span>{baht(w["glass"])}</span></u>' if w["glass"]
             else "")
    return (f'<div class="price">{glass}'
            f'<u class="b"><span>{baht(w["price"])}</span></u></div>')


def facts(w, short=False):
    note = SHORT[w["shot"]] if short else w["note"]
    return f"""
        <div class="note">{note}</div>
        <div class="meta"><i class="ic">{ICON_GRAPES}</i>
          <span><b>{GRAPES.get(w['shot'], w['grapes'])}</b>
          &nbsp;·&nbsp; {w['maker'].split(' · ')[0]}</span></div>
        <div class="pair"><i class="ic">{ICON_FORK}</i>
          <span>{PAIR.get(w['shot'], w['pairing'])}</span></div>"""


def name_block(w):
    return f"""
        <div class="en">{NAME.get(w['shot'], w['en'])}</div>
        <div class="ru">{ru_name(w)}</div>"""


def wide_card(w, short=False, solo=False):
    """solo: a card that owns the full width — the price moves to its own column."""
    body = f"""<div class="body">
          {name_block(w)}
          {facts(w, short)}
          {"" if solo else prices(w)}
        </div>"""
    return f"""
      <div class="wide{' solo' if solo else ''}">
        <div class="stand"><img src="assets/{w['shot']}" alt=""></div>
        {body}
        {prices(w) if solo else ""}
      </div>"""


def tall_card(w):
    return f"""
      <div class="tall">
        <div class="stand"><img src="assets/{w['shot']}" alt=""></div>
        {name_block(w)}
        {facts(w, short=True)}
        {prices(w)}
      </div>"""


def band(label, key, theme, with_glass=False):
    accent = ACCENT[key][0 if theme == "dark" else 1]
    cols = (f'<u class="g">{ICON_GLASS}Glass</u>' if with_glass
            else '<u class="g"></u>')
    return (f'<div class="band" style="--accent:{accent}">'
            f'<span>{label}</span>'
            f'<div class="cols">{cols}'
            f'<u class="b">{ICON_BOTTLE}Bottle</u></div></div>')


def section(label, key, theme, body, grow, with_glass=False):
    accent = ACCENT[key][0 if theme == "dark" else 1]
    return f"""
      <div class="sec" style="--accent:{accent};flex:{grow} 1 auto">
        {band(label, key, theme, with_glass)}
        {body}
      </div>"""


def front(theme, g):
    glass = "".join(f'<div style="flex:1">{wide_card(w)}</div>'
                    for w in g["glass"])
    sparkling = "".join(tall_card(w) for w in g["sparkling"])
    orange = "".join(wide_card(w, solo=True) for w in g["orange"])
    return f"""
  <div class="sheet {theme}">
    <div class="panel">
      <div class="head">
        <h1>Wine List</h1>
        <div class="side">Sparkling · Orange · By the glass</div>
      </div>
      <div class="stack">
        {section("By the Glass · По бокалам", "glass", theme,
                 f'<div style="display:flex;gap:4mm;flex:1;margin-top:2.6mm">{glass}</div>',
                 grow=13, with_glass=True)}
        {section("Sparkling · Игристое", "sparkling", theme,
                 f'<div class="row3" style="margin-top:2.6mm">{sparkling}</div>',
                 grow=19)}
        {section("Orange · Оранжевое", "orange", theme,
                 f'<div style="margin-top:2.6mm">{orange}</div>', grow=7)}
      </div>
      <div class="foot">
        <div>All prices in Thai baht</div>
        <div>White and red on the other side</div>
      </div>
    </div>
  </div>"""


def back(theme, g):
    white = "".join(tall_card(w) for w in g["white"])
    red = "".join(tall_card(w) for w in g["red"])
    return f"""
  <div class="sheet {theme}">
    <div class="panel">
      <div class="head">
        <h1>Wine List</h1>
        <div class="side">White · Red</div>
      </div>
      <div class="stack">
        {section("White · Белое", "white", theme,
                 f'<div class="row4" style="margin-top:2.6mm">{white}</div>',
                 grow=1)}
        {section("Red · Красное", "red", theme,
                 f'<div class="row4" style="margin-top:2.6mm">{red}</div>',
                 grow=1)}
      </div>
      <div class="foot">
        <div>All prices in Thai baht</div>
        <div>Ask your waiter for a recommendation</div>
      </div>
    </div>
  </div>"""


def build_html(theme):
    g = groups()
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spice House — Wine List (two sides)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>{front(theme, g)}{back(theme, g)}
</body>
</html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--theme", choices=("dark", "light", "both"), default="dark")
    ap.add_argument("--html", action="store_true")
    args = ap.parse_args()

    themes = ("dark", "light") if args.theme == "both" else (args.theme,)
    for theme in themes:
        slug = SLUG if theme == "dark" else f"{SLUG}-light"
        html_path = os.path.join(HERE, f"{slug}.html")
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(build_html(theme))
        print("html →", html_path)
        if args.html:
            continue

        pdf_path = os.path.join(HERE, f"{slug}.pdf")
        subprocess.run([CHROME, "--headless", "--disable-gpu",
                        "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}",
                        f"file://{html_path}"], check=True, capture_output=True)
        print("pdf  →", pdf_path)
        subprocess.run(["pdftoppm", "-png", "-r", "150", pdf_path,
                        os.path.join(HERE, f"{slug}_page")], check=True)
        print("png  → page previews")


if __name__ == "__main__":
    main()
