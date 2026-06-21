# Prosecco Rosé — WhatsApp promo (2026-06)

Limited offer image for **WhatsApp broadcast**: **Lele Prosecco Rosé V8 Brut**, *buy 4 get 2
free* — **฿649 / bottle**.

This is the first use of a **reusable WhatsApp promo template** — Dark mode, 1080×1350 (4:5,
the size that fills the most screen in a chat), W&W masthead up top for instant brand
recognition. Text on the image is **English only** (brand rule for visuals); the Russian +
English message copy lives in [`captions.md`](captions.md).

## Files
| File | What |
|------|------|
| `prosecco-rose-promo.html` | Source template |
| `prosecco-rose-promo_2026-06-17.png` | Final 1080×1350 image to send |
| `prosecco-rose-promo_2026-06-17_preview.png` | Creative Library card preview |
| `captions.md` | RU + EN message text to send with the image |
| `assets/bottle.png` | V8+ bottle, background removed |
| `_render.sh` | Re-render the PNG + preview after editing the HTML |

## Reuse for the next promo
The HTML is built as labelled **slots** (`SLOT:` comments). To make a new promo, copy the
folder (new `YYYY-MM-DD_topic`), then swap:

- **eyebrow** — `Limited Offer` → e.g. `New Arrival`, `This Week`
- **hero image** — drop a new `assets/bottle.png` (use `03_automation/lift_subject.py` to cut
  the background from a supplier photo)
- **caption** — product name + variant
- **mechanic** — the big deal line (`Buy 4 · Get 2 Free`)
- **price** — the hero number (`฿649`) + its sub label (`PER BOTTLE`)

Masthead, gold frame, colours and type stay fixed — that's what makes the channel recognisable.

## Re-render
```sh
./_render.sh
```
Renders at 2× via headless Chrome, then supersamples to 1080×1350 for crisp text. The bottle,
gradients and frame are baked into a flat PNG (no transparency) so WhatsApp shows it as-is.

## Source
Bottle from the supplier screenshot `.inbox/Screenshot 2026-06-17 at 11.32.14.png`, background
removed → also saved to `04_brand/products/lele-prosecco-rose-v8-brut.png`.
