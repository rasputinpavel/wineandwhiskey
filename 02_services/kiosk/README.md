# Kiosk — Wine & Whiskey self-service

Next.js web app running on a 27" Android touchscreen kiosk (RTLY W-Series,
portrait orientation). Two modes, only one shipped in v1:

- **Sommelier (v1)** — catalog browse + 4-step wizard (type → taste → food → budget)
  → 3 in-stock picks with Vivino enrichment.
- **Checkout (v2)** — deferred until we have a payment integration that supports
  unattended self-service.

## Run locally

```bash
cd 02_services/kiosk
cp .env.example .env.local   # fill SUPABASE_URL, SUPABASE_SERVICE_KEY
npm install
npm run dev                  # → http://localhost:3007
```

## Data sources

Reads only — no writes from the kiosk.

| Table / view              | What we use                                     |
|---------------------------|-------------------------------------------------|
| `inventory.v_sku_breakdown` | in-stock wines + wine_color, grape, country, price |
| `public.wine_items`       | Vivino enrichment (image, rating, body, food pairings) |

Catalog joins the two by normalized SKU name (vintage + volume stripped),
mirroring `02_services/mission-control/lib/wine-matrix/queries.ts`.

## Кnown limitations (v1)

- Vivino match is best-effort by name; SKUs without a Vivino row show no image / rating.
- Wizard scoring is a transparent heuristic (rating + body bucket + food keyword),
  not ML. Tune in `lib/wizard.ts`.
- No analytics yet.

## Deployment

Railway, NIXPACKS, same pattern as mission-control. Health: `/api/health`.

Env needed:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — same project as mission-control
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_STAFF_CHAT_ID` — for «Позвать продавца» button
  (optional; missing env = silent skip, button still says "notified")

## Hardware setup (when device arrives)

1. Install **Fully Kiosk Browser** (paid, ~€20 one-off).
2. Set start URL to the Railway deploy URL.
3. Enable: kiosk mode, screen always on, auto-reload on idle (10 min), block all
   gestures except touch, hide system bars.
4. Lock the device to one app (Android Owner mode via ADB if needed).
