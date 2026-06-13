# Russian Wine & Spirits — B2B / Wholesale Catalog (2026-06)

By-bottle catalog of the Russian range, priced for **B2B clients**. Same range,
photos and bilingual (RU + EN) tasting notes as the public festival landing
(`02_services/mission-control/app/russian-wine`), but priced from the supplier's
**"From Latitude to Customers"** column — not the live store retail price.

Format = **one tall scrollable sheet** (phone-width, no page breaks), our usual
shareable layout for messengers — not paginated A4.

- `russian_wine_b2b_catalog_2026-06.html` — source (fonts + bottle images inlined)
- `russian_wine_b2b_catalog_2026-06_scroll.pdf` — single tall page (scroll)
- `russian_wine_b2b_catalog_2026-06_preview.png` — full-page screenshot

Rebuild: `npm install` (once) then `npm run build`. `build.mjs` writes the HTML,
then renders it through `03_automation/export_creative.ts` (Playwright — measures
content height, emits one tall page). Needs `npx tsx` + Playwright at repo root.

## Prices

Hardcoded as `b2b` (THB, per bottle) on each row in `build.mjs`. Source:
`.inbox/Suppliers/Harvest/Moi Vina Prices 2026 Phuket.pdf` (Harvest Creation /
Moi Vina — Phuket Wholesale Price List, Summer 2026), the right-hand
**From Latitude to Customers** column. The left **HC to Latitude / EXF** column
is our cost and is NOT used. When the supplier list changes, edit `b2b` and rebuild.

Two ambiguous Château Tamagne rows resolved per owner: Cabernet Reserve → South
Coast Reserve Cabernet ฿685; Krasnostop Reserve Collection → Tamagne Reserve
Krasnostop ฿875.

## Order QR

The header QR opens a WhatsApp chat with **Irina Rasputina** (`wa.me/66939140004`,
+66 93 914 0004) pre-filled with a B2B order message. Target lives in `ORDER_URL`
at the top of `build.mjs`.
