#!/usr/bin/env python3
"""Draws the Penny Plan app icons (stdlib only): green tile, rising bars, gold coin."""
import os, struct, zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(u, v):
    """Colour at unit coords (u, v); None = background gradient."""
    # gold coin, upper right
    dx, dy = u - 0.69, v - 0.25
    r2 = dx * dx + dy * dy
    if r2 <= 0.115 ** 2:
        return (250, 176, 5) if r2 > 0.085 ** 2 else (255, 212, 59)
    # bars
    for x0, x1, top in ((0.20, 0.36, 0.60), (0.42, 0.58, 0.48), (0.64, 0.80, 0.38)):
        if x0 <= u <= x1 and top + (0.02 if (u - x0) < 0.01 else 0) <= v <= 0.80:
            return (255, 255, 255)
    # baseline
    if 0.16 <= u <= 0.84 and 0.82 <= v <= 0.85:
        return (214, 245, 232)
    return None


def render(n):
    ss = 3
    top, bot = (24, 190, 140), (8, 112, 82)
    rows = []
    for y in range(n):
        row = bytearray([0])
        for x in range(n):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    u, v = (x + (sx + .5) / ss) / n, (y + (sy + .5) / ss) / n
                    c = shade(u, v) or lerp(top, bot, v)
                    for i in range(3):
                        acc[i] += c[i]
            row += bytes(int(a / (ss * ss)) for a in acc)
        rows.append(bytes(row))
    return b"".join(rows)


def png(n, path):
    raw = render(n)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, n in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
        png(n, os.path.join(OUT, name))
        print("wrote", name)
