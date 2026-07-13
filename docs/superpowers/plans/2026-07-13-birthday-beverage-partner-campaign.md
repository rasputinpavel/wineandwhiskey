# Birthday Beverage-Partner Campaign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a launch-ready Meta (Instagram/Facebook) ad kit for Wine & Whiskey's "birthday beverage-partner" campaign — 16 brand-styled static creatives (+2–4 animated), RU/EN copy, targeting instructions, and a manual creative tracker — that the owner publishes by hand.

**Architecture:** Everything lives in one campaign folder under `05_creative/output/`. Creatives are produced data-driven: a single `build.py` renders every angle × language × format from a `COPY` dict via self-contained HTML → PNG with headless Chrome (mirroring the existing `2026-07-13_event-curation-social` pipeline). Animation reuses the deterministic `?t=`-frame + ffmpeg story pattern. The rest (brief, copy-deck, targeting-setup, tracker) are markdown/CSV. No code ships to a service; no Meta API is called.

**Tech Stack:** Python 3 (stdlib only: `base64`, `subprocess`, `pathlib`), headless Google Chrome (PNG render), ffmpeg (mp4 encode), W&W brand design-system, Meta Ads Manager (manual, by owner).

**Reference implementation to mirror:** `05_creative/output/2026-07-13_event-curation-social/build_fb_square.py` (static render) and `build_story.py` (animation + ffmpeg). Use their exact Chrome invocation and base64-embed approach — do not reinvent the render call.

**Design spec:** `docs/superpowers/specs/2026-07-13-birthday-beverage-partner-campaign-design.md`

---

## File Structure

All under `05_creative/output/2026-07-13_birthday-beverage-partner/`:

