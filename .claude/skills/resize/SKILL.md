---
name: resize
description: Resize a source image into platform-ready formats for Instagram, Facebook, Telegram. Analyzes image mode, extends canvas intelligently, then runs art director review. Max 3 rework loops before escalating to human.
---

# Creative Resizer — Social Media Formats

Resize a single source image into multiple platform-ready formats using ffmpeg.

---

## When invoked

1. Ask the user: **which image** (path) and **which platforms/formats** are needed.
2. **Analyze the source image** before touching anything — read it and determine:
   - Visual mode: Dark or Light (see design system)
   - Where the key subjects are (center? lower third? offset?)
   - Whether there is baked-in text and where it sits
   - What the background is (solid dark, stone, marble, wood, etc.)
3. Choose the right **extension strategy** for each target format (see section below). Do not ask the user — decide based on your analysis.
4. Determine the output folder: same directory as the source file, subfolder `resized/`.
5. Generate all requested formats.
6. **Art director review** — read each output image and score it (see section below).
7. If score < 7: rework with a different strategy. Max **3 attempts per image**. After 3 failed attempts — stop and call the human (see escalation).
8. Report final file paths for all approved images.

---

## Extension strategies

Blur is banned. It always looks unnatural — a visible halo, a mood mismatch, an obvious patch job.

Instead, choose based on image analysis:

### Strategy A — Solid background extend (Dark mode images)
Dark mode images (`#1A1A1A` or near-black background) are seamless with a solid pad. The background is already flat — extending it with the same color is invisible.

```bash
ffmpeg -y -i INPUT \
  -vf "scale=W:H:force_original_aspect_ratio=decrease, \
       pad=W:H:(ow-iw)/2:(oh-ih)/2:color=0x1A1A1A" \
  -frames:v 1 -update 1 -q:v 2 OUTPUT
```

For subjects that are not centered (e.g. text on one side, product on other): adjust the x offset to keep the subject in the visually correct position rather than dead center. Use `pad=W:H:XOFFSET:(oh-ih)/2:color=0x1A1A1A`.

### Strategy B — Edge-sampled extend (Light mode images)
Light mode images (stone, marble, travertine backgrounds) — extend using the edge pixel color sampled from the nearest border. Gives a smooth, gradient-like continuation.

Step 1: sample the dominant edge color with ffmpeg metadata (or eyeball from the image read):
```bash
ffmpeg -y -i INPUT -vf "cropdetect,scale=1:1:flags=area" -frames:v 1 -update 1 /tmp/sample.jpg 2>&1
```

Step 2: use the sampled hex color in a solid pad. Light stone typically samples to `#D4C9BC` (Pale Stone) or `#EDE0D0` (Cream) — use the closest brand color.

```bash
ffmpeg -y -i INPUT \
  -vf "scale=W:H:force_original_aspect_ratio=decrease, \
       pad=W:H:(ow-iw)/2:(oh-ih)/2:color=SAMPLED_HEX" \
  -frames:v 1 -update 1 -q:v 2 OUTPUT
```

### Strategy C — Smart crop (when the source has enough content)
If the source image is larger than the target ratio requires — don't add any fill. Crop intelligently by finding the gravity point (where the key subject is) and crop around it.

```bash
# Center crop
ffmpeg -y -i INPUT \
  -vf "crop=W:H:(iw-W)/2:(ih-H)/2" \
  -frames:v 1 -update 1 -q:v 2 OUTPUT

# Subject offset crop — adjust X/Y to keep subject in frame
ffmpeg -y -i INPUT \
  -vf "crop=W:H:XOFFSET:YOFFSET" \
  -frames:v 1 -update 1 -q:v 2 OUTPUT
```

### Strategy D — Subject reposition + extend
When converting square → landscape (e.g. 1:1 → 1.91:1), the subject may need to shift left or right to leave breathing room on one side, with the extension filling the other. Combine scale + pad with asymmetric offset.

### Choosing the strategy

| Situation | Use |
|---|---|
| Dark mode, adding side space | A (solid `#1A1A1A`) |
| Light mode, adding side space | B (edge-sampled brand color) |
| Source has room, just needs different crop | C (smart crop) |
| Subject needs repositioning to balance at new ratio | D (reposition + extend) |
| Unsure | Read the image, pick what would be invisible to the eye |

---

## Platform formats

The user never needs to specify dimensions. They say a format name — you resolve it.

