#!/usr/bin/env python3
"""Cat Party montage — offer-first, snappy, two animation modes, two jingles.

Structure (offer bookends the video, ~9s):
  HOOK card (1.5s, offer up front)
    -> 4 cat scenes @1.2s  (BBQ -> Pool -> Yacht -> Beach)
    -> CTA card (3.0s, offer close + Message us)

One SHARED cat set (cats have no ethnicity) — RU/EN differ only in card text +
captions + jingle. Two aspect formats per language:
  stv 1080x1920 (9:16 Stories/Reels), fv 1080x1350 (4:5 Feed).

Two animation modes (A/B), selected with --motion:
  kenburns : slow zoom over the stills (works today, no external deps)
  runway   : real image->video clips from assets/runway/<scene>.mp4
             (per-scene fallback to Ken Burns if a clip is missing)

Two jingles (A/B): assets/audio/cat_house.mp3, assets/audio/cat_meme.mp3.
Each present jingle is muxed into its own final; if none exist, a silent cut is
written. Finals: bd_cat_{lang}_{fmt}_{motion}_{jingle|silent}_v01.mp4

Legal frame unchanged: no alcohol in frame, celebration-led, "with or without
bubbles", 20+.

Run from inside this folder:
    python3 build_cat_montage.py                 # both motions, all jingles
    python3 build_cat_montage.py --motion kenburns
    python3 build_cat_montage.py --motion runway
"""
import base64
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]           # repo root (Cats/ is 4 levels deep)
AUDIO_DIR = HERE / "assets" / "audio"
WORK = HERE / "assets" / "montage_work"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Two parallel style versions (A/B): cartoon 3D cats vs photoreal adult cats.
# Each reads its own scenes/runway dirs and gets its own final-file prefix.
STYLE_DIRS = {
    "cartoon": {"scenes": HERE / "assets" / "scenes",
                "runway": HERE / "assets" / "runway", "prefix": "bd_cat"},
    "real": {"scenes": HERE / "assets" / "scenes_real",
             "runway": HERE / "assets" / "runway_real", "prefix": "bd_catreal"},
    "gatsby": {"scenes": HERE / "assets" / "scenes_gatsby",
               "runway": HERE / "assets" / "runway_gatsby", "prefix": "bd_gatsby"},
    "phangan": {"scenes": HERE / "assets" / "scenes_phangan",
                "runway": HERE / "assets" / "runway_phangan", "prefix": "bd_phangan"},
}

FPS = 30
FORMATS = {"stv": (1080, 1920), "fv": (1080, 1350)}
VERSION = "v01"
HOOK_DUR = 2.8           # holds long enough to read the offer (staged reveal)
PARTY_DUR = 1.2          # snappy
CTA_DUR = 3.6            # lingers so the CTA + special-price message land
XFADE = 0.35
# Scene order + count per style (all currently 4-scene montages).
STYLE_ORDER = {
    "cartoon": ["bbq", "pool", "yacht", "bachelor"],
    "real": ["bbq", "pool", "yacht", "bachelor"],
    "gatsby": ["gala", "tower", "jazz", "rooftop"],
    "phangan": ["fire", "neon", "boat", "beachbar"],
}
RUNWAY_TRIM_START = 1.0   # skip the near-static first second of each Runway clip

JINGLES = {"house": AUDIO_DIR / "cat_house.mp3",
           "meme": AUDIO_DIR / "cat_meme.mp3",
           "club": AUDIO_DIR / "cat_club.mp3"}
# The jingles build to a drop/peak near their end; mux aligns that peak to the
# moment the CTA card lands. The exact CTA-onset time is computed in build().


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


BEBAS = b64(ROOT / "04_brand/logo/fonts/BebasNeue.woff2")
OSWALD_LATIN = b64(ROOT / "04_brand/logo/fonts/Oswald500-latin.woff2")
OSWALD_CYRILLIC = b64(ROOT / "04_brand/logo/fonts/Oswald500-cyrillic.woff2")
INTER = b64(ROOT / "04_brand/logo/fonts/Inter500.woff2")
LOGO = b64(ROOT / "04_brand/logo/channel_avatar_light.png")

