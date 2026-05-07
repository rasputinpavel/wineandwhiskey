# Mission Control (ЦУП)

Wine & Whiskey internal portal. Umbrella service that absorbs the per-service split — every internal tool, agent, and dashboard lives here either as a native module or as an embedded panel.

## Architecture

App shell with a persistent left sidebar. Each item in the sidebar opens in the right pane and is one of four kinds:

- **native**   — first-class module living at `app/(portal)/m/<slug>/*` with its own pages, sub-nav, and Supabase queries (e.g. `inventory`)
- **iframe**   — third-party tool that allows framing (Google Sheets, Drive, Lovable storefront)
- **external** — third-party tool that blocks framing — renders an "Open externally ↗" card (Loyverse, FlowAccount, GitHub, Railway)
- **builtin**  — small inline React panel (KPI Pulse stub, env-vars reference)

The single source of truth for the sidebar is [lib/registry.ts](lib/registry.ts).

## Stack

- Next.js 15 (App Router) · React 19 · Tailwind CSS
- Auth: HMAC-signed cookie (same pattern as `trendwatch`)
- Data: Supabase (`inventory` schema today; `price`, `matrix` etc. as modules land)
- Brand tokens: `/04_brand/design-tokens.json` (light theme, Wine Red / Warm White, Bebas Neue + DM Sans + Inter)

## Run locally

```bash
cd 02_services/mission-control
npm install
cp .env.example .env.local   # set MC_PASSWORD + MC_SECRET + Supabase
npm run dev                  # → http://localhost:3003
```

For real Inventory data locally:

```bash
set -a; source ../../.env.local; set +a   # picks up SUPABASE_URL + SUPABASE_SERVICE_KEY
npm run dev
```

## Deploy (Railway)

Service in the same Railway project as price-service / trendwatch.

- **Root Directory:** `02_services/mission-control`
- **Builder:** Nixpacks (auto)
- **Healthcheck:** `/api/health`
- **Env vars:** `MC_PASSWORD`, `MC_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

## Modules

### Inventory (live)
Bridges Loyverse stock with FlowAccount B2B invoices. Schema in [supabase/migrations/001_inventory.sql](supabase/migrations/001_inventory.sql) (apply once via Supabase SQL editor; expose `inventory` schema via API settings).

Sync from the project root:
```bash
npm run inv:all   # = inv:loyverse + inv:flow
```

Pages:
- `/m/inventory` — SKU breakdown (on hand / in store / B2B in transit / consignment)
- `/m/inventory/sku/[code]` — drill-down per SKU
- `/m/inventory/b2b` — outstanding invoices (Open vs Overdue)
- `/m/inventory/consignment` — consignment locations (Phase 2: balances + delivery notes)
- `/m/inventory/admin/unmapped` — FlowAccount lines without Loyverse code match

### Roadmap
- `price-service` migration into `/m/price/*` (currently iframed/external)
- `wine-matrix` greenfield module
- `pulse` real KPI panel
- Internal links from sidebar to live Sheets / Drive folders work as iframes already
