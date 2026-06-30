# Russian Wine & Spirits Catalog — Wine & Whiskey

**Date:** 2026-06-30
**Status:** Approved design, ready for plan
**Owner:** Pavel

## Goal

Rebrand the supplier "Moi Vina" 2024 Wine & Spirit catalog (`/.inbox/Russian Wine
Harvest price.pdf`) into a Wine & Whiskey wholesale price list used to show prices
to restaurants. Keep every product's prices, region/variety/ABV, and the few prose
descriptions that exist; reuse the existing clean product PNGs; reorder by category.

## Deliverable

A single self-contained HTML file that serves two purposes:

1. **On phone / screen** — continuous vertical scroll: cover → category sections,
   each an adaptive grid of product cards. Openable on a phone, sendable in a
   messenger.
2. **For print (PDF)** — `@page A4` + `@media print` page-break rules so the cover
   is its own page and each category starts on a new page. The user prints this to
   a multi-page PDF.

Plus a generated multi-page **PDF** for printing (headless Chrome at build; fall
back to documenting the browser print path if unavailable).

**Self-contained:** all product images embedded as base64 data URIs so the file is
portable (phone, messenger) and prints reliably. Fonts via Google Fonts CDN
(Bebas Neue / DM Sans / Inter) — acceptable for a local creative output opened in a
browser.

## Output location

Per creative-pipeline convention:

```
05_creative/output/2026-06-30_russian-wine-catalog/
  russian-wine-catalog_2026-06-30.html
  russian-wine-catalog_2026-06-30.pdf
  russian-wine-catalog_2026-06-30_preview.png
```

Committed to git (so it is versioned with the rest of creative output).

## Branding (from 04_brand/design-system.md)

- **Colors:** Warm White `#F5F0EB` / Cream `#EDE0D0` backgrounds; Wine Red `#8C1C1C`
  for section headers and price pills; Amber Gold `#C9A84C` for accents and the
  BEST SELLER ribbon; Graphite `#3D3D3D` for secondary text.
- **Fonts:** Bebas Neue (display: cover word, prices), DM Sans (product names,
  section headers), Inter (region/variety/ABV, footnotes).
- **Logo:** W&W monogram (`04_brand/logo/channel_avatar_light.png`) large on the
  cover, small in the page footer. No deprecated wordmark PNGs.
- **Cover:** monogram + "RUSSIAN WINE & SPIRITS" + tagline "Exclusive distributor of
  Russian wine and spirits in Phuket" + "Wholesale price list · 2026".
- **Footer (every print page):** `Wine & Whiskey · wine-whiskey.com · Prices exclude
  7% VAT`. No Instagram for now.

## Card design

Cream-tinted card: transparent product PNG on top → product name (DM Sans SemiBold)
→ `Region · Variety · ABV` meta line (Inter, Graphite) → price in a Wine Red pill
(Bebas Neue). BEST SELLER items get an Amber Gold corner ribbon. Spirits cards show
two prices (1 L / 0.7 L). Prose description shown **only** for the items that carry
one in the source PDF (Vedernikov Krasnostop Zolotovsky oak + standard, Sibirkovyi,
Vedernikov Krasnostop Rosé).

## Section order & contents

Language: English. Prices: ฿, ex-VAT. Order: **White → Rosé → Red → Sparkling →
Spirits**. Image = filename in `04_brand/products/` (`.png`).

### WHITE (6)

| Name | Price | Region · Variety · ABV | Image | Tag |
|------|-------|------------------------|-------|-----|
| Grape Dance Blanc, Chateau Tamagne | ฿515 | Tamagne Peninsula · 100% Bianca, Gurner · 14% | chateau-tamagne-grape-dance-blanc | BEST SELLER |
| Vedernikov Sibirkovyi | ฿575 | Vedernikov, Don Valley · Sibirkovyi · 12% | vedernikov-sibirkovyi | desc |
| Visokiy Bereg Grüner Veltliner | ฿595 | Kuban · 100% Grüner · 12.5% | visokiy-bereg-gruner-veltliner | |
| Aristov Riesling | ฿610 | Kuban · 100% Riesling · 14% | aristov-riesling | BEST SELLER |
| Abrau-Durso Riesling | ฿910 | Abrau Durso, Tamagne Peninsula · 100% Riesling · 12% | abrau-durso-riesling | |
| Abrau-Durso Chardonnay | ฿910 | Abrau Durso, Tamagne Peninsula · 100% Chardonnay · 12% | abrau-durso-chardonnay | |

