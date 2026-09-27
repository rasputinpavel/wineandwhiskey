# Wine Casino Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `02_services/wine-casino` — a Kahoot-style multiplayer wine-tasting casino where guests join from their phones by QR/PIN, bet chips on a blind-poured wine's characteristics, and a host drives rounds from a control panel with a shared TV screen.

**Architecture:** Next.js 15 App Router service on Railway, backed by the existing Supabase project in a new `casino` schema. All game logic that decides money lives in pure, unit-tested functions under `lib/`; API routes are thin wrappers that load state, call the pure function, and persist. Correct answers never leave the server: they live in `casino.game_wine` (service-role only), while phones read a sanitized `casino.round_state` projection over Supabase Realtime.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 3, `@supabase/supabase-js` 2.104.0, `qrcode`, Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-28-wine-casino-design.md`](../specs/2026-09-28-wine-casino-design.md)

---

## Conventions carried over from this repo

- Services live in `02_services/<name>/`, each its own npm project (no root workspace entry — `workspaces` is `packages/*` only).
- Migrations are a single global sequence in `02_services/mission-control/supabase/migrations/NNN_*.sql` because every service shares one Supabase project. **The user applies them by hand in the Supabase SQL Editor** — never attempt to run DDL from code.
- Portal/service UI copy is English; this service is the exception — the *player* surface is bilingual RU/EN because the guests are mixed. Admin and host surfaces stay English.
- Vitest config mirrors mission-control: `include: ['lib/**/*.test.ts']`, `environment: 'node'`.
- Tailwind brand tokens are copied from `02_services/kiosk/tailwind.config.ts`.

## File Structure

```
02_services/wine-casino/
├── package.json                    npm project, dev port 3009
├── tsconfig.json                   paths: @/* -> ./*
├── next.config.ts                  outputFileTracingRoot -> repo root
├── tailwind.config.ts              brand tokens (copy of kiosk)
├── postcss.config.mjs
├── nixpacks.toml                   nodejs_20
├── railway.json                    healthcheck /api/health
├── vitest.config.ts                lib/**/*.test.ts
├── .env.example
├── README.md
├── middleware.ts                   gates /admin and /api/admin behind a cookie
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx                    guest join screen (PIN + nickname)
│   ├── play/page.tsx               guest game screen
│   ├── host/page.tsx               host control panel (?t=<host_token>)
│   ├── screen/[pin]/page.tsx       TV screen
│   ├── admin/page.tsx              game list + create
│   ├── admin/[gameId]/page.tsx     game editor (wines, options, hints)
│   ├── login/page.tsx              admin password form
│   └── api/
│       ├── health/route.ts
│       ├── join/route.ts           POST — guest joins by PIN
│       ├── state/route.ts          GET  — polling fallback + hint ticking
│       ├── bet/route.ts            POST — replace this player's bet slip
│       ├── host/state/route.ts     GET  — full state incl. answers
│       ├── host/round/route.ts     POST — start | lock | reveal | next
│       ├── host/tick/route.ts      POST — reveals hints that came due
│       ├── auth/login/route.ts     POST — admin password -> cookie
│       └── admin/
│           ├── games/route.ts              GET list, POST create
│           ├── games/[gameId]/route.ts     GET, PATCH, DELETE
│           ├── games/[gameId]/wines/route.ts          POST add
│           ├── games/[gameId]/wines/[wineId]/route.ts PATCH, DELETE
│           └── inventory/route.ts          GET ?q= search v_sku_breakdown
├── lib/
│   ├── types.ts          shared types, no imports
│   ├── wine-data.ts      country / grape / region dictionaries (RU + EN)
│   ├── categories.ts     category defs, multipliers, Old/New World map
│   ├── options.ts        answer-option generator            [tested]
│   ├── hints.ts          hint generator + schedule          [tested]
│   ├── payout.ts         settleRound — the money function   [tested]
│   ├── bets.ts           bet-slip validation                [tested]
│   ├── pin.ts            PIN + nickname uniqueness          [tested]
│   ├── i18n.ts           UI string dictionary RU/EN
│   ├── admin-auth.ts     HMAC cookie for the admin surface  [tested]
│   ├── supabase.ts       service-role + browser anon clients
│   ├── db.ts             server-only data access
│   ├── round.ts          server-only round orchestration
│   └── realtime.ts       client hooks: useRoundState, usePlayers
└── components/
    ├── Timer.tsx           local countdown synced to ends_at
    ├── BetBoard.tsx        the betting grid
    ├── ChipPicker.tsx      denomination selector
    ├── HintFeed.tsx        revealed hints
    ├── Leaderboard.tsx     shared by /screen and /play
    ├── QrPanel.tsx         QR + PIN for the TV
    └── LangToggle.tsx      RU / EN
```

**Why the money logic is split out:** `payout.ts`, `bets.ts`, `options.ts` and `hints.ts` are pure functions with no Supabase import. They are the only places a bug costs a real evening, so they are the only places with exhaustive tests, and they can be reasoned about without any of the Next.js machinery.

---

### Task 1: Scaffold the service

**Files:**
- Create: `02_services/wine-casino/package.json`
- Create: `02_services/wine-casino/tsconfig.json`
- Create: `02_services/wine-casino/next.config.ts`
- Create: `02_services/wine-casino/tailwind.config.ts`
- Create: `02_services/wine-casino/postcss.config.mjs`
- Create: `02_services/wine-casino/nixpacks.toml`
- Create: `02_services/wine-casino/railway.json`
- Create: `02_services/wine-casino/vitest.config.ts`
- Create: `02_services/wine-casino/.env.example`
- Create: `02_services/wine-casino/app/globals.css`
- Create: `02_services/wine-casino/app/layout.tsx`
- Create: `02_services/wine-casino/app/page.tsx`
- Create: `02_services/wine-casino/app/api/health/route.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "wine-casino",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3009",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "2.104.0",
    "next": "^15.1.0",
    "qrcode": "^1.5.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/qrcode": "^1.5.6",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.1.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.0.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts`, `postcss.config.mjs`, `nixpacks.toml`, `railway.json`, `vitest.config.ts`**

`next.config.ts`:
```ts
import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The repo is a monorepo; without this Next traces files from the wrong root.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'images.vivino.com' },
    ],
  },
}

export default nextConfig
```

`postcss.config.mjs`:
```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
```

`nixpacks.toml`:
```toml
[phases.setup]
nixPkgs = ["nodejs_20"]
```

`railway.json`:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Create `tailwind.config.ts`**

Same brand tokens as kiosk, plus a `felt` green for the casino table surface.

```ts
import type { Config } from 'tailwindcss'

// Brand tokens shared with mission-control and kiosk. `felt` is casino-only:
// the betting board reads as a card table, not as a portal page.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'warm-white':    '#F5F0EB',
        'cream':         '#EDE0D0',
        'pale-stone':    '#D4C9BC',
        'graphite':      '#3D3D3D',
        'deep-black':    '#1A1A1A',
        'wine-red':      '#8C1C1C',
        'burgundy-deep': '#5C1010',
        'amber-gold':    '#C9A84C',
        'felt':          '#14342B',
        'felt-light':    '#1D4739',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        heading: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Bebas Neue"', 'system-ui', 'sans-serif'],
      },
      letterSpacing: { 'overline': '0.18em', 'display': '0.04em' },
      borderRadius: { 'sm': '4px', 'md': '8px', 'lg': '16px' },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 5: Create `.env.example`**

```
# Same Supabase project as mission-control / kiosk (arbturzdpqvulsqwqpbd).
# The `casino` schema must be added to Settings -> API -> Exposed schemas.
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Password for /admin. Anything long; guests never see it.
CASINO_ADMIN_PASSWORD=
# Signing secret for the admin cookie.
CASINO_SECRET=

# Public origin, used to build the QR code shown on the TV.
NEXT_PUBLIC_CASINO_URL=https://wine-casino.up.railway.app
```

- [ ] **Step 6: Create `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/api/health/route.ts`**

`app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=DM+Sans:wght@500;700&family=Bebas+Neue&display=swap');

html, body {
  @apply bg-deep-black text-warm-white;
  -webkit-tap-highlight-color: transparent;
}
```

`app/layout.tsx`:
```tsx
import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Wine Casino — Wine & Whiskey',
  robots: { index: false, follow: false },
}

// Phones in a dim room. No pinch-zoom: the betting grid is already thumb-sized
// and an accidental zoom mid-round costs the guest the round.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#14342B',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
```

`app/page.tsx` — placeholder for now, replaced in Task 18:
```tsx
export default function Home() {
  return <main className="p-8 font-heading text-2xl">Wine Casino</main>
}
```

`app/api/health/route.ts`:
```ts
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ ok: true, service: 'wine-casino' })
}
```

- [ ] **Step 7: Install and verify the build**

Run:
```bash
cd 02_services/wine-casino && npm install && npm run build
```
Expected: `npm install` succeeds; `next build` finishes with `✓ Compiled successfully` and lists `/` and `/api/health` in the route table.

- [ ] **Step 8: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino
git commit -m "винное казино: скаффолд сервиса"
```

---

### Task 2: Database migration

**Files:**
- Create: `02_services/mission-control/supabase/migrations/047_wine_casino.sql`

The migration lives in mission-control's folder because all services share one Supabase project and one numbered migration sequence. `046_receipt_b2b_manual.sql` is the current head.

- [ ] **Step 1: Write the migration**

```sql
-- 047_wine_casino.sql
-- Wine Casino: a Kahoot-style multiplayer tasting game. Guests join from their
-- phones by PIN, bet chips on a blind-poured wine's characteristics, a host
-- drives the rounds, a TV shows the shared screen.
--
-- Trust model: correct answers live in casino.game_wine, which anon can never
-- read. Phones read casino.round_state, a sanitized projection the server
-- rewrites on every round transition — it only ever contains what is already
-- public at that moment. All payouts are computed server-side with the service
-- key, which bypasses RLS.
--
-- Apply manually in the Supabase SQL Editor (same as all other migrations),
-- then add `casino` to Settings -> API -> Exposed schemas or PostgREST will
-- 404 every request from the service.

create schema if not exists casino;

-- One game = one evening = one set of wines.
create table if not exists casino.game (
  id              uuid primary key default gen_random_uuid(),
  pin             text not null unique,          -- 6 digits, what guests type
  host_token      uuid not null default gen_random_uuid(),
  title           text not null default 'Wine Casino',
  status          text not null default 'draft', -- draft|lobby|running|finished
  difficulty      text not null default 'medium',-- easy|medium|hard|pro
  starting_chips  integer not null default 100,
  rescue_chips    integer not null default 10,   -- handed out when a guest busts
  round_seconds   integer not null default 120,
  categories      jsonb not null default '[]'::jsonb,  -- [{key,multiplier,ru,en}]
  current_wine_id uuid,
  created_at      timestamptz not null default now()
);

-- The wines of a game, in pouring order. PRIVATE: holds the answers.
create table if not exists casino.game_wine (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references casino.game(id) on delete cascade,
  order_no    integer not null,
  label       text not null,            -- what the guest sees: "Вино №3"
  sku         text,                     -- inventory.v_sku_breakdown.sku_id, if any
  name        text not null,
  country     text,
  region      text,
  grape       text,
  vintage     integer,
  style       text,                     -- dry|semi-dry|semi-sweet|sweet
  color       text,                     -- red|white|rose|sparkling|orange
  abv         numeric(4,1),
  image_url   text,
  answers     jsonb not null default '{}'::jsonb,  -- {category: canonical value}
  options     jsonb not null default '{}'::jsonb,  -- {category: [{value,ru,en}]}
  hints       jsonb not null default '[]'::jsonb,  -- [{at,ru,en}] at = sec remaining
  status      text not null default 'pending',     -- pending|betting|locked|revealed
  started_at  timestamptz,
  ends_at     timestamptz,
  unique (game_id, order_no)
);

-- Not declared inline on casino.game because game_wine does not exist yet at
-- that point. The server reads current_wine_id to know which round is live, so
-- a dangling pointer here would be an expensive bug to chase.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'game_current_wine_fk'
                    and conrelid = 'casino.game'::regclass) then
    alter table casino.game
      add constraint game_current_wine_fk
      foreign key (current_wine_id) references casino.game_wine(id) on delete set null;
  end if;
end $$;

-- The only game table a phone reads. One row per game, rewritten by the server.
create table if not exists casino.round_state (
  game_id          uuid primary key references casino.game(id) on delete cascade,
  wine_id          uuid,
  label            text,
  game_status      text not null default 'lobby',
  round_status     text not null default 'pending',
  round_no         integer not null default 0,
  total_rounds     integer not null default 0,
  ends_at          timestamptz,
  options          jsonb not null default '{}'::jsonb,
  revealed_hints   jsonb not null default '[]'::jsonb,
  revealed_answers jsonb,                -- null until the host reveals
  reveal           jsonb,                -- {name,country,region,grape,vintage,abv,image_url}
  updated_at       timestamptz not null default now()
);

create table if not exists casino.player (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references casino.game(id) on delete cascade,
  nickname   text not null,
  chips      integer not null default 0,
  lang       text not null default 'ru',      -- ru|en
  joined_at  timestamptz not null default now(),
  unique (game_id, nickname)
);

-- Split out so the bearer token is never in a table anon can select from.
create table if not exists casino.player_secret (
  player_id  uuid primary key references casino.player(id) on delete cascade,
  token_hash text not null
);

create table if not exists casino.bet (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references casino.game(id) on delete cascade,
  wine_id    uuid not null references casino.game_wine(id) on delete cascade,
  player_id  uuid not null references casino.player(id) on delete cascade,
  category   text not null,
  option     text not null,
  amount     integer not null,
  is_correct boolean,                    -- null = voided (no answer on file)
  payout     integer,
  created_at timestamptz not null default now(),
  unique (player_id, wine_id, category, option)
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'bet_amount_positive'
                    and conrelid = 'casino.bet'::regclass) then
    alter table casino.bet add constraint bet_amount_positive check (amount > 0);
  end if;
end $$;

create index if not exists game_wine_game_idx on casino.game_wine (game_id, order_no);
create index if not exists player_game_idx    on casino.player (game_id);
create index if not exists bet_wine_idx       on casino.bet (wine_id);
-- Every host request looks the game up by this token.
create unique index if not exists game_host_token_idx on casino.game (host_token);

-- RLS -----------------------------------------------------------------------
alter table casino.game          enable row level security;
alter table casino.game_wine     enable row level security;
alter table casino.round_state   enable row level security;
alter table casino.player        enable row level security;
alter table casino.player_secret enable row level security;
alter table casino.bet           enable row level security;

-- No policies on game, game_wine, player_secret and bet: with RLS on and no
-- policy, anon gets nothing. The server uses the service key, which bypasses RLS.

drop policy if exists round_state_public_read on casino.round_state;
create policy round_state_public_read on casino.round_state for select to anon using (true);

-- Nicknames and chip counts are the leaderboard; they are meant to be public.
drop policy if exists player_public_read on casino.player;
create policy player_public_read on casino.player for select to anon using (true);

grant usage on schema casino to anon, authenticated, service_role;
grant select on casino.round_state, casino.player to anon;
grant all on all tables in schema casino to service_role;
-- Future tables in this schema inherit service_role access without another grant.
alter default privileges in schema casino grant all on tables to service_role;

-- Realtime ------------------------------------------------------------------
-- ALTER PUBLICATION has no IF NOT EXISTS, and the SQL Editor runs a pasted
-- script as one transaction: a second run would abort the whole migration on
-- "already member of publication". Guard both.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'casino'
      and tablename = 'round_state'
  ) then
    alter publication supabase_realtime add table casino.round_state;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'casino'
      and tablename = 'player'
  ) then
    alter publication supabase_realtime add table casino.player;
  end if;
end $$;
```

- [ ] **Step 2: Commit — do NOT try to apply it**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/mission-control/supabase/migrations/047_wine_casino.sql
git commit -m "винное казино: миграция 047, схема casino"
```

Then tell the user, in these words: *миграцию 047 нужно применить вручную в Supabase SQL Editor, и после этого добавить схему `casino` в Settings → API → Exposed schemas.* There is no DB connection string in this project — the service key talks to PostgREST, which cannot run DDL.

---

### Task 3: Shared types, wine dictionaries, categories

**Files:**
- Create: `02_services/wine-casino/lib/types.ts`
- Create: `02_services/wine-casino/lib/wine-data.ts`
- Create: `02_services/wine-casino/lib/categories.ts`
- Test:   `02_services/wine-casino/lib/categories.test.ts`

- [ ] **Step 1: Create `lib/types.ts`**

```ts
// Shared vocabulary for the whole service. Imports nothing — everything else
// imports from here, so there is exactly one definition of each shape.

export type Difficulty  = 'easy' | 'medium' | 'hard' | 'pro'
export type GameStatus  = 'draft' | 'lobby' | 'running' | 'finished'
export type RoundStatus = 'pending' | 'betting' | 'locked' | 'revealed'
export type Lang        = 'ru' | 'en'
export type WineColor   = 'red' | 'white' | 'rose' | 'sparkling' | 'orange'

export type CategoryKey = 'style' | 'world' | 'country' | 'region' | 'grape' | 'vintage'

export type CategoryDef = {
  key: CategoryKey
  multiplier: number
  ru: string
  en: string
}

/** One selectable answer. `value` is the canonical, language-independent key. */
export type Option = { value: string; ru: string; en: string }

export type OptionSet = Partial<Record<CategoryKey, Option[]>>

/** `at` = seconds REMAINING in the round when this hint appears. */
export type Hint = { at: number; ru: string; en: string }

export type WineAnswers = Partial<Record<CategoryKey, string>>

/** Everything the generators need to know about a bottle. */
export type WineFacts = {
  name:    string
  country: string | null
  region:  string | null
  grape:   string | null
  vintage: number | null
  style:   string | null   // one of STYLE_OPTIONS values
  color:   WineColor | null
  abv:     number | null
}
```

- [ ] **Step 2: Create `lib/wine-data.ts`**

```ts
import type { Option, WineColor } from './types'

// Distractor pools. These do not have to be exhaustive — they have to be
// plausible enough that a guest cannot win by elimination. Values are the
// canonical lowercase key; ru/en are what the phone shows.

export const COUNTRIES: Option[] = [
  { value: 'france',       ru: 'Франция',      en: 'France' },
  { value: 'italy',        ru: 'Италия',       en: 'Italy' },
  { value: 'spain',        ru: 'Испания',      en: 'Spain' },
  { value: 'portugal',     ru: 'Португалия',   en: 'Portugal' },
  { value: 'germany',      ru: 'Германия',     en: 'Germany' },
  { value: 'austria',      ru: 'Австрия',      en: 'Austria' },
  { value: 'greece',       ru: 'Греция',       en: 'Greece' },
  { value: 'hungary',      ru: 'Венгрия',      en: 'Hungary' },
  { value: 'georgia',      ru: 'Грузия',       en: 'Georgia' },
  { value: 'moldova',      ru: 'Молдавия',     en: 'Moldova' },
  { value: 'russia',       ru: 'Россия',       en: 'Russia' },
  { value: 'chile',        ru: 'Чили',         en: 'Chile' },
  { value: 'argentina',    ru: 'Аргентина',    en: 'Argentina' },
  { value: 'australia',    ru: 'Австралия',    en: 'Australia' },
  { value: 'new zealand',  ru: 'Новая Зеландия', en: 'New Zealand' },
  { value: 'south africa', ru: 'ЮАР',          en: 'South Africa' },
  { value: 'usa',          ru: 'США',          en: 'USA' },
  { value: 'uruguay',      ru: 'Уругвай',      en: 'Uruguay' },
  { value: 'lebanon',      ru: 'Ливан',        en: 'Lebanon' },
  { value: 'israel',       ru: 'Израиль',      en: 'Israel' },
  { value: 'bulgaria',     ru: 'Болгария',     en: 'Bulgaria' },
  { value: 'cyprus',       ru: 'Кипр',         en: 'Cyprus' },
  // We are in Phuket and Monsoon Valley is on our own shelf.
  { value: 'thailand',     ru: 'Таиланд',      en: 'Thailand' },
]

/** Grapes carry a colour group so a red wine never gets Chardonnay as a decoy.
 *  `null` means we genuinely do not know — see grapeOption. */
export type GrapeOption = Option & { group: 'red' | 'white' | null }

