# Event Curation — Social adaptations (2026-07-13)

Social versions of the A3 "Planning Something?" event-curation poster
(`../2026-07-07_event-curation-poster/`). Same message, light travertine brand
style, subtle party decor.

## Deliverables

| File | Format | Use |
|------|--------|-----|
| `event-curation-fb-square_2026-07-13.png` | 1080×1080 | Facebook / Instagram feed post |
| `event-curation-story_2026-07-13.mp4` | 1080×1920, ~8s loop | Instagram / Facebook Story (animated) |
| `event-curation-story_2026-07-13_poster.png` | 1080×1920 | Static fallback / thumbnail for the story |
| `*.html` | — | Self-contained source (fonts + logo + QR embedded as base64) |

## Story animation

- **Balloons rising** continuously (brand tints), gentle horizontal sway.
- **Fireworks** — radiating gold/wine/burgundy bursts staggered across the loop.
- The animation is **deterministic**: every frame is a pure function of `?t=<seconds>`
  in the HTML. `build_story.py` renders stills with headless Chrome (parallel), then
  ffmpeg stitches them into a seamless-loop MP4. Loop length = `DURATION` (8s) so the
  end matches the start.

## Rebuild

```bash
python3 build_fb_square.py            # → FB square PNG
python3 build_story.py                # → Story MP4 + poster still
python3 build_story.py --still 5.95   # → single preview frame (peak burst)
```

Requires Google Chrome (headless render) and `ffmpeg` (video encode).
