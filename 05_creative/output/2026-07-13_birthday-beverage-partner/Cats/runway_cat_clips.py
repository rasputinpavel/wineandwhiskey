#!/usr/bin/env python3
"""Runway image->video for the Cat Party scenes.

Each of the 4 cat stills (assets/scenes/<scene>.png) is the anchor frame; we
ask Runway to animate it with a MOTION-ONLY prompt (per Runway Academy: the
input image carries identity, the prompt describes only movement). Scenes are
distinct party locations, so no last-frame chaining — each still anchors itself.

Output: assets/runway/<scene>.mp4 (5s clips; build_cat_montage.py trims to ~1.2s).
On any per-scene failure we log and continue — the montage falls back to Ken
Burns for whatever clip is missing.

Reads RUNWAY_API_KEY from repo-root .env.local.

Usage:
    python3 runway_cat_clips.py                 # all 4
    python3 runway_cat_clips.py yacht bbq       # only these
    python3 runway_cat_clips.py --model gen3a_turbo
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
# Style versions (cartoon vs photoreal adult cats) read/write separate dirs.
SCENE_DIRS = {"cartoon": os.path.join(HERE, "assets", "scenes"),
              "real": os.path.join(HERE, "assets", "scenes_real")}
OUT_DIRS = {"cartoon": os.path.join(HERE, "assets", "runway"),
            "real": os.path.join(HERE, "assets", "runway_real")}

API_BASE = "https://api.dev.runwayml.com/v1"
API_VERSION = "2024-11-06"
RATIO = "720:1280"      # 9:16
DURATION = 5            # Runway minimum; montage trims to ~1.2s

# Motion-only prompts (identity is locked by the input still). Camera moves kept
# gentle to avoid fighting the already-dynamic poses in the stills.
MOTION = {
    "bbq": (
        "The ginger cat flips the skewers on the grill and grins; the other cats "
        "laugh and sway. Slow gentle push in, subtle handheld. String lights "
        "flicker, soap bubbles drift up, embers glow."
    ),
    "pool": (
        "The white cat splashes down into the pool as the others cheer and wave "
        "their paws, water sparkling. Slow push in, gentle handheld. Confetti and "
        "soap bubbles drift through the sunny air."
    ),
    "yacht": (
        "The girl-cats throw their paws up and dance, the cake sparklers fizzing "
        "and balloons swaying. Slow orbit around the group, smooth gimbal. Soap "
        "bubbles drift and the sea shimmers behind them."
    ),
    "bachelor": (
        "The ginger cat leaps and dances on the sand while the black cat waves a "
        "sparkler and everyone cheers. Slow push in, subtle handheld. The bonfire "
        "flickers, bubbles float, waves roll behind."
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


def data_uri(scene_png, tmp_dir):
    """Center-crop the still to 720x1280 JPG and return a base64 data URI.

    Downscaling keeps the promptImage well under Runway's data-URI size cap and
    matches the 9:16 output ratio so Runway doesn't re-crop.
    """
    tmp = os.path.join(tmp_dir, "_in_" + os.path.basename(scene_png).replace(".png", ".jpg"))
    subprocess.run([
        "ffmpeg", "-y", "-i", scene_png,
        "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
        "-q:v", "3", tmp,
    ], check=True, capture_output=True)
    with open(tmp, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    os.remove(tmp)
    return f"data:image/jpeg;base64,{b64}"


def api(method, path, key, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{API_BASE}{path}", data=data, method=method,
        headers={
            "Authorization": f"Bearer {key}",
            "X-Runway-Version": API_VERSION,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def submit(key, model, scene, scenes_dir, out_dir):
    body = {
        "model": model,
        "promptImage": data_uri(os.path.join(scenes_dir, f"{scene}.png"), out_dir),
        "promptText": MOTION[scene],
        "ratio": RATIO,
        "duration": DURATION,
    }
    return api("POST", "/image_to_video", key, body)["id"]


def poll(key, task_id, timeout=600):
    start = time.time()
    while time.time() - start < timeout:
        t = api("GET", f"/tasks/{task_id}", key)
        st = t.get("status")
        if st == "SUCCEEDED":
            return t["output"][0]
        if st in ("FAILED", "CANCELLED"):
            raise RuntimeError(f"task {st}: {t.get('failure', '')}")
        time.sleep(6)
    raise TimeoutError("Runway task timed out")


def download(url, out_path):
    with urllib.request.urlopen(url, timeout=180) as resp, open(out_path, "wb") as fh:
        fh.write(resp.read())


def main():
    args = [a for a in sys.argv[1:]]
    model = "gen4_turbo"
    if "--model" in args:
        i = args.index("--model")
        model = args[i + 1]
        args = args[:i] + args[i + 2:]
    style = "cartoon"
    if "--style" in args:
        i = args.index("--style")
        style = args[i + 1]
        args = args[:i] + args[i + 2:]
    if style not in SCENE_DIRS:
        sys.exit(f"unknown --style {style}")
    scenes_dir, out_dir = SCENE_DIRS[style], OUT_DIRS[style]
    scenes = [a for a in args if a in MOTION] or list(MOTION)

    env = load_env(os.path.join(REPO_ROOT, ".env.local"))
    key = env.get("RUNWAY_API_KEY") or os.environ.get("RUNWAY_API_KEY")
    if not key:
        sys.exit("No RUNWAY_API_KEY in .env.local")
    os.makedirs(out_dir, exist_ok=True)

    # Submit all first, then poll — clips render in parallel on Runway's side.
    tasks = {}
    for s in scenes:
        try:
            tasks[s] = submit(key, model, s, scenes_dir, out_dir)
            print(f"[submit] {s} -> task {tasks[s]}", flush=True)
        except urllib.error.HTTPError as e:
            print(f"[ERR submit] {s}: HTTP {e.code} {e.read().decode()[:400]}", flush=True)
        except Exception as e:  # noqa
            print(f"[ERR submit] {s}: {e}", flush=True)

    for s, tid in tasks.items():
        out_path = os.path.join(out_dir, f"{s}.mp4")
        try:
            url = poll(key, tid)
            download(url, out_path)
            print(f"[ok] {s} -> {out_path} ({os.path.getsize(out_path)//1024} KB)", flush=True)
        except Exception as e:  # noqa
            print(f"[ERR poll] {s}: {e}  (montage will Ken-Burns this scene)", flush=True)


if __name__ == "__main__":
    main()
