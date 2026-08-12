#!/usr/bin/env python3
"""Build the "Wine by Glass" A1 lightbox poster: self-contained HTML -> PDF + preview PNG.

A1 portrait (594 x 841 mm), full-bleed AI hero + crisp HTML text layer, meant to
be printed twice and slotted into both sides of a backlit stand. Fonts, wordmark
and hero photo are embedded as base64 so the HTML is fully portable.

Run from inside this folder:
    python3 build.py
"""
import base64
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DATE = "2026-08-12"
STEM = f"wine-by-glass-a1-poster_{DATE}"
HERO = "single"  # which generated hero to use: single | single_pour | glow | red


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


BEBAS = b64(ROOT / "04_brand/logo/fonts/BebasNeue.woff2")
INTER = b64(ROOT / "04_brand/logo/fonts/Inter500.woff2")
LOGO = b64(ROOT / "04_brand/logo/logo_black_transparent.png")
HERO_IMG = b64(HERE / f"assets/hero_{HERO}.png")

HTML = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Wine &amp; Whiskey — Wine by Glass (A1 poster)</title>
<style>
  @font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{BEBAS}) format('woff2'); font-weight:400; font-display:block; }}
  @font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{INTER}) format('woff2'); font-weight:500; font-display:block; }}

  :root{{
    --wine:#8C1C1C; --ink:#1A1A1A; --warm:#F5F0EB; --cream:#EDE0D0;
    --gold:#C9A84C; --graphite:#3D3D3D; --stone:#D4C9BC; --white:#E7D9A6;
  }}
  *{{box-sizing:border-box;margin:0;padding:0}}
  @page {{ size:594mm 841mm; margin:0; }}
  html,body{{background:#c9beb0}}
  body{{font-family:'Inter',sans-serif;display:flex;justify-content:center;}}

  .sheet{{
    width:594mm;height:841mm;background:var(--warm);position:relative;
    overflow:hidden;display:flex;flex-direction:column;align-items:center;
    text-align:center;
  }}
  @media screen {{ body{{padding:20px}} .sheet{{box-shadow:0 20px 80px rgba(60,40,20,.35)}} }}

  /* ---------- headline (top) ---------- */
  .headline{{margin-top:50mm;font-family:'Bebas Neue',sans-serif;color:var(--ink);
    font-size:310px;line-height:.9;letter-spacing:5px;text-transform:uppercase;
    position:relative;z-index:3}}
  .headline .em{{color:var(--wine)}}

  /* ---------- hero photo (single glass, fills the rest) ---------- */
  .hero{{position:relative;width:100%;flex:1 1 auto;min-height:0;overflow:hidden;
    margin-top:-4mm}}
  .hero img{{width:100%;height:100%;object-fit:cover;object-position:50% 42%;display:block;
    transform:scale(1.42);transform-origin:50% 44%}}
  /* fade top & bottom of the photo into the warm sheet */
  .hero::before{{content:"";position:absolute;left:0;right:0;top:0;height:110mm;z-index:2;
    background:linear-gradient(to bottom,var(--warm) 2%,rgba(245,240,235,.55) 55%,rgba(245,240,235,0) 100%);}}
  .hero::after{{content:"";position:absolute;left:0;right:0;bottom:0;height:120mm;z-index:2;
    background:linear-gradient(to bottom,rgba(245,240,235,0) 0%,rgba(245,240,235,.55) 55%,var(--warm) 97%);}}

  /* ---------- price seal beside the glass ---------- */
  .badge{{position:absolute;z-index:4;left:4%;top:24%;
    width:168mm;height:168mm;border-radius:50%;background:var(--wine);color:var(--warm);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    box-shadow:0 10mm 26mm rgba(90,20,20,.28)}}
  .badge .num{{font-family:'Bebas Neue',sans-serif;font-size:320px;line-height:.78;letter-spacing:2px}}
  .badge .num .baht{{font-size:.44em;vertical-align:.42em;margin-right:.04em;letter-spacing:0}}
  .badge .lbl{{font-size:40px;letter-spacing:8px;text-transform:uppercase;opacity:.82;margin-top:8px}}

  /* ---------- options row, sitting on the (softened) stem ---------- */
  .opts-wrap{{position:absolute;z-index:4;left:0;right:0;bottom:232mm;
    display:flex;justify-content:center}}
  .opts-scrim{{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    width:500mm;height:150mm;
    background:radial-gradient(ellipse 46% 50% at 50% 50%,rgba(245,240,235,.96) 0%,rgba(245,240,235,.9) 38%,rgba(245,240,235,.5) 62%,rgba(245,240,235,0) 82%);
    backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:-1}}
  .opts{{display:flex;align-items:center;justify-content:center;gap:56px;
    font-family:'Bebas Neue',sans-serif;font-size:132px;letter-spacing:4px;
    color:var(--ink);text-transform:uppercase;line-height:1}}
  .opts .it{{display:inline-flex;align-items:center;gap:26px}}
  .opts .dot{{width:52px;height:52px;border-radius:50%;display:inline-block;flex:0 0 auto}}
  .opts .dot.rd{{background:var(--wine)}}
  .opts .dot.wh{{background:var(--white);border:2px solid var(--gold)}}
  .opts .dot.sp{{background:var(--gold)}}
  .opts .sep{{color:var(--stone);font-size:100px}}
</style>
</head>
<body>
  <div class="sheet">
    <h1 class="headline">Wine by <span class="em">Glass</span></h1>

    <div class="hero">
      <img src="data:image/png;base64,{HERO_IMG}" alt="">

      <div class="badge">
        <span class="num"><span class="baht">฿</span>160</span>
        <span class="lbl">per glass</span>
      </div>

      <div class="opts-wrap">
        <div class="opts-scrim"></div>
        <div class="opts">
          <span class="it"><span class="dot rd"></span>Red</span>
          <span class="sep">/</span>
          <span class="it"><span class="dot wh"></span>White</span>
          <span class="sep">/</span>
          <span class="it"><span class="dot sp"></span>Sparkling</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
"""


def main():
    html_path = HERE / f"{STEM}.html"
    pdf_path = HERE / f"{STEM}.pdf"
    preview = HERE / f"{STEM}_preview"
    html_path.write_text(HTML, encoding="utf-8")
    print(f"[html] {html_path.name} ({len(HTML)//1024} KB)")

    subprocess.run([
        CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path}", html_path.as_uri(),
    ], check=True, capture_output=True)
    print(f"[pdf ] {pdf_path.name}")

    subprocess.run([
        "pdftoppm", "-png", "-r", "72", "-singlefile", str(pdf_path), str(preview),
    ], check=True)
    print(f"[png ] {preview.name}.png")


if __name__ == "__main__":
    main()
