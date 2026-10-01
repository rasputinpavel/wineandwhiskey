# Trendwatch — daily digest of viral wine reels

**Date:** 2026-10-01
**Status:** Design approved, ready for implementation plan
**Origin:** "Раздел trendwatch не работает — странно себя ведёт." The investigation found two
unrelated faults (a hijacked domain in the portal registry, and a daily sync that has been
failing in CI since the day it was created) and one unclaimed asset (55 vetted wine accounts
sitting unused in a database JSON column).

## 1. Goal

Revive trend monitoring in the narrowest form that serves the actual need: **a daily Telegram
digest of wine reels that went viral relative to their own account**, so the store can film its
own version of what works. Monitoring only — no web UI, no AI video generation.

The trendwatch service's remaining capabilities (Claude frame-by-frame analysis, brief
generation, Runway image-to-video) stay in the repo, unused and undeployed.

## 2. What was actually broken

Recorded here because three of these facts are invisible from the code alone:

1. **The daily sync fails every morning and reports success.** `sync-trends.yml` is green, but
   its log says `Apify start failed: {"error":{"type":"token-not-provided"}}`. `APIFY_TOKEN` was
   never added to GitHub secrets — only `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` exist.
   `sync_trends.ts` catches per-account errors, prints `✗ Failed`, then finishes with
   `✅ Done. New reels: 0` and exit code 0. Collection has therefore never run in CI; the 30
   reels in `trend_reels` all came from a local run on 2026-05-02.
2. **There is nothing to watch.** `trend_accounts` holds exactly one row —
   `ingvildtennfjord`, admitted with `verdict: maybe` and `category: other`. Even with a working
   token the digest would be empty.
3. **The harvest is stranded.** A full discovery run on 2026-05-27 (14 hashtags) succeeded and
   produced 55 scored candidates, 29 of them `keep`, including real wine retailers with
   millions of views. They are still inside `discover_jobs.candidates` as JSON: promoting a
   candidate to `trend_accounts` is a button in the web UI, and the UI was never deployed.
4. **The portal tile pointed at a stranger's app.** `trendwatch-production.up.railway.app` was
   never our deployment; it now serves an unrelated project ("RILT Index", FastAPI). Fixed
   separately on 2026-09-28 — the tile is parked (`status: 'planned'`, builtin placeholder) and
   `mission-control/lib/registry.test.ts` guards against a repeat.

## 3. Scope

**In:** the signal definition, the digest itself, loud failures, a CLI for the watchlist, a
fresh discovery scan to populate it, the missing GitHub secrets, tests for the pure logic.

**Out:** deploying the trendwatch UI, Runway video generation, Claude reel analysis, reviving
the portal tile, hashtag-based daily scanning (considered and rejected — see §11).

## 4. Data flow

Daily at 09:00 Bangkok, `sync-trends.yml` runs `npm run trends`:

1. Load accounts from `trend_accounts` where `is_active = true`.
2. For each, call Apify `apify~instagram-scraper` with
   `directUrls: ['https://www.instagram.com/<username>/reels/']`, `resultsType: 'reels'` and
   **`resultsLimit: 10`** (down from 30 — a daily run only needs recent posts, and the actor
   bills per result). Keep posts where `videoPlayCount != null`.

   **Corrected 2026-10-01, after the first dry run returned zero reels for a live account.**
   This spec originally carried forward the script's existing `usernames` +
   `resultsType: 'posts'` input, filtered by `type === 'Video'`. That pattern is known-broken:
   `02_services/trendwatch/lib/apify.ts:75` fixed it months ago and says why — "the older
   `usernames + resultsType=posts` filter often returned zero videos" — but the fix only ever
   landed inside the undeployed service, never in the script the Action runs. So the daily job
   would have collected nothing even with a working token: a second silent failure stacked on
   the first.
3. Keep posts that clear the threshold (§5).
4. Insert the ones not already present by `instagram_id` into `trend_reels`.
5. Of those, notify the ones published within `NOTIFY_MAX_AGE_DAYS` (§5).
6. Barrymore sends the digest (§6). Nothing new → no message, as today.

Nothing else reads these tables; the digest is the only consumer.

## 5. Signal: what counts as "залетело"

```
isHit(views, followers) = views >= 5 * followers AND views >= 50_000
```

- `VIEWS_MULTIPLE = 5`, `VIEWS_FLOOR = 50_000`, **AND**, replacing today's
  `≥15_000 OR ≥1.5×` (which is OR and would flood the digest with the routine output of
  large accounts).
- Rationale for the relative half: an outlier against the account's own baseline is what can
  be copied. The discovery data makes the case — `fabiopicchiquintovizio` has 4,015 followers
  and a 611K-view reel (152×); that reel's format works on its own merits, not on reach.
- Rationale for the floor: a 300-follower account hitting 3,000 views is 10× and still noise.
- `NOTIFY_MAX_AGE_DAYS = 14`. Everything above threshold is **stored**; only reels published
  within 14 days are **notified**. Without this, activating ten accounts dumps each one's
  entire back catalogue of hits into the chat on day one.

