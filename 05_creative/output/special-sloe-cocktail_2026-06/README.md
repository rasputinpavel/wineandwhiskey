# Special Sloe Cocktail — table flyer (2026-06)

One-sided **light** table-tent flyer for the *Special Sloe Cocktail* — **Barrister Sloe Gin
over ice, topped with fresh orange & olives** (a Spanish vermut-style serve). Price **฿200**.

Light background + dark text so it stays legible in print (red-on-black washed out).
Made to print and drop into the acrylic table holders. Comes in **two sizes**.

## Files
| Size | Source | Print PDF | Preview |
|------|--------|-----------|---------|
| **A5** (148×210 mm) | `special-sloe-cocktail_a5.html` | `special-sloe-cocktail_2026-06_a5.pdf` | `..._a5_preview.png` |
| **A6** (105×148 mm) | `special-sloe-cocktail_a6.html` | `special-sloe-cocktail_2026-06_a6.pdf` | `..._a6_preview.png` |

- `assets/hero_light.png` — AI-generated hero shot, shared by both sizes.

## How the hero image was made
Generated with **Nano Banana Pro (Gemini 3 Pro Image)** via the Gemini API, using the
supplier bottle photo (`.inbox/WhatsApp Image 2026-06-14 at 12.16.31.jpeg`) as a product
reference so the real Barrister Sloe Gin bottle appears (softly out of focus) in the scene.
Light mode: pale travertine, daylight, long geometric shadow. Lightly desaturated into sRGB.

## Re-render after editing the HTML
The PDF is built from the flat PNG raster (NOT Chrome's `--print-to-pdf`). Chrome's PDF
export keeps the photo + gradients as separate layers and can bloom magenta on Display-P3
viewers; rasterising to PNG first bakes everything flat and avoids it.
```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --force-device-scale-factor=5 --window-size=559,794 \
  --hide-scrollbars --screenshot="$PWD/special-sloe-cocktail_2026-06_a5_preview.png" \
  "file://$PWD/special-sloe-cocktail_a5.html"
"$CHROME" --headless=new --force-device-scale-factor=5 --window-size=397,559 \
  --hide-scrollbars --screenshot="$PWD/special-sloe-cocktail_2026-06_a6_preview.png" \
  "file://$PWD/special-sloe-cocktail_a6.html"
python3 - <<'PY'
from PIL import Image
for tag, page_w in (("a5", 148), ("a6", 105)):
    im = Image.open(f"special-sloe-cocktail_2026-06_{tag}_preview.png").convert("RGB")
    im.save(f"special-sloe-cocktail_2026-06_{tag}.pdf", "PDF", resolution=im.size[0]/(page_w/25.4))
PY
```

## Print notes
- Print at **100% / actual size** on the matching paper (A5 = 148×210 mm, A6 = 105×148 mm),
  borderless if possible, otherwise print on the next size up and trim.
