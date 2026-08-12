#!/usr/bin/env python3
"""Generate the "Wine by Glass" A1 lightbox-poster hero via Nano Banana Pro.

Reads GEMINI_API_KEY (fallback NANO_BANANA_API_KEY) from repo-root .env.local.
No text baked in — all copy is overlaid crisply in HTML (build.py).

Concept: a glass being POURED / filled, wine catching low warm light. Brand
"Light mode": hard directional afternoon sun, long shadows on light travertine,
no faces. Designed to glow inside a backlit double-sided stand and read from afar.

Usage:
    python3 gen_hero.py           # all variants
    python3 gen_hero.py red       # just one
"""
import base64
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ASSETS = os.path.join(HERE, "assets")

ANCHOR = (
    "Editorial lifestyle beverage photography, photorealistic, high quality, "
    "dramatic and appetising. Hard directional late-afternoon sunlight raking in "
    "low from one side, casting long crisp geometric shadows across a light warm "
    "travertine / cream stone surface #F5F0EB — the shadow is part of the "
    "composition. Warm natural palette, cream stone and one rich accent of wine "
    "colour, glass that glows where the light passes through it. Premium wine-bar "
    "mood, calm and alive. No faces, no full body, no logos, no visible text, "
    "no rings, no bracelets, no watch. Clean and tasteful, never messy."
)

VARIANT = {
    # SINGLE — one single glass of red wine, centred, catching the light
    "single": (
        "ONE single large stemmed wine glass, filled with deep ruby red wine that "
        "glows translucent garnet where the low sunlight passes through it. The "
        "glass stands alone, centred, on the light travertine, casting one long "
        "crisp geometric shadow to the side. Nothing else in frame — no bottle, no "
        "other glasses. Generous calm sunlit empty stone all around the glass as "
        "negative space (top and bottom especially) so headline and text can sit "
        "above and below it later. Elegant, iconic, minimal."
    ),
    # SINGLE-POUR — one glass being filled, still just one glass
    "single_pour": (
        "ONE single large stemmed wine glass being filled with deep ruby red wine "
        "poured in a clean stream from a bottle that enters only from the top edge "
        "of the frame; the pour stream and a few droplets are frozen in motion and "
        "glow in the low sunlight. Just the one glass, centred, casting a long "
        "geometric shadow across the light travertine. Calm sunlit empty stone "
        "around it as negative space above and below. Elegant, dynamic, minimal."
    ),
    # RED — a stream of deep red wine pouring into a glass, mid-pour
    "red": (
        "A dramatic close-up of deep ruby red wine being POURED in a clean stream "
        "from a bottle into a large stemmed wine glass that is about one-third "
        "full. The pour stream and a few fine droplets are frozen in motion and "
        "catch the low sunlight, glowing translucent garnet-red. The glass sits "
        "slightly LEFT of centre in the LOWER two-thirds of a tall vertical frame; "
        "keep the UPPER THIRD calmer and more open — soft sunlit empty stone and "
        "warm negative space — so a large headline can be placed there later. "
        "Long shadow of the glass rakes across the stone to one side."
    ),
    # TRIO-GLOW — one glass being filled, two more glowing behind (subtle nod to R/W/Sparkling)
    "glow": (
        "A tall vertical frame. In the foreground, deep red wine is being POURED "
        "into a large stemmed glass, the stream and droplets frozen mid-motion and "
        "glowing in the raking sunlight. Softly out of focus behind it stand two "
        "more glasses catching the light — one of pale golden white wine, one of "
        "sparkling wine alive with fine rising bubbles — reading left to right as a "
        "trio without competing with the hero pour. Everything sits in the LOWER "
        "two-thirds; keep the UPPER THIRD calm sunlit empty stone as clean negative "
        "space for a headline overlay. Long geometric glass shadows across the stone."
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
        prompt = f"{ANCHOR} {VARIANT[v]} Format: tall vertical portrait 2:3."
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