Sibirkovyi desc: "Made from the local Sibirkovy grape — aromas of acacia, lime, and
green apple. Fresh and full-bodied, with mineral notes and a grapefruit finish."

### ROSÉ (2)

| Name | Price | Region · Variety · ABV | Image | Tag |
|------|-------|------------------------|-------|-----|
| Vedernikov Krasnostop Rosé | ฿625 | Vedernikov, Don Valley · 100% Krasnostop Zolotovsky · 12% | vedernikov-krasnostop-rose | desc |
| Visokiy Bereg Graphite Rosé | ฿650 | Kuban · 100% Cabernet Sauvignon · 12% | visokiy-bereg-graphite-rose | |

Krasnostop Rosé desc: "A vibrant rosé with strawberry, marshmallow, and berry sorbet
aromas. Smooth, light, and refreshing with a silky finish. Perfect for any season."

### RED (14)

| Name | Price | Region · Variety · ABV | Image | Tag |
|------|-------|------------------------|-------|-----|
| Chateau Tamagne Krasnostop Saperavi | ฿560 | Kuban · 100% Krasnostop, Saperavi · 14% | chateau-tamagne-krasnostop-saperavi | |
| Nude Saperavi 2022, Chateau Tamagne | ฿575 | Krasnodar Region · 100% Saperavi · 13.5% | chateau-tamagne-nude-saperavi | BEST SELLER |
| Aristov Cabernet Sauvignon | ฿615 | Kuban · 100% Cabernet Sauvignon · 14% | aristov-cabernet-sauvignon | BEST SELLER |
| Vedernikov Krasnostop Zolotovsky | ฿625 | Vedernikov, Don Valley · 100% Krasnostop Zolotovsky · 14.5% | vedernikov-krasnostop-zolotovsky | desc |
| Chateau Tamagne Cabernet Reserve | ฿685 | Tamagne Peninsula · 100% Cabernet Sauvignon · 12–14% | chateau-tamagne-cabernet-reserve | BEST SELLER |
| Chateau Tamagne Saperavi Reserve | ฿685 | Tamagne Peninsula · 100% Saperavi · 14% | chateau-tamagne-saperavi-reserve | BEST SELLER |
| Chateau Tamagne Krasnostop Reserve | ฿685 | Tamagne Peninsula · 100% Krasnostop · 11.5–13.5% | chateau-tamagne-krasnostop-reserve | |
| Chateau Tamagne Premier Rouge Reserve | ฿685 | Tamagne Peninsula · Merlot, Cabernet Sauvignon, Krasnostop, Saperavi · 12–14% | chateau-tamagne-premier-rouge-reserve | |
| Cuvée Alexander Intenso Rosso, Aristov | ฿750 | Tamagne Peninsula · 100% Anchelotta · 12% | aristov-cuvee-alexander-intenso-rosso | |
| Chateau Tamagne Krasnostop Reserve 2016 | ฿875 | Tamagne Peninsula · 100% Krasnostop Anapskiy · 14% | chateau-tamagne-krasnostop-reserve-2016 | |
| Abrau-Durso Pinot Noir | ฿910 | Abrau Durso, Tamagne Peninsula · 100% Pinot Noir · 11.5% | abrau-durso-pinot-noir | |
| Vedernikov Krasnostop Zolotovsky, Aged in Oak | ฿1,250 | Vedernikov, Don Valley · 100% Krasnostop Zolotovsky · 14.5% | vedernikov-krasnostop-zolotovsky-oak | desc |
| Gertz Sikory | ฿1,285 | Semigorye · Cabernet Sauvignon, Merlot, Cabernet Franc, Krasnostop · 14% | sikory-gertz | |
| Sikory Cabernet Sauvignon Family Reserve | ฿1,500 | Semigorye · 100% Cabernet Sauvignon · 14% | sikory-cabernet-family-reserve | |

Chateau Tamagne Krasnostop Reserve 2016 aging note (append to meta): "12 months in
French and American oak, plus 48 months in bottle."

Vedernikov Krasnostop Zolotovsky oak desc: "From the native Krasnostop Zolotovsky
grape, registered in 1814; aged 16 months in French oak. Deep ruby-red with aromas
of cherry jam, blackberry, prune, smoke, and vanilla. Full-bodied and tannic with
flavors of dried cherry, mulberry, tobacco, leather, and a hint of smoke, finishing
with long jammy notes of black currant and blackberry."

