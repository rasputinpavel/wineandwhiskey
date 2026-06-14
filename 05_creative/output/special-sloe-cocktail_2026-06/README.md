# Special Sloe Cocktail — table flyer (2026-06)

One-sided **A6 portrait** (105×148 mm) table-tent flyer for the *Special Sloe Cocktail* — a Spanish-style
vermouth serve built on **Barrister Sloe Gin** layered with dark vermouth over ice, garnished
with an orange wheel + olive on a pick. Price **฿200**.

Made to print and drop into the acrylic table holders.

## Files
- `special-sloe-cocktail.html` — source (A5, dark cinematic, brand tokens). Print this.
- `special-sloe-cocktail_2026-06.pdf` — single-page A5 print export.
- `special-sloe-cocktail_2026-06_preview.png` — preview.
- `assets/hero.png` — AI-generated hero shot.

## How the hero image was made
Generated with **Nano Banana Pro (Gemini 3 Pro Image)** via the Gemini API, using the
supplier bottle photo (`.inbox/WhatsApp Image 2026-06-14 at 12.16.31.jpeg`) as a product
reference so the real Barrister Sloe Gin bottle appears (softly out of focus) in the scene.

## Re-render after editing the HTML
```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HTML="file://$PWD/special-sloe-cocktail.html"
"$CHROME" --headless=new --force-device-scale-factor=4 --window-size=397,559 \
  --hide-scrollbars --screenshot="$PWD/special-sloe-cocktail_2026-06_preview.png" "$HTML"
"$CHROME" --headless=new --no-pdf-header-footer \
  --print-to-pdf="$PWD/special-sloe-cocktail_2026-06.pdf" "$HTML"
```

## Print notes
- Print at **100% / actual size**, A6 paper (105×148 mm), borderless if possible.
- Background is near-black — print on a printer that handles full-bleed dark coverage well,
  or trim to the edge after printing on A4.
