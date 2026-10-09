#!/usr/bin/env python3
"""Build the integration's brand icons (custom_components/calendar_card_with_avatars/brand/).

A calendar page with a round avatar in the bottom-right corner, drawn with
plain Python (no image libraries), in two colour sets:

    icon.png / icon@2x.png            light theme
    dark_icon.png / dark_icon@2x.png  dark theme

    python tools/build_brand.py
"""
import math
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "custom_components" / "calendar_card_with_avatars" / "brand"

SIZE = 512  # @2x; the 1x icon is this halved
SAMPLES = 3  # per axis, for anti-aliasing

COLOURS = {
    "light": {"band": (66, 105, 208), "page": (236, 239, 241), "line": (176, 190, 197),
              "avatar": (244, 189, 74), "person": (255, 255, 255)},
    "dark": {"band": (110, 145, 235), "page": (69, 90, 100), "line": (120, 144, 156),
             "avatar": (244, 189, 74), "person": (38, 50, 56)},
}

PAGE = (40, 70, 400, 440, 44)  # x0, y0, x1, y1, corner radius
BAND_BOTTOM = 160
RINGS = [(130, 60), (310, 60)]  # binder rings: centre x, top y
AVATAR, AVATAR_R, AVATAR_GAP = (372, 384), 112, 16


def _in_round_rect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return math.hypot(x - cx, y - cy) <= r


def _colour_at(x, y, c):
    ax, ay = AVATAR
    d = math.hypot(x - ax, y - ay)
    if d <= AVATAR_R:
        # Head and shoulders.
        if math.hypot(x - ax, y - (ay - 26)) <= 36:
            return c["person"] + (255,)
        if y >= ay + 22 and math.hypot((x - ax) / 70, (y - (ay + 92)) / 64) <= 1:
            return c["person"] + (255,)
        return c["avatar"] + (255,)
    if d <= AVATAR_R + AVATAR_GAP:
        return (0, 0, 0, 0)
    for rx, ry in RINGS:
        if _in_round_rect(x, y, rx - 14, ry - 30, rx + 14, ry + 40, 14):
            return c["line"] + (255,)
    x0, y0, x1, y1, r = PAGE
    if not _in_round_rect(x, y, x0, y0, x1, y1, r):
        return (0, 0, 0, 0)
    if y <= BAND_BOTTOM:
        return c["band"] + (255,)
    for top, bottom in ((220, 250), (290, 320), (360, 390)):
        if top <= y <= bottom and 90 <= x <= 330 and _in_round_rect(x, y, 90, top, 330, bottom, 15):
            return c["line"] + (255,)
    return c["page"] + (255,)


def render(c):
    rows, step, n = [], 1 / SAMPLES, SAMPLES * SAMPLES
    for py in range(SIZE):
        row = []
        for px in range(SIZE):
            r = g = b = a = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    cr, cg, cb, ca = _colour_at(px + (sx + 0.5) * step, py + (sy + 0.5) * step, c)
                    r += cr * ca
                    g += cg * ca
                    b += cb * ca
                    a += ca
            row.append((r / n, g / n, b / n, a / n))
        rows.append(row)
    return rows


def halve(rows):
    return [
        [tuple(sum(p[i] for p in (rows[y][x], rows[y][x + 1], rows[y + 1][x], rows[y + 1][x + 1])) / 4 for i in range(4))
         for x in range(0, len(rows[0]), 2)]
        for y in range(0, len(rows), 2)
    ]


def write_png(path, rows):
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((round(r / a), round(g / a), round(b / a), round(a))) if a else b"\0\0\0\0"

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", len(rows[0]), len(rows), 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for theme, colours in COLOURS.items():
        prefix = "" if theme == "light" else "dark_"
        big = render(colours)
        write_png(OUT / f"{prefix}icon@2x.png", big)
        write_png(OUT / f"{prefix}icon.png", halve(big))
        print(f"{theme}: {prefix}icon.png, {prefix}icon@2x.png")


if __name__ == "__main__":
    main()