| What the user says | Dimensions | Notes |
|---|---|---|
| `instagram post`, `ig post`, `instagram feed`, `ig square` | 1080×1080 | Standard feed |
| `instagram portrait`, `ig portrait`, `ig 4:5` | 1080×1350 | More feed real estate |
| `instagram stories`, `ig stories`, `instagram reels`, `ig reels`, `reels` | 1080×1920 | Vertical full-screen |
| `facebook post`, `fb post`, `facebook feed`, `fb feed` | 1080×1080 | Square photo post |
| `facebook landscape`, `fb landscape`, `facebook cover`, `fb ad`, `facebook link` | 1200×630 | Link preview / ad / event cover |
| `facebook stories`, `fb stories` | 1080×1920 | Vertical full-screen |
| `telegram post`, `telegram`, `tg post` | 1280×720 | Wide channel post |
| `telegram square`, `tg square` | 1080×1080 | Square channel post |
| `16:9`, `widescreen`, `presentation` | 1920×1080 | Universal wide |
| `all instagram` | 1080×1080 + 1080×1350 + 1080×1920 | All three IG formats |
| `all facebook`, `all fb` | 1080×1080 + 1200×630 + 1080×1920 | All three FB formats |
| `all` | Every format in the table | Full set |

If the user names a platform without a format (e.g. just "Facebook"), ask: feed, landscape, or stories? Unless they said "all Facebook".

---

## Output naming convention

`{original-name}_{platform}_{WxH}.jpg`

Examples:
- `post_arrivals_v2_ig-square_1080x1080.jpg`
- `post_arrivals_v2_ig-portrait_1080x1350.jpg`
- `post_arrivals_v2_fb-landscape_1200x630.jpg`
- `post_arrivals_v2_ig-stories_1080x1920.jpg`

---

## Art director review

After generating each image, read it and evaluate as an experienced art director who has internalized the Wine & Whiskey design system.

### Your role
You know this system better than anyone. You feel immediately when something is off — a fill that reads as a patch, a crop that amputates a shadow, a composition that lost its tension at a new ratio. You are direct. You don't comfort. You score and explain.

### Scoring criteria (average to final score)

| Criterion | What to check |
|---|---|
| **Mode integrity** | Does the resize preserve the Dark/Light mood? Extended areas must feel like they belong to the same image. |
| **Subject integrity** | Bottles, glasses, hands, liquid, shadows — fully visible, nothing cropped out, nothing awkwardly cut. |
| **Composition balance** | Subject placement feels intentional at the new ratio. Empty space reads as breathing room, not neglect. |
| **Extension quality** | Fill looks like part of the original, not added. No visible seams, no color mismatch, no halo. |
| **Text safe zones** | Baked-in text fully readable, within margins. (Feed: 64px, Stories: 96px top/bottom) |

### Output format per image

```
[filename]
Strategy used: [A / B / C / D]
Score: X/10
✓ [what works]
✗ [what doesn't — be specific: "the cream pad on the left is 20% lighter than the stone in the original, visible seam at the join"]
Verdict: APPROVED (score ≥ 7) / NEEDS REWORK (score < 7)
```

The verdict is binary. No "approved with caveats", no "approved but...". Score ≥ 7 = APPROVED, done. Score < 7 = NEEDS REWORK, state exactly what to fix.

### Rework loop

- Max **3 attempts** per image before escalating.
- Each attempt: try a different strategy or adjust offset/color. State what changed and why.
- Track attempts: **Attempt 1/3**, **Attempt 2/3**, **Attempt 3/3**.

### Escalation (after 3 failed attempts)

Stop. Do not produce a substandard file. Tell the human:

```
⚠ [filename] could not reach score 7 after 3 attempts.

Attempts summary:
1. [strategy] — score X — [why it failed]
2. [strategy] — score X — [why it failed]
3. [strategy] — score X — [why it failed]

Root cause: [honest diagnosis — e.g. "the source image doesn't have enough background area to extend naturally to 1.91:1. A new source crop or a redesigned composition is needed."]

Options:
→ Generate a new source image at the correct aspect ratio
→ Accept attempt [N] (score X) and publish with awareness of the flaw
→ Skip this format
```

---

## Notes

- Source quality: always use the highest-res source available.
- `-q:v 2` = near-lossless JPEG quality.
- For PNG sources with transparency: output as PNG, not JPG.
- If the source already matches the target ratio exactly: scale only, no fill.
- If the user doesn't specify platforms, ask. Don't assume.
