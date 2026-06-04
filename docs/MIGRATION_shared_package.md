# Migration: shared `@ww/shared` package (keystone #1)

Status: **foundation landed on branch `chore/shared-package`** — `packages/shared`
exists, the repo is an npm workspace, and the `03_automation` layer is fully
migrated and verified. The web services and Telegram bots are **not yet
converted** because each builds from its own directory on Railway and switching
them requires Railway dashboard changes that must be applied and deploy-tested.

This doc is the runbook for finishing the migration.

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

### B. `02_services/matrix-runner` — tsx

1. Add `"02_services/*"` to root `workspaces`; add `"@ww/shared": "*"` to its `package.json`.
2. Replace `matrix-runner/b2b.ts` (mirror) with `import { classifyReceipt } from "@ww/shared/b2b"`.
3. Long term: also import the shared matrix logic so `matrix.ts` stops being a fork.
4. Railway: Root Directory = repo root; Start = `npm --workspace 02_services/matrix-runner run start`.

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
