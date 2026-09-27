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
  lang       text not null default 'ru',
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

create index if not exists game_wine_game_idx on casino.game_wine (game_id, order_no);
create index if not exists player_game_idx    on casino.player (game_id);
create index if not exists bet_wine_idx       on casino.bet (wine_id);

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
grant select on casino.round_state, casino.player to anon, authenticated;
grant all on all tables in schema casino to service_role;

-- Realtime ------------------------------------------------------------------
alter publication supabase_realtime add table casino.round_state;
alter publication supabase_realtime add table casino.player;
