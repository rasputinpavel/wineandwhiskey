#!/usr/bin/env python3
"""Contact sheet: each variant as it reads by day, lit at night, and from far away.

Night column fakes a backlit stand — the light areas bloom, the black stays
black. Squint column throws the poster away to ~25 m: whatever survives there
is what a passer-by actually gets.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageDraw

HERE = Path(__file__).resolve().parent
DATE = "2026-09-21"
KEYS = ("a", "b", "c")
COL_W = 520
PAD = 26
LABEL_H = 44


def night(img: Image.Image) -> Image.Image:
    """Backlit simulation: bloom off the bright areas, black stays black."""
    bloom = img.filter(ImageFilter.GaussianBlur(radius=img.width // 42))
    bloom = ImageEnhance.Brightness(bloom).enhance(1.35)
    lit = ImageChops.screen(img, ImageChops.multiply(bloom, bloom))
    lit = ImageEnhance.Brightness(lit).enhance(1.06)
    return ImageEnhance.Color(lit).enhance(1.12)


def squint(img: Image.Image, px: int = 34) -> Image.Image:
    """What's left at ~25 m: drop to a handful of pixels and blow it back up."""
    small = img.resize((px, int(px * img.height / img.width)), Image.LANCZOS)
    return small.resize(img.size, Image.BICUBIC)


def main():
    cols = []
    for k in KEYS:
        src = Image.open(HERE / f"wine-by-glass-a1-night-{k}_{DATE}_preview.png").convert("RGB")
        lit = night(src)
        src.save(HERE / f"wine-by-glass-a1-night-{k}_{DATE}_night.png")
        cols.append((k, [("day", src), ("night (lit)", lit), ("25 m", squint(lit))]))

    h = int(COL_W * cols[0][1][0][1].height / cols[0][1][0][1].width)
    sheet = Image.new("RGB", (PAD + (COL_W + PAD) * 3, PAD + (h + LABEL_H + PAD) * 3), "#1b1917")
    d = ImageDraw.Draw(sheet)
    for ci, (k, rows) in enumerate(cols):
        x = PAD + ci * (COL_W + PAD)
        for ri, (name, im) in enumerate(rows):
            y = PAD + ri * (h + LABEL_H + PAD)
            d.text((x + 2, y + 6), f"{k.upper()} — {name}", fill="#cfc6ba")
            sheet.paste(im.resize((COL_W, h), Image.LANCZOS), (x, y + LABEL_H))
    out = HERE / f"compare_day-night_{DATE}.png"
    sheet.save(out)
    print(f"[sheet] {out.name}  {sheet.size}")


if __name__ == "__main__":
    main()
