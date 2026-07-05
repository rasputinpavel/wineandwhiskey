# Neck-tag pilot — "The Waiting Cat"

Bottle-neck hangtag asking buyers to leave a Google review. First creative of the
cat-series experiment (see `docs/superpowers/specs/2026-07-04-review-neck-tags-cat-series-design.md`).

## Files
- **`neck-tag_waiting-cat_2026-07-04_PRINT.pdf`** — press-ready, 3 pages (front / back /
  die-line guide), 68 × 134 mm (62 × 128 trim + 3 mm bleed), crop marks. **Send this to the printer.**
- `PRINT_SPECS.md` — spec sheet to hand to the print shop.
- `neck-tag_waiting-cat_2026-07-04.html` — self-contained on-screen source (fonts + images base64).
- `neck-tag_waiting-cat_2026-07-04.pdf` — simple 2-page proof (no bleed/marks), 62 × 128 mm.
- `neck-tag_waiting-cat_2026-07-04_preview.png` — side-by-side preview.
- `build_tag.py` / `build_print.py` — regenerate the proof / print files.
- `assets/cat_glass.jpg` — framed snapshot of the owner's cat with a glass of red wine
  (cropped from a preliminary photo; shown as a rounded-corner photo, not a cutout).
- `assets/qr_review.png` — QR code.

## Spec
- Size: 62 × 128 mm, neck hole Ø 27 mm (dashed die-line on the art).
- Front: framed photo of the owner's cat + glass of wine, labelled as the owner's cat,
  + "ONE REVIEW IS ALL I ASK". Back: small W&W wordmark, then one merged block —
  "LEAVE US A REVIEW" + a cat-voice request ("Meow. Liked the wine? …") + 5★ + QR + CTA.
- Brand: Warm White #F5F0EB, Wine Red #8C1C1C, Deep Black #1A1A1A, Amber Gold #C9A84C stars; Bebas Neue + Inter.

## QR target
- **Draft:** `https://www.google.com/maps?cid=15061316081394851182` — opens the exact store
  listing (Wine&Whiskey store, Rawai); "Write a review" is one tap away.
- **TODO for final:** swap to the one-tap review composer
  `https://search.google.com/local/writereview?placeid=<ChIJ...>` once we resolve the ChIJ
  place_id (trivial once `GOOGLE_PLACES_API_KEY` from the measurement track is set).

## Draft caveats (pending owner's hi-res photos, due next day)
- Cat photo is a low-res preliminary snapshot; background is a home kitchen. For print,
  reshoot hi-res (cat + glass, cleaner backdrop) at proper DPI.
- Confirm cat name / whether to credit him by name on the tag.

## Regenerate
Edit and run `scratchpad build_tag.py` (or the copy here), then render with headless Chrome:
```
chrome --headless=new --print-to-pdf=<out>.pdf  file://<html>
chrome --headless=new --screenshot=<out>_preview.png --force-device-scale-factor=4 --window-size=508,544 file://<html>
```
