# Wine & Whiskey — Store OS

This is the operating system for managing the Wine & Whiskey retail store.

## What lives here

- **dashboard/** — Internal operations dashboard (Railway). Sales, inventory, marketing metrics.
- **store/** — Customer-facing wine reservation shop (Railway + custom domain).
- **bot/** — Telegram bot for staff operations (Railway webhook).
- **agents/** — Claude AI agents (inventory turnover analysis, etc.).
- **skills/** — Claude Code custom slash commands.
- **data/** — Local data store: inventory, sales, products, suppliers.
- **integrations/** — Connectors: Google Sheets, POS, Instagram/Facebook.
- **reports/** — Generated reports (daily, weekly, monthly).
- **config/** — Store settings and thresholds.

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
