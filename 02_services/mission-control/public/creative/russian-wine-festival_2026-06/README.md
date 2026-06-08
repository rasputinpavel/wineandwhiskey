# Russian Wine & Spirits — Russian Food Festival 2026

Booth materials for the **Russian Food Festival × Central Phuket**
(12–14 June 2026, Phuket Outdoor Arena). Message: Russian wine & spirits are
stocked at the Wine & Whiskey store on Rawai.

## A5 booth flyer (this folder)

Double-sided, colour, print-ready. Front = Russian, back = English. Three QR
codes per side: WhatsApp · Russian-wine catalog · Google Maps.

- `russian_wine_flyer_2026-06.pdf` — 2-page print PDF (154×216 mm = A5 + 3 mm bleed; trim at 148×210 mm)
- `russian_wine_flyer_front_2026-06.pdf` / `…_back_2026-06.pdf` — per-side print PDFs
- `russian_wine_flyer_preview_2026-06.png` — both sides side-by-side

Rebuild: `npm install` (once) then `npm run build` — renders via headless Chrome.
QR targets live in `LINKS` at the top of `build.mjs`.

### Links baked into the QR codes
- **WhatsApp** → `wa.me/66809020550` (store / Pavel)
- **Catalog** → `mission-control-production.up.railway.app/russian-wine` (landing below)
- **Maps** → `maps.app.goo.gl/KjDb42GC4AAZ6mKKA` (Rawai store pin)

## Landing page

Lives in the mission-control service, not this folder:
- Route: `02_services/mission-control/app/russian-wine/` (`page.tsx` + `data.ts`)
- Public (no login) via the allowlist in `02_services/mission-control/middleware.ts`
- Bilingual RU/EN catalog of ~25 key Russian wines & spirits with real bottle
  images from `/brand/products/`. No prices (supplier list is ex-VAT wholesale) —
  the page introduces the range and sends people to the store / WhatsApp.
- Deploys automatically on push to `main`.
