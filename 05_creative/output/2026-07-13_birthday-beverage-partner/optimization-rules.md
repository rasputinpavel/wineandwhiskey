# Optimization Rules — Birthday Beverage-Partner Campaign

Weekly manual loop for turning `creative-tracker.csv` into pause/scale decisions.

## Format legend

| Code | Meaning |
|------|---------|
| `sq`  | Square 1080×1080, feed placement — **static** |
| `st`  | Story 1080×1920 — **static** |
| `stv` | Story 1080×1920 — **video** (animated, `.mp4`) |

For the two angles that have a video counterpart (`curate`, `delivered`), the
static story ad (`st`) and the video story ad (`stv`) run at the same
angle/lang on purpose — this is a deliberate **static-vs-video A/B**. Compare
their CPL head-to-head each week (e.g. `bd_curate_en_st_v01` vs
`bd_curate_en_stv_v01`) before drawing any conclusion about whether motion
is worth the extra production time on this campaign.

## Target CPL

Set the target CPL at launch, once real spend starts flowing in. Until then,
use this proxy: **a lead = a qualified WhatsApp party-brief conversation** —
all 5 items collected (date, guest count, budget, delivery address, time),
per the lead definition in `whatsapp-funnel.md` (§5). One completed
party-brief = one lead in `creative-tracker.csv`.

Do not hard-code a baht figure here — it depends on week-1 actuals. Record
the agreed target CPL as a note in the CSV or this file once it's set, so
future weeks compare against the same number.

## 3× Kill Rule

If a creative has spent **≥ 3× target CPL with 0 leads**, mark its `status`
as `kill` and pause the ad in Ads Manager. Zero leads at 3x spend is strong
enough evidence that the angle/lang/format combination isn't converting —
don't wait for more data to accumulate.

## Scale Rule

If a creative's CPL is **below the cohort median** (median CPL across all
creatives with ≥1 lead that week) **and it has ≥ 1 lead**, mark its `status`
as `scale` and raise its ad-set budget **+20%**. Do this **no more than once
every 3 days** per ad set — more frequent budget jumps reset the delivery
learning phase and make the next week's comparison noisy.

## Cadence

Once a week:

1. Export ad-level performance from Ads Manager (spend, impressions, clicks,
   leads/results).
2. Match rows into `creative-tracker.csv` by **ad name = `creative_id`**
   (ads are named by creative_id exactly — see `targeting-setup.md` §6, so
   the join is a straight string match, no manual guesswork).
3. Fill in `launch_date` (first date the ad had spend), `spend`,
   `impressions`, `clicks`, `leads`; compute `cpl = spend / leads` (leave
   blank if `leads = 0`).
4. Apply the Kill Rule and Scale Rule above; update `status` accordingly
   (`test` → `kill` / `scale`, or leave as `test` if neither threshold is
   met yet).
5. Read off the `st` vs `stv` pairs for `curate` and `delivered` and note
   which format is winning on CPL so far.

## Wave 2 (later)

- Semi-automate the Ads Manager export → CSV merge (script that reads the
  export file, matches on `creative_id`, and writes the numeric columns —
  removing the manual copy-paste in step 3 above).
- Add rollups: per-angle (curate/brief/bulk/delivered), per-language
  (en/ru), and static-vs-video (`st`+`sq` combined vs `stv`) average CPL,
  so the weekly read doesn't require eyeballing all 20 rows individually.