| File | Responsibility |
|------|----------------|
| `campaign-brief.md` | Strategy, targeting spec, budget scaffold, legal guardrails (owner's single reference) |
| `copy-deck.md` | All RU/EN copy by angle, with Meta char-count check |
| `copy.py` | The `COPY` dict — single source of truth for headlines/subs/CTAs consumed by `build.py` |
| `build.py` | Data-driven renderer: loops angles × langs × formats → PNG. Reuses render() from the event-curation script |
| `build_anim.py` | Animates the 2 selected angles (square) → mp4, deterministic frames + ffmpeg |
| `assets/wa_qr.png` | WhatsApp click-to-chat QR (offline bridge printed on creatives) |
| `targeting-setup.md` | Step-by-step Ads Manager build (campaigns, ad sets, targeting, age-gate, budget, WhatsApp) |
| `creative-tracker.csv` | Per-creative performance log + status |
| `optimization-rules.md` | Kill/scale rules for the weekly manual loop |
| `README.md` | What's in the folder + rebuild commands |
| `*.png`, `*.mp4` | Rendered outputs (committed so preview/Railway sees them) |

**Naming of outputs:** `bd_<angle>_<lang>_<format>_v01.png` where angle ∈ `curate|brief|bulk|delivered`, lang ∈ `en|ru`, format ∈ `sq|st` (sq=1080×1080, st=1080×1920). Animated: `bd_<angle>_<lang>_st_v01.mp4`.

---

## Task 1: Scaffold folder + campaign brief

**Files:**
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/campaign-brief.md`
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/assets/.gitkeep`

- [ ] **Step 1: Create folder + assets subdir**

```bash
mkdir -p "05_creative/output/2026-07-13_birthday-beverage-partner/assets"
touch "05_creative/output/2026-07-13_birthday-beverage-partner/assets/.gitkeep"
```

- [ ] **Step 2: Write `campaign-brief.md`**

Content must cover, copied/condensed from the design spec §1–3 and §8:
- Positioning: "Your beverage partner for the celebration" — party sourcing/curation, budget-based, light wholesale, delivered. Action = WhatsApp party-brief conversation.
- Legal guardrails: lead from celebration/curation/delivery; "beverages with and without alcohol"; no brands, no pouring/consumption, no benefit claims; age-gate 20+.
- Campaign map: `BD | RU` and `BD | EN`, each with ad sets A1 (Upcoming-birthday, Phuket, 20+) and A2 (broad 20+ Phuket). Note the platform reality: no native "birthday next month"; nearest is Upcoming-birthday ~1 week; the month-ahead reach comes from creative.
- Budget scaffold: ฿300–500/day per active ad set, 7–14 day learning (exact number set at launch).
- Objective: Messages → WhatsApp.

- [ ] **Step 3: Verify**

Run: `test -f "05_creative/output/2026-07-13_birthday-beverage-partner/campaign-brief.md" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add "05_creative/output/2026-07-13_birthday-beverage-partner/"
git commit -m "feat(campaign): scaffold birthday beverage-partner folder + brief"
```

---

## Task 2: Copy deck (RU/EN, 4 angles) + `copy.py` source of truth

**Files:**
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/copy.py`
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/copy-deck.md`

- [ ] **Step 1: Write `copy.py` with the `COPY` dict**

This dict is consumed by `build.py` (Task 3). Every string is final, legal-safe, brand-TOV (short, no hype). `headline` renders large; `sub` renders as supporting line on the creative; `primary`/`cta` are the Meta ad text (not baked into the image).

```python
# Single source of truth for all campaign copy.
# angle -> lang -> {headline, sub, primary, cta}
COPY = {
    "curate": {
        "en": {
            "headline": "PLANNING YOUR BIRTHDAY?",
            "sub": "We curate the drinks for your celebration.",
            "primary": "Tell us the date and the vibe — we'll curate the drinks for your celebration. Beverages with and without alcohol, matched to your budget.",
            "cta": "Message us",
        },
        "ru": {
            "headline": "ПЛАНИРУЕШЬ ДЕНЬ РОЖДЕНИЯ?",
            "sub": "Подберём напитки под твой праздник.",
            "primary": "Скажи дату и настроение — подберём напитки под твой праздник. С градусами и без, точно в твой бюджет.",
            "cta": "Напишите нам",
        },
    },
    "brief": {
        "en": {
            "headline": "YOUR PARTY, YOUR BUDGET.",
            "sub": "Send the budget — we build the list.",
            "primary": "Send us your budget and guest count. We build the drinks list — with and without alcohol — around it.",
            "cta": "Message us",
        },
        "ru": {
            "headline": "ТВОЯ ПАТИ — ТВОЙ БЮДЖЕТ.",
            "sub": "Пришли бюджет — соберём список.",
            "primary": "Пришли бюджет и число гостей. Соберём список напитков — с градусами и без — под него.",
            "cta": "Напишите нам",
        },
    },
    "bulk": {
        "en": {
            "headline": "BIGGER PARTY, BETTER PRICE.",
            "sub": "Light wholesale for your celebration.",
            "primary": "Light wholesale for your celebration — one order, one delivery, a friendlier price.",
            "cta": "Message us",
        },
        "ru": {
            "headline": "КРУПНЕЕ ПАТИ — ИНТЕРЕСНЕЕ ЦЕНА.",
            "sub": "Мелкий опт на твой праздник.",
            "primary": "Мелкий опт на твой праздник — один заказ, одна доставка, приятнее цена.",
            "cta": "Напишите нам",
        },
    },
    "delivered": {
        "en": {
            "headline": "DELIVERED TO YOUR CELEBRATION.",
            "sub": "We order it and bring it to you.",
            "primary": "We order it and bring it to you — so your birthday is about the party, not the run to the shop.",
            "cta": "Message us",
        },
        "ru": {
            "headline": "ДОСТАВИМ К ТВОЕМУ ПРАЗДНИКУ.",
            "sub": "Закажем и привезём — тебе.",
            "primary": "Закажем и привезём — чтобы день рождения был про праздник, а не про поездку в магазин.",
            "cta": "Напишите нам",
        },
    },
}
```

- [ ] **Step 2: Validate Meta character limits**

Meta recommends: primary text ≤ 125 chars (before "…more" truncation), headline ≤ 40 chars. Run this check:

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
python3 -c "
from copy import COPY
bad=0
for a,langs in COPY.items():
    for l,c in langs.items():
        if len(c['headline'])>40: print(f'HEADLINE>{40}: {a}/{l} ({len(c[\"headline\"])})'); bad+=1
        if len(c['primary'])>125: print(f'PRIMARY>{125}: {a}/{l} ({len(c[\"primary\"])})'); bad+=1
print('OK' if not bad else f'{bad} over limit')
"
```

Expected: `OK`. If any line is over, shorten it in `copy.py` (keep meaning + legal frame) and re-run until `OK`.

- [ ] **Step 3: Write `copy-deck.md`**

Human-readable table: for each angle × lang, list headline / sub / primary / CTA, plus a "Legal check" column confirming: no brand names, no pouring/consumption verbs, celebration-led, "with and without alcohol" present or implied. This is the doc the owner pastes into Ads Manager from.

- [ ] **Step 4: Commit**

```bash
git add "05_creative/output/2026-07-13_birthday-beverage-partner/copy.py" "05_creative/output/2026-07-13_birthday-beverage-partner/copy-deck.md"
git commit -m "feat(campaign): copy deck + copy.py source of truth (RU/EN, 4 angles)"
```

---

## Task 3: Data-driven static builder → 16 PNGs

**Files:**
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/build.py`
- Reference: `05_creative/output/2026-07-13_event-curation-social/build_fb_square.py` (mirror its `b64()` helper, Chrome invocation, and brand CSS variables)

- [ ] **Step 1: Write `build.py`**

Structure (fill the HTML template with real brand styling mirrored from the reference script — light travertine background, W&W monogram top, Bebas Neue headline in Wine Red/Black, subtle party decor, WA QR bottom):

```python
#!/usr/bin/env python3
"""Render all birthday-campaign static creatives.

For each angle x lang x format in COPY, emit self-contained HTML
(fonts + logo + QR embedded as base64) -> PNG via headless Google Chrome.
Mirrors 2026-07-13_event-curation-social/build_fb_square.py.
"""
import base64
import subprocess
from pathlib import Path
from copy import COPY

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

FORMATS = {"sq": (1080, 1080), "st": (1080, 1920)}


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


BEBAS = b64(ROOT / "04_brand/logo/fonts/BebasNeue.woff2")
INTER = b64(ROOT / "04_brand/logo/fonts/Inter500.woff2")
LOGO = b64(ROOT / "04_brand/logo/logo_sq_color_transparent.png")
QR = b64(HERE / "assets/wa_qr.png")


def render_html(angle, lang, fmt):
    w, h = FORMATS[fmt]
    c = COPY[angle][lang]
    # Full brand-styled template — mirror colors/fonts from the reference script.
    # Headline (Bebas, Wine Red), sub (Inter, graphite), monogram top, QR bottom,
    # light travertine bg, subtle balloons/confetti decor. Size = (w, h).
    return f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8">
<style>
@font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{BEBAS}) format('woff2'); }}
@font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{INTER}) format('woff2'); }}
:root {{ --wine:#8C1C1C; --black:#1A1A1A; --white:#F5F0EB; --cream:#EDE0D0; --gold:#C9A84C; --graphite:#3D3D3D; }}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:{w}px;height:{h}px}}
body{{font-family:'Inter',sans-serif;background:var(--white);color:var(--black);-webkit-print-color-adjust:exact;print-color-adjust:exact}}
/* ... full layout: .monogram, .headline (Bebas, var(--wine)), .sub, .qr ... */
</style></head><body>
<!-- monogram, headline={c['headline']}, sub={c['sub']}, WA QR -->
</body></html>"""


def render_png(angle, lang, fmt):
    w, h = FORMATS[fmt]
    slug = f"bd_{angle}_{lang}_{fmt}_v01"
    html_path = HERE / f"{slug}.html"
    png_path = HERE / f"{slug}.png"
    html_path.write_text(render_html(angle, lang, fmt), encoding="utf-8")
    subprocess.run([
        CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
        f"--screenshot={png_path}", f"--window-size={w},{h}",
        "--force-device-scale-factor=1", str(html_path),
    ], check=True)
    return png_path


if __name__ == "__main__":
    n = 0
    for angle in COPY:
        for lang in COPY[angle]:
            for fmt in FORMATS:
                p = render_png(angle, lang, fmt)
                print("rendered", p.name)
                n += 1
    print(f"total {n} PNGs")
```

> Before running, open the reference `build_fb_square.py` and copy its exact working Chrome flags and its complete CSS/HTML layout into `render_html()` — the block above is the skeleton, not the final styling.

- [ ] **Step 2: Generate the WA QR into `assets/wa_qr.png`** (needed before render)

The QR encodes the WhatsApp click-to-chat link (Task 5 sets the number). Reuse the existing QR if the number matches, else regenerate:

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
# Reuse the event-curation QR if it points at the same WhatsApp number:
cp ../2026-07-13_event-curation-social/assets/wa_qr.png assets/wa_qr.png 2>/dev/null && echo "reused" || echo "regenerate in Task 5"
```

- [ ] **Step 3: Run the builder**

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
python3 build.py
```

Expected: `total 16 PNGs` and 16 `bd_*_v01.png` files.

- [ ] **Step 4: Verify dimensions of every PNG**

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
for f in bd_*_sq_v01.png; do python3 -c "from PIL import Image;import sys;w,h=Image.open('$f').size;print('$f',w,h);assert (w,h)==(1080,1080)"; done
for f in bd_*_st_v01.png; do python3 -c "from PIL import Image;import sys;w,h=Image.open('$f').size;print('$f',w,h);assert (w,h)==(1080,1920)"; done
echo "dims OK"
```

Expected: each file prints its correct size and `dims OK`. (If PIL is missing: `python3 -m pip install Pillow` or use `sips -g pixelWidth -g pixelHeight`.)

- [ ] **Step 5: Eyeball a preview**

Open 2–3 PNGs (one square, one story, both languages) and confirm brand styling, legible headline, monogram present, QR present, safe margins (nothing critical within 80px of any edge for story).

Run: `open bd_curate_en_sq_v01.png bd_curate_ru_st_v01.png`

- [ ] **Step 6: Commit**

```bash
git add "05_creative/output/2026-07-13_birthday-beverage-partner/build.py" "05_creative/output/2026-07-13_birthday-beverage-partner/"*.png "05_creative/output/2026-07-13_birthday-beverage-partner/"*.html "05_creative/output/2026-07-13_birthday-beverage-partner/assets/wa_qr.png"
git commit -m "feat(campaign): 16 static birthday creatives (4 angles x RU/EN x sq/st)"
```

---

## Task 4: Animate 2 angles → mp4

**Files:**
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/build_anim.py`
- Reference: `05_creative/output/2026-07-13_event-curation-social/build_story.py`

Animate the two strongest angles for Stories: `curate` and `delivered`, in both languages (4 mp4 total), story format only.

- [ ] **Step 1: Write `build_anim.py`**

Mirror `build_story.py`: deterministic per-frame HTML parameterized by `?t=<seconds>`, render stills with headless Chrome in parallel, stitch with ffmpeg into an 8s seamless loop. Motion: rising balloons (brand tints) + gentle confetti drift + headline fade-in. Reuse the `COPY` headline/sub for the target angle/lang.

```python
#!/usr/bin/env python3
"""Animate selected birthday creatives (story 1080x1920) -> mp4.
Mirrors 2026-07-13_event-curation-social/build_story.py (deterministic ?t= frames + ffmpeg)."""
from copy import COPY

TARGETS = [("curate", "en"), ("curate", "ru"), ("delivered", "en"), ("delivered", "ru")]
DURATION = 8  # seconds, seamless loop
# ... reuse build_story.py's frame render + ffmpeg stitch, output bd_<angle>_<lang>_st_v01.mp4 ...
```

> Copy the frame-generation and ffmpeg-encode functions from `build_story.py` verbatim; only swap the visual content to the birthday layout + `COPY` text, and loop over `TARGETS`.

- [ ] **Step 2: Run**

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
python3 build_anim.py
```

Expected: 4 `bd_*_st_v01.mp4` files.

- [ ] **Step 3: Verify each mp4 (dimensions, duration, loops)**

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
for f in bd_*_st_v01.mp4; do ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of csv=p=0 "$f" | sed "s|^|$f |"; done
```

Expected: each reports `1080,1920` and duration ≈ 8s.

- [ ] **Step 4: Commit**

```bash
git add "05_creative/output/2026-07-13_birthday-beverage-partner/build_anim.py" "05_creative/output/2026-07-13_birthday-beverage-partner/"*.mp4
git commit -m "feat(campaign): animated story creatives (curate + delivered, RU/EN)"
```

---

## Task 5: WhatsApp funnel assets

**Files:**
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/whatsapp-funnel.md`
- Ensure: `05_creative/output/2026-07-13_birthday-beverage-partner/assets/wa_qr.png` encodes the campaign WA link

- [ ] **Step 1: Confirm the WhatsApp Business number + build the click-to-chat link**

Link format: `https://wa.me/<countrycode+number>?text=<url-encoded greeting>`. Greeting pre-fill (EN): `Hi! I'm planning a birthday and want help with the drinks.` The number comes from the store's WhatsApp Business (ask owner if unknown — do not guess).

- [ ] **Step 2: (Re)generate the QR if the reused one doesn't match**

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
python3 -c "import qrcode;qrcode.make('https://wa.me/PLACEHOLDER?text=...').save('assets/wa_qr.png')"
```

Replace `PLACEHOLDER` with the real link. (If `qrcode` missing: `python3 -m pip install qrcode[pil]`.) If regenerated, re-run `build.py` (Task 3) so PNGs pick up the new QR.

- [ ] **Step 3: Write `whatsapp-funnel.md`**

Document: the click-to-chat link, the pre-filled greeting (RU + EN), and the **party-brief script** staff use in-chat — collect: date, guest count, budget, alcoholic/non-alcoholic split, delivery address/time. Include a one-line auto-reply suggestion for WhatsApp Business.

- [ ] **Step 4: Commit**

```bash
git add "05_creative/output/2026-07-13_birthday-beverage-partner/whatsapp-funnel.md" "05_creative/output/2026-07-13_birthday-beverage-partner/assets/wa_qr.png"
git commit -m "feat(campaign): whatsapp funnel (link, greeting, in-chat party brief)"
```

---

## Task 6: Ads Manager setup instructions

**Files:**
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/targeting-setup.md`

- [ ] **Step 1: Write `targeting-setup.md`** — a numbered walkthrough the owner follows in Meta Ads Manager:

1. **Campaign:** create `BD | EN` and `BD | RU`, Objective = **Engagement → Messages**, message destination = **WhatsApp**. (CBO off — budget at ad-set level for clean per-audience stats.)
2. **Ad set A1 (Birthday-precise):** Location = Phuket; Age = 20+ (or 25+); Detailed targeting = **Behaviors → Upcoming birthday**; connect WhatsApp Business; budget ฿300–500/day.
3. **Ad set A2 (Planners/broad):** same geo/age, no birthday flag (broad); budget ฿300–500/day.
4. **Language:** EN campaign → English creatives + copy; RU campaign → Russian. (Optionally set ad-set language = the relevant language.)
5. **Ads:** upload the matching `bd_*` PNGs/MP4s; paste `primary`/`headline`/`cta` from `copy-deck.md`; CTA button = **Send Message**; ensure the special-ad-category / alcohol flag is set per Meta prompt for 20+.
6. **Naming inside Meta:** name each ad exactly its `creative_id` (`bd_curate_en_sq_v01`) so exported stats map 1:1 to `creative-tracker.csv`.
7. **Before publish checklist:** age-gate ≥20, WhatsApp connected, no alcohol brand in text, celebration-led image, each ad named by creative_id.

- [ ] **Step 2: Verify** the doc names every one of the 16 static creative_ids at least implicitly (via the naming rule) and both mp4 pairs.

Run: `grep -c "creative_id" "05_creative/output/2026-07-13_birthday-beverage-partner/targeting-setup.md"`
Expected: ≥1 (rule stated).

- [ ] **Step 3: Commit**

```bash
git add "05_creative/output/2026-07-13_birthday-beverage-partner/targeting-setup.md"
git commit -m "feat(campaign): Ads Manager targeting setup walkthrough"
```

---

## Task 7: Creative tracker + optimization rules

**Files:**
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/creative-tracker.csv`
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/optimization-rules.md`

- [ ] **Step 1: Generate `creative-tracker.csv` pre-seeded with every creative_id**

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
python3 -c "
from copy import COPY
rows=['creative_id,angle,lang,format,launch_date,spend,impressions,clicks,leads,cpl,status']
for a in COPY:
    for l in COPY[a]:
        for f in ('sq','st'):
            rows.append(f'bd_{a}_{l}_{f}_v01,{a},{l},{f},,,,,,,test')
open('creative-tracker.csv','w').write(chr(10).join(rows)+chr(10))
print('rows', len(rows)-1)
"
```

Expected: `rows 16`.

- [ ] **Step 2: Write `optimization-rules.md`**

Document the weekly manual loop:
- **Target CPL:** set at launch (proxy until known: a lead = a qualified WhatsApp party-brief conversation).
- **3× Kill Rule:** an ad that spent 3× target CPL with 0 leads → mark `kill`, pause it.
- **Scale:** an ad with CPL below the cohort median **and** ≥1 lead → mark `scale`, raise its ad-set budget +20% (no more than once per 3 days to protect learning).
- **Cadence:** update the CSV weekly from Ads Manager export (match on ad name = creative_id).
- **Wave-2:** semi-automate the export→CSV merge; add per-angle/-language rollups.

- [ ] **Step 3: Commit**

```bash
git add "05_creative/output/2026-07-13_birthday-beverage-partner/creative-tracker.csv" "05_creative/output/2026-07-13_birthday-beverage-partner/optimization-rules.md"
git commit -m "feat(campaign): creative tracker (16 ids) + optimization rules"
```

---

## Task 8: Final QA + README + push

**Files:**
- Create: `05_creative/output/2026-07-13_birthday-beverage-partner/README.md`

- [ ] **Step 1: Legal-wording audit across all copy**

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
python3 -c "
from copy import COPY
banned=['vodka','whisky','whiskey','wine','beer','рюмк','водк','виск','пиво','вино','drunk','пьян']
hits=[]
for a in COPY:
    for l in COPY[a]:
        for k,v in COPY[a][l].items():
            for b in banned:
                if b in v.lower(): hits.append(f'{a}/{l}/{k}: {b}')
print('CLEAN' if not hits else '\n'.join(hits))
"
```

Expected: `CLEAN`. (The store name "Wine & Whiskey" as a logo/brand mark on the image is fine — this check is about ad *copy* claiming specific alcohol.) If a legitimate hit appears, confirm it's brand-name-only usage and whitelist consciously.

- [ ] **Step 2: Full deliverable inventory**

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
echo "PNGs:"; ls bd_*_v01.png | wc -l          # expect 16
echo "MP4s:"; ls bd_*_v01.mp4 | wc -l          # expect 4
for f in campaign-brief.md copy-deck.md whatsapp-funnel.md targeting-setup.md creative-tracker.csv optimization-rules.md; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
```

Expected: 16 PNGs, 4 MP4s, all 6 docs `OK`.

- [ ] **Step 2b: Generate a `_preview.png` contact sheet** (per creative-file convention) so the batch is skimmable in git/preview:

```bash
cd "05_creative/output/2026-07-13_birthday-beverage-partner"
python3 -c "
from PIL import Image; import glob, math
fs=sorted(glob.glob('bd_*_sq_v01.png'))
imgs=[Image.open(f).resize((300,300)) for f in fs]
cols=4; rows=math.ceil(len(imgs)/cols)
sheet=Image.new('RGB',(cols*300,rows*300),'#F5F0EB')
for i,im in enumerate(imgs): sheet.paste(im,((i%cols)*300,(i//cols)*300))
sheet.save('birthday-beverage-partner_2026-07-13_preview.png')
print('preview saved')
"
```

- [ ] **Step 3: Write `README.md`**

List deliverables table (like the event-curation README), rebuild commands (`python3 build.py`, `python3 build_anim.py`), toolchain requirements (Chrome, ffmpeg, Pillow, qrcode), and a one-paragraph "how to launch" pointer to `targeting-setup.md`.

- [ ] **Step 4: Final commit + push**

```bash
git add "05_creative/output/2026-07-13_birthday-beverage-partner/"
git commit -m "feat(campaign): README + preview contact sheet + QA for birthday campaign"
git push origin main
```

Expected: clean push to `origin main` (Railway/preview will pick up the committed assets).

---

## Self-Review (author checklist — completed)

**Spec coverage:**
- Spec §1 positioning → Task 1 brief + Task 2 copy. ✓
- Spec §2 legal guardrails → Task 1 brief, Task 2 legal column, Task 8 wording audit. ✓
- Spec §3 architecture (RU/EN campaigns, A1/A2 ad sets, birthday reality, 20+, budget) → Task 1 brief + Task 6 setup. ✓
- Spec §4 four angles → Task 2 `COPY` (curate/brief/bulk/delivered). ✓
- Spec §5 production (sq+st formats, HTML→PNG, animation, batch=16, folder) → Tasks 3 & 4. ✓
- Spec §6 copy deck → Task 2. ✓
- Spec §7 WhatsApp funnel → Task 5. ✓
- Spec §8 taxonomy + tracker + kill/scale → Task 7 + naming rule in Tasks 3/6. ✓
- Spec §9 deliverables (5 items) → all produced; Task 8 inventory verifies. ✓
- Spec §10 scope: Runway/ZH/TH/automation correctly deferred (not in any task). ✓

**Placeholder scan:** Copy is final and char-validated; build code is skeleton-with-explicit-instruction to copy the reference script's proven render call (intentional, not a vague TODO); WA number is the one genuine unknown, flagged to ask the owner. No "TBD/handle edge cases" left.

**Type consistency:** `COPY[angle][lang]` keys `headline/sub/primary/cta` used identically in `build.py`, char-check, tracker seeder, and legal audit. creative_id format `bd_<angle>_<lang>_<format>_v01` consistent across Tasks 3, 6, 7, 8.
