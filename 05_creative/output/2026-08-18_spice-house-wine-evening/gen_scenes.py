#!/usr/bin/env python3
"""Generate two realistic scene illustrations for the Spice House proposal
via Nano Banana Pro (Gemini 3 Pro Image). Text-to-image, no input photo.

  seated.png    — Option 1: long seated wine dinner
  freeflow.png  — Option 2: stand-up reception with tasting stations

Warm brand palette (honey-amber / cream / travertine / wine-red), evening light,
composed to avoid clear faces (high angle, from behind — hands, glasses, tables).

Reads GEMINI_API_KEY (fallback NANO_BANANA_API_KEY) from repo-root .env.local.

Usage: python3 gen_scenes.py [seated|freeflow ...]
"""
import base64, json, os, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MODEL = "gemini-3-pro-image-preview"
FALLBACK_MODEL = "gemini-2.5-flash-image"
ASPECT = "16:9"

BASE = (
    "Warm candid photograph, real photographic look with natural film grain and "
    "true-to-life colour — NOT CGI, NOT 3D render, NOT illustration, NOT AI-looking, "
    "NOT a stiff stock photo, no text or lettering anywhere. Evening candlelit mood. "
    "Palette: honey-amber gold #C9A84C, cream #F5F0EB, warm travertine stone, deep "
    "wine-red #8C1C1C and dark walnut wood; soft warm glow, gentle shadows, shallow "
    "depth of field."
)

# For the two 'scene' shots — informal gathering of friends on a tropical terrace.
CASUAL = (
    " Setting: an open-air terrace in Phuket, Thailand on a warm tropical evening — "
    "lush palm trees and greenery around, warm string fairy lights overhead, a soft "
    "sunset/dusk sky, relaxed island resort vibe. Vibe: a joyful gathering of close "
    "friends — genuine candid laughter, warm smiles and real natural faces, people "
    "leaning in, talking and clinking glasses. Everyone in light summer clothes for "
    "hot weather (linen shirts, short sleeves, flowy summer dresses, light fabrics) "
    "— absolutely NO sweaters, knitwear, jackets, blazers or neckties, nothing warm "
    "or corporate. Breezy, tropical, intimate and unposed, full of life and fun."
)

# For the product close-up — hands only, no faces needed.
NOFACE = (
    " Premium and intimate. Compose close-up from a high angle so we mainly see "
    "hands, the vials and the table; no clear human face in frame."
)

SCENES = {
    "seated": (
        "A big long dinner table set outdoors on a palm-fringed terrace for a friends' "
        "wine evening. Friends sit close together down both sides, laughing, chatting "
        "and raising their glasses of red and white wine. Plates of shared food, cream "
        "linen runner, low candles and small tropical flowers down the middle, a few "
        "open wine bottles. One friend leans over to top up another's glass. Palms and "
        "warm string lights behind them, warm dusk sky. Happy and full of life."
        + BASE + CASUAL
    ),
    "freeflow": (
        "A relaxed evening terrace party where friends stand around, mingle and taste "
        "wine together outdoors among palms. Small groups gather at a couple of tall "
        "round tables and by a side counter lined with wine bottles and simple snack "
        "platters, where someone pours a glass for a friend. Everyone holds a glass, "
        "laughing and chatting. Warm string lights strung between palm trees overhead, "
        "warm tropical night. Lively and fun." + BASE + CASUAL
    ),
    "nosekit": (
        "A wine-aroma tasting kit (in the spirit of 'Le Nez du Vin') open on a warm "
        "travertine table: an elegant wooden presentation case holding neat rows of "
        "many small identical numbered glass aroma vials with cork/dropper tops. A "
        "hand lifts one little vial up toward the nose to smell it — only fingers and "
        "the vial in focus, no face. Beside the case, a few natural aroma cues are "
        "arranged: a coffee bean, a fresh cherry, a vanilla pod, a curl of citrus "
        "peel, a rose petal. Warm candlelight, cosy and intriguing, shallow depth of "
        "field, close-up. " + BASE + NOFACE
    ),
}


def load_env(path):
    env = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def gen(key, model, prompt, out_path):
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": ASPECT},
        },
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.load(resp)
    for p in data["candidates"][0]["content"]["parts"]:
        inline = p.get("inlineData") or p.get("inline_data")
        if inline and inline.get("data"):
            open(out_path, "wb").write(base64.b64decode(inline["data"]))
            return True
    raise RuntimeError(f"no image in response: {json.dumps(data)[:400]}")


def main():
    env = load_env(os.path.join(REPO_ROOT, ".env.local"))
    key = (env.get("GEMINI_API_KEY") or env.get("NANO_BANANA_API_KEY")
           or os.environ.get("GEMINI_API_KEY"))
    if not key:
        sys.exit("No GEMINI_API_KEY / NANO_BANANA_API_KEY in .env.local")
    want = [a for a in sys.argv[1:] if a in SCENES] or list(SCENES)
    for name in want:
        out = os.path.join(HERE, f"{name}.png")
        for model in (MODEL, FALLBACK_MODEL):
            print(f"[gen] {name} via {model} ...", flush=True)
            try:
                gen(key, model, SCENES[name], out)
                print(f"[ok ] -> {out} ({os.path.getsize(out)//1024} KB)", flush=True)
                break
            except urllib.error.HTTPError as e:
                print(f"[ERR] {model}: HTTP {e.code} {e.read().decode()[:300]}", flush=True)
            except Exception as e:  # noqa
                print(f"[ERR] {model}: {e}", flush=True)


if __name__ == "__main__":
    main()