**Known drift:** the multiple is computed from `trend_accounts.followers_count`, which is
written when an account is added and only changes when somebody refreshes it. Between refreshes
the number ages, and a **growing** account's multiple reads high — so routine posts start
clearing a threshold they should not. This is not hypothetical: `bodegagoulart_oficial` grew 49%
in four months (15,425 → 22,989).

Refreshing is `npm run trends:accounts -- --refresh <username…>`, which re-reads the profile.
It is a manual act on purpose: the alternative is a profile scrape per account per day, which
roughly doubles the bill for a metric that only needs to be approximately right. Note this used
to be the monthly discovery run's job — that run is no longer usable (§8), which is why the CLI
has the command.

## 6. Digest shape

Russian, HTML parse mode, to `BARRYMORE_OWNER_CHAT_ID ?? BARRYMORE_CHAT_ID`.

One header message, counting the **notified** reels (§5), not everything stored:

```
📈 Залетело за сутки: 3
```

Then the **top 5 by multiple**, each as its own `sendPhoto` with the reel's thumbnail:

```
@fabiopicchiquintovizio · 611K просмотров · 152× от своей нормы
0:42 · 12 апреля
«Questo vino costa 8 euro e batte…»
смотреть рилс →
```

- The thumbnail is **downloaded and uploaded as multipart**, not passed as a URL: Instagram CDN
  links are signed and Telegram's fetch gets a 403 often enough to matter.
- If the download or upload fails, that reel is sent as a plain text message instead. One bad
  thumbnail never costs us the digest.
- Caption is truncated to Telegram's 1024-character limit; the quoted caption line is cut to
  one line of the original.
- Beyond the first 5, up to 10 total are listed in one closing text message, one line each.
  Above 10, the closing line says how many were left out.
- All links to the trendwatch service are removed from bot messages, and `TRENDWATCH_URL` is
  dropped from the workflow env — there is no service to link to.

