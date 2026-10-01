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
| `/login` → `/admin` | game setup, behind `CASINO_ADMIN_PASSWORD` |

## Running an evening

1. `/login` → `/admin` → **New game** → set difficulty, round length, chips.
2. Add 5–8 wines. The inventory search (`inventory.v_sku_breakdown`) fills
   country, grape and colour; region and vintage are always typed in by hand —
   that view doesn't carry them. Edit or rewrite the generated hints if you
   want.
3. Open `/screen/<pin>` on the TV and `/host?t=…` on your phone.
4. Host → **Open lobby**. Guests scan the QR.
5. Pour wine #1 blind → **Start round** → hints appear on schedule → **Close
   bets** → **Reveal** → talk about the wine → **Next wine**.

**Keep the host panel open.** It posts a tick every two seconds and that tick is
what reveals hints. Closing it does not break the game — the countdown itself
is computed locally on each phone — but hints stop appearing until the host
panel is reopened.

## Local development

```bash
cp .env.example .env.local   # fill in from Railway
npm install
npm run dev                  # http://localhost:3009
npm test
```

## Rules that look arbitrary and are not

- **A blind guess must never pay — but only categories with a button count to
  protect.** Every `choice` category's button count is `>=` its payout
  multiplier — betting `A` chips on a uniform guess across `n` buttons returns
  `A*(m-n)/n`, so `m > n` makes ignorance profitable. That's why Vintage widened
  to 16 buttons at x16, not fewer. `lib/options.ts` states the invariant and a
  test in `options.test.ts` enforces it for every `choice` category — retuning
  the numbers without re-checking the test will break the game economically,
  not just cosmetically. Country and region are `open` (free text against the
  dictionaries in `lib/wine-data.ts`, see `lib/bets.ts`) and sit outside this
  invariant entirely: there is no board to make small, and a dictionary of
  dozens of entries is unprofitable to blind-guess against almost by
  construction. They used to be `choice` categories with a board, and the
  region board was the reason they changed — it was always built from the
  wine's own true country's regions, so a guest who recognised even one region
  name won Country for free. A real game had country options
  Греция/Грузия/Германия/Болгария/Португалия/Молдавия next to a region board
  that was all eight Moldovan regions.
- **Hints are free information, so the expensive categories don't get them
  first.** `lib/hints.ts`'s generator list runs cheapest-category-first, with
  vintage last on purpose: a ±1 year hint cuts a sixteen-button board to three,
  which made "ignore the wine, wait for the year hint, shove everything" the
  best strategy when it was tried earlier.
- **Questions we can't ask fairly are not asked.** A grape outside our pool on
  a bottle with no recorded colour gets no colour hint (a hardcoded fallback
  once called Kisi, a Georgian amber grape, red) — and, for the same reason,
  its decoy pool on the betting board falls back to the correct grape's own
  group before ever widening to every grape we know (a colourless Sauvignon
  Blanc used to get five red decoys and one white option). An unrecognised
  country gets no Old/New World category. A wine from the current vintage year
  gets no vintage category at all, because the option window can only be built
  one legal way and the answer would always be the last button — a free x16.
- **Style is a fact, not a bet.** `WineFacts.style` and `STYLE_OPTIONS` still
  exist — the admin form still records it and the reveal still shows it — but
  it is no longer in `DEFAULT_CATEGORIES`. `'style'` survives as a
  `CategoryKey` and `buildOptions` still knows how to build its board, purely
  so a game created before this change keeps settling the way it always did
  (see "games already created" below).
- **A busted guest is staked 10 chips** (`rescue_chips`, editable per game),
  and the phone says so ("Казино дарит вам фишки на следующий кон" / "The house
  stakes you for the next round"). Without that message the balance jumps from
  zero to ten with no explanation, and in a game about chips that reads as a
  miscount.
- **The host panel is the clock.** It posts a tick to `/api/host/tick` every
  two seconds, and that tick is what reveals hints. Closing the host panel does
  not break the round — the countdown itself is local to each phone — but
  hints stop appearing until the host panel is reopened.
- **Bets autosave every tap**, and the phone always sends the whole slip to
  `/api/bet` (server-side `replaceBets`, not an increment). A dropped request
  or a dead phone battery can't silently lose a guest's stake, because there's
  nothing to lose in transit — the next successful save just re-sends the
  current full slip.

## Notes

- Same Supabase project as mission-control and kiosk, schema `casino`. It must
  be listed under **Settings → API → Exposed schemas**.
- Migration `047_wine_casino.sql` lives in
  `02_services/mission-control/supabase/migrations/` — one numbered sequence for
  the whole project, shared across all services — and is applied by hand in the
  Supabase SQL Editor.
- Correct answers never reach a phone: they live in `casino.game_wine`, which
  anon cannot read, and payouts are computed server-side.
- Realtime is `postgres_changes` on `casino.round_state` and `casino.player`;
  when the socket doesn't reach `SUBSCRIBED` (corporate wifi, a captive portal,
  a sleeping tab), the guest screen falls back to polling `/api/state` every
  3 seconds, which also keeps hints ticking.

## Manual smoke test

Not run as part of this task — it needs a real Supabase database, real phones
and a real TV. Do this once the migration is applied and `.env.local` is filled
in:

1. Create a game in `/admin`, add three wines with full facts.
2. Open `/screen/<pin>` in one window and `/host?t=…` in another.
3. Open `/` in two more windows (use a private window for the second so they
   get separate localStorage) and join with two different names.
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

## Deploying

1. Apply `047_wine_casino.sql` in the Supabase SQL Editor.
2. Add `casino` to **Settings → API → Exposed schemas**.
3. Create the Railway service pointing at `02_services/wine-casino`, and set
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CASINO_ADMIN_PASSWORD`, `CASINO_SECRET`,
   `NEXT_PUBLIC_CASINO_URL`.
