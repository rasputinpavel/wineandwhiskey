# Event Curation Poster — "Planning Something?"

In-store A3 poster promoting the **custom event-curation service**: guests with an
occasion coming up (birthday, party, Sunday roast, BBQ, friends over) talk to staff
or message us on WhatsApp, and we curate wines & spirits at a special price for
larger orders.

## Files

| File | Purpose |
|------|---------|
| `event-curation-poster_2026-07-07.pdf` | **Print this** — A3 portrait, ready for the shop printer |
| `event-curation-poster_2026-07-07_preview.png` | Screen preview |
| `event-curation-poster_2026-07-07.html` | Self-contained source (fonts, logo, QR embedded as base64) |
| `build_poster.py` | Regenerates HTML + PDF + PNG via headless Chrome |
| `assets/wa_qr.png` | WhatsApp QR (encodes `https://wa.me/66809020550`) |

## Print specs

- **Size:** A3 portrait — 297 × 420 mm
- **Bleed:** none (full-bleed background, safe internal margins ~22 mm)
- **Colour:** RGB in the PDF; convert to CMYK at the printer if they ask
- **Language:** English
- **Style:** light travertine, brand palette (Wine Red / Deep Black / Amber Gold on Warm White)

## Contact on the poster

- WhatsApp: **+66 80 902 0550** → `https://wa.me/66809020550`
- QR code links straight to that WhatsApp chat.

## Rebuild

```bash
python 05_creative/output/2026-07-07_event-curation-poster/build_poster.py
```

Requires Google Chrome (headless render). The QR PNG is already committed; regenerate
it with the `qrcode` Python package only if the number changes.
