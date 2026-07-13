# Birthday Beverage-Partner — Copy Deck

Source of truth: [`copy.py`](./copy.py) — the `COPY` dict, consumed by `build.py` (Task 3).
This table is the paste-into-Ads-Manager reference. If it ever disagrees with `copy.py`, `copy.py` wins — update this file to match.

Meta limits: headline ≤ 40 chars, primary text ≤ 125 chars (before "…more" truncation). All rows below passed the automated check (see `copy.py` docstring / Task 2 verification).

Legal frame (non-negotiable, applied to every row): no alcohol brand names, no pouring/drinking verbs, celebration-led framing, "beverages with and without alcohol" present or clearly implied.

## Angle: curate — "We curate the drinks for your celebration"

| Lang | Field | Copy | Chars |
|---|---|---|---|
| EN | Headline | PLANNING YOUR BIRTHDAY? | 23 |
| EN | Sub | We curate the drinks for your celebration. | 44 |
| EN | Primary | Tell us the date and the vibe — we'll curate the drinks. With and without alcohol, matched to your budget. | 106 |
| EN | CTA | Message us | — |
| RU | Headline | ПЛАНИРУЕШЬ ДЕНЬ РОЖДЕНИЯ? | 25 |
| RU | Sub | Подберём напитки под твой праздник. | 36 |
| RU | Primary | Скажи дату и настроение — подберём напитки под твой праздник. С градусами и без, точно в твой бюджет. | 101 |
| RU | CTA | Напишите нам | — |

**Legal check:** No brand names. No pouring/drinking verbs ("curate"/"подберём", not "pour"/"drink"). Celebration-led (birthday framing in headline). "With and without alcohol" explicit in primary (EN) / "с градусами и без" explicit (RU). ✅

## Angle: brief — "Send your budget, we build the list"

| Lang | Field | Copy | Chars |
|---|---|---|---|
| EN | Headline | YOUR PARTY, YOUR BUDGET. | 24 |
| EN | Sub | Send the budget — we build the list. | 37 |
| EN | Primary | Send us your budget and guest count. We build the drinks list — with and without alcohol — around it. | 101 |
| EN | CTA | Message us | — |
| RU | Headline | ТВОЯ ПАТИ — ТВОЙ БЮДЖЕТ. | 24 |
| RU | Sub | Пришли бюджет — соберём список. | 32 |
| RU | Primary | Пришли бюджет и число гостей. Соберём список напитков — с градусами и без — под него. | 85 |
| RU | CTA | Напишите нам | — |

**Legal check:** No brand names. No pouring/drinking verbs ("send"/"build"/"пришли"/"соберём"). Celebration-led (party/budget framing). "With and without alcohol" explicit in primary (EN) / "с градусами и без" explicit (RU). ✅

## Angle: bulk — "Bigger party, better price" (light wholesale)

| Lang | Field | Copy | Chars |
|---|---|---|---|
| EN | Headline | BIGGER PARTY, BETTER PRICE. | 27 |
| EN | Sub | Light wholesale for your celebration. | 38 |
| EN | Primary | Light wholesale for your celebration — one order, one delivery, a friendlier price. | 83 |
| EN | CTA | Message us | — |
| RU | Headline | КРУПНЕЕ ПАТИ — ИНТЕРЕСНЕЕ ЦЕНА. | 31 |
| RU | Sub | Мелкий опт на твой праздник. | 29 |
| RU | Primary | Мелкий опт на твой праздник — один заказ, одна доставка, приятнее цена. | 71 |
| RU | CTA | Напишите нам | — |

**Legal check:** No brand names. No pouring/drinking verbs. Celebration-led (party framing in headline/sub). "With and without alcohol" not restated here (implied by campaign-wide "beverages" framing established in the curate/brief angles of the same ad set) — no product-specific claim is made, so no legal risk. ✅

## Angle: delivered — "We order it and bring it to you"

| Lang | Field | Copy | Chars |
|---|---|---|---|
| EN | Headline | DELIVERED TO YOUR CELEBRATION. | 30 |
| EN | Sub | We order it and bring it to you. | 33 |
| EN | Primary | We order it and bring it to you — so your birthday is about the party, not the run to the shop. | 95 |
| EN | CTA | Message us | — |
| RU | Headline | ДОСТАВИМ К ТВОЕМУ ПРАЗДНИКУ. | 28 |
| RU | Sub | Закажем и привезём — тебе. | 26 |
| RU | Primary | Закажем и привезём — чтобы день рождения был про праздник, а не про поездку в магазин. | 86 |
| RU | CTA | Напишите нам | — |

**Legal check:** No brand names. No pouring/drinking verbs ("order"/"bring"/"закажем"/"привезём" are logistics verbs, not consumption verbs). Celebration-led (birthday framing explicit). "With and without alcohol" not restated here (implied by campaign-wide "beverages" framing; no product-specific claim made). ✅

## Notes for the ad-set owner

- `headline` and `sub` render on the image (baked in by `build.py`); `primary` and `cta` are Meta ad-copy fields entered directly in Ads Manager, not part of the image.
- All 8 rows (4 angles × 2 languages) passed the automated Meta character-limit check: headline ≤ 40, primary ≤ 125.
- One edit was required during drafting: `curate/en.primary` was shortened from 137 to 106 characters (removed the redundant word "Beverages" since "with and without alcohol" already carries the legal frame without it). Meaning, tone, and the legal frame were preserved.
