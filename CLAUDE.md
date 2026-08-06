# Wine & Whiskey — Store OS

This is the operating system for managing the Wine & Whiskey retail store.

> **Project docs:** see [`docs/`](docs/) — architecture, source-of-truth reference, data model, cross-cutting conventions, service catalog, and the latest audit. Start with [`docs/README.md`](docs/README.md). Keep these updated when the system changes.

## What lives here

- **docs/** — Project documentation: ARCHITECTURE, DATA_SOURCES (source of truth), DATA_MODEL, CROSS_CUTTING (shared logic & conventions), SERVICES, and dated audits.
- **packages/** — Shared internal packages consumed across the monorepo (npm workspaces). `packages/shared` = `@ww/shared`: B2B classification, Loyverse client, sales aggregation — the single home for cross-cutting source-of-truth logic.
- **.inbox/** — Incoming materials for any area: files to process, references, drafts.
- **01_agents/** — Виртуальные сотрудники (Telegram bots on Railway).
  - `bot/` — Staff operations bot (Chip & Dale).
  - `barrymore/` — Secretary bot (Бэрримор).
- **02_services/** — Web services on Railway.
  - `price-service/` — Next.js price list manager.
- **03_automation/** — Data sync scripts (run via `npm run <name>` from root).
- **04_brand/** — Design system, tokens, logo, visual references.
- **05_creative/** — All creative output, organized by type.
  - `social/` — Instagram/Facebook campaigns and posts.
  - `catalog/` — Product photography.
  - `output/` — Generated exports (HTML, CSV) with date in filename.
- **06_knowledge/** — Store knowledge base.
  - `wine/` — Wine concepts, regions, styles.
- **07_contacts/** — Партнёры и команда (профили, договоры, бонусные программы).
  - `partners/<slug>/` — внешние партнёры (поставщики, бренды, B2B, медиа).
  - `team/<slug>/` — сотрудники.
  - `templates/` — шаблоны карточек.
- **08_config/** — Store settings and thresholds.
- **09_data/** — Local data store: inventory, sales, products, suppliers.

## Folder rules

These rules apply to all work in this repo. Follow them strictly. If a new file or directory does not fit the structure, **stop and discuss with the user before committing**.

| What | Where | Notes |
|------|-------|-------|
| Project documentation | `docs/` | Architecture, source-of-truth, data model, conventions, service catalog, audits |
| Shared internal package | `packages/shared` (`@ww/shared`) | Cross-cutting logic (B2B, Loyverse client, sales aggregation). Edit here, not the copies |
| Anything incoming / unprocessed | `.inbox/` | Temporary landing zone — not knowledge, not output |
| Telegram bot code | `01_agents/<name>/` | Each bot is its own subdirectory |
| Web service code | `02_services/<name>/` | Each service is its own subdirectory |
| Data sync scripts | `03_automation/` | TypeScript/Python scripts, run from root `package.json` |
| Brand assets | `04_brand/` | design-system.md, tokens, logo/, references/ |
| Social posts & campaigns | `05_creative/social/` | Subdirectory per campaign or date |
| Product photography | `05_creative/catalog/` | |
| Generated exports | `05_creative/output/` | Date-first so newest sorts to top: folders `YYYY-MM-DD_topic/` (or `YYYY-MM_topic/`), files `YYYY-MM-DD_topic.ext` |
| Wine knowledge notes | `06_knowledge/wine/` | Concepts, regions, styles in markdown |
| Партнёры | `07_contacts/partners/<slug>/` | profile.md + contracts/ + programs.md + notes/ |
| Сотрудники | `07_contacts/team/<slug>/` | profile.md + compensation.md + notes/ |
| Store config & thresholds | `08_config/` | |
| Local data store | `09_data/` | Inventory, sales, products, suppliers |

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

- Main repo: https://github.com/rasputinpavel/wineandwhiskey
- Storefront (Lovable, separate repo): https://github.com/rasputinpavel/phuket-sip-reserve
  - Customer-facing wine catalog + reservations. Edited via Lovable, synced to its own repo.
  - Backed by a separate Lovable Cloud Supabase (project ref `fqpnhcsidaxlclmvcawj`).
  - Reads Vivino enrichment from `price-service` via `GET /api/public/vivino/lookup`
    (key in `STOREFRONT_API_KEY` on Railway).
  - Stock comes from its own Loyverse-sync edge function, not from `price-service`.
