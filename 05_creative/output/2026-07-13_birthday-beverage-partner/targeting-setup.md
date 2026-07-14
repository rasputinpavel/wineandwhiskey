# Meta Ads Manager — Targeting & Setup Walkthrough

**Campaign:** Birthday Beverage-Partner (Wave-1, RU + EN)
**Date:** 2026-07-13
**Objective:** Click-to-WhatsApp message generation, not a storefront sale.
**Read first:** `campaign-brief.md` (positioning + legal guardrails), `copy-deck.md`
(paste-in text), `whatsapp-funnel.md` (links + greeting), `creative-tracker.csv`
(per-`creative_id` stats sheet you'll be filling from exported Meta data).

Follow the steps in order. Each step says *what* to click and, where it isn't
obvious, *why*.

---

## 1. Create the two campaigns

Meta Ads Manager → **Create** → new campaign, twice:

1. **`BD | EN`**
2. **`BD | RU`**

For both:

- **Objective:** Engagement
- **Conversion location / goal:** Messages
- **Message destination:** WhatsApp
- **Campaign Budget Optimization (CBO):** **OFF**

> **Why CBO off:** CBO lets Meta shift spend between ad sets automatically. We
> deliberately have two ad sets per campaign with *different* targeting logic
> (A1 = birthday-precise, A2 = broad planners) and we want clean, comparable
> per-audience stats — CPL for A1 vs A2 — to know which targeting actually
> works. With CBO on, Meta could starve one ad set before it has enough data
> and we'd never learn the answer. Budget is set per ad set instead (Step 2/3).

- Do **not** enable Advantage+ campaign budget.
- Leave the special ad category selector for later — see Step 5 for the
  alcohol-policy flag, which lives at the ad-set/ad level, not here.

---

## 2. Ad set A1 — "Birthday-precise" (one per campaign)

Inside each campaign, create ad set **A1**:

- **Location:** Phuket (radius or region targeting — not all of Thailand)
- **Age:** 20+ (Thailand's legal drinking age; raise to 25+ if you want a
  tighter, higher-intent audience — see brief §2)
- **Detailed targeting:** Behaviors → **Upcoming birthday**
- **Placements:** Advantage+ / Automatic is fine (feed + story both draw from
  the same creative set — see the mapping table in Step 5)
- **Messaging app:** connect your **WhatsApp Business** account/number
  (+66 080 902 0550) as the message destination
- **Budget:** ฿300–500/day (owner sets exact number at launch — not fixed
  here, see brief §4)
- **Alcohol-policy flag:** ON (Step 5 covers exactly where this prompt appears)

> **Caveat — read before you expect this to be a "birthday next month"
> audience:** Meta has **no** native "upcoming birthday in the next 30 days"
> option. "Upcoming birthday" as a Behavior targets people whose birthday is
> roughly **within the next ~1 week**. That's a genuinely hot, high-intent
> pocket of people — worth its own ad set and budget — but it is *not* how
> we reach someone who's planning a month out. That month-ahead reach comes
> from the **creative itself** ("Birthday coming up? Start planning now"),
> served to the broader A2 audience below, not from a targeting setting.
> Don't be surprised A1's audience size is small; that's expected.

---

## 3. Ad set A2 — "Planners / broad" (one per campaign)

Same campaign, second ad set:

- **Location:** Phuket (same as A1)
- **Age:** 20+ (same as A1 — keep age consistent across A1/A2 so it isn't a
  confound when you compare their CPL)
- **Detailed targeting:** none — leave broad. Do **not** set the "Upcoming
  birthday" behavior here; that's what separates A2 from A1.
- **Messaging app:** WhatsApp Business, same number as A1
- **Budget:** ฿300–500/day
- **Alcohol-policy flag:** ON

> **Why a broad ad set at all:** A1's audience is small and time-boxed (the
> ~1-week window above). A2 is where the "start planning now" creative
> angle does its real job — reaching people before Meta's birthday signal
> would ever fire. Comparing A1 vs A2 CPL after the 7–14 day learning phase
> tells you whether the precise-but-narrow or broad-but-early audience is
> more efficient — that's the point of keeping them as separate ad sets
> instead of merging them.

---

## 4. Match language to campaign

