#!/usr/bin/env python3
"""
Background-removal utility for product photography.

Lifts the foreground subject (bottle, glass, etc.) from a source image and
writes a transparent PNG, tightly cropped to the subject's bounding box.

Usage:
    python3 lift_subject.py <input> <output> [--pad 20]
    python3 lift_subject.py <input> <output_dir>/   # writes <input-name>.png

Requires: rembg, Pillow, onnxruntime (installed in 03_automation/.venv-img).

Run via the project venv:
    03_automation/.venv-img/bin/python3 03_automation/lift_subject.py <in> <out>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
from rembg import remove


def lift(in_path: Path, out_path: Path, pad: int = 20) -> tuple[int, int]:
    src = Image.open(in_path).convert("RGBA")
    cut = remove(src)

    # Tight crop to the non-transparent bounding box (+ padding).
    bbox = cut.getbbox()
    if bbox is not None:
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(cut.width, x1 + pad)
        y1 = min(cut.height, y1 + pad)
        cut = cut.crop((x0, y0, x1, y1))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cut.save(out_path, "PNG")
    return cut.size


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    in_path = Path(sys.argv[1])
    out_arg = Path(sys.argv[2])
    pad = 20
    for a in sys.argv[3:]:
        if a.startswith("--pad="):
            pad = int(a.split("=", 1)[1])
        elif a == "--pad" and sys.argv.index(a) + 1 < len(sys.argv):
            pad = int(sys.argv[sys.argv.index(a) + 1])

    out_path = (
        out_arg / (in_path.stem + ".png")
        if out_arg.is_dir() or sys.argv[2].endswith("/")
        else out_arg
    )

    w, h = lift(in_path, out_path, pad=pad)
    print(f"wrote {out_path} ({w}×{h})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
