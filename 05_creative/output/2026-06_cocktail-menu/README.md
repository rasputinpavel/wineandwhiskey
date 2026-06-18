# Cocktail & Shots Price List — A4 (June 2026)

Branded A4 print menu for the bar counter. Dark cinematic style matching the
Special Sloe Cocktail flyer. W&W monogram up top, dotted leader lines, gold prices.

## Items

| Item              | Price |
|-------------------|-------|
| Vodka Shot        | ฿100  |
| Gin Shot          | ฿150  |
| Gin & Tonic       | ฿200  |
| Special Cocktail  | ฿200  |

## Files

- `cocktail-menu.html` — source (A4, `@page size: 210mm 297mm`)
- `cocktail-menu_2026-06.pdf` — print-ready (headless Chrome, no header/footer)
- `cocktail-menu_2026-06_preview.png` — preview
- `assets/monogram.png` — W&W dark monogram (from `04_brand/logo/channel_avatar_dark.png`)

## Re-render

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
D="$(pwd)"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$D/cocktail-menu_2026-06.pdf" "file://$D/cocktail-menu.html"
```

Print at A4, 100% scale (no "fit to page").