| Campaign | Creative language | Copy language | Ad-set language (optional) |
|---|---|---|---|
| `BD \| EN` | `*_en_*` PNGs/MP4s | EN rows in `copy-deck.md` | English |
| `BD \| RU` | `*_ru_*` PNGs/MP4s | RU rows in `copy-deck.md` | Russian |

Do not mix — no RU creative/copy inside `BD | EN` or vice versa. Optionally
set the ad-set-level "Languages" targeting field to match (English / Russian)
so Meta biases delivery toward people whose device/profile language agrees
with the ad's language; not required, but reduces wasted impressions.

Thai and Chinese are documented for Wave-2 only — **do not launch them now**
(brief §2, §6: Thai + alcohol carries the highest legal risk and needs
separate review).

---

## 5. Build the ads

Inside each ad set, create one ad **per creative** (not one ad with multiple
images — we want per-creative stats, see Step 6).

For each ad:

1. **Format:** Single image or single video (not carousel).
2. **Media:** upload the matching `bd_*` file for this campaign's language —
   see the mapping table below.
3. **Primary text / Headline / CTA text:** copy verbatim from `copy-deck.md`
   for that angle + language. Don't paraphrase — the copy already passed the
   legal check and the Meta character-limit check (headline ≤ 40, primary
   ≤ 125).
4. **CTA button:** **Send Message**
5. **Destination:** WhatsApp, click-to-chat link from `whatsapp-funnel.md`
   (EN link on `BD | EN` ads, RU link on `BD | RU` ads — same 5-item
   pre-filled greeting either way).
6. **Alcohol / special-ad-category flag:** Meta will prompt for this because
   the creative/copy relates to alcohol-adjacent content. Set it to **On /
   Alcohol**, confirm the age restriction shows **20+** on the ad preview.
   This is separate from (and in addition to) the age targeting in Step
   2/3 — the targeting age and the policy flag are two different settings
   and Meta checks both.

### Creative → campaign/ad-set mapping

Every creative from Task 5 goes into **both** A1 and A2 of its matching
language campaign (same ad, same targeting split — A1 and A2 just change the
audience, not the creative set). Angle `bulk` and `brief` are static-only;
`curate` and `delivered` also have an animated story variant.

| creative_id (file stem) | Angle | Lang | Format | File | Placement | Campaign |
|---|---|---|---|---|---|---|
| `bd_curate_en_sq_v01` | curate | EN | 1080×1080 feed | `.png` | Feed | `BD \| EN` |
| `bd_curate_en_st_v01` | curate | EN | 1080×1920 story | `.png` | Story/Reels | `BD \| EN` |
| `bd_curate_en_st_v01` (animated) | curate | EN | 1080×1920 story | `.mp4` | Story/Reels | `BD \| EN` |
| `bd_curate_ru_sq_v01` | curate | RU | 1080×1080 feed | `.png` | Feed | `BD \| RU` |
| `bd_curate_ru_st_v01` | curate | RU | 1080×1920 story | `.png` | Story/Reels | `BD \| RU` |
| `bd_curate_ru_st_v01` (animated) | curate | RU | 1080×1920 story | `.mp4` | Story/Reels | `BD \| RU` |
| `bd_brief_en_sq_v01` | brief | EN | feed | `.png` | Feed | `BD \| EN` |
| `bd_brief_en_st_v01` | brief | EN | story | `.png` | Story/Reels | `BD \| EN` |
| `bd_brief_ru_sq_v01` | brief | RU | feed | `.png` | Feed | `BD \| RU` |
| `bd_brief_ru_st_v01` | brief | RU | story | `.png` | Story/Reels | `BD \| RU` |
| `bd_bulk_en_sq_v01` | bulk | EN | feed | `.png` | Feed | `BD \| EN` |
| `bd_bulk_en_st_v01` | bulk | EN | story | `.png` | Story/Reels | `BD \| EN` |
| `bd_bulk_ru_sq_v01` | bulk | RU | feed | `.png` | Feed | `BD \| RU` |
| `bd_bulk_ru_st_v01` | bulk | RU | story | `.png` | Story/Reels | `BD \| RU` |
| `bd_delivered_en_sq_v01` | delivered | EN | feed | `.png` | Feed | `BD \| EN` |
| `bd_delivered_en_st_v01` | delivered | EN | story | `.png` | Story/Reels | `BD \| EN` |
| `bd_delivered_en_st_v01` (animated) | delivered | EN | story | `.mp4` | Story/Reels | `BD \| EN` |
| `bd_delivered_ru_sq_v01` | delivered | RU | feed | `.png` | Feed | `BD \| RU` |
| `bd_delivered_ru_st_v01` | delivered | RU | story | `.png` | Story/Reels | `BD \| RU` |
| `bd_delivered_ru_st_v01` (animated) | delivered | RU | story | `.mp4` | Story/Reels | `BD \| RU` |

