# Wine & Whiskey — Store OS

This is the operating system for managing the Wine & Whiskey retail store.

## What lives here

- **agents/** — Виртуальные сотрудники (Telegram bots on Railway).
  - `bot/` — Staff operations bot (Chip & Dale).
  - `barrymore/` — Secretary bot (Бэрримор).
- **services/** — Web services on Railway.
  - `price-service/` — Next.js price list manager.
- **automation/** — Data sync scripts (run via `npm run <name>` from root).
- **brand/** — Design system, tokens, logo, visual references.
- **creative/** — All creative output, organized by type.
  - `social/` — Instagram/Facebook campaigns and posts.
  - `catalog/` — Product photography.
  - `output/` — Generated exports (HTML, CSV) with date in filename.
- **knowledge/** — Store knowledge base.
  - `wine/` — Wine concepts, regions, styles.
  - `inbox/` — Unprocessed materials and references.
- **skills/** — Claude Code custom slash commands.
- **config/** — Store settings and thresholds.
- **data/** — Local data store: inventory, sales, products, suppliers.

## Key context

- **Primary metric:** Inventory turnover (оборачиваемость). The main agent analyses stock vs. sales history and recommends reorders.
- **Data sources:** Google Sheets (operational), POS/accounting system (TBD), Telegram bot inputs.
- **Dashboard shows:** Retail sales, wholesale sales, Instagram/Facebook/Maps daily metrics.
- **Customer store:** Browse catalog + reserve wine. Not full e-commerce — reservation only.
- **Telegram bot:** Staff use it for quick management accounting entries and stock queries.

## Deployment

All services deploy to Railway automatically on push to `main`.

## Secrets

Never commit `.env` files. Use `.env.local` locally and Railway environment variables in production.
See `config/secrets.example.env` for required variables.

## GitHub

https://github.com/rasputinpavel/wineandwhiskey
