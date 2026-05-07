# Mission Control (ЦУП)

Internal operations bridge for Wine & Whiskey — single screen with all key business KPIs and a registry of every service, agent, and sync job that runs the store.

Two functions:
1. **Operator mode** (you + Ирина) — quickly see business pulse, what's healthy, what's stale, jump straight to any service.
2. **Investor view** (later) — narrative of the AI-native wine boutique #1 on Phuket: visible agents, live KPIs, transparent automation.

## Stack
- Next.js 15 (App Router) · React 19 · Tailwind CSS
- Cookie auth (HMAC-signed, 30-day) — same pattern as `trendwatch`
- Reads later from: Supabase (`price-service` + `inventory` schemas), Loyverse REST, Google Sheets, Railway API

## Run locally

```bash
cd 02_services/mission-control
npm install
cp .env.example .env.local   # set MC_PASSWORD + MC_SECRET
npm run dev                  # → http://localhost:3003
```

## Deploy (Railway)

New service in the same Railway project. Set env vars: `MC_PASSWORD`, `MC_SECRET`. Build/start come from `railway.json` + `nixpacks.toml`. Health check: `/api/health`.

## Layout

- `app/page.tsx` — **Bridge** (HUD KPIs + subsystem rails)
- `app/systems/page.tsx` — fleet registry (all services as cards)
- `app/systems/[slug]/page.tsx` — single service detail
- `app/login/page.tsx` — bridge access
- `lib/registry.ts` — single source of truth for the service catalog
- `lib/kpi.ts` — KPI fetchers (currently mocks)

## Rollout plan

1. ✅ Skeleton, auth, dark starship theme
2. ✅ Bridge with mock KPIs + subsystem rails
3. ✅ `/systems` registry + per-service detail
4. Wire real KPIs one by one: revenue → GP → cash → stock health → turnover
5. Wire real health: `inventory.sync_log`, Railway API, GitHub last commit
6. Last-output stream: latest bot briefing, latest accounting close, latest reels
7. Polish: investor share-link mode (read-only public KPIs), iPad layout
