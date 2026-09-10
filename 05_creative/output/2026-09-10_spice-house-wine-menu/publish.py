#!/usr/bin/env python3
"""Build every variant and lay the PDFs out under pdf/ with readable names.

The working files here are named for the code that makes them. What actually
gets sent to the restaurant is a folder of six PDFs named the way a person
picks a file: which theme, how many sides, which version of the back.

    pdf/DARK_1 page.pdf         one sheet, dark
    pdf/LIGHT_1 page.pdf        one sheet, light — the print-friendly one
    pdf/DARK_2 page.pdf         two sides, staggered back
    pdf/LIGHT_2 page.pdf
    pdf/DARK_2 page_v2.pdf      two sides, level back
    pdf/LIGHT_2 page_v2.pdf

Rebuilds from source every time, then runs check_fit.py, so nothing lands in
that folder without its footer checked.

    python3 publish.py
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pdf")
DATE = "2026-09-10"

BUILDS = (
    (["build_a4.py", "--theme", "both"], "one sheet"),
    (["build_2side.py", "--theme", "both"], "two sides, staggered back"),
    (["build_2side.py", "--theme", "both", "--back", "level"],
     "two sides, level back"),
)

DELIVERABLES = {
    f"spice-house-wine-menu-a4_{DATE}.pdf": "DARK_1 page.pdf",
    f"spice-house-wine-menu-a4_{DATE}-light.pdf": "LIGHT_1 page.pdf",
    f"spice-house-wine-menu-2side_{DATE}.pdf": "DARK_2 page.pdf",
    f"spice-house-wine-menu-2side_{DATE}-light.pdf": "LIGHT_2 page.pdf",
    f"spice-house-wine-menu-2side-level_{DATE}.pdf": "DARK_2 page_v2.pdf",
    f"spice-house-wine-menu-2side-level_{DATE}-light.pdf": "LIGHT_2 page_v2.pdf",
}


def run(args):
    subprocess.run([sys.executable] + args, cwd=HERE, check=True,
                   stdout=subprocess.DEVNULL)


def main():
    for args, what in BUILDS:
        print(f"building {what} …")
        run(args)

    print("checking footers …")
    check = subprocess.run([sys.executable, "check_fit.py"], cwd=HERE,
                           capture_output=True, text=True)
    print(check.stdout.strip())
    if check.returncode:
        print("something runs into a footer — not publishing")
        return 1

    os.makedirs(OUT, exist_ok=True)
    for src, name in DELIVERABLES.items():
        shutil.copyfile(os.path.join(HERE, src), os.path.join(OUT, name))
        print(f"pdf/{name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