FONT_FACES = f"""
@font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{BEBAS}) format('woff2'); font-weight:400; font-display:block; }}
@font-face {{ font-family:'Oswald'; src:url(data:font/woff2;base64,{OSWALD_CYRILLIC}) format('woff2'); font-weight:500; font-display:block; unicode-range:U+0400-04FF,U+0500-052F; }}
@font-face {{ font-family:'Oswald'; src:url(data:font/woff2;base64,{OSWALD_LATIN}) format('woff2'); font-weight:500; font-display:block; }}
@font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{INTER}) format('woff2'); font-weight:500; font-display:block; }}
"""

HOOK = {
    "en": {"kicker": "Wine & Whiskey · Phuket",
           "headline": "PLANNING SOMETHING SPECIAL?",
           "sub": "Your beverage partner for the celebration."},
    "ru": {"kicker": "Wine & Whiskey · Пхукет",
           "headline": "ПЛАНИРУЕТЕ ЧТО-ТО ОСОБЕННОЕ?",
           "sub": "Ваш партнёр по напиткам на праздник."},
}

CTA = {
    "en": {"headline": "CURATED DRINKS FOR YOUR PARTY",
           "sub": "With or without bubbles — at a special party price.",
           "cta": "Message us"},
    "ru": {"headline": "НАПИТКИ НА ВАШ ПРАЗДНИК — ПОД КЛЮЧ",
           "sub": "С пузырьками и без — по специальной цене.",
           "cta": "Напишите нам"},
}

# Per-style, per-language lower-... (now upper) scene captions.
STYLE_CAPTIONS = {
    "cartoon": {
        "en": {"bbq": "BBQ with the crew", "pool": "Villa pool party",
               "yacht": "Birthday on a yacht", "bachelor": "Beach bash"},
        "ru": {"bbq": "Шашлыки с компанией", "pool": "Вечеринка у бассейна",
               "yacht": "День рождения на яхте", "bachelor": "Пляжный движ"},
    },
    "gatsby": {
        "en": {"gala": "A night to remember", "tower": "Raise a glass",
               "jazz": "Dance till dawn", "rooftop": "Under the city lights"},
        "ru": {"gala": "Ночь, что запомнится", "tower": "Поднимем бокалы",
               "jazz": "Танцы до рассвета", "rooftop": "Под огнями города"},
    },
    "phangan": {
        "en": {"fire": "Fire on the beach", "neon": "Full moon nights",
               "boat": "Sunset on the water", "beachbar": "Raise a glass"},
        "ru": {"fire": "Огонь на пляже", "neon": "Ночи полнолуния",
               "boat": "Закат на воде", "beachbar": "Поднимем бокалы"},
    },
}
STYLE_CAPTIONS["real"] = STYLE_CAPTIONS["cartoon"]  # same party-type scenes

PIN = (
    '<svg width="34" height="45" viewBox="0 0 24 32" style="display:block;'
    'filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))">'
    '<path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" '
    'fill="#8C1C1C"/><circle cx="12" cy="11.5" r="4.3" fill="#F5F0EB"/></svg>'
)

BUBBLE_SPOTS = [
    (150, 300, 70), (900, 240, 48), (820, 520, 30), (240, 720, 40),
    (960, 900, 60), (120, 1150, 34), (880, 1320, 52), (300, 1480, 26),
    (640, 200, 22), (520, 1650, 38), (980, 1600, 30), (80, 560, 24),
]


def bubbles_svg(w: int, h: int) -> str:
    sx, sy = w / 1080, h / 1920
    return "".join(
        f'<circle cx="{cx * sx:.0f}" cy="{cy * sy:.0f}" r="{r * sx:.0f}" '
        f'fill="rgba(245,240,235,0.05)" stroke="rgba(201,168,76,0.28)" stroke-width="1.4"/>'
        for cx, cy, r in BUBBLE_SPOTS
    )


CARD_BG = """
    radial-gradient(120% 70% at 50% 8%, rgba(140,28,28,.30), transparent 55%),
    radial-gradient(120% 80% at 50% 108%, rgba(201,168,76,.16), transparent 60%),
    linear-gradient(165deg, #1E1712 0%, #141210 55%, #0E0B09 100%);"""

CTA_CSS = """.cta { display:inline-flex; align-items:center; gap:18px; background:var(--white); color:#141210;
  border-radius:999px; padding:32px 66px; font-family:'Inter'; font-weight:700; font-size:42px;
  letter-spacing:.05em; text-transform:uppercase; box-shadow:0 18px 46px rgba(0,0,0,.45); }
.cta .arrow { color:var(--wine); font-weight:800; }"""


