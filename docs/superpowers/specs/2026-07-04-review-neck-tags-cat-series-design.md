# Neck-tag → Google Review — Cat Series Experiment

**Date:** 2026-07-04
**Status:** Design approved, ready for implementation plan
**Owner:** Pavel

## Problem

We want more Google Maps reviews. The lever: bottle-neck hangtags (like the GranMonte
neck-ringer in `.inbox/photo_2026-07-04 23.34.59.jpeg`) that ask the buyer to leave a review.
We don't know which creative works, so we run a **weekly A/B experiment** to find a
**stable, repeatably-winning creative**, and Chip & Dale (the staff Telegram bot) measures
new reviews and conversion.

Secondary goal: the creative should be **shareable enough to go viral on socials**. The
heroes are the store's **two real cats** (one black, one grey), so every weekly tag is
also a ready-made Instagram/Facebook post.

## Goals

- Find a neck-tag creative that reliably lifts Google review rate.
- Build a lightweight, automated measurement loop (no manual review counting).
- Produce a printable pilot tag and a repeatable pipeline for the weekly rotation.
- Generate social-ready content as a by-product of each week's tag.

## Non-goals

- No per-scan attribution / QR funnel tracking (scans → reviews). Decided out of scope
  for now — we measure only the weekly review delta. Can be added later.
- No statistical-significance claims. Review volume is low (units per week); single-week
  results are **screening**, not proof (see Measurement caveat).
- No incentivized reviews. Offering rewards for reviews violates Google policy; tags ask,
  they don't bribe.

---

## The heroes: two cats

The store has two real cats — one **black**, one **grey** — and a stock of photos the
owner will supply. They become the recurring heroes of the tag series, giving the campaign
built-in brand consistency and a shareable character.

**Working names (owner to confirm):** grey = **Chip**, black = **Dale** — tying the cats to
the existing **Chip & Dale** staff bot so tag, bot, and store lore share one story. Until
confirmed, the spec refers to "the grey cat" / "the black cat."

The cats are a **double act**: recurring duo dynamic (calm grey vs. dramatic black) that we
mine for different message angles across weeks.

---

## Architecture

Four isolated units. Each has one job and a clear interface.

### A. Review snapshot collector (`03_automation/sync-review-snapshot.ts`)

A weekly job (GitHub Action, same pattern as `sync-daily-revenue.yml`) that:

