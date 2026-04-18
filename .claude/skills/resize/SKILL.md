---
name: resize
description: Resize a source image into platform-ready formats for Instagram, Facebook, Telegram. Handles aspect ratio mismatch with blur background or brand color fill using ffmpeg.
---

# Creative Resizer — Social Media Formats

Resize a single source image into multiple platform-ready formats using ffmpeg.

---

## When invoked

1. Ask the user: **which image** (path) and **which platforms/formats** are needed.
2. Ask **fill mode** if the source aspect ratio doesn't match the target:
   - **blur** (default) — scales up + blurs the source as background, places original centered on top. Looks intentional, not lazy.
   - **color** — fills with a brand color. Ask which: `#1A1A1A` (dark) or `#F5F0EB` (light).
3. Determine the output folder: same directory as the source file, subfolder `resized/`.
4. Generate all requested formats using the ffmpeg commands below.
5. Report what was created with file paths.

---

## Platform formats

| Platform | Format | Dimensions | When to use |
|---|---|---|---|
| Instagram | Feed square | 1080×1080 | Standard feed post |
| Instagram | Feed portrait | 1080×1350 | More real estate in feed |
| Instagram | Stories / Reels | 1080×1920 | Vertical full-screen |
| Facebook | Feed square | 1080×1080 | Photo post |
| Facebook | Landscape | 1200×630 | Link preview, ads, event cover |
| Facebook | Stories | 1080×1920 | Vertical full-screen |
| Telegram | Landscape | 1280×720 | Channel post wide |
| Telegram | Square | 1080×1080 | Channel post square |
| Universal | 16:9 | 1920×1080 | Presentations, ads |

---

## ffmpeg commands

### Fill mode: blur background

```bash
ffmpeg -y -i INPUT \
  -filter_complex \
    "[0:v]scale=W:H:force_original_aspect_ratio=increase,crop=W:H,boxblur=40:5[bg]; \
     [0:v]scale=W:H:force_original_aspect_ratio=decrease[fg]; \
     [bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p" \
  -frames:v 1 -update 1 -q:v 2 OUTPUT
```

Replace `W` and `H` with target width and height. Replace `INPUT` / `OUTPUT` with actual paths.

### Fill mode: solid color background

```bash
ffmpeg -i INPUT \
  -vf "scale=W:H:force_original_aspect_ratio=decrease, \
       pad=W:H:(ow-iw)/2:(oh-ih)/2:color=HEXCOLOR" \
  -q:v 2 OUTPUT
```

`HEXCOLOR` format for ffmpeg: `0x1A1A1A` (no `#`).

### When source already matches ratio (no fill needed)

```bash
ffmpeg -i INPUT -vf "scale=W:H" -q:v 2 OUTPUT
```

---

## Output naming convention

`{original-name}_{platform}_{WxH}.jpg`

Examples:
- `post_arrivals_v2_ig-square_1080x1080.jpg`
- `post_arrivals_v2_ig-portrait_1080x1350.jpg`
- `post_arrivals_v2_fb-landscape_1200x630.jpg`
- `post_arrivals_v2_ig-stories_1080x1920.jpg`

---

## Notes

- Source quality: always use the highest-res source available.
- `-q:v 2` = near-lossless JPEG quality. Use `-q:v 1` for maximum quality if file size isn't a concern.
- For PNG sources with transparency: output as PNG, not JPG.
- If the user doesn't specify platforms, ask. Don't assume.
- If the source image is already the correct size for a requested format, skip ffmpeg and copy the file.
- After generating, list all output files clearly so the user can find them.