def hook_card_html(lang: str, w: int, h: int, stage: int = 3) -> str:
    """Hook card. `stage` gates a staged reveal (opacity only, no layout shift):
    1 = kicker only, 2 = + headline/rule, 3 = + sub. Crossfading the stages in
    build gives a word-by-word 'reveal' that guides reading."""
    e = HOOK[lang]
    head_op = 1 if stage >= 2 else 0
    sub_op = 1 if stage >= 3 else 0
    if lang == "en":
        head_font = "font-family:'Bebas Neue';font-weight:400;letter-spacing:.02em;line-height:1.0;"
        head_size = 118
    else:
        head_font = "font-family:'Oswald';font-weight:500;letter-spacing:.005em;line-height:1.1;"
        head_size = 82
    return f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><style>
{FONT_FACES}
:root {{ --wine:#8C1C1C; --gold:#C9A84C; --white:#F5F0EB; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:{w}px; height:{h}px; }}
.card {{ position:relative; width:{w}px; height:{h}px; overflow:hidden;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:40px; text-align:center; padding:110px 96px; background:{CARD_BG} }}
.bubbles {{ position:absolute; inset:0; z-index:0; pointer-events:none; }}
.kicker, .headline, .rule, .sub {{ position:relative; z-index:1; }}
.kicker {{ font-family:'Inter',sans-serif; font-weight:600; font-size:34px;
  color:var(--gold); letter-spacing:.20em; text-transform:uppercase;
  text-shadow:0 2px 12px rgba(0,0,0,.5); }}
.headline {{ {head_font} text-transform:uppercase; color:var(--white);
  font-size:{head_size}px; max-width:920px; text-shadow:0 4px 24px rgba(0,0,0,.5); }}
.rule {{ width:180px; height:6px; border-radius:3px; background:var(--gold);
  box-shadow:0 2px 10px rgba(0,0,0,.4); }}
.sub {{ font-family:'Inter',sans-serif; font-weight:500; font-size:46px; line-height:1.3;
  color:#EDE4D6; max-width:840px; }}
</style></head><body>
<div class="card">
  <svg class="bubbles" viewBox="0 0 {w} {h}" aria-hidden="true">{bubbles_svg(w, h)}</svg>
  <p class="kicker">{e['kicker']}</p>
  <h1 class="headline" style="opacity:{head_op}">{e['headline']}</h1>
  <div class="rule" style="opacity:{head_op}"></div>
  <p class="sub" style="opacity:{sub_op}">{e['sub']}</p>
</div></body></html>"""


def cta_card_html(lang: str, w: int, h: int) -> str:
    e = CTA[lang]
    if lang == "en":
        head_font = "font-family:'Bebas Neue';font-weight:400;letter-spacing:.02em;line-height:1.02;"
        head_size = 112
    else:
        head_font = "font-family:'Oswald';font-weight:500;letter-spacing:.005em;line-height:1.12;"
        head_size = 72
    return f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><style>
{FONT_FACES}
:root {{ --wine:#8C1C1C; --gold:#C9A84C; --white:#F5F0EB; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:{w}px; height:{h}px; }}
.card {{ position:relative; width:{w}px; height:{h}px; overflow:hidden;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:38px; text-align:center; padding:100px 92px; background:{CARD_BG} }}
.bubbles {{ position:absolute; inset:0; z-index:0; pointer-events:none; }}
.logo, .headline, .rule, .sub, .cta, .geo {{ position:relative; z-index:1; }}
.logo {{ height:132px; width:132px; border-radius:26px; box-shadow:0 16px 44px rgba(0,0,0,.5); }}
.headline {{ {head_font} text-transform:uppercase; color:var(--white);
  font-size:{head_size}px; max-width:940px; text-shadow:0 4px 24px rgba(0,0,0,.5); }}
.rule {{ width:160px; height:6px; border-radius:3px; background:var(--gold);
  box-shadow:0 2px 10px rgba(0,0,0,.4); }}
.sub {{ font-family:'Inter',sans-serif; font-weight:500; font-size:42px; line-height:1.3;
  color:#EDE4D6; max-width:820px; }}
{CTA_CSS}
.geo {{ display:flex; align-items:center; gap:12px; }}
.geo span {{ font-family:'Inter'; font-weight:600; font-size:34px; color:var(--white);
  letter-spacing:.03em; }}
</style></head><body>
<div class="card">
  <svg class="bubbles" viewBox="0 0 {w} {h}" aria-hidden="true">{bubbles_svg(w, h)}</svg>
  <img class="logo" src="data:image/png;base64,{LOGO}" alt="Wine &amp; Whiskey">
  <h1 class="headline">{e['headline']}</h1>
  <div class="rule"></div>
  <p class="sub">{e['sub']}</p>
  <div class="cta"><span>{e['cta']}</span><span class="arrow">&rarr;</span></div>
  <div class="geo">{PIN}<span>Phuket</span></div>
</div></body></html>"""


def _caption_css(lang: str, h: int) -> str:
    cap_font = ("font-family:'Bebas Neue';font-weight:400;letter-spacing:.04em;"
                if lang == "en"
                else "font-family:'Oswald';font-weight:500;letter-spacing:.02em;")
    # Caption sits in the clean UPPER third — the lower-center is where the cats
    # move, so a bottom caption gets overlapped. Scrim points downward from the top.
    return f"""
.scrim {{ position:absolute; left:0; right:0; top:0; height:{int(h * 0.26)}px;
  background:linear-gradient(to bottom, rgba(0,0,0,.72), transparent); }}
.caption {{ position:absolute; left:140px; right:140px; top:{int(h * 0.085)}px; z-index:1;
  {cap_font} font-size:118px; line-height:1.06; text-transform:uppercase;
  color:#F5F0EB; text-align:center; text-shadow:0 6px 28px rgba(0,0,0,.65); }}"""


def captioned_scene_html(scene: Path, caption: str, lang: str, w: int, h: int) -> str:
    """Opaque still with caption baked in — for the Ken Burns path."""
    return f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><style>
{FONT_FACES}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:{w}px; height:{h}px; }}
.scene {{ position:relative; width:{w}px; height:{h}px; overflow:hidden; }}
.scene img.bg {{ width:100%; height:100%; object-fit:cover; display:block; }}
{_caption_css(lang, h)}
</style></head><body>
<div class="scene">
  <img class="bg" src="data:image/png;base64,{b64(scene)}" alt="">
  <div class="scrim"></div>
  <p class="caption">{caption}</p>
</div></body></html>"""


def caption_overlay_html(caption: str, lang: str, w: int, h: int) -> str:
    """Transparent scrim+caption only — overlaid onto a Runway clip."""
    return f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><style>
{FONT_FACES}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:{w}px; height:{h}px; background:transparent; }}
.scene {{ position:relative; width:{w}px; height:{h}px; overflow:hidden; }}
{_caption_css(lang, h)}
</style></head><body>
<div class="scene">
  <div class="scrim"></div>
  <p class="caption">{caption}</p>
</div></body></html>"""


def render_png(html: str, out: Path, width: int, height: int, transparent: bool = False) -> None:
    hp = WORK / (out.stem + ".html")
    hp.write_text(html, encoding="utf-8")
    args = [CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
            "--force-device-scale-factor=1", f"--window-size={width},{height}"]
    if transparent:
        args.append("--default-background-color=00000000")
    args += [f"--screenshot={out}", f"file://{hp}"]
    subprocess.run(args, check=True, capture_output=True)


def ken_burns(src: Path, out: Path, dur: float, zoom_in: bool, w: int, h: int) -> None:
    frames = int(round(dur * FPS))
    rate = 0.0022
    z = f"min(1.0+{rate}*on,1.18)" if zoom_in else f"max(1.18-{rate}*on,1.0)"
    vf = (
        f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,crop={w * 2}:{h * 2},"
        f"zoompan=z='{z}':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"fps={FPS}:s={w}x{h},format=yuv420p"
    )
    subprocess.run([
        "ffmpeg", "-y", "-i", str(src), "-vf", vf, "-c:v", "libx264",
        "-r", str(FPS), "-crf", "18", "-preset", "medium", str(out),
    ], check=True, capture_output=True)


def still_clip(png: Path, out: Path, dur: float, w: int, h: int, fade_in: float = 0.0) -> None:
    """A static PNG held for `dur` seconds as an libx264 clip (optional fade-in)."""
    vf = f"fps={FPS},format=yuv420p"
    if fade_in > 0:
        vf += f",fade=t=in:st=0:d={fade_in:.2f}"
    subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-t", f"{dur:.2f}", "-i", str(png),
        "-vf", vf, "-c:v", "libx264", "-r", str(FPS), "-crf", "18",
        "-preset", "medium", "-pix_fmt", "yuv420p", str(out),
    ], check=True, capture_output=True)


