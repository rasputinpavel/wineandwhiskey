#!/usr/bin/env python3
"""Static brand posters over the Gatsby / Phangan scene stills.

Not video — single-frame ad cards. Same offer, wholesale-led:
    [W&W logo]
    YOUR PARTY *DRINK* PARTNER      (DRINK highlighted)
    With or without bubbles
    SPECIAL PRICE · LIGHT WHOLESALE

Backgrounds are the photoreal people scenes we already generated (no cats, no
cartoon). EN + RU, three formats (st 9:16 / fv 4:5 / sq 1:1).

    python3 build_posters.py                      # all
    python3 build_posters.py gatsby tower en fv   # filter by any of style/scene/lang/fmt

Output: posters/pp_<style>_<scene>_<lang>_<fmt>_v01.png
"""
import base64
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SCENES = {"gatsby": HERE / "Cats" / "assets" / "scenes_gatsby",
          "phangan": HERE / "Cats" / "assets" / "scenes_phangan"}
OUT = HERE / "posters"
WORK = OUT / "_work"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

FORMATS = {"st": (1080, 1920), "fv": (1080, 1350), "sq": (1080, 1080)}
# A few frames from each — the strongest, with the champagne/toast beats first.
BACKGROUNDS = {"gatsby": ["tower", "jazz", "rooftop"],
               "phangan": ["beachbar", "boat", "neon"]}


def b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode()


BEBAS = b64(ROOT / "04_brand/logo/fonts/BebasNeue.woff2")
OSWALD_LATIN = b64(ROOT / "04_brand/logo/fonts/Oswald500-latin.woff2")
OSWALD_CYRILLIC = b64(ROOT / "04_brand/logo/fonts/Oswald500-cyrillic.woff2")
INTER = b64(ROOT / "04_brand/logo/fonts/Inter500.woff2")
LOGO = b64(ROOT / "04_brand/logo/logo_white.png")

FONT_FACES = f"""
@font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{BEBAS}) format('woff2'); font-weight:400; font-display:block; }}
@font-face {{ font-family:'Oswald'; src:url(data:font/woff2;base64,{OSWALD_CYRILLIC}) format('woff2'); font-weight:500; font-display:block; unicode-range:U+0400-04FF,U+0500-052F; }}
@font-face {{ font-family:'Oswald'; src:url(data:font/woff2;base64,{OSWALD_LATIN}) format('woff2'); font-weight:500; font-display:block; }}
@font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{INTER}) format('woff2'); font-weight:500; font-display:block; }}
"""

COPY = {
    "en": {"head": ["YOUR PARTY", ("DRINK", True), ("PARTNER", False)],
           "sub": "With or without bubbles",
           "price": "SPECIAL PRICE · LIGHT WHOLESALE",
           "geo": "Phuket"},
    "ru": {"head": ["ВАШ ПАРТНЁР", ("ПО НАПИТКАМ", True)],
           "sub": "С пузырьками и без — на ваш праздник",
           "price": "СПЕЦЦЕНА · МЕЛКИЙ ОПТ",
           "geo": "Пхукет"},
}

PIN = (
    '<svg width="30" height="40" viewBox="0 0 24 32" style="display:block;'
    'filter:drop-shadow(0 2px 5px rgba(0,0,0,.6))">'
    '<path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" '
    'fill="#8C1C1C"/><circle cx="12" cy="11.5" r="4.3" fill="#F5F0EB"/></svg>'
)


def head_html(head, lang):
    # Word-per-line headline; the flagged word is gold.
    font = ("font-family:'Bebas Neue';letter-spacing:.01em;line-height:.94;"
            if lang == "en"
            else "font-family:'Oswald';font-weight:500;letter-spacing:.005em;line-height:1.0;")
    lines = []
    for item in head:
        if isinstance(item, tuple):
            word, gold = item
            cls = "gold" if gold else ""
            lines.append(f'<span class="{cls}">{word}</span>')
        else:
            lines.append(f"<span>{item}</span>")
    return font, "".join(lines)