export const GRAPES: GrapeOption[] = [
  { value: 'cabernet sauvignon', ru: 'Cabernet Sauvignon', en: 'Cabernet Sauvignon', group: 'red' },
  { value: 'merlot',             ru: 'Merlot',             en: 'Merlot',             group: 'red' },
  { value: 'syrah',              ru: 'Syrah / Shiraz',     en: 'Syrah / Shiraz',     group: 'red' },
  { value: 'pinot noir',         ru: 'Pinot Noir',         en: 'Pinot Noir',         group: 'red' },
  { value: 'sangiovese',         ru: 'Sangiovese',         en: 'Sangiovese',         group: 'red' },
  { value: 'nebbiolo',           ru: 'Nebbiolo',           en: 'Nebbiolo',           group: 'red' },
  { value: 'tempranillo',        ru: 'Tempranillo',        en: 'Tempranillo',        group: 'red' },
  { value: 'malbec',             ru: 'Malbec',             en: 'Malbec',             group: 'red' },
  { value: 'carmenere',          ru: 'Carménère',          en: 'Carménère',          group: 'red' },
  { value: 'saperavi',           ru: 'Saperavi',           en: 'Saperavi',           group: 'red' },
  { value: 'grenache',           ru: 'Grenache',           en: 'Grenache',           group: 'red' },
  { value: 'primitivo',          ru: 'Primitivo',          en: 'Primitivo',          group: 'red' },
  { value: 'montepulciano',      ru: 'Montepulciano',      en: 'Montepulciano',      group: 'red' },
  { value: 'chardonnay',         ru: 'Chardonnay',         en: 'Chardonnay',         group: 'white' },
  { value: 'sauvignon blanc',    ru: 'Sauvignon Blanc',    en: 'Sauvignon Blanc',    group: 'white' },
  { value: 'riesling',           ru: 'Riesling',           en: 'Riesling',           group: 'white' },
  { value: 'pinot grigio',       ru: 'Pinot Grigio',       en: 'Pinot Grigio',       group: 'white' },
  { value: 'rkatsiteli',         ru: 'Rkatsiteli',         en: 'Rkatsiteli',         group: 'white' },
  { value: 'viognier',           ru: 'Viognier',           en: 'Viognier',           group: 'white' },
  { value: 'chenin blanc',       ru: 'Chenin Blanc',       en: 'Chenin Blanc',       group: 'white' },
  { value: 'gewurztraminer',     ru: 'Gewürztraminer',     en: 'Gewürztraminer',     group: 'white' },
  { value: 'albarino',           ru: 'Albariño',           en: 'Albariño',           group: 'white' },
  { value: 'verdejo',            ru: 'Verdejo',            en: 'Verdejo',            group: 'white' },
  { value: 'muscat',             ru: 'Muscat',             en: 'Muscat',             group: 'white' },
  { value: 'glera',              ru: 'Glera',              en: 'Glera',              group: 'white' },
]

const REGIONS: Record<string, string[]> = {
  france:        ['Bordeaux', 'Bourgogne', 'Rhône', 'Loire', 'Languedoc', 'Provence', 'Champagne', 'Alsace'],
  italy:         ['Toscana', 'Piemonte', 'Veneto', 'Puglia', 'Sicilia', 'Abruzzo', 'Umbria', 'Friuli'],
  spain:         ['Rioja', 'Ribera del Duero', 'Priorat', 'Rueda', 'Rías Baixas', 'La Mancha'],
  portugal:      ['Douro', 'Alentejo', 'Vinho Verde', 'Dão'],
  germany:       ['Mosel', 'Rheingau', 'Pfalz', 'Baden'],
  austria:       ['Wachau', 'Burgenland', 'Kamptal'],
  greece:        ['Santorini', 'Nemea', 'Naoussa'],
  hungary:       ['Tokaj', 'Eger', 'Villány'],
  georgia:       ['Kakheti', 'Kartli', 'Imereti', 'Racha'],
  moldova:       ['Codru', 'Valul lui Traian', 'Ștefan Vodă'],
  russia:        ['Кубань', 'Крым', 'Долина Дона', 'Севастополь'],
  chile:         ['Maipo', 'Colchagua', 'Casablanca', 'Maule'],
  argentina:     ['Mendoza', 'Salta', 'Patagonia', 'San Juan'],
  australia:     ['Barossa', 'McLaren Vale', 'Yarra Valley', 'Coonawarra'],
  'new zealand': ['Marlborough', 'Central Otago', 'Hawke\'s Bay'],
  'south africa':['Stellenbosch', 'Swartland', 'Paarl', 'Walker Bay'],
  usa:           ['Napa Valley', 'Sonoma', 'Willamette Valley', 'Paso Robles'],
  uruguay:       ['Canelones', 'Maldonado'],
  lebanon:       ['Bekaa Valley'],
  israel:        ['Galilee', 'Judean Hills'],
  bulgaria:      ['Thracian Valley', 'Danubian Plain', 'Struma Valley'],
  cyprus:        ['Limassol', 'Paphos', 'Commandaria'],
  thailand:      ['Hua Hin', 'Khao Yai'],
}

/** A pool of plausible regions: the wine's own country first, falling back to
 *  every region we know when that country has too few. The fallback makes the
 *  question EASIER — foreign decoys are obvious next to a Bekaa Valley — but a
 *  one-button board would simply hand the answer over, so it is the better of
 *  the two bad options. */
export function regionsFor(country: string | null): Option[] {
  const key = (country ?? '').trim().toLowerCase()
  const own = REGIONS[key] ?? []
  const rest = Object.entries(REGIONS)
    .filter(([k]) => k !== key)
    .flatMap(([, v]) => v)
  // Keep OPTION_COUNTS.region (options.ts) in step with this number: below it
  // the board cannot be filled from one country and has to borrow decoys.
  const names = own.length >= 8 ? own : [...own, ...rest]
  return names.map(n => ({ value: n.toLowerCase(), ru: n, en: n }))
}

export function countryOption(country: string): Option {
  const key = country.trim().toLowerCase()
  return COUNTRIES.find(c => c.value === key) ?? { value: key, ru: country, en: country }
}

/** For a grape outside our pool, take the colour from the bottle rather than
 *  guessing. Hints state the grape's colour as fact and guests bet chips on it,
 *  so a wrong guess is worse than no answer: Kisi is a Georgian amber grape we
 *  actually stock, and a hardcoded 'red' fallback would have announced it red. */
export function grapeOption(grape: string, color?: WineColor | null): GrapeOption {
  const key = grape.trim().toLowerCase()
  return GRAPES.find(g => g.value === key)
      ?? { value: key, ru: grape, en: grape, group: grapeGroup(color ?? null) }
}

/** Rosé is pressed from red grapes; orange from white. Sparkling is mostly
 *  white grapes on our shelf. Anything unknown falls back to the whole pool. */
export function grapeGroup(color: WineColor | null): 'red' | 'white' | null {
  if (color === 'red' || color === 'rose') return 'red'
  if (color === 'white' || color === 'orange' || color === 'sparkling') return 'white'
  return null
}
```

- [ ] **Step 3: Create `lib/categories.ts`**

```ts
import { COUNTRIES } from './wine-data'
import type { CategoryDef, Option } from './types'

// Multipliers follow the classic game: the vaguer the question, the cheaper it
// pays. Vintage is the hardest and the richest. Every game stores its own copy
// in casino.game.categories so a host can retune without a deploy.
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { key: 'style',   multiplier: 1.5, ru: 'Стиль',               en: 'Style' },
  { key: 'world',   multiplier: 2,   ru: 'Старый / Новый Свет', en: 'Old / New World' },
  { key: 'country', multiplier: 4,   ru: 'Страна',              en: 'Country' },
  { key: 'grape',   multiplier: 6,   ru: 'Сорт',                en: 'Grape' },
  { key: 'region',  multiplier: 8,   ru: 'Регион',              en: 'Region' },
  { key: 'vintage', multiplier: 10,  ru: 'Год',                 en: 'Vintage' },
]

export const STYLE_OPTIONS: Option[] = [
  { value: 'dry',        ru: 'Сухое',       en: 'Dry' },
  { value: 'semi-dry',   ru: 'Полусухое',   en: 'Semi-dry' },
  { value: 'semi-sweet', ru: 'Полусладкое', en: 'Semi-sweet' },
  { value: 'sweet',      ru: 'Сладкое',     en: 'Sweet' },
]

export const WORLD_OPTIONS: Option[] = [
  { value: 'old', ru: 'Старый Свет', en: 'Old World' },
  { value: 'new', ru: 'Новый Свет',  en: 'New World' },
]

// Europe plus the Caucasus and the Levant cradle. Everything else is New World.
const OLD_WORLD = new Set([
  'france', 'italy', 'spain', 'portugal', 'germany', 'austria', 'greece',
  'hungary', 'georgia', 'moldova', 'romania', 'bulgaria', 'croatia', 'slovenia',
  'switzerland', 'serbia', 'czechia', 'north macedonia', 'armenia',
  'israel', 'lebanon', 'turkey', 'russia', 'cyprus',
])

/**
 * `null` means "we do not recognise this country", and the caller skips the
 * category. Treating an unrecognised string as confidently New World would pay
 * out on a guess: Cyprus was missing from the set above until a review caught
 * it, and the world category pays x2 either way.
 */
export function worldOf(country: string | null): 'old' | 'new' | null {
  const key = country?.trim().toLowerCase()
  if (!key) return null
  if (OLD_WORLD.has(key)) return 'old'
  return COUNTRIES.some(c => c.value === key) ? 'new' : null
}
```

- [ ] **Step 4: Write the failing test `lib/categories.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_CATEGORIES, STYLE_OPTIONS, WORLD_OPTIONS, worldOf } from './categories'

describe('worldOf', () => {
  it('puts Georgia and Russia in the Old World', () => {
    expect(worldOf('Georgia')).toBe('old')
    expect(worldOf('Russia')).toBe('old')
  })

  it('puts Chile and New Zealand in the New World', () => {
    expect(worldOf('Chile')).toBe('new')
    expect(worldOf('New Zealand')).toBe('new')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(worldOf('  ITALY ')).toBe('old')
  })

  it('returns null when the country is missing, so the category can be skipped', () => {
    expect(worldOf(null)).toBeNull()
    expect(worldOf('   ')).toBeNull()
  })

  it('returns null for a country we do not recognise rather than guessing', () => {
    expect(worldOf('Freedonia')).toBeNull()
    // A typo must not quietly pay out as New World.
    expect(worldOf('Itlay')).toBeNull()
  })

  it('treats a recognised country outside the Old World list as New World', () => {
    expect(worldOf('Thailand')).toBe('new')   // Monsoon Valley is on our shelf
    expect(worldOf('Chile')).toBe('new')
  })

  it('counts Cyprus as Old World', () => {
    expect(worldOf('Cyprus')).toBe('old')
  })
})

