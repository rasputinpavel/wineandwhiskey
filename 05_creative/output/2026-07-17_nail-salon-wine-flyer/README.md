# Nail-Salon Wine Flyer — A5 (2026-07-17)

A5 print flyer to pitch to the two nail salons next to the store. Offer: while a
client's nails are being done, we bring a proper glass of wine from next door.

## The offer
- **Pour:** Sparkling / White / Red (specific wines TBD)
- **Price:** ฿160 per glass
- **Mechanic:** client asks the salon front desk → we bring the glass over in ~5 min
- **Language:** English (Phuket resort audience)

## Files
- `nail-salon-wine-flyer_2026-07-17.pdf` — print-ready single A5 sheet (148×210 mm)
- `nail-salon-wine-flyer_2026-07-17.html` — self-contained source (fonts/photo/logo embedded)
- `nail-salon-wine-flyer_2026-07-17_preview.png` — flat preview
- `assets/hero_a.png` — hero used (manicured hand + glass of red, light mode). Brand tie: wine-red manicure = nails + wine.
- `assets/hero_b.png` — alternate hero (trio: sparkling/white/red, hand reaching). Swap via `HERO="b"` in `build.py`.

## Design
W&W Light mode: hard afternoon sun, long geometric shadows on travertine, no face.
Bebas Neue + Inter, palette Wine Red / Ink / Warm White / Amber Gold. Two fonts, TOV-direct copy.

## Regenerate
```
python3 gen_hero.py     # (re)generate hero_a / hero_b via Nano Banana Pro (Gemini 3 Pro Image)
python3 build.py        # rebuild HTML -> PDF + preview PNG
```
Needs `GEMINI_API_KEY` (or `NANO_BANANA_API_KEY`) in repo-root `.env.local`, and
Google Chrome + `pdftoppm` for rendering.

## TODO before pitching
- Lock the three specific wines (name + producer) for each pour.
- Confirm ฿160 with the owner.
- Print a small run; hand to both salons.