def hook_reveal_clip(lang: str, w: int, h: int, out: Path) -> None:
    """Staged hook reveal: kicker -> +headline -> +sub, crossfaded, ~HOOK_DUR.

    Elements appear in reading order so the offer is easy to take in. Stage
    durations are tuned so the crossfaded total equals HOOK_DUR."""
    stages = []
    for s in (1, 2, 3):
        png = WORK / f"hook_{lang}_s{s}.png"
        render_png(hook_card_html(lang, w, h, stage=s), png, w, h)
        stages.append(png)
    # concat_xfade length = d1 + d2 + d3 - 2*XFADE; solve d3 so it equals HOOK_DUR.
    d1, d2 = 0.85, 0.80
    d3 = HOOK_DUR - d1 - d2 + 2 * XFADE
    clips = []
    for s, (png, d, fi) in enumerate(zip(stages, (d1, d2, d3), (0.4, 0.0, 0.0))):
        c = WORK / f"hook_{lang}_c{s}.mp4"
        still_clip(png, c, d, w, h, fade_in=fi)
        clips.append(c)
    concat_xfade(clips, [d1, d2, d3], out)


def runway_scene_clip(src: Path, overlay_png: Path, out: Path, dur: float, w: int, h: int) -> None:
    """Cover-fit a Runway clip to WxH, burn the caption overlay, trim to dur."""
    fc = (
        f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1[bg];"
        f"[bg][1:v]overlay=0:0,trim=0:{dur:.2f},setpts=PTS-STARTPTS,format=yuv420p[v]"
    )
    subprocess.run([
        "ffmpeg", "-y", "-ss", f"{RUNWAY_TRIM_START:.2f}", "-i", str(src),
        "-i", str(overlay_png), "-filter_complex", fc, "-map", "[v]",
        "-an", "-c:v", "libx264", "-r", str(FPS), "-crf", "18", "-preset", "medium",
        str(out),
    ], check=True, capture_output=True)


