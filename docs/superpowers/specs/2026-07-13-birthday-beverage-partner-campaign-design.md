# Birthday Beverage-Partner — Ad Campaign Design

**Date:** 2026-07-13
**Status:** Approved design → implementation plan next
**Owner:** Pavel
**Approach:** A — Lean launch + testing spine (chosen over B "full conveyor" and C "creative blitz")

---

## 1. Goal & positioning

Launch a paid social campaign (Meta — Instagram/Facebook) this week that turns
birthday intent into party-drinks orders for Wine & Whiskey (Phuket).

**Positioning:** *"Your beverage partner for the celebration."* Not a birthday
discount. The offer is a **party sourcing / curation service**: tell us your
budget and format, we curate the most relevant set of beverages (alcoholic **and**
non-alcoholic), and order + deliver them to your celebration. It is light
wholesale — the bigger the order, the better the price.

**Desired action:** a WhatsApp conversation containing the party brief (date,
guests, budget, alcoholic/non-alcoholic preferences). This is a lead-gen / message
campaign, **not** a storefront reservation.

## 2. Legal & platform guardrails (non-negotiable)

Thailand's Alcoholic Beverage Control Act restricts alcohol advertising, and the
offer (sourcing + delivery of drinks) is more sensitive than image ads. Meta's
alcohol policy also applies.

- Lead creative from **celebration, curation and delivery convenience** — never
  from bottles, brands, pouring, or consumption.
- Frame everything as **"beverages, with and without alcohol"** — the legal shield.
- **No** alcohol brand names, **no** pouring/drinking imagery, **no** claims that
  alcohol improves social/sexual/professional success or solves problems.
- **Age-gate 20+** (Thailand legal drinking age); Meta alcohol-policy flag enabled.
  Can raise to 25+ on request.
- Thai-language + alcohol is the highest legal risk → **excluded from Wave-1**,
  revisit later, very limited.

## 3. Campaign architecture (Meta)

- **Objective:** Messages (Click-to-WhatsApp). Drives into a WhatsApp Business
  conversation. (Confirmed channel: **WhatsApp**, not IG Direct.)
- **Structure — split by language so budgets & stats don't mix:**
  - Campaign `BD | RU`
  - Campaign `BD | EN`
  - Each campaign has 2 ad sets:
    - **A1 — Birthday-precise:** Meta *Upcoming birthday* targeting, geo Phuket, 20+.
    - **A2 — Planners / broad:** broad 20+ Phuket, no birthday flag; creative
      self-selects people planning ahead.
- **Platform reality — accept this:** Meta has **no** native "birthday next month"
  targeting; the nearest is *Upcoming birthday (within ~1 week)*. So "a month
  ahead" is reached by **creative**, not targeting ("Birthday coming up? Start
  planning now"), while A1 captures the hot near-birthday segment.
- **Geo:** Phuket.
- **Age:** 20+ (adjustable to 25+).
- **Budget:** test scaffold ≈ ฿300–500/day per active ad set, 7–14 day learning.
  Exact number is a launch-time parameter set by owner.
- **Languages Wave-1:** RU + EN. Chinese and Thai documented as **Wave-2** segments,
  not launched now.

## 4. Message angles (what we test)

Four angles, each its own creative line:

1. **Curate** — "Planning your birthday? We're your beverage partner." (curation / convenience)
2. **Your brief** — "Tell us your budget & vibe — we build the drinks list." (personalization)
3. **Bulk value** — "The bigger the party, the better the price." (light wholesale)
4. **Delivered** — "Ordered, brought, delivered to your celebration." (logistics / care)

All in the "beverages with and without alcohol" frame, no alcohol brands, no
pouring/consumption, led from the celebration.

## 5. Creative production (the conveyor)

- **Formats Wave-1:** square 1080×1080 (feed) + vertical 1080×1920 (Stories/Reels).
- **Static:** brand HTML→PNG pipeline (same as `2026-07-13_event-curation-social`),
  W&W design system (Wine Red `#8C1C1C` / Deep Black `#1A1A1A` / Warm White
  `#F5F0EB`, W&W monogram, Bebas Neue, light + travertine + hands-no-faces per
  approved visual direction).
- **Animation:** 1–2 angles animated HTML→mp4 (ken-burns / reveal), like the prior story.
- **Wave-1 batch:** 4 angles × 2 languages × 2 formats = **16 static units**, of
  which 2–4 are animated. **Runway AI video = Wave-2** (needs `RUNWAY_API_TOKEN`).
- **Location:** `05_creative/output/2026-07-13_birthday-beverage-partner/`
  (per creative-file convention: assets + `_preview.png`, committed to git so
  Railway/preview sees them).

## 6. Copy deck

- Per angle: primary text + headline + CTA, in RU and EN, validated against Meta
  character limits.
- **CTA:** "Message us" / "Напишите нам" → into WhatsApp.
- Brand TOV (short, direct, no hype — from the `social` skill). Legal-safe wording
  from §2.

## 7. Funnel

**Click-to-Message → WhatsApp Business.** A greeting template plus a mini party-brief
the staff collects in-chat: date, guest count, budget, alcoholic/non-alcoholic
preferences. Storefront reservation is out of scope (it is product-reservation, not
party-quote).

## 8. Taxonomy & tracking (the test loop — a core requirement)

- **Creative ID:** `bd_<angle>_<lang>_<format>_v<NN>` → e.g. `bd_curate_en_sq_v01`.
  Angles: `curate | brief | bulk | delivered`. Lang: `en | ru`. Format: `sq | st`.
- **UTM** on any link that isn't the WhatsApp deep-link (profile/landing later).
- **Tracker:** `creative-tracker.csv` in the campaign folder, columns:
  `creative_id, angle, lang, format, launch_date, spend, impressions, clicks,
  leads, cpl, status`. Status ∈ `test | scale | kill`.
- **Optimization rules (manual, weekly):**
  - **3× Kill Rule** — spent 3× target CPL with zero leads → `kill`.
  - **Scale** — CPL below cohort median **and** ≥1 lead → `scale` +20% budget.
  - Wave-2: semi-automate the stats pull + per-creative analytics.

## 9. Deliverables (launch-ready kit — owner presses launch)

There is **no** connected Meta Ads Manager / API access here, so the output is a
complete kit the owner (or SMM) publishes manually:

1. `campaign-brief.md` — strategy + targeting spec + budget scaffold.
2. 16 static creatives + 2–4 mp4, brand-styled, in the campaign folder.
3. `copy-deck.md` — all RU/EN copy by angle.
4. `targeting-setup.md` — step-by-step Ads Manager build (ad sets, targeting,
   age-gate, budget, WhatsApp connection).
5. `creative-tracker.csv` + optimization rules.

## 10. Scope boundaries

**In (Wave-1):** RU + EN, static + light animation, 4 angles, WhatsApp funnel,
manual tracker, launch kit.

**Out (Wave-2+):** Runway AI video, Chinese & Thai segments, analytics automation
/ dashboard, storefront landing page, any auto-publish to Meta.

**Open at launch time:** exact daily budget number; whether to raise age-gate to 25+.