**Quiet days send one line** (decided 2026-10-01, replacing this spec's original "nothing new →
no message"): `🫧 Проверено аккаунтов: N · рилсов просмотрено: M · залётов нет`. Review pointed
out that silence was ambiguous in exactly the way that cost five months — an empty chat meant
either "nothing went viral" or "the job stopped running, the workflow broke, the schedule was
skipped". A per-account failure now reddens the run and sends a notice, but a job that never
starts cannot report anything, and GitHub's scheduled cron does occasionally skip. One line a
day makes the absence of a message meaningful on its own. If the heartbeat itself fails to
deliver, that counts as a failure like any other.

## 7. Watchlist maintenance without a UI

New script `03_automation/trend_accounts_cli.ts`, wired as `npm run trends:accounts`:

| Command | Behaviour |
|---|---|
| `--list` | Table: username, category, followers, median views, multiple, tier, active. Sorted by multiple. |
| `--add <username…>` | Add accounts by hand (own picks, competitors), inactive. **Fetches the profile once** via `apify~instagram-profile-scraper` to fill `followers_count` — without it the multiple is 0 and the account could never produce a digest entry (§5, §10). |
| `--on <username…>` / `--off <username…>` | Flip `is_active`. This is the only switch that affects cost. |

Upserts key on `username` (already unique) and never overwrite `is_active` — so re-running
discovery cannot silently switch accounts on.

## 8. Phase 0 — fresh discovery scan

The May harvest is four months old (`freshness_score` was already 0 for most of it), so the
watchlist is built from a new scan rather than the stored candidates.

**What happened instead: hashtag discovery is dead at the source.** The smoke run
(`npm run discover-accounts -- --hashtags=winestore`) returned **1 reel**, from an unrelated
furniture account. A second probe on `#wine` — one of the largest tags on the platform —
returned **3 reels**. Both against `resultsLimit: 60`, and the code is correct: it uses the same
`directUrls: explore/tags/<tag>` + `resultsType: 'reels'` pattern as the service. Instagram has
simply stopped serving hashtag browse pages to the scraper; the 2026-05-27 run that found 55
candidates from 14 hashtags is not reproducible. **The full 14-hashtag scan was therefore not
run** — it would have cost 40 minutes and Apify credit to return nothing.

Account-level scraping is unaffected (`directUrls: /<username>/reels/` returns a full 10 reels),
so the daily job itself is fine. Only *finding* new accounts is broken.

**So the watchlist is curated by hand**, seeded from the Claude verdicts stored in the
2026-05-27 `discover_jobs.candidates` JSON. That vetting judged content format and
reproducibility, which does not go stale in four months; what *was* stale were the follower
counts, and `npm run trends:accounts -- --add <username>` fetches today's number per account, so
the multiple is computed from fresh data. Two of the chosen handles no longer resolve at all
(`degustandoexperience.it`, `grinsteadsonthevine` — Apify returns an error record, not a
profile), which is itself a reason the May metrics could not have been trusted as-is.

**The pilot, activated 2026-10-01** — ten accounts, weighted toward small ones with large
multiples because their formats are reproducible by a shop, plus a few large accounts as format
teachers: `fabiopicchiquintovizio` (4,016 followers), `aleksandarskorchev` (2,679),
`vinoteca_mendoza` (3,724), `cultwinesintl` (10,728), `bodegagoulart_oficial` (22,989),
`vinhosememe` (23,744), `melindacomelamela` (38,208), `lucialoveswine` (124,193),
`bernabei.it` (153,927), `laregoladelpiatto` (219,202). One inactive row remains from before
(`ingvildtennfjord`, admitted by mistake in May, switched off).

Follower refresh now has no automated path: re-running discovery cannot update these numbers,
so the multiple drifts as accounts grow. `bodegagoulart_oficial` grew 49% in four months
(15,425 → 22,989), which on the stale number would have inflated its multiple by half. Until
there is a better route, refreshing means re-reading a profile by hand.

**Budget.** Apify is on STARTER: $29/month of included credit. The actor is pay-per-event and
its per-result price is not exposed through the API, so the spend is measured, not predicted:
after the first week of daily runs, read actual usage in the Apify Console before widening the
watchlist past 10 accounts. `resultsLimit: 10` (§4) is the main lever if it runs hot.

## 9. Failing loudly

The current script's silence is the reason this went unnoticed for five months.

- **Fail fast** on a missing `APIFY_TOKEN`, `SUPABASE_URL` or `SUPABASE_SERVICE_KEY` — before
  the account loop, with a message naming the variable.
- **Per-account failures** are collected, not swallowed: the digest goes out first for the
  accounts that worked, and only then does the run end with `exit(1)` listing what failed —
  a non-zero exit must never cost us a digest we already assembled. The Action turns
  red.
- **Barrymore reports the failure too** (`⚠️ Синк трендов упал: 3 из 10 аккаунтов`), because a
  red Action in a repo nobody watches is not a notification.
- **Secrets to add to GitHub:** `APIFY_TOKEN`, `BARRYMORE_BOT_TOKEN`, `BARRYMORE_CHAT_ID`.
  Values exist in the local `.env.local`; they can be set with `gh secret set` reading from the
  file, which keeps them out of the terminal log.

## 10. Code layout and tests

Pure logic moves into `03_automation/lib/trends.ts`:

- `multiple(views, followers)` — views over followers, 0 when followers is 0 or missing.
- `isHit(views, followers)` — the §5 threshold.
- `isFreshForDigest(publishedAt, now)` — the 14-day notify window.
- `pickDigestReels(hits)` — sort by multiple descending, return `{ photos, listed, omitted }`:
  the first 5 as photos, the next 5 as list lines (10 notified at most), and a count of the rest.
- `formatReelCaption(reel, account)` — the §6 caption, including truncation.

`sync_trends.ts` keeps only the network and database work and calls into that module.

The repo root has no test setup at all, so this adds one: `vitest` as a root devDependency, a
`vitest.config.ts` with `include: ['03_automation/**/*.test.ts']`, and `"test": "vitest run"`
in the root `package.json`. (mission-control already has its own vitest; this is the first
coverage for `03_automation/`.)

Test cases to cover:

- A reel at exactly 5× and exactly 50,000 is a hit; 4.9× or 49,999 is not.
- A 300-follower account at 10× does not clear the floor.
- Followers 0 or null never produces a hit (no division by zero, no infinite multiple).
- A reel published 15 days ago is stored but not notified; 13 days ago is notified.
- `pickDigestReels` on 12 hits returns 5 photos, 5 list lines, and a remainder count of 2.
- A caption longer than 1024 characters is truncated and still ends with the link.

Apify, Telegram and Supabase calls stay thin wrappers and are not tested.

## 11. Considered and rejected

- **Daily hashtag scanning instead of a watchlist.** Would catch viral wine reels from any
  author and never go stale, but the "×above its own norm" metric needs the author's follower
  count, which means a profile scrape per author per day. More cost, more noise (ads, off-topic
  posts). This was written expecting the monthly discovery run to keep the list fresh; that run
  turned out to be dead (§8), so hashtag scanning is not an alternative we rejected — it is one
  that is no longer available in either shape.
- **Moving the job into the Barrymore bot on Railway.** The bot already holds the secrets and
  could offer an on-demand `/trends`. Rejected for now: a GitHub Action's log is easier to
  debug than a Node cron inside a long-running bot, and the Action already exists.
- **A one-line Claude "why it worked" per reel in the digest.** Without video frames it is a
  guess from the caption and thumbnail, and often generic. The facts (multiple, views, length,
  caption) are verifiable and enough to decide what to open. Revisit if the digest proves
  useful and the guess proves good.

## 12. Future

- If the fresh scan comes back thin, the 2026-05-27 harvest is still intact in
  `discover_jobs.candidates` (55 candidates, 29 `keep`) and a small importer can lift it into
  `trend_accounts`. Deliberately not built now — the fresh scan is expected to replace it.
- A whisky/spirits hashtag cluster (`#whisky #singlemalt #spirits`) as a separate scan — the
  store is Wine **& Whiskey**, but this round is deliberately wine-only.
- The portal tile stays parked until there is a reason to deploy the UI; if it is ever deployed,
  `registry.ts` must point at the real Railway host and the digest can link into it again.
