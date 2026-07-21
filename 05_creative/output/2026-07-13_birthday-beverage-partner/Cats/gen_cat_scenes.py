#!/usr/bin/env python3
"""Generate the 3D-Pixar cat party scenes via OpenAI gpt-image-1.

Cat Party creative (Wave-1b) — a scroll-stopping A/B variant of the human
birthday montage. Charming anthropomorphic 3D cats celebrating in Phuket.
ONE shared set (cats have no ethnicity → no RU/EN cast split).

Meta-safe: absolutely NO alcohol signal — no bottles, no wine/champagne glasses,
no cocktails, no pouring/drinking. The story is the celebration and the place.
Floating iridescent soap bubbles are the ONLY 'sparkle' cue.

Reads OPENAI_API_KEY from the repo-root .env.local.
Saves PNGs to assets/scenes/<angle>.png.

Usage:
    python3 gen_cat_scenes.py                       # all 4, cartoon style
    python3 gen_cat_scenes.py --style real          # all 4, photoreal adult cats
    python3 gen_cat_scenes.py --style real bbq yacht  # only these
"""
import base64
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# Cats/ is one level deeper than the human scripts → repo root is 4 up.
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

# Two parallel style versions (A/B). Cartoon = original 3D-Pixar set; real =
# photoreal adult cats. Each writes to its own scenes dir so neither clobbers
# the other.
SCENE_DIRS = {"cartoon": os.path.join(HERE, "assets", "scenes"),
              "real": os.path.join(HERE, "assets", "scenes_real")}

# ---- shared style anchor (identical across all 4 for a consistent set) ----
ANCHOR_REAL = (
    "Photorealistic cinematic film still — believable anthropomorphic cats with "
    "real, natural fur (individually rendered strands, realistic sheen and depth), "
    "natural feline eyes and realistic proportions, expressive but restrained, "
    "appealing and charming (NOT creepy, NOT uncanny, NOT cartoon, NOT chibi, NOT "
    "big-eyed toy, NOT childish, NOT Pixar, NOT flat 2D). High-end live-action VFX "
    "creature realism, like the talking-animal characters in a premium feature "
    "film. The cats stand and behave like stylish ADULTS at a grown-up party — "
    "fashionable adult summer nightlife wardrobe: crisp linen shirts, tailored "
    "shorts and chinos, elegant summer cocktail dresses, blazers, sunglasses, "
    "tasteful jewelry and watches. A sophisticated, upscale adult birthday "
    "celebration in Phuket, Thailand — luxury tropical vacation and nightlife "
    "energy: turquoise sea, palm trees, a chic villa, warm golden light. The cats "
    "laugh, dance and celebrate together, caught mid-motion, full of grown-up "
    "personality and cool confidence. Warm natural color palette — honey-amber "
    "#C9A84C, cream #F5F0EB, deep teal water, lush green palms. "
    "IMPORTANT: absolutely NO alcohol anywhere in the frame — no bottles, no wine "
    "or champagne glasses, no cocktails, no drinks in paws or on tables. Festive "
    "props are welcome: balloons, confetti, paper streamers, string fairy lights, "
    "a birthday cake, pool floats, sparklers, colorful fruity smoothies in fun "
    "cups. A subtle 'bubbles' cue: iridescent floating soap bubbles drifting "
    "through the warm light — the only 'sparkling' hint, never a drink."
)

ANCHOR_CARTOON = (
    "Charming, friendly 3D animated feature-film still — Pixar / Illumination "
    "quality CGI, cinematic soft global illumination, subsurface-scattered fluffy "
    "fur with individually rendered strands, big expressive glossy eyes, warm and "
    "adorable, premium studio render (NOT flat cartoon, NOT 2D, NOT photoreal cat, "
    "NOT creepy, NOT uncanny). The characters are cute anthropomorphic cats that "
    "stand and act like people, wearing stylish summer resort outfits and tiny "
    "sunglasses. A joyful birthday celebration in Phuket, Thailand — luxury "
    "tropical vacation energy: turquoise sea, palm trees, a chic villa, warm golden "
    "light. The cats laugh, dance and celebrate together, caught mid-motion, full "
    "of personality and fun. Warm natural color palette — honey-amber #C9A84C, "
    "cream #F5F0EB, deep teal water, lush green palms. "
    "IMPORTANT: absolutely NO alcohol anywhere in the frame — no bottles, no wine "
    "or champagne glasses, no cocktails, no drinks in paws or on tables. Festive "
    "props are welcome: balloons, confetti, paper streamers, string fairy lights, "
    "a birthday cake, pool floats, sparklers, colorful fruity smoothies in fun "
    "cups. A playful 'bubbles' cue: lots of iridescent floating soap bubbles "
    "drifting through the warm light — the only 'sparkling' hint, never a drink."
)

ANCHORS = {"cartoon": ANCHOR_CARTOON, "real": ANCHOR_REAL}

