#!/usr/bin/env bash
# Render prosecco-rose-promo.html → 1080×1350 PNG (+ preview) for WhatsApp.
# Renders at 2× via headless Chrome, then supersamples down for crisp text.
set -euo pipefail
cd "$(dirname "$0")"
DATE="2026-06-17"
STEM="prosecco-rose-promo"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
VENV="../../../03_automation/.venv-img/bin/python3"

"$CHROME" --headless=new --force-device-scale-factor=2 --window-size=1080,1350 \
  --default-background-color=00000000 --hide-scrollbars \
  --screenshot="$PWD/_render2x.png" "file://$PWD/${STEM}.html"

"$VENV" - "$DATE" "$STEM" <<'PY'
import sys
from PIL import Image
date, stem = sys.argv[1], sys.argv[2]
im = Image.open("_render2x.png").convert("RGB")
im.resize((1080, 1350), Image.LANCZOS).save(f"{stem}_{date}.png")
im.resize((900, 1125), Image.LANCZOS).save(f"{stem}_{date}_preview.png")
print("wrote", f"{stem}_{date}.png", "and preview")
PY
rm -f _render2x.png