That's 16 static PNGs (4 angles × 2 langs × 2 formats) + 4 MP4s (curate +
delivered, 2 langs each) = 20 ads per campaign × 2 campaigns = 40 ads total
across the two A1/A2 ad sets — 20 ads live under each campaign, duplicated
identically into both its A1 and A2 ad set.

> **Static vs. animated story — name collision, read before uploading:** the
> `curate` and `delivered` MP4s are rendered from the *same slug* as their
> static story PNG (`bd_curate_en_st_v01.png` and `bd_curate_en_st_v01.mp4`
> share one filename stem). If you run both as separate ads in the same ad
> set to A/B test motion vs. static, Meta will let you name two ads
> identically but your own reporting won't be able to tell them apart. Pick
> one approach and stay consistent across all 4 pairs:
> - **Recommended:** run the MP4 *instead of* the static PNG in the story
>   placement for `curate`/`delivered` (replace, don't duplicate) — the feed
>   placement still uses the PNG. This keeps one ad = one creative_id, no
>   collision, matches Step 6 exactly.
> - **If you want the A/B test:** keep both, but suffix the Meta ad name
>   only — `bd_curate_en_st_v01-static` / `bd_curate_en_st_v01-anim` — and
>   add the same suffix to those two rows in `creative-tracker.csv` so
>   exported stats still map back cleanly.

---

## 6. Name every ad exactly its creative_id

In the ad-level **Ad name** field, type the file stem exactly:

```
bd_curate_en_sq_v01
bd_curate_en_st_v01
bd_brief_ru_st_v01
...
```

> **Why this matters:** `creative-tracker.csv` (Task 7) has one row per
> `creative_id`. When you later export ad-level performance from Ads
> Manager (spend, messages, CPL) and paste it into the tracker, the only
> way to join the two without manual guesswork is if the Meta ad name and
> the tracker's `creative_id` column are character-for-character identical.
> Free-text names like "Curate EN Square" will not match and you'll have to
> hand-reconcile 40 rows every time you check performance. Copy-paste the
> filename stem, don't retype it.

Do **not** rename the ad *set* or campaign this way — creative_id naming
applies only at the ad level, one level below where A1/A2 live.

---

## 7. Before-publish checklist

Run through this for **every** ad before hitting Publish:

- [ ] **Age-gate is 20+** — both the ad-set age range (Step 2/3) and the
      alcohol special-ad-category flag (Step 5) show 20+, not the Meta
      default of 18+.
- [ ] **WhatsApp Business is connected** as the message destination on the
      ad set, and the CTA button is **Send Message** (not "Learn More" or
      "Shop Now").
- [ ] **No alcohol brand name appears anywhere** in the ad — headline, sub,
      primary text, or baked into the image. Re-check against brief §2 if in
      doubt.
- [ ] **Image is celebration-led**, not product/bottle-led — cake, party
      setup, delivery moment; no pouring or drinking imagery/verbs.
- [ ] **Ad is named exactly its creative_id** (Step 6) — copy-pasted, not
      retyped.
- [ ] **Copy matches the language of the campaign** (EN copy only in
      `BD | EN`, RU copy only in `BD | RU`) and was copy-pasted from
      `copy-deck.md`, not retyped.
- [ ] **Click-to-WhatsApp link matches the ad's language** (EN link in
      `BD | EN` ads, RU link in `BD | RU` ads — from `whatsapp-funnel.md`).
- [ ] **Budget is set per ad set** (฿300–500/day), CBO confirmed off at the
      campaign level.

Once every ad set (A1 + A2) × campaign (EN + RU) passes this list, launch.
Expect a 7–14 day learning phase before comparing A1 vs A2 CPL (brief §4).