def poster_html(bg: Path, lang: str, w: int, h: int) -> str:
    c = COPY[lang]
    font, head_spans = head_html(c["head"], lang)
    head_size = int(w * (0.108 if lang == "en" else 0.086))
    logo_w = int(w * 0.60)
    return f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><style>
{FONT_FACES}
:root {{ --wine:#8C1C1C; --gold:#C9A84C; --white:#F5F0EB; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:{w}px; height:{h}px; }}
.card {{ position:relative; width:{w}px; height:{h}px; overflow:hidden; }}
.bg {{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }}
.scrim {{ position:absolute; inset:0; background:
   linear-gradient(180deg, rgba(8,6,5,.62) 0%, rgba(8,6,5,.12) 24%, rgba(8,6,5,.08) 46%,
   rgba(8,6,5,.55) 72%, rgba(8,6,5,.88) 100%); }}
.wrap {{ position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:space-between; padding:{int(h*0.06)}px 88px {int(h*0.055)}px; }}
.brand {{ display:flex; flex-direction:column; align-items:center; gap:{int(h*0.012)}px;
  filter:drop-shadow(0 4px 20px rgba(0,0,0,.6)); }}
.brand .wm {{ font-family:'Bebas Neue'; color:var(--white); text-transform:uppercase;
  font-size:{int(w*0.135)}px; line-height:.9; letter-spacing:.02em; text-align:center; }}
.brand .wm .amp {{ color:var(--gold); }}
.brand .rule {{ width:{int(w*0.16)}px; height:4px; border-radius:2px; background:var(--gold);
  margin-top:{int(h*0.006)}px; }}
.mid {{ display:flex; flex-direction:column; align-items:center; gap:{int(h*0.028)}px; text-align:center; }}
.head {{ {font} text-transform:uppercase; color:var(--white); font-size:{head_size}px;
  display:flex; flex-direction:column; text-shadow:0 5px 26px rgba(0,0,0,.7); }}
.head .gold {{ color:var(--gold); }}
.sub {{ font-family:'Inter'; font-weight:600; font-size:{int(w*0.040)}px; letter-spacing:.02em;
  color:var(--white); text-shadow:0 3px 16px rgba(0,0,0,.7); }}
.price {{ display:inline-block; background:var(--gold); color:#241a0c;
  font-family:'Inter'; font-weight:800; font-size:{int(w*0.036)}px; letter-spacing:.05em;
  padding:20px 42px; border-radius:999px; text-transform:uppercase;
  box-shadow:0 12px 34px rgba(0,0,0,.5); }}
.geo {{ display:flex; align-items:center; gap:10px; }}
.geo span {{ font-family:'Inter'; font-weight:600; font-size:{int(w*0.030)}px;
  color:var(--white); letter-spacing:.04em; text-shadow:0 2px 10px rgba(0,0,0,.6); }}
</style></head><body>
<div class="card">
  <img class="bg" src="data:image/png;base64,{b64(bg)}" alt="">
  <div class="scrim"></div>
  <div class="wrap">
    <div class="brand">
      <div class="wm">Wine <span class="amp">&amp;</span> Whiskey</div>
      <div class="rule"></div>
    </div>
    <div class="mid">
      <div class="head">{head_spans}</div>
      <p class="sub">{c['sub']}</p>
      <div class="price">{c['price']}</div>
    </div>
    <div class="geo">{PIN}<span>{c['geo']}</span></div>
  </div>
</div></body></html>"""


def render(html: str, out: Path, w: int, h: int) -> None:
    hp = WORK / (out.stem + ".html")
    hp.write_text(html, encoding="utf-8")
    subprocess.run([
        CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
        "--force-device-scale-factor=1", f"--window-size={w},{h}",
        f"--screenshot={out}", f"file://{hp}",
    ], check=True, capture_output=True)


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    flt = set(sys.argv[1:])
    for style, scenes in BACKGROUNDS.items():
        for scene in scenes:
            bg = SCENES[style] / f"{scene}.png"
            if not bg.exists():
                print(f"[skip] missing {bg}")
                continue
            for lang in ("en", "ru"):
                for fmt, (w, h) in FORMATS.items():
                    # A poster passes when every filter token names one of its
                    # dimensions (empty filter => render everything).
                    if flt and not flt.issubset({style, scene, lang, fmt}):
                        continue
                    out = OUT / f"pp_{style}_{scene}_{lang}_{fmt}_v01.png"
                    render(poster_html(bg, lang, w, h), out, w, h)
                    print(f"[ok] {out.name}")


if __name__ == "__main__":
    main()
