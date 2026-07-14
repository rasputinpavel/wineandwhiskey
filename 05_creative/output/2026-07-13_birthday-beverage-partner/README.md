# Birthday Beverage-Partner (2026-07-13)

Meta (Instagram/Facebook) lead-gen campaign, Wave-1, RU + EN. Positioning:
**"Your beverage partner for the celebration"** — not a discount, a party
sourcing/curation service (alcoholic and non-alcoholic drinks, delivered).
Objective is **Click-to-WhatsApp messages**, not a storefront sale: the ad
sends people into a WhatsApp Business conversation where staff collect a
mini party brief (date, guest count, budget, alcoholic/non-alcoholic
preferences). Two ad sets per language campaign — A1 "birthday-precise"
(Meta's Upcoming-birthday behavior) vs A2 "planners/broad" — to compare
targeting efficiency. Full legal/platform guardrails (Thailand alcohol
advertising rules, Meta alcohol policy, 20+ age-gate) live in
`campaign-brief.md`.

## Deliverables

| File | Format | Use |
|------|--------|-----|
| `campaign-brief.md` | doc | Positioning, legal guardrails, campaign map, budget, funnel |
| `copy-deck.md` (+ `copy.py`) | doc | Paste-in ad copy per angle/language (source of truth = `copy.py`) |
| `whatsapp-funnel.md` | doc | Click-to-WhatsApp links + pre-filled greeting, EN/RU |
| `targeting-setup.md` | doc | Meta Ads Manager walkthrough — campaigns, ad sets, ad-by-ad build, before-publish checklist |
| `creative-tracker.csv` | doc | Per-`creative_id` performance tracking sheet (20 rows) |
| `optimization-rules.md` | doc | When/how to pause, scale, or refresh creative post-launch |
| `bd_*_v01.png` (16) | 1080×1080 (`sq`, feed) / 1080×1920 (`st`, story) | Static creatives — 4 angles (`curate`, `brief`, `bulk`, `delivered`) × 2 langs × 2 formats |
| `bd_*_stv_v01.mp4` (4) | 1080×1920, ~8s loop | Animated story/Reels creatives — `curate` + `delivered` angles, 2 langs each |
| `bd_*_stv_v01_poster.png` (4) | 1080×1920 | Static fallback / thumbnail for each video |
| `bd_*_v01.html` | — | Self-contained static source (fonts + logo + QR embedded as base64) |
| `assets/wa_qr.png` | image | WhatsApp click-to-chat QR, embedded into creatives |
| `birthday-beverage-partner_2026-07-13_preview.png` | contact sheet | 4×2 grid of the 8 `sq` (feed) creatives, quick visual QA |

**Naming:** every creative is `bd_<angle>_<lang>_<format>_v01`, where format
is `sq` (feed static), `st` (story static), or `stv` (story video — its own
distinct creative_id, not a variant of `st`). 16 static + 4 `stv` = 20
creative_ids total, matching the 20 rows in `creative-tracker.csv`.

## Rebuild

```bash
python3 build.py          # static PNGs (sq + st) from copy.py + HTML templates
python3 build_anim.py     # stv MP4s + posters — needs a local puppeteer-core
                           # install + ffmpeg + Google Chrome; the persistent-
                           # Chrome renderer lives at
                           # scratchpad/puppet/render_anim.mjs
```

## How to launch

Follow `targeting-setup.md` step by step — it walks through creating the
two Meta campaigns (`BD | EN`, `BD | RU`), the A1/A2 ad sets, the
creative→campaign mapping table, ad naming (must match `creative_id`
exactly so exported stats join cleanly), and a before-publish checklist
(age-gate, alcohol flag, no brand names, celebration-led imagery).

## How to track

After launch, export ad-level performance from Ads Manager and paste it
into `creative-tracker.csv` by `creative_id`. Apply `optimization-rules.md`
for pause/scale/refresh decisions (e.g. comparing A1 vs A2 CPL after the
7–14 day learning phase, and the static-vs-video A/B on the `st`/`stv`
pairs for `curate` and `delivered`).
