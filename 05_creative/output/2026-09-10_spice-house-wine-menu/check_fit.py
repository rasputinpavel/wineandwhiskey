#!/usr/bin/env python3
"""Does anything crash into the footer?

Every layout here fills the sheet to the millimetre, and the way it fails is
always the same: one more line of copy, the last row grows, and the footer ends
up printed across a price. Eyeballing a preview catches it late, so this reads
the finished PDF instead.

pdftotext -bbox gives every word's box in points. The footer is found by its
own words, and anything whose box reaches into the footer's band — or past the
bottom of the sheet — is reported.

    python3 check_fit.py                 # every PDF in this folder
    python3 check_fit.py some-file.pdf
"""
import glob
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# Anchor words that only ever appear in a footer, across all three layouts.
FOOTER_WORDS = ("baht", "recommendation", "side")
SLACK = 1.5          # pt — a hair of tolerance for antialiasing and rounding


def words_by_page(pdf):
    xml = subprocess.run(["pdftotext", "-bbox", pdf, "-"],
                         capture_output=True, text=True, check=True).stdout
    pages = []
    for page in re.findall(r"<page width=\"([\d.]+)\" height=\"([\d.]+)\">(.*?)</page>",
                           xml, re.S):
        w, h, body = float(page[0]), float(page[1]), page[2]
        words = [(float(m[0]), float(m[1]), float(m[2]), float(m[3]), m[4])
                 for m in re.findall(
                     r"<word xMin=\"([\d.]+)\" yMin=\"([\d.]+)\" "
                     r"xMax=\"([\d.]+)\" yMax=\"([\d.]+)\">(.*?)</word>", body)]
        pages.append((w, h, words))
    return pages


def check(pdf):
    problems = []
    for n, (pw, ph, words) in enumerate(words_by_page(pdf), 1):
        if not words:
            problems.append(f"page {n}: no text at all")
            continue

        footer = [w for w in words if w[4].lower().strip(".,·") in FOOTER_WORDS
                  and w[1] > ph * 0.85]
        if not footer:
            # Letterspaced footers sometimes come back split into single
            # letters, so fall back to the lowest row of text on the page:
            # a collision shows up the same way from either side.
            bottom = max(w[3] for w in words)
            footer = [w for w in words if w[3] > bottom - 6]
        top = min(w[1] for w in footer)

        # the footer's own row is fine; anything else reaching into it is not
        intruders = [w for w in words
                     if w[3] > top + SLACK and w[1] < top - SLACK]
        if intruders:
            worst = max(intruders, key=lambda w: w[3])
            problems.append(
                f"page {n}: {len(intruders)} word(s) run into the footer, "
                f"lowest is {worst[4]!r} at y={worst[3]:.0f} "
                f"(footer starts at {top:.0f})")

        off = [w for w in words if w[3] > ph + SLACK]
        if off:
            problems.append(f"page {n}: {len(off)} word(s) below the sheet edge")
    return problems


def main():
    targets = sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, "*.pdf")))
    bad = 0
    for pdf in targets:
        problems = check(pdf)
        name = os.path.basename(pdf)
        if problems:
            bad += 1
            print(f"✗ {name}")
            for p in problems:
                print(f"    {p}")
        else:
            print(f"✓ {name}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