describe('DEFAULT_CATEGORIES', () => {
  it('pays more for harder questions, vintage highest', () => {
    const byKey = Object.fromEntries(DEFAULT_CATEGORIES.map(c => [c.key, c.multiplier]))
    expect(byKey.style).toBeLessThan(byKey.world)
    expect(byKey.world).toBeLessThan(byKey.country)
    expect(byKey.country).toBeLessThan(byKey.grape)
    expect(byKey.grape).toBeLessThan(byKey.region)
    expect(byKey.region).toBeLessThan(byKey.vintage)
  })

  it('has no duplicate keys', () => {
    const keys = DEFAULT_CATEGORIES.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('fixed option lists', () => {
  it('offers four styles ordered dry to sweet', () => {
    expect(STYLE_OPTIONS.map(o => o.value)).toEqual(['dry', 'semi-dry', 'semi-sweet', 'sweet'])
  })

  it('offers exactly two worlds', () => {
    expect(WORLD_OPTIONS.map(o => o.value)).toEqual(['old', 'new'])
  })
})
```

- [ ] **Step 5: Write the test `lib/wine-data.test.ts`**

These four helpers are where the canonical-value contract lives. If `countryOption('Italy').value`
ever stops equalling `'Italy'.trim().toLowerCase()`, a guest who taps the right button is told
they were wrong and loses chips for it. That is worth its own test file.

```ts
import { describe, it, expect } from 'vitest'
import { COUNTRIES, GRAPES, countryOption, grapeGroup, grapeOption, regionsFor } from './wine-data'

describe('the dictionaries themselves', () => {
  it('keeps every value canonical, because answers are matched by trim().toLowerCase()', () => {
    for (const o of [...COUNTRIES, ...GRAPES]) {
      expect(o.value).toBe(o.value.trim().toLowerCase())
    }
  })

  it('has no duplicate country or grape', () => {
    expect(new Set(COUNTRIES.map(c => c.value)).size).toBe(COUNTRIES.length)
    expect(new Set(GRAPES.map(g => g.value)).size).toBe(GRAPES.length)
  })

  it('has enough grapes of each colour to fill a six-button board', () => {
    expect(GRAPES.filter(g => g.group === 'red').length).toBeGreaterThanOrEqual(6)
    expect(GRAPES.filter(g => g.group === 'white').length).toBeGreaterThanOrEqual(6)
  })
})

describe('countryOption', () => {
  it('matches regardless of case and padding', () => {
    expect(countryOption('  ITALY ').value).toBe('italy')
  })

  it('round-trips the answer key that prepareWine will store', () => {
    for (const raw of ['Italy', 'georgia', ' Cyprus ', 'Thailand']) {
      expect(countryOption(raw).value).toBe(raw.trim().toLowerCase())
    }
  })

  it('falls back to the raw name for a country we do not stock', () => {
    const o = countryOption('Freedonia')
    expect(o.value).toBe('freedonia')
    expect(o.en).toBe('Freedonia')
  })
})

describe('grapeOption', () => {
  it('finds a known grape and keeps its colour', () => {
    expect(grapeOption('Merlot').group).toBe('red')
    expect(grapeOption('riesling').group).toBe('white')
  })

  it('takes the colour from the bottle for a grape outside the pool', () => {
    // Kisi is a Georgian amber grape we actually stock.
    expect(grapeOption('Kisi', 'orange').group).toBe('white')
    expect(grapeOption('Kisi', 'red').group).toBe('red')
  })

  it('refuses to invent a colour when both grape and bottle are unknown', () => {
    expect(grapeOption('Kisi').group).toBeNull()
    expect(grapeOption('Kisi', null).group).toBeNull()
  })

  it('round-trips the answer key', () => {
    expect(grapeOption('  Saperavi ').value).toBe('saperavi')
  })
})

describe('grapeGroup', () => {
  it('pairs rose with red grapes and orange with white', () => {
    expect(grapeGroup('rose')).toBe('red')
    expect(grapeGroup('orange')).toBe('white')
  })

  it('returns null for an unknown colour so the caller can widen the pool', () => {
    expect(grapeGroup(null)).toBeNull()
  })
})

describe('regionsFor', () => {
  it('uses the country own regions when it has enough', () => {
    const values = regionsFor('Italy').map(r => r.value)
    expect(values).toContain('toscana')
    expect(values).not.toContain('rioja')
  })

  it('widens the pool for a country with too few regions of its own', () => {
    // Lebanon has one region; a one-button board would hand the answer over.
    expect(regionsFor('Lebanon').length).toBeGreaterThan(4)
  })

  it('lowercases values so they match the stored answer', () => {
    for (const r of regionsFor('Georgia')) {
      expect(r.value).toBe(r.ru.trim().toLowerCase())
    }
  })
})
```

- [ ] **Step 6: Run the tests**

Run: `cd 02_services/wine-casino && npx vitest run`
Expected: PASS — 11 tests in `categories.test.ts`, 15 in `wine-data.test.ts`.

- [ ] **Step 7: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib
git commit -m "винное казино: типы, словари вин, категории ставок"
```

---

### Task 4: Answer-option generator (TDD)

Options are generated once, when the admin saves a wine, and stored in
`casino.game_wine.options`. Because they are stored, every phone sees the same
order without any shared shuffle seed.

**Files:**
- Create: `02_services/wine-casino/lib/options.ts`
- Test:   `02_services/wine-casino/lib/options.test.ts`

- [ ] **Step 1: Write the failing test `lib/options.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildOptions, OPTION_COUNTS } from './options'
import { DEFAULT_CATEGORIES } from './categories'
import type { CategoryKey, WineFacts } from './types'

const ALL: CategoryKey[] = ['style', 'world', 'country', 'grape', 'region', 'vintage']

const chianti: WineFacts = {
  name: 'Castello di Gabbiano Chianti Classico',
  country: 'Italy',
  region: 'Toscana',
  grape: 'Sangiovese',
  vintage: 2019,
  style: 'dry',
  color: 'red',
  abv: 13.5,
}

// A deterministic RNG so the assertions do not depend on Math.random.
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('buildOptions', () => {
  it('always includes the correct answer in every category', () => {
    const o = buildOptions(chianti, ALL, seeded(1))
    expect(o.style!.map(x => x.value)).toContain('dry')
    expect(o.world!.map(x => x.value)).toContain('old')
    expect(o.country!.map(x => x.value)).toContain('italy')
    expect(o.grape!.map(x => x.value)).toContain('sangiovese')
    expect(o.region!.map(x => x.value)).toContain('toscana')
    expect(o.vintage!.map(x => x.value)).toContain('2019')
  })

  it('never exceeds the configured option count', () => {
    const o = buildOptions(chianti, ALL, seeded(2))
    for (const key of ALL) {
      expect(o[key]!.length).toBeLessThanOrEqual(OPTION_COUNTS[key])
    }
  })

  it('never repeats an option inside a category', () => {
    const o = buildOptions(chianti, ALL, seeded(3))
    for (const key of ALL) {
      const values = o[key]!.map(x => x.value)
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('offers only red grapes as decoys for a red wine', () => {
    const o = buildOptions(chianti, ALL, seeded(4))
    expect(o.grape!.map(x => x.value)).not.toContain('chardonnay')
    expect(o.grape!.map(x => x.value)).not.toContain('riesling')
  })

  it('offers only white grapes as decoys for a white wine', () => {
    const riesling: WineFacts = { ...chianti, grape: 'Riesling', color: 'white', country: 'Germany', region: 'Mosel' }
    const o = buildOptions(riesling, ALL, seeded(5))
    expect(o.grape!.map(x => x.value)).not.toContain('merlot')
  })

  it('gives vintage options in ascending order around the true year', () => {
    const o = buildOptions(chianti, ALL, seeded(6))
    const years = o.vintage!.map(x => Number(x.value))
    expect(years).toEqual([...years].sort((a, b) => a - b))
    expect(years).toContain(2019)
    expect(years.length).toBe(OPTION_COUNTS.vintage)
  })

  it('does not put the true vintage in the same slot every time', () => {
    const positions = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map(seed => {
        const o = buildOptions(chianti, ALL, seeded(seed))
        return o.vintage!.findIndex(x => x.value === '2019')
      }),
    )
    expect(positions.size).toBeGreaterThan(1)
  })

  it('never makes a blind guess profitable: every multiplier fits its button count', () => {
    // Betting A chips on a uniform guess returns A*(m - n)/n, so m > n pays
    // ignorance better than knowledge. This invariant is the whole reason
    // region has 8 buttons and vintage has 10.
    for (const cat of DEFAULT_CATEGORIES) {
      expect(cat.multiplier).toBeLessThanOrEqual(OPTION_COUNTS[cat.key])
    }
  })

  it('treats an off-canon style as missing instead of posting an unwinnable board', () => {
    const offDry: WineFacts = { ...chianti, style: 'off-dry' }
    expect(buildOptions(offDry, ALL, seeded(11)).style).toBeUndefined()
  })

  it('never offers a vintage that has not happened yet', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const o = buildOptions({ ...chianti, vintage: 2025 }, ALL, seeded(seed), 2026)
      for (const opt of o.vintage!) {
        expect(Number(opt.value)).toBeLessThanOrEqual(2026)
      }
      expect(o.vintage!.map(x => x.value)).toContain('2025')
    }
  })

  it('skips a category whose fact is missing', () => {
    const noRegion: WineFacts = { ...chianti, region: null, vintage: null }
    const o = buildOptions(noRegion, ALL, seeded(7))
    expect(o.region).toBeUndefined()
    expect(o.vintage).toBeUndefined()
    expect(o.country).toBeDefined()
  })

  it('skips a category the game has turned off', () => {
    const o = buildOptions(chianti, ['style', 'country'], seeded(8))
    expect(o.grape).toBeUndefined()
    expect(o.vintage).toBeUndefined()
    expect(o.style).toBeDefined()
    expect(o.country).toBeDefined()
  })

  it('treats orange wine as white for grape decoys and still fills the board', () => {
    const orange: WineFacts = { ...chianti, grape: 'Rkatsiteli', color: 'orange', country: 'Georgia', region: 'Kakheti' }
    const o = buildOptions(orange, ALL, seeded(9))
    expect(o.grape!.length).toBe(OPTION_COUNTS.grape)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd 02_services/wine-casino && npx vitest run lib/options.test.ts`
Expected: FAIL — `Failed to resolve import "./options"`.

- [ ] **Step 3: Write `lib/options.ts`**

```ts
import { STYLE_OPTIONS, WORLD_OPTIONS, worldOf } from './categories'

import { COUNTRIES, GRAPES, countryOption, grapeGroup, grapeOption, regionsFor } from './wine-data'
import type { CategoryKey, Option, OptionSet, WineFacts } from './types'

// How many buttons a guest sees per category. Fixed across difficulties —
// difficulty only moves the hint schedule (see hints.ts).
//
// THE RULE: every count must be >= its category's multiplier. Betting A chips
// on a uniform blind guess returns A*(m - n)/n, so m > n makes ignorance
// profitable. With region at 4 buttons paying x8, and vintage at 5 paying x10,
// a guest who knew nothing about wine and mashed those two every round doubled
// their stake in expectation and beat anyone who actually tasted. The
// categories.test.ts invariant test locks this down.
export const OPTION_COUNTS: Record<CategoryKey, number> = {
  style:   4,
  world:   2,
  country: 6,
  grape:   6,
  region:  8,
  vintage: 10,
}

const STYLE_VALUES = new Set(STYLE_OPTIONS.map(o => o.value))

type Rng = () => number

function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function withDistractors(correct: Option, pool: readonly Option[], count: number, rng: Rng): Option[] {
  const decoys = shuffle(pool.filter(o => o.value !== correct.value), rng).slice(0, count - 1)
  return shuffle([correct, ...decoys], rng)
}

/** `count` consecutive years containing the true one, at a random offset so the
 *  answer is not always in the middle. Ascending, because a jumbled list of
 *  years is just annoying to read on a phone.
 *
 *  The window never runs past the current year: a vintage that has not happened
 *  yet is an obvious non-answer and hands the guest a free elimination, which
 *  is exactly the edge the option counts above exist to remove. `thisYear` is a
 *  parameter so the function stays pure and testable. */
function vintageWindow(vintage: number, count: number, rng: Rng, thisYear: number): number[] {
  const drift = Math.floor(rng() * count)
  const latest = Math.max(vintage, Math.min(vintage + drift, thisYear))
  const start = latest - count + 1
  return Array.from({ length: count }, (_, i) => start + i)
}

export function buildOptions(
  facts: WineFacts,
  activeCategories: readonly CategoryKey[],
  rng: Rng = Math.random,
  thisYear: number = new Date().getFullYear(),
): OptionSet {
  const on = (k: CategoryKey) => activeCategories.includes(k)
  const out: OptionSet = {}

  // Style and world are closed sets — showing all of them is the game. Style is
  // the one category whose correct answer is NOT derived from the fact itself,
  // so an off-canon value (a hand-typed "off-dry", a bulk import) would put four
  // buttons on the board with the right answer among none of them: every bet
  // unwinnable and no answer to highlight at the reveal. Skip instead.
  if (on('style') && facts.style && STYLE_VALUES.has(facts.style.trim().toLowerCase())) {
    out.style = [...STYLE_OPTIONS]
  }
  if (on('world') && worldOf(facts.country)) out.world = [...WORLD_OPTIONS]

  if (on('country') && facts.country) {
    out.country = withDistractors(countryOption(facts.country), COUNTRIES, OPTION_COUNTS.country, rng)
  }

  if (on('grape') && facts.grape) {
    const correct = grapeOption(facts.grape)
    const group = grapeGroup(facts.color)
    const scoped = group ? GRAPES.filter(g => g.group === group) : GRAPES
    const pool = scoped.length >= OPTION_COUNTS.grape ? scoped : GRAPES
    out.grape = withDistractors(correct, pool, OPTION_COUNTS.grape, rng)
  }

  if (on('region') && facts.region) {
    const correct: Option = { value: facts.region.trim().toLowerCase(), ru: facts.region, en: facts.region }
    out.region = withDistractors(correct, regionsFor(facts.country), OPTION_COUNTS.region, rng)
  }

  if (on('vintage') && facts.vintage) {
    out.vintage = vintageWindow(facts.vintage, OPTION_COUNTS.vintage, rng, thisYear)
      .map(y => ({ value: String(y), ru: String(y), en: String(y) }))
  }

  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd 02_services/wine-casino && npx vitest run lib/options.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/options.ts 02_services/wine-casino/lib/options.test.ts
git commit -m "винное казино: генератор вариантов ответов"
```

---

### Task 5: Hint generator and schedule (TDD)

**Files:**
- Create: `02_services/wine-casino/lib/hints.ts`
- Test:   `02_services/wine-casino/lib/hints.test.ts`
- Modify: `docs/superpowers/specs/2026-09-28-wine-casino-design.md` (one line)

- [ ] **Step 1: Write the failing test `lib/hints.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildHints, hintTimes } from './hints'
import type { CategoryKey, WineFacts } from './types'

const ALL: CategoryKey[] = ['style', 'world', 'country', 'grape', 'region', 'vintage']

const chianti: WineFacts = {
  name: 'Castello di Gabbiano Chianti Classico',
  country: 'Italy',
  region: 'Toscana',
  grape: 'Sangiovese',
  vintage: 2019,
  style: 'dry',
  color: 'red',
  abv: 13.5,
}

describe('hintTimes', () => {
  it('uses the reference schedule for a 120-second round', () => {
    expect(hintTimes('easy', 120)).toEqual([90, 60, 30])
    expect(hintTimes('medium', 120)).toEqual([60, 25])
    expect(hintTimes('hard', 120)).toEqual([25])
    expect(hintTimes('pro', 120)).toEqual([])
  })

  it('scales proportionally for a shorter round', () => {
    expect(hintTimes('easy', 60)).toEqual([45, 30, 15])
  })

  it('never schedules a hint closer than 5 seconds to the buzzer', () => {
    expect(hintTimes('easy', 10).every(t => t >= 5)).toBe(true)
  })

  it('counts down — later hints have fewer seconds remaining', () => {
    const t = hintTimes('easy', 120)
    expect(t).toEqual([...t].sort((a, b) => b - a))
  })
})

describe('buildHints', () => {
  it('gives professionals nothing', () => {
    expect(buildHints(chianti, 'pro', 120, ALL)).toEqual([])
  })

  it('gives three hints on easy, at the scheduled times', () => {
    const hints = buildHints(chianti, 'easy', 120, ALL)
    expect(hints).toHaveLength(3)
    expect(hints.map(h => h.at)).toEqual([90, 60, 30])
  })

  it('opens with the vaguest hint — Old or New World', () => {
    const [first] = buildHints(chianti, 'easy', 120, ALL)
    expect(first.ru).toBe('Это Старый Свет')
    expect(first.en).toBe('This is the Old World')
  })

  it('narrows the vintage to a one-year window either side', () => {
    const hints = buildHints(chianti, 'easy', 120, ALL)
    const vintage = hints.find(h => h.ru.startsWith('Год'))!
    expect(vintage.ru).toBe('Год между 2018 и 2020')
    expect(vintage.en).toBe('Vintage between 2018 and 2020')
  })

  it('writes every hint in both languages', () => {
    for (const h of buildHints(chianti, 'easy', 120, ALL)) {
      expect(h.ru.length).toBeGreaterThan(0)
      expect(h.en.length).toBeGreaterThan(0)
    }
  })

  it('never hints at a category the game has turned off', () => {
    const hints = buildHints(chianti, 'easy', 120, ['country', 'style'])
    expect(hints.some(h => h.ru.startsWith('Год'))).toBe(false)
    expect(hints.some(h => h.ru === 'Это Старый Свет')).toBe(false)
  })

  it('skips generators whose fact is missing and still fills the earlier slots', () => {
    const bare: WineFacts = { ...chianti, vintage: null, region: null, grape: null }
    const hints = buildHints(bare, 'easy', 120, ALL)
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.map(h => h.at)).toEqual([90, 60, 30].slice(0, hints.length))
  })

  it('never claims a colour for a grape we do not know on a bottle with no colour', () => {
    const kisi: WineFacts = { ...chianti, grape: 'Kisi', color: null }
    const hints = buildHints(kisi, 'easy', 120, ALL)
    expect(hints.some(h => h.ru === 'Сорт красный')).toBe(false)
    expect(hints.some(h => h.ru === 'Сорт белый')).toBe(false)
  })

  it('does name the colour when the bottle tells us, even for an unknown grape', () => {
    const kisi: WineFacts = { ...chianti, grape: 'Kisi', color: 'orange' }
    const hints = buildHints(kisi, 'easy', 120, ALL)
    expect(hints.some(h => h.ru === 'Сорт белый')).toBe(true)
  })

  it('returns nothing when no fact can produce a hint', () => {
    const blank: WineFacts = {
      name: 'Mystery', country: null, region: null, grape: null,
      vintage: null, style: null, color: null, abv: null,
    }
    expect(buildHints(blank, 'easy', 120, ALL)).toEqual([])
  })

  it('reveals the country initial in the local alphabet', () => {
    const hints = buildHints(chianti, 'easy', 120, ['country'])
    expect(hints[0].ru).toBe('Страна начинается на букву И')
    expect(hints[0].en).toBe('The country starts with I')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd 02_services/wine-casino && npx vitest run lib/hints.test.ts`
Expected: FAIL — `Failed to resolve import "./hints"`.

- [ ] **Step 3: Write `lib/hints.ts`**

```ts
import { worldOf } from './categories'
import { countryOption, grapeOption } from './wine-data'
import type { CategoryKey, Difficulty, Hint, WineFacts } from './types'

// The schedule is written for a 120-second round and scaled from there, so a
// host can shorten rounds without the hints bunching up at the buzzer.
const BASE_ROUND_SECONDS = 120

export const HINT_SCHEDULE: Record<Difficulty, number[]> = {
  easy:   [90, 60, 30],
  medium: [60, 25],
  hard:   [25],
  pro:    [],
}

/** Times are seconds REMAINING, so the list runs high to low. */
export function hintTimes(difficulty: Difficulty, roundSeconds: number): number[] {
  return HINT_SCHEDULE[difficulty].map(t =>
    Math.max(5, Math.round((t / BASE_ROUND_SECONDS) * roundSeconds)),
  )
}

type Text = { ru: string; en: string }
type Generator = { category: CategoryKey; make: (f: WineFacts) => Text | null }

/** Ordered vaguest first: the opening hint should barely narrow the field, the
 *  last one should rescue a guest who is completely lost. */
const GENERATORS: Generator[] = [
  {
    category: 'world',
    make: f => {
      const w = worldOf(f.country)
      if (!w) return null
      return w === 'old'
        ? { ru: 'Это Старый Свет', en: 'This is the Old World' }
        : { ru: 'Это Новый Свет',  en: 'This is the New World' }
    },
  },
  {
    category: 'vintage',
    make: f => f.vintage
      ? {
          ru: `Год между ${f.vintage - 1} и ${f.vintage + 1}`,
          en: `Vintage between ${f.vintage - 1} and ${f.vintage + 1}`,
        }
      : null,
  },
  {
    category: 'grape',
    make: f => {
      if (!f.grape) return null
      // A hint is stated as fact and guests bet chips on it. If the grape is
      // outside our pool AND the bottle's colour is unrecorded, we genuinely do
      // not know — skip rather than guess. (Kisi, a Georgian amber grape we
      // stock, used to be announced as red by a hardcoded fallback.)
      const g = grapeOption(f.grape, f.color)
      if (!g.group) return null
      return g.group === 'red'
        ? { ru: 'Сорт красный', en: 'The grape is red' }
        : { ru: 'Сорт белый',   en: 'The grape is white' }
    },
  },
  {
    category: 'country',
    make: f => {
      if (!f.country) return null
      const c = countryOption(f.country)
      return {
        ru: `Страна начинается на букву ${c.ru.trim()[0].toUpperCase()}`,
        en: `The country starts with ${c.en.trim()[0].toUpperCase()}`,
      }
    },
  },
  {
    category: 'grape',
    // Grape names are printed in Latin on our shelf, so the initial is the same
    // letter in both languages.
    make: f => f.grape
      ? {
          ru: `Сорт начинается на букву ${f.grape.trim()[0].toUpperCase()}`,
          en: `The grape starts with ${f.grape.trim()[0].toUpperCase()}`,
        }
      : null,
  },
  {
    category: 'region',
    make: f => {
      if (!f.region) return null
      const letter = f.region.trim()[0].toUpperCase()
      const country = f.country ? countryOption(f.country) : null
      return {
        ru: country ? `Регион: ${country.ru}, на букву ${letter}` : `Регион на букву ${letter}`,
        en: country ? `Region: ${country.en}, starts with ${letter}` : `Region starts with ${letter}`,
      }
    },
  },
]

export function buildHints(
  facts: WineFacts,
  difficulty: Difficulty,
  roundSeconds: number,
  activeCategories: readonly CategoryKey[],
): Hint[] {
  const times = hintTimes(difficulty, roundSeconds)
  if (times.length === 0) return []

  const texts: Text[] = []
  for (const g of GENERATORS) {
    if (texts.length >= times.length) break
    if (!activeCategories.includes(g.category)) continue
    const t = g.make(facts)
    if (t) texts.push(t)
  }

  return texts.map((t, i) => ({ at: times[i], ru: t.ru, en: t.en }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd 02_services/wine-casino && npx vitest run lib/hints.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Correct the spec**

The spec says the vintage hint uses a `±2` window while its own example shows
`±1`. The implementation uses `±1`. Fix the spec line so the two agree:

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
sed -i '' 's/(диапазон ±2 от истинного)/(окно ±1 год от истинного)/' \
  docs/superpowers/specs/2026-09-28-wine-casino-design.md
grep -n 'окно ±1' docs/superpowers/specs/2026-09-28-wine-casino-design.md
```
Expected: one matching line.

- [ ] **Step 6: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/hints.ts 02_services/wine-casino/lib/hints.test.ts \
        docs/superpowers/specs/2026-09-28-wine-casino-design.md
git commit -m "винное казино: генератор подсказок и расписание по сложности"
```

---

### Task 6: Payout engine (TDD)

This is the function that decides who wins the evening. It is pure: no Supabase,
no clock, no randomness.

**Files:**
- Create: `02_services/wine-casino/lib/payout.ts`
- Test:   `02_services/wine-casino/lib/payout.test.ts`

- [ ] **Step 1: Write the failing test `lib/payout.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { settleRound } from './payout'
import { DEFAULT_CATEGORIES } from './categories'
import type { PlacedBet } from './payout'

const answers = { style: 'dry', world: 'old', country: 'italy', vintage: '2019' }

function run(bets: PlacedBet[], players: Array<{ id: string; chips: number }>, rescueChips = 10) {
  return settleRound({ bets, answers, categories: DEFAULT_CATEGORIES, players, rescueChips })
}

describe('settleRound', () => {
  it('pays the stake times the category multiplier on a correct bet', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: 'italy', amount: 10 }], [{ id: 'p1', chips: 100 }])
    expect(r.bets[0].isCorrect).toBe(true)
    expect(r.bets[0].payout).toBe(40)                 // 10 x4
    expect(r.players[0].chipsAfter).toBe(130)         // 100 - 10 + 40
  })

  it('burns the stake on a wrong bet', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: 'france', amount: 10 }], [{ id: 'p1', chips: 100 }])
    expect(r.bets[0].isCorrect).toBe(false)
    expect(r.bets[0].payout).toBe(0)
    expect(r.players[0].chipsAfter).toBe(90)
  })

  it('compares answers case- and whitespace-insensitively', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: '  ITALY ', amount: 10 }], [{ id: 'p1', chips: 100 }])
    expect(r.bets[0].isCorrect).toBe(true)
  })

  it('rounds a fractional multiplier to the nearest chip', () => {
    // style pays x1.5; 5 chips -> 7.5 -> 8.
    const r = run([{ playerId: 'p1', category: 'style', option: 'dry', amount: 5 }], [{ id: 'p1', chips: 50 }])
    expect(r.bets[0].payout).toBe(8)
    expect(r.players[0].chipsAfter).toBe(53)
  })

  it('settles a hedge across two options in one category', () => {
    const r = run(
      [
        { playerId: 'p1', category: 'world', option: 'old', amount: 20 },
        { playerId: 'p1', category: 'world', option: 'new', amount: 20 },
      ],
      [{ id: 'p1', chips: 100 }],
    )
    expect(r.players[0].staked).toBe(40)
    expect(r.players[0].won).toBe(40)                 // 20 x2 on 'old', nothing on 'new'
    expect(r.players[0].chipsAfter).toBe(100)         // hedging the coin flip is break-even
  })

  it('voids a bet when we have no answer on file and hands the stake back', () => {
    // 'grape' is a live category but this wine has no grape recorded.
    const r = run([{ playerId: 'p1', category: 'grape', option: 'merlot', amount: 30 }], [{ id: 'p1', chips: 100 }])
    expect(r.bets[0].isCorrect).toBeNull()
    expect(r.bets[0].payout).toBe(30)
    expect(r.players[0].chipsAfter).toBe(100)
  })

  it('voids a bet in a category the game does not run', () => {
    const r = settleRound({
      bets: [{ playerId: 'p1', category: 'vintage', option: '2019', amount: 30 }],
      answers,
      categories: DEFAULT_CATEGORIES.filter(c => c.key !== 'vintage'),
      players: [{ id: 'p1', chips: 100 }],
      rescueChips: 10,
    })
    expect(r.bets[0].isCorrect).toBeNull()
    expect(r.players[0].chipsAfter).toBe(100)
  })

  it('leaves a player who passed exactly where they were', () => {
    const r = run([], [{ id: 'p1', chips: 73 }])
    expect(r.players[0]).toMatchObject({ chipsAfter: 73, staked: 0, won: 0, rescued: false })
  })

  it('hands rescue chips to a player who bet everything and lost', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: 'chile', amount: 40 }], [{ id: 'p1', chips: 40 }])
    expect(r.players[0].chipsAfter).toBe(10)
    expect(r.players[0].rescued).toBe(true)
  })

  it('rescues a player who is already at zero and could not bet', () => {
    const r = run([], [{ id: 'p1', chips: 0 }])
    expect(r.players[0].chipsAfter).toBe(10)
    expect(r.players[0].rescued).toBe(true)
  })

  it('does not rescue a player who merely lost some chips', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: 'chile', amount: 40 }], [{ id: 'p1', chips: 100 }])
    expect(r.players[0].chipsAfter).toBe(60)
    expect(r.players[0].rescued).toBe(false)
  })

  it('settles every player in the game, including ones with no bets', () => {
    const r = run(
      [{ playerId: 'p1', category: 'world', option: 'old', amount: 10 }],
      [{ id: 'p1', chips: 100 }, { id: 'p2', chips: 100 }],
    )
    expect(r.players.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(r.players[1].chipsAfter).toBe(100)
  })

  it('never mutates the inputs', () => {
    const players = [{ id: 'p1', chips: 100 }]
    const bets: PlacedBet[] = [{ playerId: 'p1', category: 'world', option: 'old', amount: 10 }]
    run(bets, players)
    expect(players[0].chips).toBe(100)
    expect(bets[0]).toEqual({ playerId: 'p1', category: 'world', option: 'old', amount: 10 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd 02_services/wine-casino && npx vitest run lib/payout.test.ts`
Expected: FAIL — `Failed to resolve import "./payout"`.

- [ ] **Step 3: Write `lib/payout.ts`**

```ts
import type { CategoryDef, CategoryKey, WineAnswers } from './types'

export type PlacedBet = {
  playerId: string
  category: CategoryKey
  option: string
  amount: number
}

/** `isCorrect: null` means the bet was voided and the stake returned. */
export type SettledBet = PlacedBet & { isCorrect: boolean | null; payout: number }

export type PlayerSettlement = {
  id: string
  chipsBefore: number
  chipsAfter: number
  staked: number
  won: number
  rescued: boolean
}

export type SettleResult = { bets: SettledBet[]; players: PlayerSettlement[] }

function canon(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Settle one wine. Chips are only moved here — placing a bet does not touch a
 * player's balance, it just reserves against it (see bets.ts).
 */
export function settleRound(input: {
  bets: readonly PlacedBet[]
  answers: WineAnswers
  categories: readonly CategoryDef[]
  players: ReadonlyArray<{ id: string; chips: number }>
  rescueChips: number
}): SettleResult {
  const multiplier = new Map(input.categories.map(c => [c.key, c.multiplier]))

  const bets: SettledBet[] = input.bets.map(b => {
    const answer = input.answers[b.category]
    const m = multiplier.get(b.category)
    // Either we never recorded the answer, or the category is not in play.
    // Void the bet and give the stake back: a gap in our data entry is our
    // mistake, and a guest must never lose chips to it.
    if (answer == null || answer === '' || m == null) {
      return { ...b, isCorrect: null, payout: b.amount }
    }
    const isCorrect = canon(answer) === canon(b.option)
    return { ...b, isCorrect, payout: isCorrect ? Math.round(b.amount * m) : 0 }
  })

  const players: PlayerSettlement[] = input.players.map(p => {
    const mine = bets.filter(b => b.playerId === p.id)
    const staked = mine.reduce((s, b) => s + b.amount, 0)
    const won = mine.reduce((s, b) => s + b.payout, 0)
    let chipsAfter = p.chips - staked + won
    let rescued = false
    // A busted guest stops playing and starts looking at their phone. Hand them
    // a small stack so they stay in the game — a deliberate break from the
    // classic rules, see the spec.
    if (chipsAfter <= 0) {
      chipsAfter = input.rescueChips
      rescued = true
    }
    return { id: p.id, chipsBefore: p.chips, chipsAfter, staked, won, rescued }
  })

  return { bets, players }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd 02_services/wine-casino && npx vitest run lib/payout.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/payout.ts 02_services/wine-casino/lib/payout.test.ts
git commit -m "винное казино: расчёт выплат и спасательные фишки"
```

---

### Task 7: Bet-slip validation (TDD)

A phone submits its **whole** slip for the current wine, not increments. The
server replaces whatever it had. That makes a dropped request harmless: the next
autosave carries the full picture.

**Files:**
- Create: `02_services/wine-casino/lib/bets.ts`
- Test:   `02_services/wine-casino/lib/bets.test.ts`

- [ ] **Step 1: Write the failing test `lib/bets.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { validateBetSlip } from './bets'
import type { BetLine } from './bets'
import type { CategoryKey, Option } from './types'

const options: Partial<Record<CategoryKey, Option[]>> = {
  country: [
    { value: 'italy',  ru: 'Италия',  en: 'Italy' },
    { value: 'france', ru: 'Франция', en: 'France' },
  ],
  world: [
    { value: 'old', ru: 'Старый Свет', en: 'Old World' },
    { value: 'new', ru: 'Новый Свет',  en: 'New World' },
  ],
}

const active: CategoryKey[] = ['country', 'world']

function check(
  slip: BetLine[],
  playerChips = 100,
  roundStatus: 'betting' | 'locked' = 'betting',
  ids: { playerGameId?: string; wineGameId?: string } = {},
) {
  return validateBetSlip({
    roundStatus,
    activeCategories: active,
    options,
    playerChips,
    slip,
    playerGameId: ids.playerGameId ?? 'g1',
    wineGameId: ids.wineGameId ?? 'g1',
  })
}

describe('validateBetSlip', () => {
  it('accepts a slip within the player’s bank', () => {
    expect(check([{ category: 'country', option: 'italy', amount: 30 }])).toEqual({ ok: true, total: 30 })
  })

  it('accepts an empty slip — passing is a legal move', () => {
    expect(check([])).toEqual({ ok: true, total: 0 })
  })

  it('accepts a hedge across two options in one category', () => {
    const r = check([
      { category: 'world', option: 'old', amount: 10 },
      { category: 'world', option: 'new', amount: 10 },
    ])
    expect(r).toEqual({ ok: true, total: 20 })
  })

  it('rejects a bet aimed at a wine from another game', () => {
    // A phone left open on last week's game must not reach into tonight's.
    expect(check([{ category: 'country', option: 'italy', amount: 5 }], 100, 'betting', { wineGameId: 'g2' }))
      .toEqual({ ok: false, error: 'wrong_game' })
  })

  it('rejects everything once the round is locked', () => {
    expect(check([{ category: 'country', option: 'italy', amount: 1 }], 100, 'locked'))
      .toEqual({ ok: false, error: 'round_closed' })
  })

  it('rejects a category the game does not run', () => {
    expect(check([{ category: 'vintage', option: '2019', amount: 5 }]))
      .toEqual({ ok: false, error: 'unknown_category' })
  })

  it('rejects an option that is not on this wine’s board', () => {
    expect(check([{ category: 'country', option: 'chile', amount: 5 }]))
      .toEqual({ ok: false, error: 'unknown_option' })
  })

  it('rejects a zero, negative or fractional stake', () => {
    expect(check([{ category: 'country', option: 'italy', amount: 0 }])).toEqual({ ok: false, error: 'bad_amount' })
    expect(check([{ category: 'country', option: 'italy', amount: -5 }])).toEqual({ ok: false, error: 'bad_amount' })
    expect(check([{ category: 'country', option: 'italy', amount: 2.5 }])).toEqual({ ok: false, error: 'bad_amount' })
  })

  it('rejects the same option twice — the phone should have summed it', () => {
    expect(check([
      { category: 'country', option: 'italy', amount: 5 },
      { category: 'country', option: 'italy', amount: 5 },
    ])).toEqual({ ok: false, error: 'duplicate_bet' })
  })

  it('rejects a slip that exceeds the bank', () => {
    expect(check([
      { category: 'country', option: 'italy', amount: 60 },
      { category: 'world', option: 'old', amount: 50 },
    ], 100)).toEqual({ ok: false, error: 'insufficient_chips' })
  })

  it('allows betting the whole bank', () => {
    expect(check([{ category: 'country', option: 'italy', amount: 100 }], 100)).toEqual({ ok: true, total: 100 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd 02_services/wine-casino && npx vitest run lib/bets.test.ts`
Expected: FAIL — `Failed to resolve import "./bets"`.

- [ ] **Step 3: Write `lib/bets.ts`**

```ts
import type { CategoryKey, Option, RoundStatus } from './types'

export type BetLine = { category: CategoryKey; option: string; amount: number }

export type BetError =
  | 'wrong_game'
  | 'round_closed'
  | 'unknown_category'
  | 'unknown_option'
  | 'bad_amount'
  | 'duplicate_bet'
  | 'insufficient_chips'

export type BetValidation = { ok: true; total: number } | { ok: false; error: BetError }

/**
 * Validates a complete replacement slip for the current wine. The phone is not
 * trusted about anything: category, option and amount are all re-checked
 * against the stored board and the server-side chip count.
 */
export function validateBetSlip(input: {
  roundStatus: RoundStatus
  activeCategories: readonly CategoryKey[]
  options: Partial<Record<CategoryKey, Option[]>>
  playerChips: number
  slip: readonly BetLine[]
  /** The game the player belongs to, and the game the wine belongs to. */
  playerGameId: string
  wineGameId: string
}): BetValidation {
  if (input.playerGameId !== input.wineGameId) return { ok: false, error: 'wrong_game' }
  if (input.roundStatus !== 'betting') return { ok: false, error: 'round_closed' }

  const seen = new Set<string>()
  let total = 0

  for (const line of input.slip) {
    if (!input.activeCategories.includes(line.category)) return { ok: false, error: 'unknown_category' }

    const board = input.options[line.category] ?? []
    if (!board.some(o => o.value === line.option)) return { ok: false, error: 'unknown_option' }

    if (!Number.isInteger(line.amount) || line.amount < 1) return { ok: false, error: 'bad_amount' }

    const key = `${line.category}:${line.option}`
    if (seen.has(key)) return { ok: false, error: 'duplicate_bet' }
    seen.add(key)

    total += line.amount
  }

  if (total > input.playerChips) return { ok: false, error: 'insufficient_chips' }
  return { ok: true, total }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd 02_services/wine-casino && npx vitest run lib/bets.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/bets.ts 02_services/wine-casino/lib/bets.test.ts
git commit -m "винное казино: валидация ставок"
```

---

### Task 8: PIN and nickname helpers (TDD)

**Files:**
- Create: `02_services/wine-casino/lib/pin.ts`
- Test:   `02_services/wine-casino/lib/pin.test.ts`

- [ ] **Step 1: Write the failing test `lib/pin.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { generatePin, uniqueNickname } from './pin'

describe('generatePin', () => {
  it('always produces six digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePin()).toMatch(/^\d{6}$/)
    }
  })

  it('never starts with a zero — guests mistype leading zeros', () => {
    expect(generatePin(() => 0)).toBe('100000')
  })

  it('uses the whole range', () => {
    expect(generatePin(() => 0.999999)).toBe('999999')
  })
})

describe('uniqueNickname', () => {
  it('keeps a free name as typed', () => {
    expect(uniqueNickname('Аня', ['Пётр'])).toBe('Аня')
  })

  it('numbers a duplicate', () => {
    expect(uniqueNickname('Аня', ['Аня'])).toBe('Аня (2)')
  })

  it('keeps counting past the first duplicate', () => {
    expect(uniqueNickname('Аня', ['Аня', 'Аня (2)'])).toBe('Аня (3)')
  })

  it('treats case and padding as the same name', () => {
    expect(uniqueNickname('  аня  ', ['АНЯ'])).toBe('аня (2)')
  })

  it('falls back to a default for an empty name', () => {
    expect(uniqueNickname('   ', [])).toBe('Гость')
  })

  it('truncates a very long name so it fits the leaderboard', () => {
    expect(uniqueNickname('a'.repeat(50), [])).toHaveLength(24)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd 02_services/wine-casino && npx vitest run lib/pin.test.ts`
Expected: FAIL — `Failed to resolve import "./pin"`.

- [ ] **Step 3: Write `lib/pin.ts`**

```ts
const MAX_NICK = 24

/** Six digits, never leading zero: guests drop leading zeros when typing. */
export function generatePin(rng: () => number = Math.random): string {
  return String(100000 + Math.floor(rng() * 900000))
}

/** `casino.player` has a unique (game_id, nickname) index — resolve collisions
 *  here rather than bouncing the guest back to the form. */
export function uniqueNickname(desired: string, taken: readonly string[]): string {
  const base = desired.trim().slice(0, MAX_NICK) || 'Гость'
  const used = new Set(taken.map(t => t.trim().toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} (${n})`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return `${base} (${Date.now() % 1000})`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd 02_services/wine-casino && npx vitest run lib/pin.test.ts`
Expected: PASS, 9 tests.

Note on `generatePin(() => 0.999999)`: `Math.floor(0.999999 * 900000)` is `899999`,
so the result is `999999`.

- [ ] **Step 5: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/pin.ts 02_services/wine-casino/lib/pin.test.ts
git commit -m "винное казино: PIN и уникализация ников"
```

---

### Task 9: UI string dictionary

Player-facing copy is RU + EN. Host and admin stay English, matching the rest of
the portal. A dictionary object is enough — an i18n library would be more moving
parts than this service has strings.

**Files:**
- Create: `02_services/wine-casino/lib/i18n.ts`

- [ ] **Step 1: Create `lib/i18n.ts`**

```ts
import type { Lang } from './types'

// Only the guest surface is translated. Host and admin are English-only, like
// the rest of the portal — they are used by us, not by the room.
const STRINGS = {
  joinTitle:        { ru: 'Винное казино',            en: 'Wine Casino' },
  joinPin:          { ru: 'Код игры',                 en: 'Game PIN' },
  joinName:         { ru: 'Ваше имя',                 en: 'Your name' },
  joinButton:       { ru: 'Войти в казино',           en: 'Enter the casino' },
  joinNotFound:     { ru: 'Игра не найдена',          en: 'Game not found' },
  joinClosed:       { ru: 'Игра уже завершена',       en: 'This game has finished' },
  lobbyWaiting:     { ru: 'Ждём ведущего…',           en: 'Waiting for the host…' },
  lobbyPlayers:     { ru: 'За столом',                en: 'At the table' },
  bank:             { ru: 'Банк',                     en: 'Bank' },
  onTable:          { ru: 'На столе',                 en: 'On the table' },
  available:        { ru: 'Доступно',                 en: 'Available' },
  placeBet:         { ru: 'Ставлю',                   en: 'Place bets' },
  betsSaved:        { ru: 'Ставки приняты',           en: 'Bets accepted' },
  betsClosed:       { ru: 'Ставки закрыты',           en: 'Betting closed' },
  clearAll:         { ru: 'Сбросить',                 en: 'Clear' },
  hint:             { ru: 'Подсказка',                en: 'Hint' },
  roundOf:          { ru: 'Вино',                     en: 'Wine' },
  youWon:           { ru: 'Выигрыш',                  en: 'Won' },
  youStaked:        { ru: 'Поставлено',               en: 'Staked' },
  rescued:          { ru: 'Казино дарит вам фишки на следующий кон', en: 'The house stakes you for the next round' },
  correct:          { ru: 'Угадали',                  en: 'Correct' },
  wrong:            { ru: 'Мимо',                     en: 'Missed' },
  voided:           { ru: 'Ставка возвращена',        en: 'Bet returned' },
  leaderboard:      { ru: 'Таблица лидеров',          en: 'Leaderboard' },
  finished:         { ru: 'Игра окончена',            en: 'Game over' },
  winner:           { ru: 'Победитель',               en: 'Winner' },
  reconnecting:     { ru: 'Восстанавливаем связь…',   en: 'Reconnecting…' },
  errBank:          { ru: 'Не хватает фишек',         en: 'Not enough chips' },
  errClosed:        { ru: 'Раунд уже закрыт',         en: 'The round is already closed' },
  errGeneric:       { ru: 'Не получилось. Попробуйте ещё раз', en: 'Something went wrong. Try again' },
} as const

export type StringKey = keyof typeof STRINGS

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang]
}

/** Picks the right side of any {ru, en} pair — options, hints, category labels. */
export function pick(pair: { ru: string; en: string }, lang: Lang): string {
  return lang === 'ru' ? pair.ru : pair.en
}
```

- [ ] **Step 2: Typecheck**

Run: `cd 02_services/wine-casino && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/i18n.ts
git commit -m "винное казино: словарь строк RU/EN"
```

---

### Task 10: Supabase clients and data access

**Files:**
- Create: `02_services/wine-casino/lib/supabase.ts`
- Create: `02_services/wine-casino/lib/db.ts`

- [ ] **Step 1: Create `lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js'

// Same Supabase project as mission-control and kiosk. The `casino` schema must
// be listed under Settings -> API -> Exposed schemas or every call 404s.

const url = process.env.SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_KEY!

/** Server-side only. Bypasses RLS — this is the client that sees the answers. */
export const sbCasino = createClient(url, serviceKey, { db: { schema: 'casino' } })

/** inventory.v_sku_breakdown, for the admin's wine search. Read-only. */
export const sbInventory = createClient(url, serviceKey, { db: { schema: 'inventory' } })

/** Browser client for Realtime + the two anon-readable tables. Never sees answers. */
export function browserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: 'casino' } },
  )
}
```

- [ ] **Step 2: Create `lib/db.ts`**

```ts
import 'server-only'
import { sbCasino, sbInventory } from './supabase'
import type {
  CategoryDef, CategoryKey, Difficulty, GameStatus, Hint,
  OptionSet, RoundStatus, WineAnswers, WineColor, WineFacts,
} from './types'

export type GameRow = {
  id: string
  pin: string
  host_token: string
  title: string
  status: GameStatus
  difficulty: Difficulty
  starting_chips: number
  rescue_chips: number
  round_seconds: number
  categories: CategoryDef[]
  current_wine_id: string | null
  created_at: string
}

export type WineRow = {
  id: string
  game_id: string
  order_no: number
  label: string
  sku: string | null
  name: string
  country: string | null
  region: string | null
  grape: string | null
  vintage: number | null
  style: string | null
  color: WineColor | null
  abv: number | null
  image_url: string | null
  answers: WineAnswers
  options: OptionSet
  hints: Hint[]
  status: RoundStatus
  started_at: string | null
  ends_at: string | null
}

export type PlayerRow = {
  id: string
  game_id: string
  nickname: string
  chips: number
  lang: 'ru' | 'en'
  joined_at: string
}

export type BetRow = {
  id: string
  game_id: string
  wine_id: string
  player_id: string
  category: CategoryKey
  option: string
  amount: number
  is_correct: boolean | null
  payout: number | null
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

// --- games -----------------------------------------------------------------

export async function getGameByPin(pin: string): Promise<GameRow | null> {
  const { data, error } = await sbCasino.from('game').select('*').eq('pin', pin).maybeSingle()
  if (error) throw new Error(error.message)
  return data as GameRow | null
}

export async function getGameByHostToken(token: string): Promise<GameRow | null> {
  const { data, error } = await sbCasino.from('game').select('*').eq('host_token', token).maybeSingle()
  if (error) throw new Error(error.message)
  return data as GameRow | null
}

export async function getGame(id: string): Promise<GameRow | null> {
  const { data, error } = await sbCasino.from('game').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as GameRow | null
}

export async function listGames(): Promise<GameRow[]> {
  return unwrap(await sbCasino.from('game').select('*').order('created_at', { ascending: false }))
}

export async function insertGame(row: Partial<GameRow>): Promise<GameRow> {
  return unwrap(await sbCasino.from('game').insert(row).select().single())
}

export async function updateGame(id: string, patch: Partial<GameRow>): Promise<GameRow> {
  return unwrap(await sbCasino.from('game').update(patch).eq('id', id).select().single())
}

export async function deleteGame(id: string): Promise<void> {
  const { error } = await sbCasino.from('game').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// --- wines -----------------------------------------------------------------

export async function listWines(gameId: string): Promise<WineRow[]> {
  return unwrap(
    await sbCasino.from('game_wine').select('*').eq('game_id', gameId).order('order_no'),
  )
}

export async function getWine(id: string): Promise<WineRow | null> {
  const { data, error } = await sbCasino.from('game_wine').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as WineRow | null
}

export async function insertWine(row: Partial<WineRow>): Promise<WineRow> {
  return unwrap(await sbCasino.from('game_wine').insert(row).select().single())
}

export async function updateWine(id: string, patch: Partial<WineRow>): Promise<WineRow> {
  return unwrap(await sbCasino.from('game_wine').update(patch).eq('id', id).select().single())
}

export async function deleteWine(id: string): Promise<void> {
  const { error } = await sbCasino.from('game_wine').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// --- players ---------------------------------------------------------------

export async function listPlayers(gameId: string): Promise<PlayerRow[]> {
  return unwrap(
    await sbCasino.from('player').select('*').eq('game_id', gameId).order('joined_at'),
  )
}

export async function getPlayer(id: string): Promise<PlayerRow | null> {
  const { data, error } = await sbCasino.from('player').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as PlayerRow | null
}

export async function insertPlayer(row: Partial<PlayerRow>): Promise<PlayerRow> {
  return unwrap(await sbCasino.from('player').insert(row).select().single())
}

export async function setPlayerChips(id: string, chips: number): Promise<void> {
  const { error } = await sbCasino.from('player').update({ chips }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function savePlayerSecret(playerId: string, tokenHash: string): Promise<void> {
  const { error } = await sbCasino.from('player_secret')
    .upsert({ player_id: playerId, token_hash: tokenHash })
  if (error) throw new Error(error.message)
}

export async function getPlayerSecret(playerId: string): Promise<string | null> {
  const { data, error } = await sbCasino.from('player_secret')
    .select('token_hash').eq('player_id', playerId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { token_hash: string } | null)?.token_hash ?? null
}

// --- bets ------------------------------------------------------------------

export async function listBetsForWine(wineId: string): Promise<BetRow[]> {
  return unwrap(await sbCasino.from('bet').select('*').eq('wine_id', wineId))
}

export async function listBetsForPlayerWine(playerId: string, wineId: string): Promise<BetRow[]> {
  return unwrap(
    await sbCasino.from('bet').select('*').eq('player_id', playerId).eq('wine_id', wineId),
  )
}

/** Replace-semantics: the phone always sends its whole slip. */
export async function replaceBets(
  playerId: string,
  wineId: string,
  rows: Array<Pick<BetRow, 'game_id' | 'wine_id' | 'player_id' | 'category' | 'option' | 'amount'>>,
): Promise<void> {
  const del = await sbCasino.from('bet').delete().eq('player_id', playerId).eq('wine_id', wineId)
  if (del.error) throw new Error(del.error.message)
  if (rows.length === 0) return
  const ins = await sbCasino.from('bet').insert(rows)
  if (ins.error) throw new Error(ins.error.message)
}

export async function saveBetOutcome(id: string, isCorrect: boolean | null, payout: number): Promise<void> {
  const { error } = await sbCasino.from('bet')
    .update({ is_correct: isCorrect, payout }).eq('id', id)
  if (error) throw new Error(error.message)
}

// --- round_state -----------------------------------------------------------

export type RoundStateRow = {
  game_id: string
  wine_id: string | null
  label: string | null
  game_status: GameStatus
  round_status: RoundStatus
  round_no: number
  total_rounds: number
  ends_at: string | null
  options: OptionSet
  revealed_hints: Hint[]
  revealed_answers: WineAnswers | null
  reveal: Record<string, unknown> | null
  updated_at: string
}

export async function getRoundState(gameId: string): Promise<RoundStateRow | null> {
  const { data, error } = await sbCasino.from('round_state')
    .select('*').eq('game_id', gameId).maybeSingle()
  if (error) throw new Error(error.message)
  return data as RoundStateRow | null
}

export async function upsertRoundState(row: Partial<RoundStateRow> & { game_id: string }): Promise<void> {
  const { error } = await sbCasino.from('round_state')
    .upsert({ ...row, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

// --- inventory search ------------------------------------------------------

export type InventoryHit = {
  sku_id: string
  name: string
  wine_color: WineColor | null
  grape_variety: string | null
  wine_country: string | null
}

/** Feeds the admin's wine picker. v_sku_breakdown carries colour, grape and
 *  country but no region or vintage — those are always typed in by hand. */
export async function searchInventory(q: string, limit = 20): Promise<InventoryHit[]> {
  const { data, error } = await sbInventory
    .from('v_sku_breakdown')
    .select('sku_id,name,wine_color,grape_variety,wine_country')
    .ilike('name', `%${q}%`)
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as InventoryHit[]
}

/** Everything the generators need, assembled from a stored wine row. */
export function factsOf(w: WineRow): WineFacts {
  return {
    name: w.name, country: w.country, region: w.region, grape: w.grape,
    vintage: w.vintage, style: w.style, color: w.color, abv: w.abv,
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd 02_services/wine-casino && npx tsc --noEmit`
Expected: no errors. (`server-only` resolves through Next's own dependency — the
same way `02_services/kiosk/lib/wines.ts` imports it without listing it.)

- [ ] **Step 4: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/supabase.ts 02_services/wine-casino/lib/db.ts
git commit -m "винное казино: клиенты Supabase и слой доступа к данным"
```

---

### Task 11: Round orchestration

Every state transition goes through this module, and every transition ends by
republishing `round_state`. That is the single place where we decide what the
room is allowed to see, which is what keeps the answers from leaking.

**Files:**
- Create: `02_services/wine-casino/lib/round.ts`

- [ ] **Step 1: Create `lib/round.ts`**

```ts
import 'server-only'
import * as db from './db'
import { settleRound } from './payout'
import type { PlacedBet } from './payout'
import type { Hint } from './types'

/**
 * Rewrites the public projection. Everything a phone knows about the game comes
 * from here, so anything not written here is, by construction, secret.
 */
async function publish(
  game: db.GameRow,
  wine: db.WineRow | null,
  wines: db.WineRow[],
  opts: { revealedHints?: Hint[] } = {},
): Promise<void> {
  const roundNo = wine ? wines.findIndex(w => w.id === wine.id) + 1 : 0
  const revealed = wine?.status === 'revealed'

  await db.upsertRoundState({
    game_id:      game.id,
    wine_id:      wine?.id ?? null,
    label:        wine?.label ?? null,
    game_status:  game.status,
    round_status: wine?.status ?? 'pending',
    round_no:     roundNo,
    total_rounds: wines.length,
    ends_at:      wine?.ends_at ?? null,
    options:      wine?.options ?? {},
    revealed_hints:   opts.revealedHints ?? [],
    revealed_answers: revealed ? (wine?.answers ?? null) : null,
    reveal: revealed && wine
      ? {
          name: wine.name, country: wine.country, region: wine.region,
          grape: wine.grape, vintage: wine.vintage, abv: wine.abv,
          style: wine.style, image_url: wine.image_url,
        }
      : null,
  })
}

/** Opens the doors: guests can join, no wine is poured yet. */
export async function openLobby(game: db.GameRow): Promise<void> {
  const updated = await db.updateGame(game.id, { status: 'lobby' })
  const wines = await db.listWines(game.id)
  await publish(updated, null, wines)
}

/** Starts betting on the game's current wine (or the first unplayed one). */
export async function startRound(game: db.GameRow): Promise<db.WineRow> {
  const wines = await db.listWines(game.id)
  if (wines.length === 0) throw new Error('game has no wines')

  const target =
    wines.find(w => w.id === game.current_wine_id) ??
    wines.find(w => w.status === 'pending') ??
    wines[0]

  const endsAt = new Date(Date.now() + game.round_seconds * 1000).toISOString()
  const wine = await db.updateWine(target.id, {
    status: 'betting',
    started_at: new Date().toISOString(),
    ends_at: endsAt,
  })

  const updatedGame = await db.updateGame(game.id, { status: 'running', current_wine_id: wine.id })
  await publish(updatedGame, wine, wines.map(w => (w.id === wine.id ? wine : w)), { revealedHints: [] })
  return wine
}

/**
 * Reveals every hint whose moment has passed. Called from the host panel every
 * two seconds — the host's browser is the clock. Nothing else ticks, so a
 * closed host panel simply means no new hints, never a stuck round.
 */
export async function tickHints(game: db.GameRow): Promise<Hint[]> {
  const state = await db.getRoundState(game.id)
  if (!state || state.round_status !== 'betting' || !state.wine_id || !state.ends_at) {
    return state?.revealed_hints ?? []
  }

  const wine = await db.getWine(state.wine_id)
  if (!wine) return state.revealed_hints

  const remaining = (new Date(state.ends_at).getTime() - Date.now()) / 1000
  const due = wine.hints.filter(h => remaining <= h.at)
  if (due.length === state.revealed_hints.length) return state.revealed_hints

  await db.upsertRoundState({ game_id: game.id, revealed_hints: due })
  return due
}

/** Closes betting without revealing anything yet. */
export async function lockRound(game: db.GameRow): Promise<void> {
  if (!game.current_wine_id) return
  const wine = await db.updateWine(game.current_wine_id, { status: 'locked' })
  const wines = await db.listWines(game.id)
  const state = await db.getRoundState(game.id)
  await publish(game, wine, wines, { revealedHints: state?.revealed_hints ?? [] })
}

export type RevealSummary = {
  wine: db.WineRow
  players: Array<{ id: string; nickname: string; chipsBefore: number; chipsAfter: number; staked: number; won: number; rescued: boolean }>
}

/** Settles the round: the only place chips ever move. */
export async function revealRound(game: db.GameRow): Promise<RevealSummary> {
  if (!game.current_wine_id) throw new Error('no current wine')

  const wine = await db.getWine(game.current_wine_id)
  if (!wine) throw new Error('current wine missing')

  const [players, betRows] = await Promise.all([
    db.listPlayers(game.id),
    db.listBetsForWine(wine.id),
  ])

  const placed: PlacedBet[] = betRows.map(b => ({
    playerId: b.player_id, category: b.category, option: b.option, amount: b.amount,
  }))

  const result = settleRound({
    bets: placed,
    answers: wine.answers,
    categories: game.categories,
    players: players.map(p => ({ id: p.id, chips: p.chips })),
    rescueChips: game.rescue_chips,
  })

  // Persist bet outcomes. Index-aligned with `placed`, which is index-aligned
  // with `betRows`, because settleRound maps one-to-one and preserves order.
  await Promise.all(
    result.bets.map((b, i) => db.saveBetOutcome(betRows[i].id, b.isCorrect, b.payout)),
  )
  await Promise.all(result.players.map(p => db.setPlayerChips(p.id, p.chipsAfter)))

  const revealedWine = await db.updateWine(wine.id, { status: 'revealed' })
  const wines = await db.listWines(game.id)
  const state = await db.getRoundState(game.id)
  await publish(game, revealedWine, wines, { revealedHints: state?.revealed_hints ?? [] })

  const byId = new Map(players.map(p => [p.id, p.nickname]))
  return {
    wine: revealedWine,
    players: result.players.map(p => ({ ...p, nickname: byId.get(p.id) ?? '?' })),
  }
}

/** Moves to the next wine, or ends the game if this was the last one. */
export async function nextWine(game: db.GameRow): Promise<db.WineRow | null> {
  const wines = await db.listWines(game.id)
  const idx = wines.findIndex(w => w.id === game.current_wine_id)
  const next = idx >= 0 ? wines[idx + 1] : wines[0]

  if (!next) {
    const finished = await db.updateGame(game.id, { status: 'finished', current_wine_id: null })
    await publish(finished, null, wines)
    return null
  }

  const updated = await db.updateGame(game.id, { current_wine_id: next.id })
  await publish(updated, next, wines, { revealedHints: [] })
  return next
}
```

- [ ] **Step 2: Typecheck**

Run: `cd 02_services/wine-casino && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/round.ts
git commit -m "винное казино: оркестрация раунда и публикация состояния"
```

---

### Task 12: Player API — join, state, bet

**Files:**
- Create: `02_services/wine-casino/lib/player-auth.ts`
- Create: `02_services/wine-casino/app/api/join/route.ts`
- Create: `02_services/wine-casino/app/api/state/route.ts`
- Create: `02_services/wine-casino/app/api/bet/route.ts`

- [ ] **Step 1: Create `lib/player-auth.ts`**

```ts
import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { getPlayerSecret } from './db'

/** A bearer token the phone keeps in localStorage. Only its hash is stored, so
 *  a leak of the database does not let anyone bet as someone else. */
export function newPlayerToken(): string {
  return randomBytes(24).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function verifyPlayer(playerId: string, token: string): Promise<boolean> {
  if (!playerId || !token) return false
  const stored = await getPlayerSecret(playerId)
  return stored != null && stored === hashToken(token)
}
```

- [ ] **Step 2: Create `app/api/join/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { uniqueNickname } from '@/lib/pin'
import { hashToken, newPlayerToken } from '@/lib/player-auth'
import type { Lang } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { pin?: string; nickname?: string; lang?: Lang } | null
  if (!body?.pin) return NextResponse.json({ error: 'pin_required' }, { status: 400 })

  const game = await db.getGameByPin(String(body.pin).trim())
  if (!game) return NextResponse.json({ error: 'game_not_found' }, { status: 404 })
  if (game.status === 'finished') return NextResponse.json({ error: 'game_finished' }, { status: 409 })
  if (game.status === 'draft') return NextResponse.json({ error: 'game_not_open' }, { status: 409 })

  const players = await db.listPlayers(game.id)
  const nickname = uniqueNickname(body.nickname ?? '', players.map(p => p.nickname))
  const lang: Lang = body.lang === 'en' ? 'en' : 'ru'

  // A latecomer gets the full starting stack. Averaging against the table was
  // considered and dropped: it rewards joining late when the leaders are rich.
  const player = await db.insertPlayer({
    game_id: game.id, nickname, chips: game.starting_chips, lang,
  })

  const token = newPlayerToken()
  await db.savePlayerSecret(player.id, hashToken(token))

  return NextResponse.json({
    gameId: game.id,
    playerId: player.id,
    playerToken: token,
    nickname: player.nickname,
    chips: player.chips,
    lang,
  })
}
```

- [ ] **Step 3: Create `app/api/state/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { tickHints } from '@/lib/round'

export const dynamic = 'force-dynamic'

/**
 * Polling fallback for phones whose Realtime socket did not come up, and the
 * screen's first paint. Also ticks hints, so a game still reveals them if the
 * host panel is asleep but guests are looking at their phones.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const pin = url.searchParams.get('pin')
  const gameId = url.searchParams.get('gameId')
  const playerId = url.searchParams.get('playerId')

  const game = gameId ? await db.getGame(gameId) : pin ? await db.getGameByPin(pin) : null
  if (!game) return NextResponse.json({ error: 'game_not_found' }, { status: 404 })

  await tickHints(game)

  const [state, players] = await Promise.all([
    db.getRoundState(game.id),
    db.listPlayers(game.id),
  ])

  const me = playerId ? players.find(p => p.id === playerId) ?? null : null
  const myBets = me && state?.wine_id
    ? await db.listBetsForPlayerWine(me.id, state.wine_id)
    : []

  return NextResponse.json({
    game: {
      id: game.id, pin: game.pin, title: game.title, status: game.status,
      categories: game.categories, roundSeconds: game.round_seconds,
    },
    state,
    players: players.map(p => ({ id: p.id, nickname: p.nickname, chips: p.chips })),
    me: me ? { id: me.id, nickname: me.nickname, chips: me.chips, lang: me.lang } : null,
    myBets: myBets.map(b => ({
      category: b.category, option: b.option, amount: b.amount,
      isCorrect: b.is_correct, payout: b.payout,
    })),
  })
}
```

- [ ] **Step 4: Create `app/api/bet/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { validateBetSlip } from '@/lib/bets'
import type { BetLine } from '@/lib/bets'
import { verifyPlayer } from '@/lib/player-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { playerId?: string; playerToken?: string; wineId?: string; slip?: BetLine[] } | null

  if (!body?.playerId || !body.playerToken || !body.wineId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (!(await verifyPlayer(body.playerId, body.playerToken))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const player = await db.getPlayer(body.playerId)
  if (!player) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const [game, wine] = await Promise.all([db.getGame(player.game_id), db.getWine(body.wineId)])
  if (!game || !wine) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const verdict = validateBetSlip({
    roundStatus: wine.status,
    activeCategories: game.categories.map(c => c.key),
    options: wine.options,
    playerChips: player.chips,
    slip: body.slip ?? [],
    playerGameId: player.game_id,
    wineGameId: wine.game_id,
  })
  if (!verdict.ok) {
    // A phone left open on last week's game must not reach into tonight's.
    const status = verdict.error === 'wrong_game' ? 403 : 409
    return NextResponse.json({ error: verdict.error }, { status })
  }

  await db.replaceBets(player.id, wine.id, (body.slip ?? []).map(l => ({
    game_id: game.id, wine_id: wine.id, player_id: player.id,
    category: l.category, option: l.option, amount: l.amount,
  })))

  return NextResponse.json({ ok: true, total: verdict.total })
}
```

- [ ] **Step 5: Typecheck and build**

Run: `cd 02_services/wine-casino && npx tsc --noEmit && npm run build`
Expected: no type errors; the build lists `/api/join`, `/api/state`, `/api/bet`.

- [ ] **Step 6: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/player-auth.ts 02_services/wine-casino/app/api
git commit -m "винное казино: API игрока — вход, состояние, ставки"
```

---

### Task 13: Host API — state, round control, hint tick

**Files:**
- Create: `02_services/wine-casino/app/api/host/state/route.ts`
- Create: `02_services/wine-casino/app/api/host/round/route.ts`
- Create: `02_services/wine-casino/app/api/host/tick/route.ts`

- [ ] **Step 1: Create `app/api/host/state/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'

export const dynamic = 'force-dynamic'

/** The host sees everything, including the answers — they are reading them out. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t')
  if (!token) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const game = await db.getGameByHostToken(token)
  if (!game) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const [wines, players, state] = await Promise.all([
    db.listWines(game.id),
    db.listPlayers(game.id),
    db.getRoundState(game.id),
  ])

  return NextResponse.json({ game, wines, players, state })
}
```

- [ ] **Step 2: Create `app/api/host/round/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { lockRound, nextWine, openLobby, revealRound, startRound } from '@/lib/round'

export const dynamic = 'force-dynamic'

type Action = 'open' | 'start' | 'lock' | 'reveal' | 'next'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { t?: string; action?: Action } | null
  if (!body?.t || !body.action) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const game = await db.getGameByHostToken(body.t)
  if (!game) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  switch (body.action) {
    case 'open':
      await openLobby(game)
      return NextResponse.json({ ok: true })
    case 'start': {
      const wine = await startRound(game)
      return NextResponse.json({ ok: true, wineId: wine.id })
    }
    case 'lock':
      await lockRound(game)
      return NextResponse.json({ ok: true })
    case 'reveal': {
      const summary = await revealRound(game)
      return NextResponse.json({ ok: true, summary })
    }
    case 'next': {
      const wine = await nextWine(game)
      return NextResponse.json({ ok: true, wineId: wine?.id ?? null, finished: wine === null })
    }
    default:
      return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  }
}
```

- [ ] **Step 3: Create `app/api/host/tick/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { tickHints } from '@/lib/round'

export const dynamic = 'force-dynamic'

/**
 * The host panel calls this every two seconds while a round is running. It is
 * the game's clock: hints become visible because this fires, not because a
 * phone decided it was time. Cheap and idempotent.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { t?: string } | null
  if (!body?.t) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const game = await db.getGameByHostToken(body.t)
  if (!game) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const hints = await tickHints(game)
  return NextResponse.json({ ok: true, hints })
}
```

- [ ] **Step 4: Build**

Run: `cd 02_services/wine-casino && npm run build`
Expected: the route table lists `/api/host/state`, `/api/host/round`, `/api/host/tick`.

- [ ] **Step 5: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/app/api/host
git commit -m "винное казино: API ведущего — управление раундом и тик подсказок"
```

---

### Task 14: Admin authentication (TDD)

A single shared password, like a stripped-down version of mission-control's
login. The cookie is an HMAC so it cannot be forged, and it is verified in
middleware with `crypto.subtle`, which is what the Edge runtime provides.

**Files:**
- Create: `02_services/wine-casino/lib/admin-auth.ts`
- Test:   `02_services/wine-casino/lib/admin-auth.test.ts`
- Create: `02_services/wine-casino/middleware.ts`
- Create: `02_services/wine-casino/app/api/auth/login/route.ts`
- Create: `02_services/wine-casino/app/login/page.tsx`

- [ ] **Step 1: Write the failing test `lib/admin-auth.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { signAdminToken, verifyAdminToken } from './admin-auth'

const SECRET = 'test-secret'

describe('admin token', () => {
  it('accepts a token it just signed', async () => {
    const token = await signAdminToken(SECRET, 60_000)
    expect(await verifyAdminToken(SECRET, token)).toBe(true)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signAdminToken('other-secret', 60_000)
    expect(await verifyAdminToken(SECRET, token)).toBe(false)
  })

  it('rejects a tampered payload', async () => {
    const token = await signAdminToken(SECRET, 60_000)
    const [payload, sig] = token.split('.')
    const bumped = String(Number(payload) + 1_000_000)
    expect(await verifyAdminToken(SECRET, `${bumped}.${sig}`)).toBe(false)
  })

  it('rejects an expired token', async () => {
    const token = await signAdminToken(SECRET, -1000)
    expect(await verifyAdminToken(SECRET, token)).toBe(false)
  })

  it('rejects junk', async () => {
    expect(await verifyAdminToken(SECRET, '')).toBe(false)
    expect(await verifyAdminToken(SECRET, 'not-a-token')).toBe(false)
    expect(await verifyAdminToken(SECRET, 'a.b.c')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd 02_services/wine-casino && npx vitest run lib/admin-auth.test.ts`
Expected: FAIL — `Failed to resolve import "./admin-auth"`.

- [ ] **Step 3: Write `lib/admin-auth.ts`**

```ts
// Edge-safe: uses Web Crypto only, so middleware can verify without Node APIs.
// The token carries nothing but its own expiry — there is one admin.

export const ADMIN_COOKIE = 'casino_admin'
export const ADMIN_MAX_AGE = 60 * 60 * 24 * 14

const ENC = new TextEncoder()

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', ENC.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const buf = await crypto.subtle.sign('HMAC', key, ENC.encode(data))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** `<expiresAtMs>.<hmac>` */
export async function signAdminToken(secret: string, ttlMs: number): Promise<string> {
  const payload = String(Date.now() + ttlMs)
  return `${payload}.${await hmac(secret, payload)}`
}

export async function verifyAdminToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, sig] = parts
  const expires = Number(payload)
  if (!Number.isFinite(expires) || expires < Date.now()) return false
  return (await hmac(secret, payload)) === sig
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd 02_services/wine-casino && npx vitest run lib/admin-auth.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Create `middleware.ts`**

```ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ADMIN_COOKIE, verifyAdminToken } from '@/lib/admin-auth'

// Everything except /admin is public by design: guests, the host and the TV all
// carry their own token in the URL or in localStorage.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  if (!isAdmin) return NextResponse.next()

  const secret = process.env.CASINO_SECRET || 'change-me'
  const ok = await verifyAdminToken(secret, request.cookies.get(ADMIN_COOKIE)?.value)
  if (ok) return NextResponse.next()

  // API routes must 401, never redirect: a redirect returns the login page with
  // HTTP 200 and client `fetch` reads that as success, silently dropping a save.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
```

- [ ] **Step 6: Create `app/api/auth/login/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, ADMIN_MAX_AGE, signAdminToken } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { password?: string } | null
  const expected = process.env.CASINO_ADMIN_PASSWORD
  if (!expected) return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  if (body?.password !== expected) {
    return NextResponse.json({ error: 'bad_password' }, { status: 401 })
  }

  const token = await signAdminToken(process.env.CASINO_SECRET || 'change-me', ADMIN_MAX_AGE * 1000)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    maxAge: ADMIN_MAX_AGE, secure: process.env.NODE_ENV === 'production',
  })
  return res
}
```

- [ ] **Step 7: Create `app/login/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) router.push('/admin')
    else setError('Wrong password')
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="font-display text-4xl tracking-display text-amber-gold">WINE CASINO</h1>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Admin password"
          className="w-full rounded-md bg-graphite/40 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-gold"
        />
        {error && <p className="text-wine-red text-sm">{error}</p>}
        <button className="w-full rounded-md bg-amber-gold py-3 font-heading text-deep-black">
          Sign in
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 8: Build**

Run: `cd 02_services/wine-casino && npm run build`
Expected: build succeeds and lists `/login` and `/api/auth/login`.

- [ ] **Step 9: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/admin-auth.ts 02_services/wine-casino/lib/admin-auth.test.ts \
        02_services/wine-casino/middleware.ts 02_services/wine-casino/app/login \
        02_services/wine-casino/app/api/auth
git commit -m "винное казино: вход в админку"
```

---

### Task 15: Admin API — games, wines, inventory search

**Files:**
- Create: `02_services/wine-casino/app/api/admin/games/route.ts`
- Create: `02_services/wine-casino/app/api/admin/games/[gameId]/route.ts`
- Create: `02_services/wine-casino/app/api/admin/games/[gameId]/wines/route.ts`
- Create: `02_services/wine-casino/app/api/admin/games/[gameId]/wines/[wineId]/route.ts`
- Create: `02_services/wine-casino/app/api/admin/inventory/route.ts`
- Create: `02_services/wine-casino/lib/prepare-wine.ts`

- [ ] **Step 1: Create `lib/prepare-wine.ts`**

The one place that turns raw bottle facts into a playable round. Both "add wine"
and "edit wine" go through it, so a field edit always regenerates a consistent
board and hint set.

```ts
import 'server-only'
import { buildOptions } from './options'
import { buildHints } from './hints'
import { worldOf } from './categories'
import type { CategoryDef, Difficulty, Hint, OptionSet, WineAnswers, WineFacts } from './types'

export type PreparedWine = { answers: WineAnswers; options: OptionSet; hints: Hint[] }

/**
 * Derives the answer key, the betting board and the hint schedule from a
 * bottle's facts. Categories with no fact on file are simply absent from
 * `answers` and `options` — settleRound voids any bet that lands on them.
 */
export function prepareWine(
  facts: WineFacts,
  categories: readonly CategoryDef[],
  difficulty: Difficulty,
  roundSeconds: number,
  keepHints?: Hint[] | null,
): PreparedWine {
  const keys = categories.map(c => c.key)

  const answers: WineAnswers = {}
  if (keys.includes('style') && facts.style)     answers.style = facts.style.trim().toLowerCase()
  const world = worldOf(facts.country)
  if (keys.includes('world') && world)           answers.world = world
  if (keys.includes('country') && facts.country) answers.country = facts.country.trim().toLowerCase()
  if (keys.includes('region') && facts.region)   answers.region = facts.region.trim().toLowerCase()
  if (keys.includes('grape') && facts.grape)     answers.grape = facts.grape.trim().toLowerCase()
  if (keys.includes('vintage') && facts.vintage) answers.vintage = String(facts.vintage)

  return {
    answers,
    options: buildOptions(facts, keys),
    // Hand-edited hints survive a re-save; otherwise regenerate from templates.
    hints: keepHints && keepHints.length > 0
      ? keepHints
      : buildHints(facts, difficulty, roundSeconds, keys),
  }
}
```

- [ ] **Step 2: Create `app/api/admin/games/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { DEFAULT_CATEGORIES } from '@/lib/categories'
import { generatePin } from '@/lib/pin'
import type { CategoryKey, Difficulty } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const games = await db.listGames()
  return NextResponse.json({ games })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    title?: string
    difficulty?: Difficulty
    startingChips?: number
    rescueChips?: number
    roundSeconds?: number
    categoryKeys?: CategoryKey[]
  } | null

  const keys = body?.categoryKeys?.length ? body.categoryKeys : DEFAULT_CATEGORIES.map(c => c.key)
  const categories = DEFAULT_CATEGORIES.filter(c => keys.includes(c.key))

  // Six digits gives a 1-in-900k collision chance; retry a few times anyway
  // rather than hand the host a 500 on the one evening they are using this.
  let pin = generatePin()
  for (let i = 0; i < 5 && (await db.getGameByPin(pin)); i++) pin = generatePin()

  const game = await db.insertGame({
    pin,
    title: body?.title?.trim() || 'Wine Casino',
    status: 'draft',
    difficulty: body?.difficulty ?? 'medium',
    starting_chips: body?.startingChips ?? 100,
    rescue_chips: body?.rescueChips ?? 10,
    round_seconds: body?.roundSeconds ?? 120,
    categories,
  })

  return NextResponse.json({ game })
}
```

- [ ] **Step 3: Create `app/api/admin/games/[gameId]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { prepareWine } from '@/lib/prepare-wine'
import { DEFAULT_CATEGORIES } from '@/lib/categories'
import type { CategoryKey, Difficulty } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ gameId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { gameId } = await params
  const game = await db.getGame(gameId)
  if (!game) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const wines = await db.listWines(gameId)
  return NextResponse.json({ game, wines })
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { gameId } = await params
  const body = await req.json().catch(() => null) as {
    title?: string
    difficulty?: Difficulty
    startingChips?: number
    rescueChips?: number
    roundSeconds?: number
    categoryKeys?: CategoryKey[]
  } | null
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.title !== undefined)         patch.title = body.title.trim() || 'Wine Casino'
  if (body.difficulty !== undefined)    patch.difficulty = body.difficulty
  if (body.startingChips !== undefined) patch.starting_chips = body.startingChips
  if (body.rescueChips !== undefined)   patch.rescue_chips = body.rescueChips
  if (body.roundSeconds !== undefined)  patch.round_seconds = body.roundSeconds
  if (body.categoryKeys !== undefined) {
    patch.categories = DEFAULT_CATEGORIES.filter(c => body.categoryKeys!.includes(c.key))
  }

  const game = await db.updateGame(gameId, patch)

  // Difficulty, round length and the category set all change what a board and a
  // hint schedule should look like, so every wine is rebuilt. Hand-edited hint
  // text is intentionally discarded here — the admin is changing the rules.
  if (body.categoryKeys !== undefined || body.difficulty !== undefined || body.roundSeconds !== undefined) {
    const wines = await db.listWines(gameId)
    for (const w of wines) {
      const prepared = prepareWine(db.factsOf(w), game.categories, game.difficulty, game.round_seconds, null)
      await db.updateWine(w.id, prepared)
    }
  }

  return NextResponse.json({ game })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { gameId } = await params
  await db.deleteGame(gameId)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Create `app/api/admin/games/[gameId]/wines/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { prepareWine } from '@/lib/prepare-wine'
import type { WineColor } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ gameId: string }> }

export type WineInput = {
  sku?: string | null
  name: string
  country?: string | null
  region?: string | null
  grape?: string | null
  vintage?: number | null
  style?: string | null
  color?: WineColor | null
  abv?: number | null
  imageUrl?: string | null
}

export async function POST(req: Request, { params }: Ctx) {
  const { gameId } = await params
  const body = await req.json().catch(() => null) as WineInput | null
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const game = await db.getGame(gameId)
  if (!game) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const existing = await db.listWines(gameId)
  const orderNo = existing.length + 1

  const facts = {
    name: body.name.trim(),
    country: body.country ?? null,
    region: body.region ?? null,
    grape: body.grape ?? null,
    vintage: body.vintage ?? null,
    style: body.style ?? null,
    color: body.color ?? null,
    abv: body.abv ?? null,
  }
  const prepared = prepareWine(facts, game.categories, game.difficulty, game.round_seconds, null)

  const wine = await db.insertWine({
    game_id: gameId,
    order_no: orderNo,
    // Guests must never see the real name before the reveal, so the label is
    // deliberately a number, not the bottle.
    label: `#${orderNo}`,
    sku: body.sku ?? null,
    image_url: body.imageUrl ?? null,
    ...facts,
    ...prepared,
    status: 'pending',
  })

  return NextResponse.json({ wine })
}
```

- [ ] **Step 5: Create `app/api/admin/games/[gameId]/wines/[wineId]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import * as db from '@/lib/db'
import { prepareWine } from '@/lib/prepare-wine'
import type { Hint } from '@/lib/types'
import type { WineInput } from '../route'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ gameId: string; wineId: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const { gameId, wineId } = await params
  const body = await req.json().catch(() => null) as (Partial<WineInput> & { hints?: Hint[] }) | null
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const [game, current] = await Promise.all([db.getGame(gameId), db.getWine(wineId)])
  if (!game || !current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const facts = {
    name:    body.name?.trim() ?? current.name,
    country: body.country !== undefined ? body.country : current.country,
    region:  body.region  !== undefined ? body.region  : current.region,
    grape:   body.grape   !== undefined ? body.grape   : current.grape,
    vintage: body.vintage !== undefined ? body.vintage : current.vintage,
    style:   body.style   !== undefined ? body.style   : current.style,
    color:   body.color   !== undefined ? body.color   : current.color,
    abv:     body.abv     !== undefined ? body.abv     : current.abv,
  }

  // `hints: []` from the admin means "regenerate"; a non-empty array is a
  // hand-written set we must keep verbatim.
  const prepared = prepareWine(
    facts, game.categories, game.difficulty, game.round_seconds,
    body.hints && body.hints.length > 0 ? body.hints : null,
  )

  const wine = await db.updateWine(wineId, {
    ...facts,
    sku: body.sku !== undefined ? body.sku : current.sku,
    image_url: body.imageUrl !== undefined ? body.imageUrl : current.image_url,
    ...prepared,
  })

  return NextResponse.json({ wine })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { wineId } = await params
  await db.deleteWine(wineId)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Create `app/api/admin/inventory/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { searchInventory } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ hits: [] })
  return NextResponse.json({ hits: await searchInventory(q) })
}
```

- [ ] **Step 7: Build**

Run: `cd 02_services/wine-casino && npm run build`
Expected: the route table lists all five admin routes.

- [ ] **Step 8: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/prepare-wine.ts 02_services/wine-casino/app/api/admin
git commit -m "винное казино: админ-API — игры, вина, поиск по инвентарю"
```

---

### Task 16: Realtime hook with polling fallback

**Files:**
- Create: `02_services/wine-casino/lib/realtime.ts`

- [ ] **Step 1: Create `lib/realtime.ts`**

```ts
'use client'
import { useEffect, useRef, useState } from 'react'
import { browserClient } from './supabase'
import type { GameStatus, Hint, OptionSet, RoundStatus, WineAnswers } from './types'

export type PublicRoundState = {
  game_id: string
  wine_id: string | null
  label: string | null
  game_status: GameStatus
  round_status: RoundStatus
  round_no: number
  total_rounds: number
  ends_at: string | null
  options: OptionSet
  revealed_hints: Hint[]
  revealed_answers: WineAnswers | null
  reveal: {
    name?: string; country?: string | null; region?: string | null
    grape?: string | null; vintage?: number | null; abv?: number | null
    style?: string | null; image_url?: string | null
  } | null
}

export type PublicPlayer = { id: string; nickname: string; chips: number }

export type LiveGame = {
  state: PublicRoundState | null
  players: PublicPlayer[]
  connected: boolean
}

const POLL_MS = 3000

/**
 * Subscribes to the two anon-readable tables. If the socket does not reach
 * SUBSCRIBED — corporate wifi, a captive portal, a sleeping tab — we fall back
 * to polling /api/state, which also keeps hints ticking. The game never stalls
 * because of the transport.
 */
export function useLiveGame(gameId: string | null, playerId?: string | null): LiveGame {
  const [state, setState] = useState<PublicRoundState | null>(null)
  const [players, setPlayers] = useState<PublicPlayer[]>([])
  const [connected, setConnected] = useState(false)
  const connectedRef = useRef(false)

  useEffect(() => { connectedRef.current = connected }, [connected])

  // Initial load + polling fallback.
  useEffect(() => {
    if (!gameId) return
    let stopped = false

    async function load() {
      const qs = new URLSearchParams({ gameId: gameId! })
      if (playerId) qs.set('playerId', playerId)
      const res = await fetch(`/api/state?${qs}`, { cache: 'no-store' })
      if (!res.ok || stopped) return
      const json = await res.json()
      setState(json.state)
      setPlayers(json.players ?? [])
    }

    void load()
    const timer = setInterval(() => {
      // Poll only while the socket is down; a healthy socket already pushes.
      if (!connectedRef.current) void load()
    }, POLL_MS)

    return () => { stopped = true; clearInterval(timer) }
  }, [gameId, playerId])

  // Realtime.
  useEffect(() => {
    if (!gameId) return
    const sb = browserClient()

    const channel = sb
      .channel(`casino:${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'casino', table: 'round_state', filter: `game_id=eq.${gameId}` },
        payload => setState(payload.new as PublicRoundState),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'casino', table: 'player', filter: `game_id=eq.${gameId}` },
        payload => {
          const row = payload.new as PublicPlayer & { game_id: string }
          setPlayers(prev => {
            const next = prev.filter(p => p.id !== row.id)
            next.push({ id: row.id, nickname: row.nickname, chips: row.chips })
            return next.sort((a, b) => b.chips - a.chips || a.nickname.localeCompare(b.nickname))
          })
        },
      )
      .subscribe(status => setConnected(status === 'SUBSCRIBED'))

    return () => { void sb.removeChannel(channel) }
  }, [gameId])

  return { state, players, connected }
}

/** Seconds remaining, recomputed locally. The wire only ever carries `ends_at`,
 *  so a laggy connection does not make the clock jump. */
export function useCountdown(endsAt: string | null): number {
  const [left, setLeft] = useState(0)

  useEffect(() => {
    if (!endsAt) { setLeft(0); return }
    const target = new Date(endsAt).getTime()
    const tick = () => setLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [endsAt])

  return left
}
```

- [ ] **Step 2: Typecheck**

Run: `cd 02_services/wine-casino && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/realtime.ts
git commit -m "винное казино: realtime-подписка с фолбэком на опрос"
```

---

### Task 17: Shared components

**Files:**
- Create: `02_services/wine-casino/components/Timer.tsx`
- Create: `02_services/wine-casino/components/HintFeed.tsx`
- Create: `02_services/wine-casino/components/Leaderboard.tsx`
- Create: `02_services/wine-casino/components/LangToggle.tsx`
- Create: `02_services/wine-casino/components/QrPanel.tsx`

- [ ] **Step 1: Create `components/Timer.tsx`**

```tsx
'use client'
import { useCountdown } from '@/lib/realtime'

export function Timer({ endsAt, size = 'md' }: { endsAt: string | null; size?: 'md' | 'xl' }) {
  const left = useCountdown(endsAt)
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  // Under ten seconds the clock turns red — visible from across a dim room.
  const urgent = left > 0 && left <= 10

  return (
    <div
      className={[
        'font-display tabular-nums tracking-display',
        size === 'xl' ? 'text-8xl' : 'text-3xl',
        urgent ? 'text-wine-red animate-pulse' : 'text-amber-gold',
      ].join(' ')}
    >
      {mm}:{ss}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/HintFeed.tsx`**

```tsx
'use client'
import { pick, t } from '@/lib/i18n'
import type { Hint, Lang } from '@/lib/types'

export function HintFeed({ hints, lang }: { hints: Hint[]; lang: Lang }) {
  if (hints.length === 0) return null
  return (
    <ul className="space-y-2">
      {hints.map((h, i) => (
        <li key={i} className="rounded-md border border-amber-gold/40 bg-amber-gold/10 px-3 py-2">
          <span className="block text-[11px] uppercase tracking-overline text-amber-gold/80">
            {t('hint', lang)} {i + 1}
          </span>
          <span className="text-warm-white">{pick(h, lang)}</span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Create `components/Leaderboard.tsx`**

```tsx
'use client'
import type { PublicPlayer } from '@/lib/realtime'

export function Leaderboard({
  players, highlightId, max = 12,
}: { players: PublicPlayer[]; highlightId?: string | null; max?: number }) {
  const ranked = [...players].sort((a, b) => b.chips - a.chips || a.nickname.localeCompare(b.nickname))

  return (
    <ol className="space-y-1">
      {ranked.slice(0, max).map((p, i) => (
        <li
          key={p.id}
          className={[
            'flex items-center gap-3 rounded-md px-3 py-2',
            p.id === highlightId ? 'bg-amber-gold/20 ring-1 ring-amber-gold' : 'bg-graphite/30',
          ].join(' ')}
        >
          <span className="w-6 font-display text-xl text-amber-gold">{i + 1}</span>
          <span className="flex-1 truncate">{p.nickname}</span>
          <span className="font-display text-xl tabular-nums">{p.chips}</span>
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 4: Create `components/LangToggle.tsx`**

```tsx
'use client'
import type { Lang } from '@/lib/types'

export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-pale-stone/30 text-xs">
      {(['ru', 'en'] as Lang[]).map(l => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={l === lang ? 'bg-amber-gold px-3 py-1 text-deep-black' : 'px-3 py-1 text-pale-stone'}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create `components/QrPanel.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** The TV's join panel: a QR that opens the join screen with the PIN prefilled,
 *  plus the PIN in huge digits for anyone whose camera will not cooperate. */
export function QrPanel({ pin }: { pin: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const base = process.env.NEXT_PUBLIC_CASINO_URL ?? ''
  const joinUrl = `${base}/?pin=${pin}`

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { width: 480, margin: 1, color: { dark: '#14342B', light: '#F5F0EB' } })
      .then(setDataUrl)
      .catch(() => setDataUrl(null))
  }, [joinUrl])

  return (
    <div className="flex flex-col items-center gap-6">
      {dataUrl && <img src={dataUrl} alt="" className="h-72 w-72 rounded-lg" />}
      <div className="text-center">
        <div className="text-sm uppercase tracking-overline text-pale-stone">PIN</div>
        <div className="font-display text-7xl tracking-display text-amber-gold">{pin}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `cd 02_services/wine-casino && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/components
git commit -m "винное казино: общие компоненты — таймер, подсказки, лидерборд, QR"
```

---

### Task 18: Player surface — join and play

**Files:**
- Create: `02_services/wine-casino/lib/session.ts`
- Create: `02_services/wine-casino/components/ChipPicker.tsx`
- Create: `02_services/wine-casino/components/BetBoard.tsx`
- Modify: `02_services/wine-casino/app/page.tsx` (replaces the Task 1 placeholder)
- Create: `02_services/wine-casino/app/play/page.tsx`

- [ ] **Step 1: Create `lib/session.ts`**

```ts
'use client'
import type { Lang } from './types'

// The guest's whole identity lives in localStorage. A refresh, a locked screen
// or a dead battery swapped for a charger all resume the same seat.
const KEY = 'wc:session'

export type Session = {
  gameId: string
  playerId: string
  playerToken: string
  nickname: string
  lang: Lang
}

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function saveSession(s: Session): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}

export function clearSession(): void {
  try { window.localStorage.removeItem(KEY) } catch { /* private mode */ }
}
```

- [ ] **Step 2: Create `components/ChipPicker.tsx`**

```tsx
'use client'

const DENOMS = [5, 10, 25, 50]

/** Denomination selector. Tapping a board button stakes this many chips, which
 *  is far fewer taps on a phone than a stepper per option. */
export function ChipPicker({
  value, available, onChange,
}: { value: number; available: number; onChange: (v: number) => void }) {
  const usable = DENOMS.filter(d => d <= available)
  const choices = usable.length > 0 ? usable : [available].filter(a => a > 0)

  return (
    <div className="flex gap-2">
      {choices.map(d => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={[
            'h-12 w-12 rounded-full border-2 font-display text-lg tabular-nums',
            d === value
              ? 'border-amber-gold bg-amber-gold text-deep-black'
              : 'border-pale-stone/40 text-pale-stone',
          ].join(' ')}
        >
          {d}
        </button>
      ))}
      {available > 0 && (
        <button
          onClick={() => onChange(available)}
          className={[
            'h-12 rounded-full border-2 px-4 font-heading text-sm',
            value === available
              ? 'border-wine-red bg-wine-red text-warm-white'
              : 'border-wine-red/60 text-wine-red',
          ].join(' ')}
        >
          ALL {available}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `components/BetBoard.tsx`**

```tsx
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChipPicker } from './ChipPicker'
import { pick, t } from '@/lib/i18n'
import type { CategoryDef, Lang, OptionSet } from '@/lib/types'
import type { BetLine } from '@/lib/bets'

type Props = {
  wineId: string
  options: OptionSet
  categories: CategoryDef[]
  chips: number
  lang: Lang
  onSave: (slip: BetLine[]) => Promise<{ ok: boolean; error?: string }>
}

const AUTOSAVE_MS = 600

export function BetBoard({ wineId, options, categories, chips, lang, onSave }: Props) {
  // slip is keyed "category:option" so a hedge inside one category is natural.
  const [slip, setSlip] = useState<Record<string, number>>({})
  const [denom, setDenom] = useState(10)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A new wine is a clean table.
  useEffect(() => { setSlip({}); setStatus('idle'); setError(null) }, [wineId])

  const staked = useMemo(() => Object.values(slip).reduce((s, n) => s + n, 0), [slip])
  const available = chips - staked

  const lines: BetLine[] = useMemo(
    () => Object.entries(slip)
      .filter(([, amount]) => amount > 0)
      .map(([key, amount]) => {
        const [category, ...rest] = key.split(':')
        return { category: category as BetLine['category'], option: rest.join(':'), amount }
      }),
    [slip],
  )

  // Autosave: every tap is persisted within a second, so a phone that dies
  // mid-round still has its bets on the table.
  useEffect(() => {
    if (status === 'idle' && lines.length === 0) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setStatus('saving')
      const res = await onSave(lines)
      if (res.ok) { setStatus('saved'); setError(null) }
      else { setStatus('error'); setError(res.error ?? 'errGeneric') }
    }, AUTOSAVE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines])

  function add(category: string, option: string) {
    const key = `${category}:${option}`
    const amount = Math.min(denom, available)
    if (amount <= 0) { setError('errBank'); return }
    setError(null)
    setSlip(prev => ({ ...prev, [key]: (prev[key] ?? 0) + amount }))
  }

  function clearOne(category: string, option: string) {
    const key = `${category}:${option}`
    setSlip(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  return (
    <div className="pb-32">
      <div className="sticky top-0 z-10 -mx-4 mb-4 bg-deep-black/95 px-4 py-3 backdrop-blur">
        <ChipPicker value={denom} available={available} onChange={setDenom} />
      </div>

      <div className="space-y-6">
        {categories.map(cat => {
          const board = options[cat.key]
          if (!board || board.length === 0) return null
          return (
            <section key={cat.key}>
              <header className="mb-2 flex items-baseline justify-between">
                <h2 className="font-heading text-sm uppercase tracking-overline text-pale-stone">
                  {pick(cat, lang)}
                </h2>
                <span className="font-display text-lg text-amber-gold">×{cat.multiplier}</span>
              </header>
              <div className="grid grid-cols-2 gap-2">
                {board.map(opt => {
                  const key = `${cat.key}:${opt.value}`
                  const on = slip[key] ?? 0
                  return (
                    <button
                      key={opt.value}
                      onClick={() => add(cat.key, opt.value)}
                      onContextMenu={e => { e.preventDefault(); clearOne(cat.key, opt.value) }}
                      className={[
                        'relative min-h-[56px] rounded-md border px-3 py-2 text-left text-sm',
                        on > 0
                          ? 'border-amber-gold bg-felt-light'
                          : 'border-pale-stone/25 bg-felt/60',
                      ].join(' ')}
                    >
                      {pick(opt, lang)}
                      {on > 0 && (
                        <span
                          onClick={e => { e.stopPropagation(); clearOne(cat.key, opt.value) }}
                          className="absolute -right-1 -top-1 flex h-7 min-w-7 items-center justify-center rounded-full bg-amber-gold px-1 font-display text-sm tabular-nums text-deep-black"
                        >
                          {on}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-pale-stone/20 bg-deep-black/95 px-4 py-3 backdrop-blur">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-pale-stone">{t('onTable', lang)}: <b className="text-warm-white">{staked}</b></span>
          <span className="text-pale-stone">{t('available', lang)}: <b className="text-warm-white">{available}</b></span>
        </div>
        {error && <p className="mb-2 text-sm text-wine-red">{t(error as 'errGeneric', lang)}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setSlip({})}
            className="rounded-md border border-pale-stone/40 px-4 py-3 text-sm text-pale-stone"
          >
            {t('clearAll', lang)}
          </button>
          <button
            onClick={async () => { setStatus('saving'); const r = await onSave(lines); setStatus(r.ok ? 'saved' : 'error') }}
            className="flex-1 rounded-md bg-amber-gold py-3 font-heading text-deep-black"
          >
            {status === 'saved' ? t('betsSaved', lang) : t('placeBet', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Replace `app/page.tsx` with the join screen**

```tsx
'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LangToggle } from '@/components/LangToggle'
import { saveSession } from '@/lib/session'
import { t } from '@/lib/i18n'
import type { Lang } from '@/lib/types'

function JoinForm() {
  const params = useSearchParams()
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [nickname, setNickname] = useState('')
  const [lang, setLang] = useState<Lang>('ru')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The TV's QR carries ?pin=, so a guest only types their name.
  useEffect(() => {
    const p = params.get('pin')
    if (p) setPin(p)
  }, [params])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin, nickname, lang }),
    })
    setBusy(false)
    if (!res.ok) {
      const { error: code } = await res.json().catch(() => ({ error: 'errGeneric' }))
      setError(code === 'game_finished' ? t('joinClosed', lang) : t('joinNotFound', lang))
      return
    }
    const data = await res.json()
    saveSession({
      gameId: data.gameId, playerId: data.playerId, playerToken: data.playerToken,
      nickname: data.nickname, lang,
    })
    router.push('/play')
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex items-start justify-between">
        <h1 className="font-display text-5xl leading-none tracking-display text-amber-gold">
          {t('joinTitle', lang)}
        </h1>
        <LangToggle lang={lang} onChange={setLang} />
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder={t('joinPin', lang)}
          className="w-full rounded-md bg-graphite/40 px-4 py-4 text-center font-display text-3xl tracking-display outline-none focus:ring-2 focus:ring-amber-gold"
        />
        <input
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          placeholder={t('joinName', lang)}
          maxLength={24}
          className="w-full rounded-md bg-graphite/40 px-4 py-3 outline-none focus:ring-2 focus:ring-amber-gold"
        />
        {error && <p className="text-sm text-wine-red">{error}</p>}
        <button
          disabled={busy || pin.length !== 6}
          className="w-full rounded-md bg-amber-gold py-4 font-heading text-lg text-deep-black disabled:opacity-40"
        >
          {t('joinButton', lang)}
        </button>
      </form>
    </main>
  )
}

export default function Home() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  )
}
```

- [ ] **Step 5: Create `app/play/page.tsx`**

```tsx
'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BetBoard } from '@/components/BetBoard'
import { HintFeed } from '@/components/HintFeed'
import { Leaderboard } from '@/components/Leaderboard'
import { Timer } from '@/components/Timer'
import { useLiveGame } from '@/lib/realtime'
import { clearSession, loadSession } from '@/lib/session'
import type { Session } from '@/lib/session'
import { t } from '@/lib/i18n'
import type { BetLine } from '@/lib/bets'
import type { CategoryDef, Lang } from '@/lib/types'

type MyBet = { category: string; option: string; amount: number; isCorrect: boolean | null; payout: number | null }

export default function Play() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [categories, setCategories] = useState<CategoryDef[]>([])
  const [myBets, setMyBets] = useState<MyBet[]>([])
  const [lang, setLang] = useState<Lang>('ru')

  useEffect(() => {
    const s = loadSession()
    if (!s) { router.replace('/'); return }
    setSession(s)
    setLang(s.lang)
  }, [router])

  const { state, players, connected } = useLiveGame(session?.gameId ?? null, session?.playerId ?? null)

  // Categories and the settled slip come from the REST endpoint; Realtime only
  // carries round_state and player rows.
  useEffect(() => {
    if (!session) return
    const qs = new URLSearchParams({ gameId: session.gameId, playerId: session.playerId })
    fetch(`/api/state?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { setCategories(j.game?.categories ?? []); setMyBets(j.myBets ?? []) })
      .catch(() => { /* the poller in useLiveGame will retry */ })
  }, [session, state?.wine_id, state?.round_status])

  const me = useMemo(
    () => players.find(p => p.id === session?.playerId) ?? null,
    [players, session],
  )

  async function saveSlip(slip: BetLine[]): Promise<{ ok: boolean; error?: string }> {
    if (!session || !state?.wine_id) return { ok: false, error: 'errGeneric' }
    const res = await fetch('/api/bet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId, playerToken: session.playerToken,
        wineId: state.wine_id, slip,
      }),
    })
    if (res.ok) return { ok: true }
    const { error } = await res.json().catch(() => ({ error: 'errGeneric' }))
    return { ok: false, error: error === 'insufficient_chips' ? 'errBank' : error === 'round_closed' ? 'errClosed' : 'errGeneric' }
  }

  if (!session) return null

  const chips = me?.chips ?? 0
  const status = state?.round_status ?? 'pending'
  const gameStatus = state?.game_status ?? 'lobby'

  return (
    <main className="mx-auto min-h-screen max-w-md p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-overline text-pale-stone">{session.nickname}</div>
          <div className="font-display text-3xl text-amber-gold">
            {chips} <span className="text-base text-pale-stone">{t('bank', lang)}</span>
          </div>
        </div>
        <div className="text-right">
          {state?.wine_id && (
            <div className="text-xs uppercase tracking-overline text-pale-stone">
              {t('roundOf', lang)} {state.round_no}/{state.total_rounds}
            </div>
          )}
          {status === 'betting' && <Timer endsAt={state?.ends_at ?? null} />}
        </div>
      </header>

      {!connected && (
        <p className="mb-3 rounded-md bg-graphite/40 px-3 py-2 text-xs text-pale-stone">
          {t('reconnecting', lang)}
        </p>
      )}

      {gameStatus === 'finished' && (
        <section className="space-y-4">
          <h2 className="font-display text-4xl text-amber-gold">{t('finished', lang)}</h2>
          <Leaderboard players={players} highlightId={session.playerId} max={20} />
        </section>
      )}

      {gameStatus !== 'finished' && status === 'pending' && (
        <section className="space-y-4">
          <p className="text-pale-stone">{t('lobbyWaiting', lang)}</p>
          <h3 className="text-xs uppercase tracking-overline text-pale-stone">{t('lobbyPlayers', lang)}</h3>
          <Leaderboard players={players} highlightId={session.playerId} max={30} />
        </section>
      )}

      {status === 'betting' && state?.wine_id && (
        <>
          <div className="mb-4">
            <HintFeed hints={state.revealed_hints} lang={lang} />
          </div>
          <BetBoard
            wineId={state.wine_id}
            options={state.options}
            categories={categories}
            chips={chips}
            lang={lang}
            onSave={saveSlip}
          />
        </>
      )}

      {status === 'locked' && (
        <section className="space-y-3">
          <p className="font-heading text-xl text-wine-red">{t('betsClosed', lang)}</p>
          <HintFeed hints={state?.revealed_hints ?? []} lang={lang} />
        </section>
      )}

      {status === 'revealed' && state?.reveal && (
        <section className="space-y-4">
          <div className="rounded-lg border border-amber-gold/40 bg-felt/60 p-4">
            <h2 className="font-heading text-xl">{state.reveal.name}</h2>
            <p className="text-sm text-pale-stone">
              {[state.reveal.country, state.reveal.region, state.reveal.grape, state.reveal.vintage]
                .filter(Boolean).join(' · ')}
            </p>
          </div>

          <ul className="space-y-1 text-sm">
            {myBets.map((b, i) => (
              <li key={i} className="flex justify-between rounded-md bg-graphite/30 px-3 py-2">
                <span className="text-pale-stone">{b.option}</span>
                <span className={b.isCorrect === true ? 'text-amber-gold' : b.isCorrect === null ? 'text-pale-stone' : 'text-wine-red'}>
                  {b.isCorrect === true ? `${t('correct', lang)} +${b.payout}` :
                   b.isCorrect === null ? t('voided', lang) : `${t('wrong', lang)} −${b.amount}`}
                </span>
              </li>
            ))}
          </ul>

          <Leaderboard players={players} highlightId={session.playerId} />
        </section>
      )}

      <footer className="mt-10 text-center">
        <button onClick={() => { clearSession(); router.replace('/') }} className="text-xs text-pale-stone/60 underline">
          exit
        </button>
      </footer>
    </main>
  )
}
```

- [ ] **Step 6: Build**

Run: `cd 02_services/wine-casino && npm run build`
Expected: build succeeds; `/` and `/play` appear in the route table.

- [ ] **Step 7: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/lib/session.ts 02_services/wine-casino/components \
        02_services/wine-casino/app/page.tsx 02_services/wine-casino/app/play
git commit -m "винное казино: экран игрока — вход, поле ставок, результат"
```

---

### Task 19: Host panel

English-only, used by us. It is also the game's clock: while a round is running
it posts `/api/host/tick` every two seconds, which is what makes hints appear.

**Files:**
- Create: `02_services/wine-casino/app/host/page.tsx`

- [ ] **Step 1: Create `app/host/page.tsx`**

```tsx
'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Timer } from '@/components/Timer'
import { Leaderboard } from '@/components/Leaderboard'
import type { CategoryDef, Hint, RoundStatus, WineAnswers } from '@/lib/types'

type HostWine = {
  id: string; order_no: number; label: string; name: string
  country: string | null; region: string | null; grape: string | null
  vintage: number | null; style: string | null; abv: number | null
  answers: WineAnswers; hints: Hint[]; status: RoundStatus; ends_at: string | null
}

type HostState = {
  game: {
    id: string; pin: string; title: string; status: string
    difficulty: string; round_seconds: number; categories: CategoryDef[]
    current_wine_id: string | null
  }
  wines: HostWine[]
  players: Array<{ id: string; nickname: string; chips: number }>
  state: { round_status: RoundStatus; ends_at: string | null; revealed_hints: Hint[] } | null
}

const TICK_MS = 2000

function HostPanel() {
  const token = useSearchParams().get('t') ?? ''
  const [data, setData] = useState<HostState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    const res = await fetch(`/api/host/state?t=${token}`, { cache: 'no-store' })
    if (!res.ok) { setError('Bad host link'); return }
    setData(await res.json())
  }, [token])

  useEffect(() => { void refresh() }, [refresh])

  // The host's browser is the game clock. Nothing else reveals hints.
  useEffect(() => {
    if (!token) return
    const timer = setInterval(async () => {
      if (data?.state?.round_status !== 'betting') return
      await fetch('/api/host/tick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t: token }),
      }).catch(() => { /* one missed tick just delays a hint by two seconds */ })
      void refresh()
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [token, data?.state?.round_status, refresh])

  async function act(action: 'open' | 'start' | 'lock' | 'reveal' | 'next') {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/host/round', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: token, action }),
    })
    setBusy(false)
    if (!res.ok) { setError(`Action "${action}" failed`); return }
    await refresh()
  }

  if (!token) return <main className="p-8">Missing host token.</main>
  if (!data) return <main className="p-8">{error ?? 'Loading…'}</main>

  const current = data.wines.find(w => w.id === data.game.current_wine_id) ?? null
  const status = data.state?.round_status ?? 'pending'

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-display text-amber-gold">{data.game.title}</h1>
          <p className="text-sm text-pale-stone">
            PIN {data.game.pin} · {data.game.difficulty} · {data.players.length} players
          </p>
        </div>
        {status === 'betting' && <Timer endsAt={data.state?.ends_at ?? null} />}
      </header>

      {error && <p className="rounded-md bg-wine-red/20 px-3 py-2 text-sm text-wine-red">{error}</p>}

      <section className="rounded-lg border border-pale-stone/20 p-4">
        {current ? (
          <>
            <div className="mb-1 text-xs uppercase tracking-overline text-pale-stone">
              {current.label} · round {current.order_no}/{data.wines.length} · {status}
            </div>
            <h2 className="font-heading text-xl">{current.name}</h2>
            <p className="text-sm text-pale-stone">
              {[current.country, current.region, current.grape, current.vintage, current.abv && `${current.abv}%`]
                .filter(Boolean).join(' · ')}
            </p>
            {data.state && data.state.revealed_hints.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-amber-gold">
                {data.state.revealed_hints.map((h, i) => <li key={i}>· {h.en}</li>)}
              </ul>
            )}
          </>
        ) : (
          <p className="text-pale-stone">No wine selected. Open the lobby, then press Start.</p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <button disabled={busy} onClick={() => act('open')} className="rounded-md border border-pale-stone/40 py-3">
          Open lobby
        </button>
        <button disabled={busy || status === 'betting'} onClick={() => act('start')} className="rounded-md bg-amber-gold py-3 text-deep-black disabled:opacity-40">
          Start round
        </button>
        <button disabled={busy || status !== 'betting'} onClick={() => act('lock')} className="rounded-md border border-wine-red py-3 text-wine-red disabled:opacity-40">
          Close bets
        </button>
        <button disabled={busy || (status !== 'locked' && status !== 'betting')} onClick={() => act('reveal')} className="rounded-md bg-wine-red py-3 disabled:opacity-40">
          Reveal
        </button>
        <button disabled={busy || status !== 'revealed'} onClick={() => act('next')} className="col-span-2 rounded-md border border-amber-gold py-3 text-amber-gold disabled:opacity-40">
          Next wine
        </button>
      </div>

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-overline text-pale-stone">Leaderboard</h3>
        <Leaderboard players={data.players} max={30} />
      </section>

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-overline text-pale-stone">Running order</h3>
        <ol className="space-y-1 text-sm">
          {data.wines.map(w => (
            <li key={w.id} className={w.id === data.game.current_wine_id ? 'text-amber-gold' : 'text-pale-stone'}>
              {w.order_no}. {w.name} — {w.status}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

export default function Host() {
  return <Suspense><HostPanel /></Suspense>
}
```

- [ ] **Step 2: Build**

Run: `cd 02_services/wine-casino && npm run build`
Expected: `/host` in the route table.

- [ ] **Step 3: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/app/host
git commit -m "винное казино: панель ведущего"
```

---

### Task 20: TV screen

Read-only, no token: anyone who can see the screen is already in the room.

**Files:**
- Create: `02_services/wine-casino/app/screen/[pin]/page.tsx`
- Create: `02_services/wine-casino/app/screen/[pin]/ScreenClient.tsx`

- [ ] **Step 1: Create `app/screen/[pin]/page.tsx`**

```tsx
import { getGameByPin } from '@/lib/db'
import { ScreenClient } from './ScreenClient'

export const dynamic = 'force-dynamic'

export default async function Screen({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params
  const game = await getGameByPin(pin)
  if (!game) {
    return <main className="flex min-h-screen items-center justify-center font-display text-4xl">No such game</main>
  }
  return <ScreenClient gameId={game.id} pin={game.pin} title={game.title} categories={game.categories} />
}
```

- [ ] **Step 2: Create `app/screen/[pin]/ScreenClient.tsx`**

```tsx
'use client'
import { HintFeed } from '@/components/HintFeed'
import { Leaderboard } from '@/components/Leaderboard'
import { QrPanel } from '@/components/QrPanel'
import { Timer } from '@/components/Timer'
import { useLiveGame } from '@/lib/realtime'
import { pick } from '@/lib/i18n'
import type { CategoryDef } from '@/lib/types'

export function ScreenClient({
  gameId, pin, title, categories,
}: { gameId: string; pin: string; title: string; categories: CategoryDef[] }) {
  const { state, players } = useLiveGame(gameId)
  const status = state?.round_status ?? 'pending'
  const gameStatus = state?.game_status ?? 'lobby'

  return (
    <main className="min-h-screen bg-felt p-10">
      <header className="mb-8 flex items-start justify-between">
        <h1 className="font-display text-6xl tracking-display text-amber-gold">{title}</h1>
        {state?.wine_id && (
          <div className="text-right">
            <div className="text-sm uppercase tracking-overline text-pale-stone">
              {state.label} · {state.round_no}/{state.total_rounds}
            </div>
            {status === 'betting' && <Timer endsAt={state.ends_at} size="xl" />}
          </div>
        )}
      </header>

      {/* Lobby: the join panel is the whole screen, because that is the only
          thing anyone needs to do right now. */}
      {gameStatus !== 'finished' && status === 'pending' && (
        <div className="grid grid-cols-2 gap-12">
          <QrPanel pin={pin} />
          <div>
            <h2 className="mb-4 font-heading text-2xl text-warm-white">
              At the table · {players.length}
            </h2>
            <Leaderboard players={players} max={20} />
          </div>
        </div>
      )}

      {status === 'betting' && (
        <div className="grid grid-cols-3 gap-10">
          <div className="col-span-2">
            <h2 className="mb-4 font-heading text-3xl text-warm-white">Place your bets</h2>
            <div className="grid grid-cols-2 gap-3">
              {categories.map(c => (
                <div key={c.key} className="rounded-lg border border-pale-stone/25 px-4 py-3">
                  <div className="text-sm uppercase tracking-overline text-pale-stone">{pick(c, 'en')}</div>
                  <div className="font-display text-3xl text-amber-gold">×{c.multiplier}</div>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <HintFeed hints={state?.revealed_hints ?? []} lang="en" />
            </div>
          </div>
          <Leaderboard players={players} max={12} />
        </div>
      )}

      {status === 'locked' && (
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="font-display text-7xl text-wine-red">BETS ARE CLOSED</p>
        </div>
      )}

      {status === 'revealed' && state?.reveal && (
        <div className="grid grid-cols-3 gap-10">
          <div className="col-span-2 space-y-4">
            {state.reveal.image_url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={state.reveal.image_url} alt="" className="h-64 rounded-lg object-contain" />
            )}
            <h2 className="font-display text-6xl text-amber-gold">{state.reveal.name}</h2>
            <p className="font-heading text-3xl text-warm-white">
              {[state.reveal.country, state.reveal.region, state.reveal.grape, state.reveal.vintage,
                state.reveal.abv && `${state.reveal.abv}%`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <Leaderboard players={players} max={12} />
        </div>
      )}

      {gameStatus === 'finished' && (
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <p className="font-display text-7xl text-amber-gold">GAME OVER</p>
          <Leaderboard players={players} max={20} />
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Build**

Run: `cd 02_services/wine-casino && npm run build`
Expected: `/screen/[pin]` in the route table.

- [ ] **Step 4: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/app/screen
git commit -m "винное казино: общий экран для ТВ"
```

---

### Task 21: Admin surface

English-only. Two pages: the list of games, and the editor for one game.

**Files:**
- Create: `02_services/wine-casino/app/admin/page.tsx`
- Create: `02_services/wine-casino/app/admin/[gameId]/page.tsx`
- Create: `02_services/wine-casino/app/admin/[gameId]/WineEditor.tsx`

- [ ] **Step 1: Create `app/admin/page.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Difficulty, GameStatus } from '@/lib/types'

type Row = {
  id: string; pin: string; title: string; status: GameStatus
  difficulty: Difficulty; created_at: string
}

export default function AdminGames() {
  const [games, setGames] = useState<Row[]>([])
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [busy, setBusy] = useState(false)

  async function load() {
    const res = await fetch('/api/admin/games', { cache: 'no-store' })
    if (res.ok) setGames((await res.json()).games)
  }
  useEffect(() => { void load() }, [])

  async function create() {
    setBusy(true)
    await fetch('/api/admin/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, difficulty }),
    })
    setBusy(false)
    setTitle('')
    await load()
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="font-display text-4xl tracking-display text-amber-gold">Wine Casino — games</h1>

      <section className="flex gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Evening name"
          className="flex-1 rounded-md bg-graphite/40 px-4 py-2 outline-none"
        />
        <select
          value={difficulty}
          onChange={e => setDifficulty(e.target.value as Difficulty)}
          className="rounded-md bg-graphite/40 px-3 py-2"
        >
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
          <option value="pro">pro</option>
        </select>
        <button disabled={busy} onClick={create} className="rounded-md bg-amber-gold px-5 py-2 text-deep-black">
          New game
        </button>
      </section>

      <ul className="space-y-2">
        {games.map(g => (
          <li key={g.id}>
            <Link
              href={`/admin/${g.id}`}
              className="flex items-center justify-between rounded-md bg-graphite/30 px-4 py-3 hover:bg-graphite/50"
            >
              <span>
                <b>{g.title}</b>
                <span className="ml-3 text-sm text-pale-stone">PIN {g.pin} · {g.difficulty} · {g.status}</span>
              </span>
              <span className="text-xs text-pale-stone">{new Date(g.created_at).toLocaleDateString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 2: Create `app/admin/[gameId]/WineEditor.tsx`**

```tsx
'use client'
import { useState } from 'react'
import type { Hint, WineColor } from '@/lib/types'

export type EditableWine = {
  id: string; order_no: number; label: string; name: string
  country: string | null; region: string | null; grape: string | null
  vintage: number | null; style: string | null; color: WineColor | null
  abv: number | null; image_url: string | null; hints: Hint[]
}

type Props = {
  gameId: string
  wine: EditableWine
  onSaved: () => void
}

/** Edits one bottle. Saving re-derives the answer key, the board and — unless
 *  the hints were hand-edited — the hint texts. */
export function WineEditor({ gameId, wine, onSaved }: Props) {
  const [form, setForm] = useState(wine)
  const [hints, setHints] = useState<Hint[]>(wine.hints)
  const [busy, setBusy] = useState(false)

  function set<K extends keyof EditableWine>(key: K, value: EditableWine[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function save(regenerateHints: boolean) {
    setBusy(true)
    await fetch(`/api/admin/games/${gameId}/wines/${wine.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name, country: form.country, region: form.region, grape: form.grape,
        vintage: form.vintage, style: form.style, color: form.color, abv: form.abv,
        imageUrl: form.image_url,
        hints: regenerateHints ? [] : hints,
      }),
    })
    setBusy(false)
    onSaved()
  }

  async function remove() {
    if (!confirm(`Remove "${wine.name}" from this game?`)) return
    await fetch(`/api/admin/games/${gameId}/wines/${wine.id}`, { method: 'DELETE' })
    onSaved()
  }

  const field = 'rounded-md bg-graphite/40 px-3 py-2 outline-none'

  return (
    <div className="space-y-3 rounded-lg border border-pale-stone/20 p-4">
      <div className="flex items-center justify-between">
        <span className="font-display text-2xl text-amber-gold">{wine.label}</span>
        <button onClick={remove} className="text-xs text-wine-red underline">remove</button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input className={`${field} col-span-2`} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Name" />
        <input className={field} value={form.country ?? ''} onChange={e => set('country', e.target.value || null)} placeholder="Country" />
        <input className={field} value={form.region ?? ''} onChange={e => set('region', e.target.value || null)} placeholder="Region" />
        <input className={field} value={form.grape ?? ''} onChange={e => set('grape', e.target.value || null)} placeholder="Grape" />
        <input
          className={field} type="number" value={form.vintage ?? ''}
          onChange={e => set('vintage', e.target.value ? Number(e.target.value) : null)} placeholder="Vintage"
        />
        <select className={field} value={form.style ?? ''} onChange={e => set('style', e.target.value || null)}>
          <option value="">— style —</option>
          <option value="dry">dry</option>
          <option value="semi-dry">semi-dry</option>
          <option value="semi-sweet">semi-sweet</option>
          <option value="sweet">sweet</option>
        </select>
        <select className={field} value={form.color ?? ''} onChange={e => set('color', (e.target.value || null) as WineColor | null)}>
          <option value="">— colour —</option>
          <option value="red">red</option>
          <option value="white">white</option>
          <option value="rose">rosé</option>
          <option value="sparkling">sparkling</option>
          <option value="orange">orange</option>
        </select>
        <input
          className={field} type="number" step="0.1" value={form.abv ?? ''}
          onChange={e => set('abv', e.target.value ? Number(e.target.value) : null)} placeholder="ABV %"
        />
        <input className={field} value={form.image_url ?? ''} onChange={e => set('image_url', e.target.value || null)} placeholder="Image URL" />
      </div>

      <div className="space-y-2">
        <h4 className="text-xs uppercase tracking-overline text-pale-stone">Hints</h4>
        {hints.length === 0 && <p className="text-sm text-pale-stone">None — difficulty is “pro”, or no facts to hint at.</p>}
        {hints.map((h, i) => (
          <div key={i} className="grid grid-cols-[4rem_1fr_1fr_2rem] gap-2">
            <input
              className={field} type="number" value={h.at}
              onChange={e => setHints(hs => hs.map((x, j) => j === i ? { ...x, at: Number(e.target.value) } : x))}
            />
            <input
              className={field} value={h.ru}
              onChange={e => setHints(hs => hs.map((x, j) => j === i ? { ...x, ru: e.target.value } : x))}
            />
            <input
              className={field} value={h.en}
              onChange={e => setHints(hs => hs.map((x, j) => j === i ? { ...x, en: e.target.value } : x))}
            />
            <button onClick={() => setHints(hs => hs.filter((_, j) => j !== i))} className="text-wine-red">×</button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button disabled={busy} onClick={() => save(false)} className="rounded-md bg-amber-gold px-4 py-2 text-deep-black">
          Save
        </button>
        <button disabled={busy} onClick={() => save(true)} className="rounded-md border border-pale-stone/40 px-4 py-2 text-sm">
          Save &amp; regenerate hints
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `app/admin/[gameId]/page.tsx`**

```tsx
'use client'
import { use, useCallback, useEffect, useState } from 'react'
import { WineEditor } from './WineEditor'
import type { EditableWine } from './WineEditor'
import type { CategoryDef, Difficulty, GameStatus } from '@/lib/types'

type Game = {
  id: string; pin: string; host_token: string; title: string; status: GameStatus
  difficulty: Difficulty; starting_chips: number; rescue_chips: number
  round_seconds: number; categories: CategoryDef[]
}

type Hit = {
  sku_id: string; name: string
  wine_color: string | null; grape_variety: string | null; wine_country: string | null
}

export default function GameEditor({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = use(params)
  const [game, setGame] = useState<Game | null>(null)
  const [wines, setWines] = useState<EditableWine[]>([])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/games/${gameId}`, { cache: 'no-store' })
    if (!res.ok) return
    const json = await res.json()
    setGame(json.game)
    setWines(json.wines)
  }, [gameId])

  useEffect(() => { void load() }, [load])

  // Inventory search: v_sku_breakdown gives us colour, grape and country.
  // Region and vintage are never in there — they get typed in below.
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/admin/inventory?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      if (res.ok) setHits((await res.json()).hits)
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  async function addWine(payload: Record<string, unknown>) {
    await fetch(`/api/admin/games/${gameId}/wines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setQ('')
    setHits([])
    await load()
  }

  async function patchGame(patch: Record<string, unknown>) {
    await fetch(`/api/admin/games/${gameId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await load()
  }

  if (!game) return <main className="p-6">Loading…</main>

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="font-display text-4xl tracking-display text-amber-gold">{game.title}</h1>
        <p className="text-sm text-pale-stone">PIN {game.pin} · {game.status}</p>
        <div className="mt-2 space-y-1 text-sm">
          <div>Host panel: <a className="text-amber-gold underline" href={`/host?t=${game.host_token}`}>{origin}/host?t={game.host_token}</a></div>
          <div>TV screen: <a className="text-amber-gold underline" href={`/screen/${game.pin}`}>{origin}/screen/{game.pin}</a></div>
        </div>
      </header>

      <section className="grid grid-cols-4 gap-3 rounded-lg border border-pale-stone/20 p-4">
        <label className="text-sm">Difficulty
          <select
            className="mt-1 w-full rounded-md bg-graphite/40 px-2 py-2"
            value={game.difficulty}
            onChange={e => patchGame({ difficulty: e.target.value })}
          >
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
            <option value="pro">pro</option>
          </select>
        </label>
        <label className="text-sm">Round, sec
          <input
            className="mt-1 w-full rounded-md bg-graphite/40 px-2 py-2" type="number"
            defaultValue={game.round_seconds}
            onBlur={e => patchGame({ roundSeconds: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">Start chips
          <input
            className="mt-1 w-full rounded-md bg-graphite/40 px-2 py-2" type="number"
            defaultValue={game.starting_chips}
            onBlur={e => patchGame({ startingChips: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">Rescue chips
          <input
            className="mt-1 w-full rounded-md bg-graphite/40 px-2 py-2" type="number"
            defaultValue={game.rescue_chips}
            onBlur={e => patchGame({ rescueChips: Number(e.target.value) })}
          />
        </label>
        <p className="col-span-4 text-xs text-pale-stone">
          Changing difficulty, round length or categories rebuilds every wine’s board and hint texts.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl">Add a wine</h2>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search our inventory…"
          className="w-full rounded-md bg-graphite/40 px-4 py-2 outline-none"
        />
        {hits.length > 0 && (
          <ul className="divide-y divide-pale-stone/10 rounded-md bg-graphite/20">
            {hits.map(h => (
              <li key={h.sku_id}>
                <button
                  onClick={() => addWine({
                    sku: h.sku_id, name: h.name,
                    country: h.wine_country, grape: h.grape_variety, color: h.wine_color,
                  })}
                  className="w-full px-4 py-2 text-left hover:bg-graphite/40"
                >
                  {h.name}
                  <span className="ml-2 text-xs text-pale-stone">
                    {[h.wine_country, h.grape_variety].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => addWine({ name: 'New wine' })}
          className="rounded-md border border-pale-stone/40 px-4 py-2 text-sm"
        >
          Add blank wine
        </button>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-xl">Running order ({wines.length})</h2>
        {wines.map(w => <WineEditor key={w.id} gameId={gameId} wine={w} onSaved={load} />)}
      </section>
    </main>
  )
}
```

- [ ] **Step 4: Build**

Run: `cd 02_services/wine-casino && npm run build`
Expected: `/admin` and `/admin/[gameId]` in the route table.

- [ ] **Step 5: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/app/admin
git commit -m "винное казино: админка — игры, вина, подсказки"
```

---

### Task 22: README, docs and the full-stack smoke test

**Files:**
- Create: `02_services/wine-casino/README.md`
- Modify: `docs/SERVICES.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the whole test suite**

Run: `cd 02_services/wine-casino && npm test`
Expected: all six test files pass — `categories`, `options`, `hints`, `payout`, `bets`, `pin`, `admin-auth`.

- [ ] **Step 2: Create `README.md`**

````markdown
# wine-casino

Multiplayer wine-tasting casino for Wine & Whiskey events. Guests join from
their phones by QR/PIN, bet chips on a blind-poured wine, a host drives the
rounds, a TV shows the shared screen.

Rules: [`docs/superpowers/specs/2026-09-28-wine-casino-design.md`](../../docs/superpowers/specs/2026-09-28-wine-casino-design.md)

## Surfaces

| URL | Who |
|---|---|
| `/` | guest join (QR carries `?pin=`) |
| `/play` | guest game screen |
| `/host?t=<host_token>` | host control panel |
| `/screen/<pin>` | TV |
| `/admin` | game setup, behind `CASINO_ADMIN_PASSWORD` |

## Running an evening

1. `/admin` → **New game** → set difficulty, round length, chips.
2. Add 5–8 wines. The inventory search fills country, grape and colour; region
   and vintage are always typed in by hand (`v_sku_breakdown` does not carry
   them). Edit or rewrite the generated hints if you want.
3. Open `/screen/<pin>` on the TV and `/host?t=…` on your phone.
4. Host → **Open lobby**. Guests scan the QR.
5. Pour wine #1 blind → **Start round** → hints appear on schedule → **Close
   bets** → **Reveal** → talk about the wine → **Next wine**.

**Keep the host panel open.** It posts a tick every two seconds and that tick is
what reveals hints. Closing it does not break the game — it only stops new hints
from appearing until it is reopened.

## Local development

```bash
cp .env.example .env.local   # fill in from Railway
npm install
npm run dev                  # http://localhost:3009
npm test
```

## Notes

- Same Supabase project as mission-control and kiosk, schema `casino`. It must
  be listed under **Settings → API → Exposed schemas**.
- Migration `047_wine_casino.sql` lives in
  `02_services/mission-control/supabase/migrations/` — one numbered sequence for
  the whole project — and is applied by hand in the SQL Editor.
- Correct answers never reach a phone: they live in `casino.game_wine`, which
  anon cannot read, and payouts are computed server-side.
````

- [ ] **Step 3: Add the service to `docs/SERVICES.md`**

Append a section in the same shape as the existing entries:

```markdown
## wine-casino

`02_services/wine-casino` — multiplayer wine-tasting casino for events. Guests
join by QR/PIN from their phones, bet chips on a blind-poured wine's country,
grape, vintage and style; a host drives rounds from a control panel and a TV
shows the shared screen.

- **Schema:** `casino` (migration 047), same Supabase project as everything else.
- **Realtime:** guests subscribe to `casino.round_state` and `casino.player`;
  polling `/api/state` every 3 s is the fallback.
- **Secrets:** `CASINO_ADMIN_PASSWORD`, `CASINO_SECRET`, `NEXT_PUBLIC_CASINO_URL`
  plus the usual Supabase pair.
- **Docs:** `docs/superpowers/specs/2026-09-28-wine-casino-design.md`
```

- [ ] **Step 4: Add the service to `CLAUDE.md`**

Under **02_services/**, add a bullet after `price-service`:

```markdown
  - `wine-casino/` — Multiplayer wine-tasting casino (Kahoot-style, QR/PIN).
```

- [ ] **Step 5: Manual smoke test**

This is the part no unit test covers. With the migration applied and `.env.local`
filled in, run `npm run dev` and:

1. Create a game in `/admin`, add three wines with full facts.
2. Open `/screen/<pin>` in one window and `/host?t=…` in another.
3. Open `/` in two more windows (use a private window for the second so they get
   separate localStorage) and join with two different names.
4. Host → Open lobby. Both guests should appear on the TV within a second.
5. Host → Start round. Both phones show the board and a running clock.
6. Place different bets on each phone, including a hedge inside one category.
7. Wait for the hint times to pass; confirm hints appear on phones and the TV.
8. Host → Close bets. Phones show "ставки закрыты" and stop accepting taps.
9. Host → Reveal. Check the arithmetic by hand on one phone: chips before minus
   staked plus payouts equals chips after.
10. Bet a guest down to zero and confirm they come back with 10 chips.
11. Reload a guest's phone mid-round — they should return to the same seat with
    the same chips.
12. Host → Next wine, repeat, then finish the game and check the podium.

- [ ] **Step 6: Commit**

```bash
cd /Users/pavelrasputin/Desktop/Wine_Whiskey
git add 02_services/wine-casino/README.md docs/SERVICES.md CLAUDE.md
git commit -m "винное казино: README и регистрация сервиса в документации"
git push origin main
```

- [ ] **Step 7: Tell the user what they must do by hand**

1. Apply `047_wine_casino.sql` in the Supabase SQL Editor.
2. Add `casino` to **Settings → API → Exposed schemas**.
3. Create the Railway service pointing at `02_services/wine-casino`, and set
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CASINO_ADMIN_PASSWORD`, `CASINO_SECRET`,
   `NEXT_PUBLIC_CASINO_URL`.

---

## Done when

- `npm test` passes in `02_services/wine-casino`.
- `npm run build` passes.
- The manual smoke test in Task 22 Step 5 has been run end to end on a real game
  with at least two phones.
- The service is registered in `docs/SERVICES.md` and `CLAUDE.md`.
