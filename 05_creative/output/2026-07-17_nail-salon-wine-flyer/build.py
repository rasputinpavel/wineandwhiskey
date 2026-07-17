#!/usr/bin/env python3
"""Build the nail-salon wine flyer: A5 portrait, self-contained HTML -> PDF + preview PNG.

Embeds fonts (Bebas Neue + Inter), the W&W wordmark and the AI hero photo as
base64, so the HTML is fully portable. Renders a single A5 sheet via headless
Chrome (--print-to-pdf) and a PNG preview via pdftoppm.

Run from inside this folder:
    python3 build.py
"""
import base64
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DATE = "2026-07-17"
STEM = f"nail-salon-wine-flyer_{DATE}"
HERO = "a"  # which generated hero to use


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


BEBAS = b64(ROOT / "04_brand/logo/fonts/BebasNeue.woff2")
INTER = b64(ROOT / "04_brand/logo/fonts/Inter500.woff2")
LOGO = b64(ROOT / "04_brand/logo/channel_avatar_light.png")
HERO_IMG = b64(HERE / f"assets/hero_{HERO}.png")

HTML = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Wine &amp; Whiskey — Nail-Salon Wine Flyer (A5)</title>
<style>
  @font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{BEBAS}) format('woff2'); font-weight:400; font-display:block; }}
  @font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{INTER}) format('woff2'); font-weight:500; font-display:block; }}

  :root{{
    --wine:#8C1C1C; --ink:#1A1A1A; --warm:#F5F0EB; --cream:#EDE0D0;
    --gold:#C9A84C; --graphite:#3D3D3D; --stone:#D4C9BC;
  }}
  *{{box-sizing:border-box;margin:0;padding:0}}
  @page {{ size:148mm 210mm; margin:0; }}
  html,body{{background:#c9beb0}}
  body{{font-family:'Inter',sans-serif;display:flex;justify-content:center;
        padding:24px;}}

  .sheet{{
    width:148mm;height:210mm;background:var(--warm);position:relative;
    overflow:hidden;display:flex;flex-direction:column;
    box-shadow:0 12px 44px rgba(60,40,20,.30);
  }}

  @media print {{
    html,body{{background:#fff}}
    body{{padding:0}}
    .sheet{{box-shadow:none}}
  }}

  /* ---------- hero photo (top ~50%) ---------- */
  .hero{{position:relative;height:104mm;flex:0 0 104mm;overflow:hidden;background:#e9e2d6}}
  .hero img{{width:100%;height:100%;object-fit:cover;object-position:50% 40%;display:block}}
  /* soft fade of the photo bottom into the warm panel */
  .hero::after{{content:"";position:absolute;left:0;right:0;bottom:0;height:24mm;
    background:linear-gradient(to bottom,rgba(245,240,235,0) 0%,var(--warm) 96%);}}

  /* overline sits on the calm sunlit top-right of the photo */
  .kicker{{position:absolute;top:9mm;right:9mm;z-index:2;text-align:right;
    font-size:8.5px;letter-spacing:2.6px;text-transform:uppercase;
    color:var(--ink);font-weight:600;opacity:.82;line-height:1.5}}

  /* ---------- copy block ---------- */
  .body{{flex:1;padding:0 12mm 9mm;display:flex;flex-direction:column;
         margin-top:-12mm;position:relative;z-index:3}}

  .headline{{font-family:'Bebas Neue',sans-serif;color:var(--ink);
    font-size:50px;line-height:.92;letter-spacing:1.5px;text-transform:uppercase}}
  .headline .em{{color:var(--wine)}}

  .sub{{margin-top:9px;font-size:11px;line-height:1.55;color:var(--graphite);
        max-width:104mm}}

  /* options + price row */
  .row{{margin-top:15px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px}}
  .opts{{display:flex;flex-direction:column;gap:5px}}
  .opts .lbl{{font-size:8px;letter-spacing:2.4px;text-transform:uppercase;color:var(--gold);font-weight:600}}
  .opts .list{{display:flex;align-items:center;gap:8px;font-family:'Bebas Neue',sans-serif;
    font-size:21px;letter-spacing:1px;color:var(--ink);text-transform:uppercase}}
  .opts .dot{{width:6px;height:6px;border-radius:50%;display:inline-block;transform:translateY(-2px)}}
  .opts .dot.sp{{background:#E4D8A8}} .opts .dot.wh{{background:#E9DFA0}} .opts .dot.rd{{background:var(--wine)}}
  .opts .sep{{color:var(--stone);font-family:'Inter';font-size:14px}}

  .price{{text-align:right;line-height:.9}}
  .price .amt{{font-family:'Bebas Neue',sans-serif;font-size:56px;color:var(--wine);letter-spacing:1px}}
  .price .per{{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--graphite);margin-top:2px}}

  /* mechanic pill */
  .mech{{margin-top:16px;background:var(--ink);color:var(--warm);border-radius:999px;
    padding:11px 16px;display:flex;align-items:center;gap:11px}}
  .mech .n{{font-family:'Bebas Neue',sans-serif;font-size:30px;color:var(--gold);line-height:1;flex:0 0 auto}}
  .mech .tx{{font-size:10.5px;line-height:1.4}}
  .mech .tx b{{color:#fff;font-weight:600}}

  /* footer: logo + coords */
  .foot{{margin-top:auto;padding-top:14px;display:flex;align-items:center;
    justify-content:space-between;border-top:1px solid var(--stone)}}
  .foot .logo{{height:15mm;width:auto;display:block}}
  .foot .coords{{text-align:right;font-size:8px;letter-spacing:1.6px;
    text-transform:uppercase;color:var(--graphite);line-height:1.7}}
  .foot .coords b{{color:var(--wine);font-weight:600}}
</style>
</head>
<body>
  <div class="sheet">
    <div class="hero">
      <div class="kicker">From the wine bar<br>right next door</div>
      <img src="data:image/png;base64,{HERO_IMG}" alt="">
    </div>

    <div class="body">
      <h1 class="headline">Wine while<br>your <span class="em">nails dry</span></h1>
      <p class="sub">A proper glass, poured next door and brought straight to your chair.
        Sit back, let the polish set — we handle the rest.</p>

      <div class="row">
        <div class="opts">
          <div class="lbl">Your pour</div>
          <div class="list">
            <span><span class="dot sp"></span>Sparkling</span><span class="sep">/</span>
            <span><span class="dot wh"></span>White</span><span class="sep">/</span>
            <span><span class="dot rd"></span>Red</span>
          </div>
        </div>
        <div class="price"><div class="amt">฿160</div><div class="per">per glass</div></div>
      </div>

      <div class="mech">
        <div class="n">5</div>
        <div class="tx"><b>Just ask the front desk.</b><br>Your glass arrives in about five minutes.</div>
      </div>

      <div class="foot">
        <img class="logo" src="data:image/png;base64,{LOGO}" alt="Wine &amp; Whiskey">
        <div class="coords"><b>Right next door</b><br>Open daily 11:00 – 22:00 · Phuket</div>
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
        "pdftoppm", "-png", "-r", "150", "-singlefile", str(pdf_path), str(preview),
    ], check=True)
    print(f"[png ] {preview.name}.png")


if __name__ == "__main__":
    main()
