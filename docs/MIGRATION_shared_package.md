# Migration: shared `@ww/shared` package (keystone #1)

Status: **foundation landed on `main`** (commit `00832ca`) — `packages/shared`
exists, the repo is an npm workspace, and the `03_automation` layer is fully
migrated and verified (`npm ci` + `npm run check:b2b` + `npm run reconcile` all
pass; CI does the same `npm ci` + tsx at root). The web services and Telegram
bots are **not yet converted** because each builds from its own directory on
Railway and switching them requires Railway dashboard changes that must be
applied and deploy-tested — do that **per service**, on a branch, before merging.

This doc is the runbook for finishing the migration.

⚠️ Per-service rule: do NOT push a service's `@ww/shared` conversion to `main`
until that service's Railway **Root Directory** is already switched to the repo
root — otherwise its next auto-deploy builds from its own subdir, can't find
`@ww/shared`, and fails. Convert on a branch → switch Railway root + Build/Start
→ deploy that branch → verify → merge.

## Why this exists

Every cross-cutting rule (B2B classification, the Loyverse client, sales
aggregation) used to be copy-pasted across `03_automation`, each `02_services/*`
app, and each `01_agents/*` bot, because there was no shared package and Railway
builds each service from its own subdirectory. The copies drifted in production
(see `docs/AUDIT_2026-06.md`). `@ww/shared` is the single home; once every
consumer imports it, each cross-cutting fix becomes a one-line change in one file.

## What landed (branch `chore/shared-package`)

- `packages/shared` — `@ww/shared` with subpath exports:
  - `@ww/shared/b2b` — `classifyReceipt`, `B2B_PATTERNS`, `BANK_TRANSFER_TYPE_ID`, `isB2BCustomerName`
  - `@ww/shared/loyverse` — `loyverseFetch` (retry), `loyverseGet`, `fetchCustomerNames`
  - `@ww/shared/sales_aggregate` — `aggregateSales`, `rollupByCategory`
- Root `package.json` is now a workspace (`"workspaces": ["packages/*"]`) and
  depends on `@ww/shared`.
- `03_automation/lib/{b2b,loyverse,sales_aggregate}.ts` are now thin re-exports
  of `@ww/shared/*`, so existing `./lib/*.js` imports keep working unchanged.
- Verified: `npm run check:b2b` and a tsx smoke import of all three modules
  resolve correctly through the workspace symlink.

The exports map points at `.ts` source on purpose: `tsx` (automation + bots) and
Next.js (`transpilePackages`) both compile TS from a workspace dependency, so no
build step is needed for the shared package.

## Remaining work — per consumer

### A. Telegram bots (`01_agents/bot`, `01_agents/barrymore`) — tsx, lowest risk

1. Add each bot to the workspace: append `"01_agents/*"` to root `workspaces`.
2. In each bot `package.json` add `"@ww/shared": "*"`.
3. Replace local copies with imports:
   - `bot/src/loyverse.ts` (dead third client) → delete; import from `@ww/shared/loyverse`.
   - `bot/src/tools.ts`, `barrymore/src/store.ts` → import `classifyReceipt` /
     `loyverseFetch` from `@ww/shared`.
4. Railway: set each bot service **Root Directory = repo root**, Build = 
   `npm ci`, Start = `npm --workspace 01_agents/bot run start` (and the
   barrymore equivalent). Deploy-test one bot first.

### B. ~~`02_services/matrix-runner`~~ — RETIRED 2026-06-05

No longer applicable: the service was removed (Google-Sheet purchase matrix dropped; Wine Matrix is native in the portal). Nothing to migrate.

### C. Next.js apps (`mission-control`, `price-service`, `kiosk`, `trendwatch`)

