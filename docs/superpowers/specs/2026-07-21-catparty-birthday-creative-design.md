# Cat Party — Birthday Beverage-Partner Creative (Wave-1b)

**Date:** 2026-07-21
**Status:** Design — awaiting user review
**Owner:** Pavel
**Parent campaign:** `2026-07-13_birthday-beverage-partner` (same offer, new creative concept, runs **in parallel** to the human `bd_montage_*` v02)

---

## 1. Why

The live human-cast birthday video is underperforming on day 2 (one inbound in 48h).
Two hypotheses: (a) the offer isn't legible fast enough, (b) scenes are too long /
watch-through is weak. This creative attacks both, and swaps the cast to charming
3D cats as a scroll-stopping, universally-relatable, meme-adjacent pattern break.

It is an **A/B addition**, not a replacement. The human v02 keeps running.

## 2. What stays identical (non-negotiable)

- **Offer & funnel:** beverage-partner sourcing/curation for a celebration →
  Click-to-WhatsApp lead-gen (`https://wa.me/66809020550`). Not a storefront.
- **Legal frame (Thai Alcoholic Beverage Control Act + Meta):** zero alcohol signal
  in frame — no bottles, no wine/champagne glasses, no cocktails, no pouring/drinking.
  Cats may hold smoothies / there may be floating soap bubbles as the only "sparkle"
  cue. Celebration-led. "With or without bubbles / с пузырьками и без" present.
  Age-gate 20+, alcohol-policy flag on every ad set. RU + EN only (no Thai).
- **Formats:** `stv` 1080×1920 (9:16 Stories/Reels), `fv` 1080×1350 (4:5 Feed).
- **Brand system:** wine `#8C1C1C`, gold `#C9A84C`, cream `#F5F0EB`; Bebas Neue (EN
  headline), Oswald (RU headline), Inter (body/CTA); channel logo on cards.

## 3. What changes

| Dimension | Human v02 | Cat Party |
|---|---|---|
| Cast | Real people, separate RU (European) + EN sets | **3D Pixar-style cats, one shared set** (no ethnicity → no RU/EN render split) |
| Structure | 4 scenes → brand card → wholesale+CTA | **Hook card first** → 4 scenes → **CTA card** (offer bookends the video) |
| Pace | 2.6s / scene, ~17s total | **1.2s / scene, ~9s total** |
| Motion | Ken Burns only | **Two variants: Ken Burns AND Runway image→video** (A/B) |
| Audio | One Suno track | **Two Suno jingles** (house-drop + playful meme), A/B |

## 4. Storyboard (~9s)

1. **HOOK card ~1.5s** — offer up front.
   EN `Planning something special?` · RU `Планируете что-то особенное?`
   Brand-tinted card (reuse `CARD_BG` + bubbles), big kicker, a cat peeking in.
2. **4 cat scenes @1.2s** (shared renders, per-lang lower-third caption):
   | Scene | RU caption | EN caption |
   |---|---|---|
   | BBQ | Шашлыки с компанией | BBQ with the crew |
   | Pool/villa | Вечеринка у бассейна | Villa pool party |
   | Yacht (girl-cats) | День рождения на яхте | Birthday on a yacht |
   | Beach (bachelor) | Пляжный движ | Beach bash |
3. **CTA card ~3s** — offer close + action.
   EN headline `CURATED DRINKS FOR YOUR PARTY`, sub `With or without bubbles — matched to your budget.`, CTA `Message us`
   RU headline `НАПИТКИ НА ВАШ ПРАЗДНИК — ПОД КЛЮЧ`, sub `С пузырьками и без — точно в ваш бюджет.`, CTA `Напишите нам`
   Brand wordmark + Phuket pin + wa.me.

Timing per scene ≈ 1.2s with 0.4s crossfade; hook 1.5s, CTA 3.0s → ~9s total.

## 5. Production pipeline

Shared upstream, split only at the motion stage:

```
gen_cat_scenes.py  → 4 shared cat stills (gpt-image-1, 3D Pixar anchor, NO alcohol)
        │
        ├── Ken Burns variant:  build_cat_montage.py --motion kenburns
        └── Runway variant:     runway_cat_clips.py (image→video) → build_cat_montage.py --motion runway
        │
   hook card + CTA card (HTML→Chrome PNG, brand system)  ← shared by both
        │
   mux one of two Suno jingles (assets/audio/cat_house.mp3, cat_meme.mp3)
```

- **`gen_cat_scenes.py`** — sibling of `gen_scenes.py`; new `ANCHOR` (charming 3D
  Pixar anthropomorphic cats, Phuket luxury party, upper-third negative space, hard
  no-alcohol clause) and 4 `SCENE` prompts (bbq/pool/yacht/bachelor). **No `_ru`
  cast variant.** Keys from `.env.local` (`OPENAI_API_KEY` present).
- **`runway_cat_clips.py`** — feeds each still + a motion prompt to Runway
  (`RUNWAY_API_KEY` present) for ~2–4s image→video clips of cats partying. Motion
  prompts authored via the `runway-prompts` skill (image+motion pairs, consistency
  anchors). Output → `assets/runway/<scene>.mp4`.
- **`build_cat_montage.py`** — fork of `build_montage.py`. New hook-first order,
  1.2s scenes, CTA close. `--motion kenburns|runway` selects clip source. Two Suno
  tracks → variant suffix in filename. Cards reuse the existing HTML card builders,
  restyled to hook/CTA copy.
- **Suno:** two prompts delivered for the user to generate (no Suno API here);
  mp3s dropped into `assets/audio/`. Script builds silent first if audio absent,
  muxes when present.

**Deliverable matrix:** 2 motion × 2 jingle × {RU,EN} × {stv,fv} = up to 16 finals.
Naming: `bd_cat_{lang}_{fmt}_{motion}_{jingle}_v01.mp4`
(e.g. `bd_cat_ru_stv_runway_house_v01.mp4`). All in the parent campaign folder.

## 6. Copy (legal-checked, added to `copy-deck.md`)

New "cat" angle block: ad-level primary/headline/description reusing the approved
montage framing (bubbles cue, budget, curation, no brand names, no pour verbs),
plus the in-video hook/caption/CTA strings above. Same 20+ / no-Thai rules.

## 7. Out of scope (YAGNI)

- No Thai/Chinese (Wave-2, unchanged).
- No new targeting/budget — reuses the existing BD | RU / BD | EN ad sets; owner
  adds the cat video as an additional creative in the same ad sets at launch.
- No voice-over — jingle only (VO could be a later test).
- Publishing to Meta stays manual (owner uploads in Ads Manager).

## 8. Open items for build

- Confirm Runway model/duration/credit cost at generation time; if a clip fails or
  the token is exhausted, fall back to Ken Burns for that scene and log it.
- Verify gpt-image-1 holds cat character consistency across 4 scenes; if drift is
  bad, generate a single "hero cat" reference first and prompt the rest against it.
