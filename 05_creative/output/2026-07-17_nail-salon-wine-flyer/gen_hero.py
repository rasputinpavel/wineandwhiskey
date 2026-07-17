#!/usr/bin/env python3
"""Generate the nail-salon wine flyer hero image via Nano Banana Pro (Gemini 3 Pro Image).

Reads GEMINI_API_KEY (fallback NANO_BANANA_API_KEY) from the repo-root .env.local.
Saves PNGs to assets/hero_<variant>.png. No text baked in — headline is overlaid in HTML.

Usage:
    python3 gen_hero.py            # all variants
    python3 gen_hero.py a          # just variant a
"""
import base64
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ASSETS = os.path.join(HERE, "assets")

# W&W Light mode — signature: hard directional afternoon sun, long geometric
# shadows on light travertine, rich colored liquid, NO faces, no rings/bracelets.
ANCHOR = (
    "Editorial lifestyle product photography, photorealistic, high quality. "
    "Hard directional late-afternoon sunlight coming in low from one side, "
    "casting long, crisp, geometric shadows across a light warm travertine / "
    "cream stone surface — the shadow pattern is a key part of the composition. "
    "Warm natural tones, cream #F5F0EB and light stone, a single rich accent of "
    "wine color. Calm, alive, uncontrived, premium wine-bar mood. "
    "No faces, no full body, no logos, no visible text, no rings, no bracelets, "
    "no watch. Clean and tasteful, never messy."
)

VARIANT = {
    # A — single manicured hand holding a glass of red wine (brand-tie: wine-red nails)
    "a": (
        "A woman's hand with a fresh, elegant manicure — glossy soft wine-red "
        "polish, neatly shaped nails — gently holds the stem of a wine glass "
        "filled with deep ruby red wine, catching the sunlight. The forearm is "
        "cropped above the wrist, sleeve of a light linen shirt. The glass and "
        "hand sit slightly off-center in the lower two-thirds of the frame; keep "
        "the UPPER THIRD calmer and more open (soft sunlit stone, empty negative "
        "space) so a headline can be placed over it later."
    ),
    # B — trio of glasses (sparkling / white / red), a manicured hand reaching for one
    "b": (
        "Three wine glasses stand in a loose row on the sunlit travertine, each "
        "with a different drink: sparkling wine with fine bubbles, pale white "
        "wine, and deep red wine — left to right. A woman's hand with a fresh, "
        "elegant nude-rose manicure reaches in from the right toward the glasses, "
        "forearm cropped, light linen sleeve. Long geometric shadows fall from "
        "the three glasses across the stone. Keep the UPPER portion calmer (sunlit "
        "empty stone) as clean negative space for a headline overlay."
    ),
}

MODEL = "gemini-3-pro-image-preview"
FALLBACK_MODEL = "gemini-2.5-flash-image"


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


def gen(key, model, prompt, out_path, aspect="2:3"):
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={key}"
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect},
        },
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.load(resp)
    parts = data["candidates"][0]["content"]["parts"]
    for p in parts:
        inline = p.get("inlineData") or p.get("inline_data")
        if inline and inline.get("data"):
            with open(out_path, "wb") as fh:
                fh.write(base64.b64decode(inline["data"]))
            return True
    raise RuntimeError(f"no image in response: {json.dumps(data)[:400]}")


def main():
    env = load_env(os.path.join(REPO_ROOT, ".env.local"))
    key = (env.get("GEMINI_API_KEY") or env.get("NANO_BANANA_API_KEY")
           or os.environ.get("GEMINI_API_KEY"))
    if not key:
        sys.exit("No GEMINI_API_KEY / NANO_BANANA_API_KEY in .env.local")

    os.makedirs(ASSETS, exist_ok=True)
    which = [a for a in sys.argv[1:] if a in VARIANT] or list(VARIANT)
    for v in which:
        prompt = f"{ANCHOR} {VARIANT[v]} Format: vertical portrait 2:3."
        out = os.path.join(ASSETS, f"hero_{v}.png")
        for model in (MODEL, FALLBACK_MODEL):
            print(f"[gen] {v} via {model} ...", flush=True)
            try:
                gen(key, model, prompt, out)
                print(f"[ok ] {v} -> {out} ({os.path.getsize(out)//1024} KB)", flush=True)
                break
            except urllib.error.HTTPError as e:
                print(f"[ERR] {v} {model}: HTTP {e.code} {e.read().decode()[:300]}", flush=True)
            except Exception as e:  # noqa
                print(f"[ERR] {v} {model}: {e}", flush=True)


if __name__ == "__main__":
    main()