def concat_xfade(clips, durs, out: Path) -> None:
    args = ["ffmpeg", "-y"]
    for c in clips:
        args += ["-i", str(c)]
    steps, prev = [], "[0:v]"
    running = durs[0]
    for i in range(1, len(clips)):
        off = running - XFADE
        label = "[vout]" if i == len(clips) - 1 else f"[v{i}]"
        steps.append(f"{prev}[{i}:v]xfade=transition=fade:duration={XFADE}:offset={off:.2f}{label}")
        prev = label
        running += durs[i] - XFADE
    args += ["-filter_complex", ";".join(steps), "-map", "[vout]",
             "-c:v", "libx264", "-crf", "18", "-preset", "medium",
             "-pix_fmt", "yuv420p", "-r", str(FPS), str(out)]
    subprocess.run(args, check=True, capture_output=True)


import array


def audio_len(audio: Path) -> float:
    out = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(audio),
    ], check=True, capture_output=True, text=True)
    return float(out.stdout.strip())


def detect_peak(audio: Path) -> float:
    """Return the time (s) of the highest-energy 0.25s window — the drop/peak.

    Decodes to 8kHz mono PCM and scans RMS per window, ignoring the first 15%
    (avoids an intro transient winning) so the build's climax is what we find.
    """
    raw = subprocess.run([
        "ffmpeg", "-v", "error", "-i", str(audio),
        "-ac", "1", "-ar", "8000", "-f", "s16le", "-",
    ], check=True, capture_output=True).stdout
    samples = array.array("h")
    samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
    sr, win = 8000, 2000  # 0.25s windows
    n = len(samples)
    start_i = int(n * 0.15)
    best_e, best_t = -1.0, 0.0
    for i in range(start_i, n - win, win):
        e = sum(s * s for s in samples[i:i + win])
        if e > best_e:
            best_e, best_t = e, i / sr
    return best_t