1. Calls **Google Places API (New) → Place Details** for the store's `place_id`, reading
   `userRatingCount` and `rating`. (Plain API key, no OAuth — simplest reliable source of
   the total rating count. We are **not** using Business Profile API: it needs OAuth + is
   access-gated, and we don't need per-review text.)
2. Calls **Loyverse** for the count of receipts in the prior 7 days (the bot already has a
   Loyverse client; reuse `@ww/shared` if it exposes receipt counts, else a direct call).
3. Writes one row to Supabase `review_experiment_snapshots` and computes the delta vs. the
   previous snapshot.

**Schedule:** weekly, Monday 00:05 Bangkok (matches the weekly experiment boundary), plus
`workflow_dispatch` for manual runs.

**Interface out:** a `review_experiment_snapshots` row.

### B. Week → concept config (Supabase `review_experiment_weeks`)

Records which creative ran which week, so a review delta can be attributed to a concept.

- Set by a bot command: `/exp set <concept-slug>` marks the concept active for the current
  week; `/exp weeks` lists history.
- Fields: `week_start`, `week_end`, `concept_slug`, `note`.

### C. Reporting (bot `/reviews`)

`/reviews` returns a leaderboard: per concept → weeks run, avg Δreviews, avg conversion,
best/worst week. The bot reads this from a **mission-control endpoint**
(`GET /api/public/review-experiment`), consistent with how it already pulls payables-alerts
(the bot stays off direct DB/Sheets access except the Expenses sheet).

The weekly briefing gains one line: "Reviews this week: +N (conv X%), concept: <name>".

### D. Creative pilot tag (`05_creative/output/2026-07-04_neck-tags-review/`)

One fully-produced neck-tag for the pilot concept, following the creative-file pipeline
(HTML source + `_preview.png`, committed so Railway/social tooling can see it):

- Form factor: neck-ring hangtag (hole for the bottle neck) like the GranMonte reference.
- Front: hero cat photo + witty English headline + CTA + **QR code** that opens the Google
  **write-a-review** flow directly: `https://search.google.com/local/writereview?placeid=<PLACE_ID>`.
- **W&W logo prominent** per brand guidance.
- Export: single-page print-ready PDF sized to the tag (per the single-page-PDF preference).
- Social by-product: the same hero art adapted to IG/FB sizes via the `resize`/`social`
  skills (separate deliverable, same week).

### Data flow

```
Weekly cron ─┬─ Google Places (userRatingCount) ─┐
             └─ Loyverse (receipts, 7d) ──────────┼─▶ Supabase review_experiment_snapshots
                                                   │
Bot /exp set <concept> ───────────────────────────┴─▶ Supabase review_experiment_weeks
                                                          │
mission-control GET /api/public/review-experiment ◀───────┘
             │
Bot /reviews + weekly briefing ◀──────────────────────────
```

---

## Data model (migration 031)

```sql
-- 031_review_experiment.sql  (applied manually in Supabase SQL Editor)

create table review_experiment_snapshots (
  id            bigint generated always as identity primary key,
  taken_at      timestamptz not null default now(),
  week_start    date not null,                 -- Monday of the measured week
  rating_count  integer not null,              -- Google userRatingCount (cumulative)
  rating_avg    numeric(2,1),                  -- Google average rating
  delta_reviews integer,                        -- vs previous snapshot
  receipts      integer,                        -- Loyverse receipts in the week
  conversion    numeric(6,4),                   -- delta_reviews / receipts
  concept_slug  text,                           -- resolved from review_experiment_weeks
  unique (week_start)
);

create table review_experiment_weeks (
  week_start    date primary key,
  week_end      date not null,
  concept_slug  text not null,
  note          text
);
```

**Conversion** = `delta_reviews / receipts` for the week. Denominator is receipt count
(per-buyer), decided over per-bottle and per-tag-handed-out.

---

## Experiment protocol

- **Week 0 — baseline:** no tag (or a neutral tag). Establishes the natural review rate.
- **Pilot week:** the first cat concept, produced end-to-end, to shake out design + QR +
  print + measurement before scaling the rotation.
- **Phase 1 — screening:** one concept per week; rank by conversion.
- **Phase 2 — confirmation:** re-run the top 2–3 concepts on non-adjacent weeks to filter
  out luck.
- **Held constant:** tag size, QR placement, W&W branding, English copy. Only the message /
  cat scenario varies — we test **psychological levers**, not just pictures.

**Measurement caveat (stated honestly):** at units-of-reviews-per-week, one week is noisy —
4 vs. 1 can be chance. Early weeks are directional screening; Phase 2 re-runs are what let
us call a winner. We will not report significance we don't have.

---

## Pilot concept

**#1 "The Waiting Cat"** — a hero cat staring into the camera. Headline draft:
*"I've been waiting. One review is all I ask."* Lever: cuteness + mild guilt. Low-risk,
friendly, on-brand first outing, and it seeds the cat-mascot story.

## Cat-series rotation (10 episodes, English, each a distinct lever + a ready social post)

| # | Episode | Hero | Lever | Headline (draft) |
|---|---------|------|-------|------------------|
| 1 | The Waiting Cat | either | cuteness/guilt | "I've been waiting. One review is all I ask." |
| 2 | The Judgy Cat | grey | cheek | "5 stars — or I judge you. Forever." |
| 3 | Noir Detective | black | narrative | "Case #12: great wine, no review. Suspicious." |
| 4 | Reverse Psychology | either | contrarian | "Don't review us. We're already too popular. — the cat" |
| 5 | Good Cat / Bad Cat | both | duo | "One of us wants your review. The other wants your soul." |
| 6 | Progress Bar | both | social proof | "3 reviews from 50. Do it for the cats." |
| 7 | The Sleeping Cat | black | guilt | "He wakes up happy if you review. Don't wake him angry." |
| 8 | Alien Cats | both | absurd | "The cats contacted their home planet. They demand 5 stars." |
| 9 | Fortune Cat | grey | mystic | "The cat sees a review in your future." |
| 10 | Deadpan Luxury | either | elegance | "A discerning cat. A discerning wine. A review, please." |

Rotation order and which cat stars each week are flexible; the table is the idea bank.

---

## Setup / configuration tails

- **Env / secrets** (add to `config/secrets.example.env`, set on GitHub + Railway as needed):
  - `GOOGLE_PLACES_API_KEY` — Places API (New) key.
  - `WW_GOOGLE_PLACE_ID` — the store's Google place_id (one-time lookup via Find Place or
    the Maps share URL).
- **Migration 031** applied manually in Supabase SQL Editor (per repo convention — I write
  the SQL, owner runs it).
- **Cat photos + names** supplied by owner; confirm working names Chip (grey) / Dale (black).
- **QR target** verified to open the write-review flow on both iOS and Android before print.

## Testing

- Snapshot collector: unit-test the delta math and conversion (previous count → new count →
  delta, receipts → conversion) with fixture snapshots; test zero-receipts guard (no
  divide-by-zero) and first-run (no previous snapshot → delta null).
- Places API call: test parsing of a recorded Place Details response for `userRatingCount` /
  `rating`.
- Bot `/reviews`: test the leaderboard aggregation from fixture rows.
- Manual: scan the printed pilot QR on iOS + Android, confirm it lands on the review form.

## Open questions for the owner

1. Confirm cat names (Chip = grey, Dale = black?) or provide the real ones.
2. Any real-world constraint on print (who prints the tags, quantity per week)?
3. Baseline week 0 with no tag, or start straight on the pilot and treat pre-experiment
   history as baseline?
