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
- **inbox/** — Incoming materials for any area: files to process, references, drafts.
- **skills/** — Claude Code custom slash commands.
- **config/** — Store settings and thresholds.
- **data/** — Local data store: inventory, sales, products, suppliers.

## Folder rules

These rules apply to all work in this repo. Follow them strictly. If a new file or directory does not fit the structure, **stop and discuss with the user before committing**.

| What | Where | Notes |
|------|-------|-------|
| Telegram bot code | `agents/<name>/` | Each bot is its own subdirectory |
| Web service code | `services/<name>/` | Each service is its own subdirectory |
| Data sync scripts | `automation/` | TypeScript/Python scripts, run from root `package.json` |
| Brand assets | `brand/` | design-system.md, tokens, logo/, references/ |
| Social posts & campaigns | `creative/social/` | Subdirectory per campaign or date |
| Product photography | `creative/catalog/` | |
| Generated exports | `creative/output/` | Filename must include date: `topic_YYYY-MM.ext` |
| Wine knowledge notes | `knowledge/wine/` | Concepts, regions, styles in markdown |
| Anything incoming / unprocessed | `inbox/` | Temporary landing zone — not knowledge, not output |
| Claude Code skills | `skills/` | |
| Store config & thresholds | `config/` | |

**Before adding a new top-level directory:** discuss with the user.
**Before committing a file that doesn't match the table above:** discuss with the user.

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