1. Add to workspace + `"@ww/shared": "*"` dependency.
2. In `next.config.ts` add `transpilePackages: ['@ww/shared']`.
3. Replace mirrors with imports:
   - `mission-control/lib/b2b.ts` → re-export `@ww/shared/b2b` (then point
     `loyverse.ts`/`customer_match.ts` at it — already centralised in-package).
   - De-dup the price/Vivino parsers (audit #7) into `@ww/shared` similarly.
4. Railway: Root Directory = repo root; Build = `npm ci && npm --workspace
   02_services/mission-control run build`; Start = `npm --workspace
   02_services/mission-control run start`. **Deploy-test mission-control on a
   Railway PR/preview environment before merging.**

## Railway change summary (must be done in the dashboard — cannot be scripted)

For every service, the per-service **Root Directory** moves from
`02_services/<svc>` (or `01_agents/<svc>`) to the **repo root**, and the Build/Start
commands switch to the `npm --workspace <path> run <script>` form so the workspace
install can link `@ww/shared`. Without this change the build context won't include
`packages/shared` and the import will fail at build time.

## Rollout order (safest)

1. Bots (tsx, cheap to redeploy, low blast radius) — A.
2. matrix-runner — B.
3. mission-control on a preview env — C, verify, then the rest.

Do **not** merge `chore/shared-package` to `main` until at least one Railway
service has been re-rooted and deploy-tested, because `main` auto-deploys.

## Drift guard in the meantime

Until B/C are converted, the in-package mirrors remain and are protected by
`npm run check:b2b`, which fails if any mirror diverges from `@ww/shared/b2b`.
Run it in CI / pre-push.

---

# По-русски — миграция на общий пакет `@ww/shared`

## Зачем это

Раньше каждое сквозное правило (классификация B2B, клиент Loyverse, агрегация
продаж) копипастилось между `03_automation`, каждым сервисом в `02_services/*`
и каждым ботом в `01_agents/*` — потому что общего пакета не было, а Railway
собирает каждый сервис из его собственной папки. Копии разъезжались в проде
(см. `docs/AUDIT_2026-06.md`). `@ww/shared` — единый дом для этой логики: когда
все его импортируют, любой фикс сквозного правила — это правка в одном файле.

## Что уже сделано (ветка `chore/shared-package`, НЕ в main)

- `packages/shared` — пакет `@ww/shared` с под-экспортами:
  - `@ww/shared/b2b` — `classifyReceipt`, `B2B_PATTERNS`, `BANK_TRANSFER_TYPE_ID`, `isB2BCustomerName`
  - `@ww/shared/loyverse` — `loyverseFetch` (с retry), `loyverseGet`, `fetchCustomerNames`
  - `@ww/shared/sales_aggregate` — `aggregateSales`, `rollupByCategory`
- Корневой `package.json` стал workspace (`"workspaces": ["packages/*"]`) и
  зависит от `@ww/shared`.
- `03_automation/lib/{b2b,loyverse,sales_aggregate}.ts` — теперь тонкие
  ре-экспорты `@ww/shared/*`, поэтому существующие импорты `./lib/*.js` работают
  как раньше.
- Проверено: `npm run check:b2b` + реальные прогоны `npm run daily / bestsellers
  / matrix` проходят через `@ww/shared`.

Экспорт-карта пакета указывает на `.ts`-исходники намеренно: `tsx` (скрипты и
боты) и Next.js (через `transpilePackages`) сами компилируют TS из workspace-
зависимости, поэтому отдельный билд пакета не нужен.

## Что осталось — по каждому потребителю

### A. Телеграм-боты (`01_agents/bot`, `01_agents/barrymore`) — на tsx, самый низкий риск

1. Добавить ботов в workspace: дописать `"01_agents/*"` в `workspaces` корня.
2. В `package.json` каждого бота добавить `"@ww/shared": "*"`.
3. Заменить локальные копии импортами:
   - `bot/src/loyverse.ts` (мёртвый третий клиент) → удалить; импортировать `@ww/shared/loyverse`.
   - `bot/src/tools.ts`, `barrymore/src/store.ts` → брать `classifyReceipt` /
     `loyverseFetch` из `@ww/shared`.
4. Railway: у каждого бота поставить **Root Directory = корень репозитория**,
   Build = `npm ci`, Start = `npm --workspace 01_agents/bot run start` (и аналог
   для barrymore). Сначала проверить деплоем один бот.

### B. ~~`02_services/matrix-runner`~~ — RETIRED 2026-06-05

Неактуально: сервис удалён (Google-таблица «Закупочная матрица» больше не используется; Wine Matrix теперь нативная в портале). Мигрировать нечего.

### C. Next.js-приложения (`mission-control`, `price-service`, `kiosk`, `trendwatch`)

1. Добавить в workspace + зависимость `"@ww/shared": "*"`.
2. В `next.config.ts` добавить `transpilePackages: ['@ww/shared']`.
3. Заменить зеркала импортами:
   - `mission-control/lib/b2b.ts` → ре-экспорт `@ww/shared/b2b` (а `loyverse.ts`
     и `customer_match.ts` уже берут B2B из этого внутрипакетного модуля).
   - Заодно вынести в `@ww/shared` дублирующиеся парсеры price/Vivino (аудит #7).
4. Railway: Root Directory = корень репо; Build = `npm ci && npm --workspace
   02_services/mission-control run build`; Start = `npm --workspace
   02_services/mission-control run start`. **Сначала проверить mission-control
   на preview-окружении Railway, и только потом мержить.**

## Изменения в Railway (только в дашборде — скриптом нельзя)

Для каждого сервиса per-service **Root Directory** меняется с
`02_services/<svc>` (или `01_agents/<svc>`) на **корень репозитория**, а
Build/Start переключаются на форму `npm --workspace <путь> run <скрипт>`, чтобы
workspace-установка слинковала `@ww/shared`. Без этого контекст сборки не
увидит `packages/shared` и импорт упадёт на этапе сборки.

## Порядок раскатки (самый безопасный)

1. Боты (tsx, дёшево передеплоить, маленький радиус поражения) — пункт A.
2. matrix-runner — пункт B.
3. mission-control на preview-окружении — пункт C, проверить, затем остальное.

**Не мержить** `chore/shared-package` в `main`, пока хотя бы один сервис в
Railway не пере-настроен на корень и не проверен деплоем — `main` деплоится
автоматически.

## Защита от расхождений на это время

Пока B/C не переведены, внутрипакетные зеркала остаются и защищены командой
`npm run check:b2b` — она падает, если любое зеркало разойдётся с
`@ww/shared/b2b`. Запускать в CI / перед пушем.