# One recurring hero to anchor character consistency across the 4 scenes.
HEROES = {
    "cartoon": (
        "Recurring hero character across all scenes: a charming ginger-orange tabby "
        "cat with a cream chest, bright green eyes and small round tortoiseshell "
        "sunglasses pushed up — always present and recognizable, joined by a small "
        "friend group of other cute cats (a fluffy grey cat, a white cat, a black cat)."
    ),
    "real": (
        "Recurring hero character across all scenes: a handsome, realistic "
        "ginger-orange tabby tomcat with a cream chest, natural amber-green eyes and "
        "an open patterned linen resort shirt, wearing stylish sunglasses — a "
        "confident adult, always present and recognizable, joined by a small group of "
        "well-dressed adult cat friends (a sleek grey cat, an elegant white cat, a "
        "cool black cat) in fashionable party outfits."
    ),
}

SCENE = {
    "bbq": (
        "Composition: a relaxed evening backyard barbecue at a Phuket villa — the "
        "cats gathered around a glowing grill on a wooden deck, one cat proudly "
        "flipping fruit-and-veg skewers with tongs, others laughing and chatting, "
        "warm string lights overhead, tall palm trees, a few floating soap bubbles, "
        "platters of grilled food and fresh fruit on a rustic table (NO bottles, NO "
        "drink glasses). Easy, cozy, golden-warm mood. Keep the UPPER portion (sky, "
        "lights, palms) as clean negative space. Mood: laid-back gathering."
    ),
    "pool": (
        "Composition: a lively daytime pool party at a luxury Phuket villa — the "
        "cats having fun in and around a sparkling turquoise pool with oversized "
        "flamingo and swan inflatable floats, one cat mid-jump, others splashing, "
        "laughing and dancing, tall palm trees and the white villa behind, bright "
        "tropical sun, lots of floating soap bubbles catching the light (NO bottles, "
        "NO drink glasses). Energetic and joyful. Keep the UPPER portion (palms, "
        "villa, sky) clean. Mood: friends pool party."
    ),
    "yacht": (
        "Composition: a joyful birthday celebration on the deck of a luxury yacht "
        "cruising past Phuket's green tropical islands and turquoise sea — a group "
        "of stylish girl-cats in cute summer dresses and sun hats laughing, dancing "
        "and throwing their paws up, a birthday cake with lit sparklers, a few "
        "colorful balloons low in the frame, floating soap bubbles, golden "
        "late-afternoon light (NO bottles, NO drink glasses, NO banners or text). "
        "Keep the UPPER THIRD completely clean — open bright sky and sea horizon "
        "only, no banners, no bunting, no lettering — as negative space for a "
        "headline overlay. Mood: celebratory girls' yacht trip."
    ),
    "bachelor": (
        "Composition: a fun beach party on a Phuket beach at golden hour — a group "
        "of the cats celebrating, laughing, cheering and jumping, playing around, "
        "tall palm trees and the sea behind, a small beach bonfire just starting, "
        "string lights strung nearby, floating soap bubbles and a couple of "
        "sparklers (NO bottles, NO drink glasses). High-energy and good-natured. "
        "Keep the UPPER portion (sky, sea) clean. Mood: beach birthday bash."
    ),
}


def load_env(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def gen_openai(key, prompt, out_path):
    body = json.dumps({
        "model": "gpt-image-1",
        "prompt": prompt,
        "size": "1024x1536",   # portrait, closest to story
        "quality": "high",
        "n": 1,
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.load(resp)
    b64 = data["data"][0]["b64_json"]
    with open(out_path, "wb") as fh:
        fh.write(base64.b64decode(b64))


def main():
    env = load_env(os.path.join(REPO_ROOT, ".env.local"))
    key = env.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("No OPENAI_API_KEY in .env.local")

    args = sys.argv[1:]
    style = "cartoon"
    if "--style" in args:
        i = args.index("--style")
        style = args[i + 1]
        args = args[:i] + args[i + 2:]
    if style not in ANCHORS:
        sys.exit(f"unknown --style {style} (choose: {', '.join(ANCHORS)})")

    scenes_dir = SCENE_DIRS[style]
    os.makedirs(scenes_dir, exist_ok=True)
    anchor, hero = ANCHORS[style], HEROES[style]
    angles = [a for a in args if a in SCENE] or list(SCENE)
    for angle in angles:
        prompt = f"{anchor} {hero} {SCENE[angle]} Format: vertical 9:16 story."
        out = os.path.join(scenes_dir, f"{angle}.png")
        print(f"[gen] {angle} -> {out} ...", flush=True)
        try:
            gen_openai(key, prompt, out)
            print(f"[ok ] {angle} ({os.path.getsize(out)//1024} KB)", flush=True)
        except urllib.error.HTTPError as e:
            print(f"[ERR] {angle}: HTTP {e.code} {e.read().decode()[:500]}", flush=True)
        except Exception as e:  # noqa
            print(f"[ERR] {angle}: {e}", flush=True)


if __name__ == "__main__":
    main()