Vedernikov Krasnostop Zolotovsky (standard) desc: "Deep ruby-red with aromas of
currant, chocolate, and spices. Bright, balanced flavors of blackcurrant, mulberry,
and cherry, with a long berry finish."

### SPARKLING (10)

| Name | Price | Region · Variety · ABV | Image | Tag |
|------|-------|------------------------|-------|-----|
| Abrau-Durso Reserve Brut | ฿510 | Abrau Durso, Tamagne Peninsula · Chardonnay, Riesling, Pinot Blanc · 11.5% | abrau-durso-reserve-brut | |
| Abrau-Durso Reserve Brut Rosé | ฿510 | Abrau Durso, Tamagne Peninsula · Pinot Noir, Pinot Franc, Cabernet Sauvignon · 11.5% | abrau-durso-reserve-brut-rose | |
| Cuvée Alexander Blanc de Blancs Brut, Aristov | ฿750 | Tamagne Peninsula · Chardonnay · 12% | aristov-cuvee-alexander-brut | |
| Victor Dravigny Brut | ฿750 | Abrau Durso, Tamagne Peninsula · Chardonnay, Riesling, Pinot Blanc · 12% | abrau-durso-victor-dravigny-brut | BEST SELLER |
| Victor Dravigny Extra Brut | ฿750 | Abrau Durso, Tamagne Peninsula · Chardonnay, Riesling, Pinot Blanc · 12.5% | abrau-durso-victor-dravigny-extra-brut | |
| Victor Dravigny Rosé Brut | ฿750 | Abrau Durso, Tamagne Peninsula · Pinot Noir, Pinot Franc, Cabernet Sauvignon · 12% | abrau-durso-victor-dravigny-rose | BEST SELLER |
| Brut d'Or Blanc de Noir | ฿935 | Abrau Durso, Tamagne Peninsula · 100% Pinot Noir · 12.5% | abrau-durso-brut-dor-blanc-de-noir | |
| Brut d'Or Riesling | ฿935 | Abrau Durso, Tamagne Peninsula · 100% Riesling · 12.5% | abrau-durso-brut-dor-riesling | |
| Alexander II Brut Vintage | ฿1,000 | Abrau Durso, Tamagne Peninsula · Pinot Noir, Pinot Blanc, Chardonnay · 12% | abrau-durso-alexander-ii-brut-vintage | |
| Alexander II Brut Rosé | ฿1,000 | Abrau Durso, Tamagne Peninsula · 100% Pinot Noir · 12% | abrau-durso-alexander-ii-brut-rose | |

### SPIRITS (6)

Two-price (1 L / 0.7 L) for vodka; single price for gin.

| Name | Price | Detail | Image |
|------|-------|--------|-------|
| Ladoga | 1 L ฿749 / 0.7 L ฿599 | Premium Russian vodka · St-Petersburg · 40% | ladoga-vodka |
| Czar's Original | 1 L ฿810 / 0.7 L ฿610 | Super-premium Russian vodka · St-Petersburg · 40% | czars-original |
| Czar's Gold | 1 L ฿1,185 / 0.7 L ฿1,060 | Luxury Russian vodka · St-Petersburg · 40% | czars-gold |
| Barrister Gin Dry | ฿910 | London dry gin · 0.7 L · 40% | barrister-dry-gin |
| Barrister Gin Pink | ฿990 | Pink gin · 0.7 L · 40% | barrister-pink-gin |
| Barrister Gin Blue | ฿990 | Blue gin · 0.7 L · 40% | barrister-blue-gin |

## Out of scope

- Live price sync (this is a static creative artifact, not the `/russian-wine`
  portal page). Prices are hard-coded from the supplier PDF.
- Thai-language text from the source vodka pages — English only.
- Whiskey (the source catalog has none; "Spirits" = vodka + gin).
```

## Build approach

1. A small build script (Node, in the output folder) holds the product data as a
   structured array, base64-encodes each PNG from `04_brand/products/`, and renders
   the HTML from a template. Keeps data/layout separated and re-runnable if prices
   change.
2. Render → write `.html`.
3. Generate `.pdf` via headless Chrome (`chrome --headless --print-to-pdf`) if a
   Chrome/Chromium binary is available; otherwise document the manual print path.
4. Generate `_preview.png` (first screen / cover).
5. Commit the output folder.