def mux_audio(video: Path, audio: Path, dur: float, out: Path, drop_target: float) -> None:
    alen = audio_len(audio)
    peak = detect_peak(audio)
    # Align the peak to the CTA moment, clamped so the window stays inside the track.
    start = min(max(peak - drop_target, 0.0), max(0.0, alen - dur))
    subprocess.run([
        "ffmpeg", "-y", "-i", str(video),
        "-ss", f"{start:.2f}", "-i", str(audio),
        "-filter_complex",
        f"[1:a]atrim=0:{dur:.2f},afade=t=in:st=0:d=0.4,"
        f"afade=t=out:st={max(dur - 1.0, 0):.2f}:d=1.0[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out),
    ], check=True, capture_output=True)


def build(motion: str, style: str) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    scenes_dir = STYLE_DIRS[style]["scenes"]
    runway_dir = STYLE_DIRS[style]["runway"]
    prefix = STYLE_DIRS[style]["prefix"]
    order = STYLE_ORDER[style]
    captions = STYLE_CAPTIONS[style]
    durs = [HOOK_DUR] + [PARTY_DUR] * len(order) + [CTA_DUR]
    total = durs[0] + sum(d - XFADE for d in durs[1:])
    # Time the CTA card becomes fully visible = where the jingle drop should land.
    drop_target = HOOK_DUR + len(order) * (PARTY_DUR - XFADE)

    for fmt, (w, h) in FORMATS.items():
        w2, h2 = w * 2, h * 2
        for lang in ("ru", "en"):
            # --- hook card (staged text reveal) ---
            hook_clip = WORK / f"hook_{style}_{fmt}_{lang}.mp4"
            hook_reveal_clip(lang, w, h, hook_clip)

            # --- scenes ---
            scene_clips = []
            for i, name in enumerate(order):
                out = WORK / f"{style}_{motion}_{fmt}_{name}_{lang}.mp4"
                rw = runway_dir / f"{name}.mp4"
                use_runway = (motion == "runway" and rw.exists())
                if use_runway:
                    ov = WORK / f"cap_{style}_{fmt}_{name}_{lang}.png"
                    render_png(caption_overlay_html(captions[lang][name], lang, w, h),
                               ov, w, h, transparent=True)
                    runway_scene_clip(rw, ov, out, PARTY_DUR, w, h)
                else:
                    if motion == "runway":
                        print(f"  [fallback] {name}: no Runway clip -> Ken Burns", flush=True)
                    still = WORK / f"scene_{style}_{fmt}_{name}_{lang}.png"
                    render_png(captioned_scene_html(scenes_dir / f"{name}.png",
                                                    captions[lang][name], lang, w2, h2),
                               still, w2, h2)
                    ken_burns(still, out, PARTY_DUR, zoom_in=(i % 2 == 0), w=w, h=h)
                scene_clips.append(out)

            # --- CTA card ---
            cta_png = WORK / f"cta_{fmt}_{lang}.png"
            render_png(cta_card_html(lang, w, h), cta_png, w, h)
            cta_clip = WORK / f"kb_{fmt}_cta_{lang}.mp4"
            ken_burns(cta_png, cta_clip, CTA_DUR, zoom_in=False, w=w, h=h)

            # --- assemble (silent) ---
            silent = WORK / f"silent_{style}_{lang}_{fmt}_{motion}.mp4"
            concat_xfade([hook_clip] + scene_clips + [cta_clip], durs, silent)

            present = {k: p for k, p in JINGLES.items() if p.exists()}
            if not present:
                final = HERE / f"{prefix}_{lang}_{fmt}_{motion}_silent_{VERSION}.mp4"
                silent.replace(final)
                print(f"FINAL (silent): {final.name}", flush=True)
            else:
                for jname, jpath in present.items():
                    final = HERE / f"{prefix}_{lang}_{fmt}_{motion}_{jname}_{VERSION}.mp4"
                    mux_audio(silent, jpath, total, final, drop_target)
                    print(f"FINAL: {final.name}", flush=True)

    print(f"[{style}/{motion}] total ~{total:.1f}s\n", flush=True)


def main() -> None:
    args = sys.argv[1:]
    motions = ["kenburns", "runway"]
    if "--motion" in args:
        i = args.index("--motion")
        motions = [args[i + 1]]
        args = args[:i] + args[i + 2:]
    styles = ["cartoon"]
    if "--style" in args:
        i = args.index("--style")
        styles = [args[i + 1]]
        args = args[:i] + args[i + 2:]
    for st in styles:
        for m in motions:
            print(f"=== building style={st} motion={m} ===", flush=True)
            build(m, st)


if __name__ == "__main__":
    main()
