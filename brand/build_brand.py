#!/usr/bin/env python3
"""Build the personal pitching-analytics visual kit for /brand/.

One solid pass: hero (png/webp + small webp), DJ favicon set, palette.md.
No team marks, crowns, uniforms, wordmarks, or player likenesses.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter, zoom

OUT = Path("/workspace/royals-portfolio/brand")
OUT.mkdir(parents=True, exist_ok=True)

# --- palette (sRGB hex) -------------------------------------------------
NAVY = "#0B1F3A"
DEEP = "#071428"
POWDER = "#7AB2DD"
TINT = "#C5DCEF"
GOLD = "#C9A227"
OFFWHITE = "#E8EEF4"
MUTED = "#9AA3B5"

NAVY_RGB = np.array([0x0B, 0x1F, 0x3A], dtype=np.float32)
DEEP_RGB = np.array([0x07, 0x14, 0x28], dtype=np.float32)
POWDER_RGB = np.array([0x7A, 0xB2, 0xDD], dtype=np.float32)
TINT_RGB = np.array([0xC5, 0xDC, 0xEF], dtype=np.float32)
GOLD_RGB = np.array([0xC9, 0xA2, 0x27], dtype=np.float32)
WHITE_RGB = np.array([255.0, 255.0, 255.0], dtype=np.float32)


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rel_lum(h: str) -> float:
    r, g, b = [c / 255.0 for c in hex_to_rgb(h)]

    def f(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    R, G, B = f(r), f(g), f(b)
    return 0.2126 * R + 0.7152 * G + 0.0722 * B


def contrast(a: str, b: str) -> float:
    L1, L2 = rel_lum(a), rel_lum(b)
    lighter, darker = max(L1, L2), min(L1, L2)
    return (lighter + 0.05) / (darker + 0.05)


def wcag_grade(ratio: float, large: bool = False) -> str:
    aaa, aa = (4.5, 3.0) if large else (7.0, 4.5)
    if ratio >= aaa:
        return "AAA"
    if ratio >= aa:
        return "AA"
    if ratio >= 3.0:
        return "AA large / fail regular"
    return "fail"


def smoothstep(t: np.ndarray | float) -> np.ndarray | float:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def line_at_x(p0, p1, x: float) -> tuple[float, float]:
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    dx = p1[0] - p0[0]
    t = 0.0 if abs(dx) < 1e-9 else (x - p0[0]) / dx
    return float(x), float(p0[1] + t * (p1[1] - p0[1]))


def bezier(p0, p1, p2, p3, n: int = 180) -> np.ndarray:
    t = np.linspace(0.0, 1.0, n)[:, None]
    p0, p1, p2, p3 = (np.asarray(p, float) for p in (p0, p1, p2, p3))
    return (
        (1 - t) ** 3 * p0
        + 3 * (1 - t) ** 2 * t * p1
        + 3 * (1 - t) * t ** 2 * p2
        + t ** 3 * p3
    )


def subdivide_edge(a, b, n: int) -> list[tuple[float, float]]:
    a, b = np.asarray(a, float), np.asarray(b, float)
    return [tuple(lerp(a, b, i / n)) for i in range(n + 1)]


# --- compositing primitives ---------------------------------------------
def stamp_disks(acc: np.ndarray, pts: np.ndarray, radii: np.ndarray, feather: float = 1.15) -> None:
    h, w = acc.shape
    for (x, y), r in zip(pts, radii):
        pad = int(r + feather + 2)
        xmin, xmax = max(0, int(x) - pad), min(w, int(x) + pad + 1)
        ymin, ymax = max(0, int(y) - pad), min(h, int(y) + pad + 1)
        if xmin >= xmax or ymin >= ymax:
            continue
        ys, xs = np.ogrid[ymin:ymax, xmin:xmax]
        d = np.sqrt((xs - x) ** 2 + (ys - y) ** 2)
        a = np.clip((r + feather - d) / max(feather, 0.55), 0.0, 1.0)
        a = a * a * (3.0 - 2.0 * a)
        view = acc[ymin:ymax, xmin:xmax]
        np.maximum(view, a.astype(np.float32), out=view)


def stamp_polyline(acc: np.ndarray, pts: np.ndarray, width: float, feather: float = 1.1) -> None:
    """Constant-width AA polyline via disks plus short segments."""
    if len(pts) < 2:
        return
    # resample by arc length so stamps overlap smoothly
    d = np.sqrt(((pts[1:] - pts[:-1]) ** 2).sum(axis=1))
    s = np.concatenate([[0.0], np.cumsum(d)])
    total = float(s[-1])
    if total < 1e-3:
        return
    step = max(0.65, width * 0.55)
    n = max(2, int(total / step) + 1)
    su = np.linspace(0.0, total, n)
    xs = np.interp(su, s, pts[:, 0])
    ys = np.interp(su, s, pts[:, 1])
    radii = np.full(n, width * 0.5, dtype=np.float32)
    stamp_disks(acc, np.column_stack([xs, ys]), radii, feather=feather)


def cheap_glow(mask: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian glow, computed at a lower resolution for speed."""
    if sigma < 1.2:
        return gaussian_filter(mask, sigma=sigma)
    factor = max(2, int(round(sigma / 3.0)))
    small = mask[::factor, ::factor]
    blurred = gaussian_filter(small, sigma=sigma / factor)
    out = zoom(blurred, factor, order=1)
    # zoom may be 1 px off
    h, w = mask.shape
    return out[:h, :w]


def composite(rgb: np.ndarray, color, alpha: np.ndarray) -> None:
    a = np.clip(alpha, 0.0, 1.0).astype(np.float32)
    c = np.asarray(color, dtype=np.float32)
    if c.max() <= 1.5:
        c = c * 255.0
    rgb += (c - rgb) * a[..., None]


def fade_left(w: int, scale: int, start: float = 900, end: float = 1120) -> np.ndarray:
    x = np.arange(w, dtype=np.float32)
    t = (x - start * scale) / ((end - start) * scale)
    return smoothstep(t).astype(np.float32)


# --- hero ----------------------------------------------------------------
def build_hero_hires(scale: int = 2) -> Image.Image:
    W, H = 2400 * scale, 1000 * scale
    S = float(scale)

    # 2-point perspective, working in final-pixel space then *scale
    HORIZON = 248.0
    VP_D = np.array([1238.0, HORIZON])  # depth / mound direction
    VP_L = np.array([4480.0, HORIZON])  # lateral, off canvas to the right

    # Strike zone sits in the lower-right so its plane reads in perspective
    # and the pitches have room to travel out of the depth corridor.
    # Left edge is nearer the camera, so taller.
    x_near, x_far = 1524.0, 1910.0
    yt_near, yb_near = 408.0, 888.0
    tl = (x_near, yt_near)
    bl = (x_near, yb_near)
    tr = line_at_x(VP_L, tl, x_far)
    br = line_at_x(VP_L, bl, x_far)

    def scaled_pt(p):
        return np.array([p[0] * S, p[1] * S], dtype=np.float32)

    vp_d = scaled_pt(VP_D)
    vp_l = scaled_pt(VP_L)
    zone = {
        "tl": scaled_pt(tl),
        "tr": scaled_pt(tr),
        "bl": scaled_pt(bl),
        "br": scaled_pt(br),
    }

    # Shadow band: expand vertically along each post, and push x slightly out
    def expand_zone(px: float, py_frac: float):
        xn = x_near - px
        xf = x_far + px
        h_n = yb_near - yt_near
        tl2 = (xn, yt_near - h_n * py_frac)
        bl2 = (xn, yb_near + h_n * py_frac)
        tr2 = line_at_x(VP_L, tl2, xf)
        br2 = line_at_x(VP_L, bl2, xf)
        return {k: scaled_pt(p) for k, p in zip(("tl", "tr", "bl", "br"), (tl2, tr2, bl2, br2))}

    shadow = expand_zone(46.0, 0.13)

    # 3x3 grid points along each vertical post
    left_div = subdivide_edge(zone["tl"], zone["bl"], 3)
    right_div = subdivide_edge(zone["tr"], zone["br"], 3)
    # cell centers (2x2 midpoints of each cell)
    left_6 = subdivide_edge(zone["tl"], zone["bl"], 6)
    right_6 = subdivide_edge(zone["tr"], zone["br"], 6)
    cell_centers = []
    for row in range(3):  # 0 = top
        for col in range(3):
            # mid of cell: vertical param (row*2+1)/6, horizontal  (col+0.5)/3
            y_i = row * 2 + 1
            lp, rp = left_6[y_i], right_6[y_i]
            cx, cy = lerp(np.array(lp), np.array(rp), (col + 0.5) / 3.0)
            cell_centers.append(np.array([cx, cy], dtype=np.float32))

    # Shadow target points (just outside the zone)
    sh_left = subdivide_edge(shadow["tl"], shadow["bl"], 6)
    sh_right = subdivide_edge(shadow["tr"], shadow["br"], 6)
    mid_l = lerp(zone["tl"], zone["bl"], 0.5)
    mid_r = lerp(zone["tr"], zone["br"], 0.5)
    # a few off-grid arrivals
    shadow_targets = {
        "low": lerp(np.array(sh_left[5]), np.array(sh_right[5]), 0.48),
        "up": lerp(np.array(sh_left[0]), np.array(sh_right[0]), 0.35),
        "in": lerp(np.array(sh_left[3]), np.array(zone["tl"]) * 0 + np.array(sh_left[3]), 0.0)
        + (np.array(sh_left[3]) - lerp(np.array(left_6[3]), np.array(right_6[3]), 0.08)),
        "away": lerp(np.array(sh_left[4]), np.array(sh_right[4]), 0.92),
    }
    # cleaner explicit shadow arrivals
    shadow_low = lerp(np.array(sh_left[5]), np.array(sh_right[5]), 0.42)
    shadow_up = lerp(np.array(sh_left[0]), np.array(sh_right[0]), 0.38)
    shadow_in = lerp(np.array(sh_left[3]), np.array(sh_right[3]), 0.08)
    shadow_away = lerp(np.array(sh_left[4]), np.array(sh_right[4]), 0.96)

    # Release is composed in the depth corridor of the ground grid, left of
    # the zone and below the horizon, so the flight paths read as coming
    # out of the distance (slightly oversized vs a literal camera, on purpose).
    plate_g = lerp(zone["bl"], zone["br"], 0.5)
    ground_at_plate = plate_g + np.array([0.0, 48.0 * S])
    release = scaled_pt((1288.0, 328.0))

    # ---- background gradient + stage light ----
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # vertical deep-navy gradient, slightly heavier at the bottom
    vt = smoothstep(yy / (H - 1))
    # also a soft left-to-right darkening, but keep the left readable-navy
    ht = smoothstep((xx / (W - 1) - 0.25) / 0.95)
    mix = np.clip(0.18 + 0.72 * vt + 0.18 * ht, 0.0, 1.0)
    rgb = NAVY_RGB[None, None, :] * (1.0 - mix[..., None]) + DEEP_RGB[None, None, :] * mix[..., None]

    # soft stage light behind the zone / trajectories
    stage_cx, stage_cy = 1680.0 * S, 520.0 * S
    stage_r = np.sqrt(((xx - stage_cx) / (520.0 * S)) ** 2 + ((yy - stage_cy) / (380.0 * S)) ** 2)
    stage = np.exp(-stage_r ** 2 * 0.85).astype(np.float32)
    lift = np.array([18.0, 32.0, 52.0], dtype=np.float32)  # slight powder lift, still navy
    composite(rgb, NAVY_RGB + lift, stage * 0.22)

    # a fainter cool glow near the release / depth
    rel_r = np.sqrt(((xx - release[0]) / (280.0 * S)) ** 2 + ((yy - release[1]) / (160.0 * S)) ** 2)
    composite(rgb, POWDER_RGB, np.exp(-rel_r ** 2 * 1.1) * 0.07)

    left = fade_left(W, scale)

    # ---- horizon + perspective ground grid ----
    grid = np.zeros((H, W), dtype=np.float32)
    # horizon line, very faint, only in the art half
    hz = np.exp(-((yy - HORIZON * S) / (1.1 * S)) ** 2)
    grid = np.maximum(grid, hz * 0.18)

    # depth rays from VP_D through the bottom of the frame
    bottoms = np.linspace(700.0, 2580.0, 15)
    for bx in bottoms:
        p0 = vp_d
        p1 = np.array([bx * S, (1000.0 + 40.0) * S])
        # only draw below the horizon
        pts = np.linspace(0.0, 1.0, 80)[:, None]
        line = p0 * (1 - pts) + p1 * pts
        line = line[line[:, 1] >= (HORIZON + 2) * S]
        if len(line) < 2:
            continue
        tmp = np.zeros((H, W), dtype=np.float32)
        stamp_polyline(tmp, line, width=1.15 * S, feather=1.0 * S)
        # fade toward horizon and toward distance
        fade_h = smoothstep((line[:, 1].min() - HORIZON * S) / (40.0 * S) if False else 1.0)
        grid = np.maximum(grid, tmp * 0.55)

    # lateral (horizontal) ground lines, denser near the horizon
    # y = HORIZON + C / z, pick world-ish z samples
    zs = np.array([1.12, 1.28, 1.48, 1.75, 2.10, 2.55, 3.15, 4.0, 5.2, 7.0, 10.0, 15.0])
    y_bottom = 1000.0
    # map z=1.12 -> near bottom, z=inf -> horizon
    for z in zs:
        y = HORIZON + (y_bottom - HORIZON) * (1.12 / z)
        if y > 990 or y < HORIZON + 8:
            continue
        # width of the field line grows toward the camera
        # line goes from some left x (fading) to the right edge, slightly following...
        # in 1-point / 2-point, lateral lines go to VP_L, so they are nearly horizontal
        # because VP_L is far. Construct via VP_L.
        p_right = line_at_x(VP_L, (1200.0, y), 2440.0)
        p_left = line_at_x(VP_L, (1200.0, y), 820.0)
        pts = np.linspace(0.0, 1.0, 70)[:, None]
        line = np.array(p_left) * (1 - pts) + np.array(p_right) * pts
        line = line * S
        tmp = np.zeros((H, W), dtype=np.float32)
        # thinner in the distance
        width = lerp(0.7, 1.35, (y - HORIZON) / (y_bottom - HORIZON)) * S
        stamp_polyline(tmp, line, width=width, feather=1.0 * S)
        dist_fade = 0.22 + 0.78 * smoothstep((y - HORIZON) / 420.0)
        grid = np.maximum(grid, tmp * dist_fade * 0.7)

    # apply left fade + a slight bottom presence
    grid *= left[None, :]
    grid *= (0.35 + 0.65 * smoothstep((yy - HORIZON * S) / (80.0 * S)))
    composite(rgb, WHITE_RGB, grid * 0.14)

    # ---- faint movement scatter (upper-right HUD) ----
    scatter_alpha = np.zeros((H, W), dtype=np.float32)
    gold_scatter = np.zeros((H, W), dtype=np.float32)
    # panel in final px
    ox, oy = 2028.0 * S, 118.0 * S
    pw, ph = 332.0 * S, 340.0 * S
    # axes: HB x, IVB y, origin at center
    origin = np.array([ox + pw * 0.50, oy + ph * 0.58])  # slightly low so "rise" has room
    # 1 inch = this many px (range about ±20 in)
    inch = 7.15 * S
    # faint panel frame + axes
    frame = np.zeros((H, W), dtype=np.float32)
    # box corners
    box = np.array(
        [
            [ox, oy],
            [ox + pw, oy],
            [ox + pw, oy + ph],
            [ox, oy + ph],
            [ox, oy],
        ]
    )
    stamp_polyline(frame, box, width=0.9 * S, feather=0.9 * S)
    # axes through origin
    axis_h = np.array([[ox + 18 * S, origin[1]], [ox + pw - 18 * S, origin[1]]])
    axis_v = np.array([[origin[0], oy + 18 * S], [origin[0], oy + ph - 18 * S]])
    stamp_polyline(frame, axis_h, width=0.8 * S, feather=0.9 * S)
    stamp_polyline(frame, axis_v, width=0.8 * S, feather=0.9 * S)
    # small tick marks at ±10, ±20
    ticks = np.zeros((H, W), dtype=np.float32)
    for val in (-20, -10, 10, 20):
        # HB ticks (along x, short vertical)
        tx = origin[0] + val * inch
        if ox + 16 * S < tx < ox + pw - 16 * S:
            stamp_polyline(
                ticks,
                np.array([[tx, origin[1] - 7 * S], [tx, origin[1] + 7 * S]]),
                width=0.7 * S,
            )
        # IVB ticks (along y, short horizontal; +IVB is up, so minus y)
        ty = origin[1] - val * inch
        if oy + 16 * S < ty < oy + ph - 16 * S:
            stamp_polyline(
                ticks,
                np.array([[origin[0] - 7 * S, ty], [origin[0] + 7 * S, ty]]),
                width=0.7 * S,
            )
    composite(rgb, WHITE_RGB, frame * 0.16)
    composite(rgb, WHITE_RGB, ticks * 0.12)

    rng = np.random.default_rng(42)
    # Decorative, made-up clusters (inches of HB, IVB). RHP-ish convention:
    # +HB ~ arm-side (right), +IVB ~ rise.
    clusters = [
        # FF
        dict(n=30, hb=(6.2, 2.1), ivb=(16.4, 2.0), color="powder", r=1.55),
        # SI / two-seamer
        dict(n=18, hb=(13.4, 2.0), ivb=(7.8, 1.8), color="powder", r=1.45),
        # CT
        dict(n=14, hb=(1.2, 1.8), ivb=(10.5, 1.7), color="tint", r=1.4),
        # SL
        dict(n=22, hb=(-5.8, 2.2), ivb=(3.6, 2.1), color="powder", r=1.5),
        # CH
        dict(n=16, hb=(12.2, 2.3), ivb=(5.0, 2.0), color="tint", r=1.4),
        # CU (gold accents)
        dict(n=14, hb=(-4.8, 2.4), ivb=(-8.6, 2.2), color="gold", r=1.6),
    ]
    powder_pts = []
    tint_pts = []
    gold_pts = []
    for cl in clusters:
        hb = rng.normal(cl["hb"][0], cl["hb"][1], cl["n"])
        ivb = rng.normal(cl["ivb"][0], cl["ivb"][1], cl["n"])
        # mild clip to a plausible window
        hb = np.clip(hb, -22, 22)
        ivb = np.clip(ivb, -18, 24)
        xs = origin[0] + hb * inch
        ys = origin[1] - ivb * inch
        pts = np.column_stack([xs, ys])
        # keep inside the panel with a small margin
        keep = (
            (pts[:, 0] > ox + 14 * S)
            & (pts[:, 0] < ox + pw - 14 * S)
            & (pts[:, 1] > oy + 14 * S)
            & (pts[:, 1] < oy + ph - 14 * S)
        )
        pts = pts[keep]
        r = np.full(len(pts), cl["r"] * S, dtype=np.float32)
        acc = np.zeros((H, W), dtype=np.float32)
        stamp_disks(acc, pts, r, feather=0.9 * S)
        if cl["color"] == "gold":
            composite(rgb, GOLD_RGB, acc * 0.62)
            # tiny gold glow
            g = cheap_glow(acc, sigma=2.2 * S)
            composite(rgb, GOLD_RGB, g * 0.28)
        elif cl["color"] == "tint":
            composite(rgb, TINT_RGB, acc * 0.40)
        else:
            composite(rgb, POWDER_RGB, acc * 0.42)

    # ---- strike zone + shadow ----
    def quad_fill(tl, tr, br, bl, skip=2) -> np.ndarray:
        """Scan-convert a convex quad into an AA-ish mask (subsampled fill + blur)."""
        # Use PIL polygon at this hires, then slight blur
        im = Image.new("L", (W, H), 0)
        draw = ImageDraw.Draw(im)
        poly = [tuple(tl), tuple(tr), tuple(br), tuple(bl)]
        draw.polygon(poly, fill=255)
        arr = np.asarray(im, dtype=np.float32) / 255.0
        if skip:
            arr = gaussian_filter(arr, sigma=0.6 * S)
        return arr

    shadow_fill = quad_fill(shadow["tl"], shadow["tr"], shadow["br"], shadow["bl"])
    zone_fill = quad_fill(zone["tl"], zone["tr"], zone["br"], zone["bl"])
    band = np.clip(shadow_fill - zone_fill, 0.0, 1.0)
    composite(rgb, POWDER_RGB, band * 0.055)
    # heart (center cell)
    heart_l0, heart_l1 = left_div[1], left_div[2]
    heart_r0, heart_r1 = right_div[1], right_div[2]
    # mid horizontal of those
    heart_tl = lerp(np.array(heart_l0), np.array(heart_r0), 1.0 / 3.0)
    heart_tr = lerp(np.array(heart_l0), np.array(heart_r0), 2.0 / 3.0)
    heart_bl = lerp(np.array(heart_l1), np.array(heart_r1), 1.0 / 3.0)
    heart_br = lerp(np.array(heart_l1), np.array(heart_r1), 2.0 / 3.0)
    heart = quad_fill(heart_tl, heart_tr, heart_br, heart_bl)
    composite(rgb, POWDER_RGB, heart * 0.05)

    def stroke_quad(q, width, closed=True) -> np.ndarray:
        acc = np.zeros((H, W), dtype=np.float32)
        pts = [q["tl"], q["tr"], q["br"], q["bl"]]
        if closed:
            pts = pts + [q["tl"]]
        for a, b in zip(pts[:-1], pts[1:]):
            stamp_polyline(acc, np.vstack([a, b]), width=width, feather=1.05 * S)
        return acc

    shadow_stroke = stroke_quad(shadow, width=1.15 * S)
    zone_stroke = stroke_quad(zone, width=1.85 * S)
    # 3x3 internals
    internals = np.zeros((H, W), dtype=np.float32)
    for i in (1, 2):
        stamp_polyline(internals, np.vstack([left_div[i], right_div[i]]), width=1.15 * S)
        # verticals: divide top and bottom into 3
        top_i = lerp(zone["tl"], zone["tr"], i / 3.0)
        bot_i = lerp(zone["bl"], zone["br"], i / 3.0)
        stamp_polyline(internals, np.vstack([top_i, bot_i]), width=1.15 * S)

    # nearer (left) post a bit brighter than the far post — already implicit if we want
    zone_glow = cheap_glow(zone_stroke + internals * 0.8, sigma=3.4 * S)
    composite(rgb, WHITE_RGB, zone_glow * 0.18)
    composite(rgb, POWDER_RGB, cheap_glow(shadow_stroke, sigma=2.6 * S) * 0.16)
    composite(rgb, WHITE_RGB, shadow_stroke * 0.22)
    composite(rgb, WHITE_RGB, zone_stroke * 0.52)
    composite(rgb, WHITE_RGB, internals * 0.28)
    # brighter near post
    near_post = np.zeros((H, W), dtype=np.float32)
    stamp_polyline(near_post, np.vstack([zone["tl"], zone["bl"]]), width=2.1 * S)
    composite(rgb, TINT_RGB, near_post * 0.35)

    # small release cluster, so the eye finds the start in the corridor
    rel_mask = np.zeros((H, W), dtype=np.float32)
    stamp_disks(
        rel_mask,
        release.reshape(1, 2),
        np.array([3.1 * S], dtype=np.float32),
        feather=1.2 * S,
    )
    composite(rgb, POWDER_RGB, cheap_glow(rel_mask, sigma=7.5 * S) * 0.40)
    composite(rgb, TINT_RGB, cheap_glow(rel_mask, sigma=3.0 * S) * 0.55)
    composite(rgb, WHITE_RGB, rel_mask * 0.80)

    # ---- pitch trajectories ----
    def ctrl_toward(p0, p3, along=0.35, lift=(0.0, 0.0)):
        return lerp(p0, p3, along) + np.array(lift) * S

    # cell index: row-major, row 0 top, col 0 inside (left / third-base)
    # 0 1 2
    # 3 4 5
    # 6 7 8
    pitches = [
        # 4-seam, glove-side high (top-left cell) — fairly straight, slight rise
        dict(
            end=cell_centers[0],
            c1=(0.32, (8, -18)),
            c2=(0.72, (8, -18)),
            color="powder",
            alpha=0.86,
            w0=1.85,
            w1=3.4,
            highlight=False,
        ),
        # 4-seam, heart
        dict(
            end=cell_centers[4],
            c1=(0.34, (4, -8)),
            c2=(0.70, (2, 6)),
            color="powder",
            alpha=0.90,
            w0=1.95,
            w1=3.7,
            highlight=False,
        ),
        # 4-seam, low away (bottom-right)
        dict(
            end=cell_centers[8],
            c1=(0.30, (10, 6)),
            c2=(0.68, (14, 18)),
            color="powder",
            alpha=0.78,
            w0=1.8,
            w1=3.2,
            highlight=False,
        ),
        # sinker, arm-side shadow
        dict(
            end=shadow_away,
            c1=(0.30, (16, 10)),
            c2=(0.66, (36, 52)),
            color="powder",
            alpha=0.70,
            w0=1.75,
            w1=3.0,
            highlight=False,
        ),
        # slider, glove-side mid shadow
        dict(
            end=shadow_in,
            c1=(0.28, (-4, 4)),
            c2=(0.64, (-52, 32)),
            color="tint",
            alpha=0.72,
            w0=1.1,
            w1=3.2,
            highlight=False,
        ),
        # changeup, down in the zone (bottom-center-ish)
        dict(
            end=cell_centers[7],
            c1=(0.33, (10, 12)),
            c2=(0.70, (18, 64)),
            color="powder",
            alpha=0.74,
            w0=1.75,
            w1=3.1,
            highlight=False,
        ),
        # high chase, upper shadow
        dict(
            end=shadow_up,
            c1=(0.30, (2, -22)),
            c2=(0.68, (-4, -16)),
            color="powder",
            alpha=0.48,
            w0=1.55,
            w1=2.5,
            highlight=False,
        ),
        # GOLD curveball, late drop into the low shadow / bottom edge
        dict(
            end=shadow_low,
            c1=(0.28, (8, -14)),
            c2=(0.63, (12, 150)),
            color="gold",
            alpha=0.95,
            w0=2.15,
            w1=4.15,
            highlight=True,
        ),
    ]

    # slight per-pitch release jitter so they don't share one pixel
    rel_jitter = [
        (0, 0),
        (5, 2),
        (-3, 3),
        (7, -2),
        (-6, 1),
        (3, 4),
        (-2, -3),
        (1, 0),
    ]

    # draw non-gold first, gold last
    order = [i for i, p in enumerate(pitches) if not p["highlight"]] + [
        i for i, p in enumerate(pitches) if p["highlight"]
    ]

    for idx in order:
        p = pitches[idx]
        jx, jy = rel_jitter[idx]
        p0 = release + np.array([jx, jy]) * S
        p3 = p["end"]
        a1, lift1 = p["c1"]
        a2, lift2 = p["c2"]
        p1 = ctrl_toward(p0, p3, a1, lift1)
        p2 = ctrl_toward(p0, p3, a2, lift2)
        curve = bezier(p0, p1, p2, p3, n=200)
        # clip to canvas-ish
        t = np.linspace(0.0, 1.0, len(curve))
        widths = (p["w0"] + (p["w1"] - p["w0"]) * (t ** 1.15)) * S
        # resample along arc length
        d = np.sqrt(((curve[1:] - curve[:-1]) ** 2).sum(axis=1))
        s = np.concatenate([[0.0], np.cumsum(d)])
        total = float(s[-1])
        step = max(0.7, float(widths.mean()) * 0.5)
        n = max(2, int(total / step) + 1)
        su = np.linspace(0.0, total, n)
        xs = np.interp(su, s, curve[:, 0])
        ys = np.interp(su, s, curve[:, 1])
        wr = np.interp(su, s, widths) * 0.5
        pts = np.column_stack([xs, ys])
        core = np.zeros((H, W), dtype=np.float32)
        stamp_disks(core, pts, wr.astype(np.float32), feather=1.15 * S)
        # fade the start of the path a little (into depth) and honor left fade
        # build a per-pixel approx by also fading the stamped core with a start mask
        # Use distance along the path: build a start-fade by restamping a weight...
        # Simpler: multiply core by left fade and a soft depth fade near release.
        depth = np.exp(
            -(((xx - p0[0]) / (90.0 * S)) ** 2 + ((yy - p0[1]) / (70.0 * S)) ** 2)
        )
        # don't actually multiply by depth (it would eat the whole start). Instead
        # the thinner start width already handles it.
        core *= left[None, :]
        glow_sig = (6.5 if p["highlight"] else 4.2) * S
        glow = cheap_glow(core, sigma=glow_sig)
        if p["color"] == "gold":
            composite(rgb, GOLD_RGB, glow * 0.38 * p["alpha"])
            # second tighter glow
            composite(rgb, GOLD_RGB, cheap_glow(core, sigma=2.4 * S) * 0.45 * p["alpha"])
            composite(rgb, np.array([255.0, 232.0, 140.0]), core * p["alpha"])
        elif p["color"] == "tint":
            composite(rgb, TINT_RGB, glow * 0.22 * p["alpha"])
            composite(rgb, TINT_RGB, core * p["alpha"])
        else:
            composite(rgb, POWDER_RGB, glow * 0.28 * p["alpha"])
            composite(rgb, POWDER_RGB, core * p["alpha"])

        # pitch-tracking sample dots along the path
        n_dots = 7 if p["highlight"] else 5
        # skip the first 18% (too crowded at release) and last 6%
        fracs = np.linspace(0.20, 0.92, n_dots)
        dot_pts = np.column_stack(
            [np.interp(fracs * total, s, curve[:, 0]), np.interp(fracs * total, s, curve[:, 1])]
        )
        # only keep those in the art half
        keep = dot_pts[:, 0] > 1080 * S
        dot_pts = dot_pts[keep]
        if len(dot_pts) == 0:
            continue
        # grow slightly toward the plate
        dist = np.linspace(0.0, 1.0, len(dot_pts))
        dr = (1.15 + 1.35 * dist) * S * (1.15 if p["highlight"] else 1.0)
        dots = np.zeros((H, W), dtype=np.float32)
        stamp_disks(dots, dot_pts, dr.astype(np.float32), feather=0.9 * S)
        dots *= left[None, :]
        if p["color"] == "gold":
            composite(rgb, WHITE_RGB, dots * 0.55)
            composite(rgb, GOLD_RGB, dots * 0.85)
        else:
            composite(rgb, WHITE_RGB, dots * 0.38)

    # arrival bloom on the gold pitch
    bloom = np.zeros((H, W), dtype=np.float32)
    stamp_disks(
        bloom,
        shadow_low.reshape(1, 2),
        np.array([6.5 * S], dtype=np.float32),
        feather=2.0 * S,
    )
    composite(rgb, GOLD_RGB, cheap_glow(bloom, sigma=7.0 * S) * 0.35)
    composite(rgb, WHITE_RGB, bloom * 0.45)

    # ---- vignette + grain ----
    # keep the left relatively even (for type), slightly stronger vignette on right/corners
    vx = np.clip((xx - 0.18 * W) / (0.92 * W), 0.0, 1.0)
    vy = yy / (H - 1)
    vign = 1.0 - 0.22 * (smoothstep((np.sqrt((vx - 0.62) ** 2 * 0.6 + (vy - 0.55) ** 2) - 0.35) / 0.55))
    # extra top/bottom softness
    vign *= 0.82 + 0.18 * np.sin(np.clip(vy, 0, 1) * math.pi)
    rgb *= vign[..., None]

    # protect the left title well: no extra texture beyond a whisper of grain
    grain = np.random.default_rng(7).normal(0.0, 1.0, (H, W, 1)).astype(np.float32)
    grain_amt = 4.6 + 1.4 * (1.0 - left[None, :, None])  # slightly less grain on the left
    rgb += grain * grain_amt
    np.clip(rgb, 0, 255, out=rgb)

    im = Image.fromarray(np.round(rgb).astype(np.uint8), "RGB")
    return im


def save_hero(hires: Image.Image) -> dict:
    hero = hires.resize((2400, 1000), Image.Resampling.LANCZOS)
    hero_sm = hires.resize((1200, 500), Image.Resampling.LANCZOS)
    png_path = OUT / "hero.png"
    webp_path = OUT / "hero.webp"
    sm_path = OUT / "hero_sm.webp"
    hero.save(png_path, format="PNG", optimize=True)
    # Keep webp under ~400 KB; start high and step down if needed
    quality = 86
    for q in range(86, 68, -3):
        hero.save(webp_path, format="WEBP", quality=q, method=6)
        if webp_path.stat().st_size <= 400 * 1024:
            quality = q
            break
    hero_sm.save(sm_path, format="WEBP", quality=max(quality, 82), method=6)
    return {
        "hero.png": png_path,
        "hero.webp": webp_path,
        "hero_sm.webp": sm_path,
        "webp_quality": quality,
    }


# --- favicon -------------------------------------------------------------
# Geometry lives in a 32x32 design space. Letters are geometric, thick
# enough to hold up at 16 px. No crown, script wordmark, or team mark.


def _cubic(p0, p1, p2, p3, n=24) -> list[tuple[float, float]]:
    t = np.linspace(0, 1, n)
    pts = (
        (1 - t)[:, None] ** 3 * np.array(p0)
        + 3 * (1 - t)[:, None] ** 2 * t[:, None] * np.array(p1)
        + 3 * (1 - t)[:, None] * t[:, None] ** 2 * np.array(p2)
        + t[:, None] ** 3 * np.array(p3)
    )
    return [tuple(p) for p in pts]


def monogram_paths():
    """Return SVG path strings and polygon point lists for D, J, and the gold arc."""
    # D — even-odd: outer bowl + stem, rectangular counter with a rounded right side
    d_outer = (
        [(5.5, 7.0), (5.5, 25.0), (10.2, 25.0)]
        + _cubic((10.2, 25.0), (17.15, 25.0), (17.15, 7.0), (10.2, 7.0), n=28)
        + [(5.5, 7.0)]
    )
    d_inner = (
        [(9.05, 10.15), (9.05, 21.85), (10.45, 21.85)]
        + _cubic((10.45, 21.85), (13.95, 21.85), (13.95, 10.15), (10.45, 10.15), n=20)
        + [(9.05, 10.15)]
    )
    # J — top bar, thick stem, chunky hook (readable at 16 px)
    j_pts = (
        [
            (18.15, 7.0),
            (25.15, 7.0),
            (25.15, 9.45),
            (23.25, 9.45),
            (23.25, 20.6),
        ]
        + _cubic((23.25, 20.6), (23.25, 25.35), (16.85, 25.55), (15.55, 22.55), n=20)
        + [
            (17.35, 21.25),
        ]
        + _cubic((17.35, 21.25), (18.05, 22.55), (21.0, 22.35), (21.0, 20.35), n=12)
        + [
            (21.0, 9.45),
            (18.15, 9.45),
            (18.15, 7.0),
        ]
    )
    # Shallow seam-like arc under the letters
    arc_start, arc_c1, arc_c2, arc_end = (6.6, 27.15), (12.2, 29.15), (19.8, 29.15), (25.4, 27.15)
    d_svg_outer = points_to_svg(d_outer)
    d_svg_inner = points_to_svg(d_inner)
    d_path = f"{d_svg_outer} {d_svg_inner}"
    j_path = points_to_svg(j_pts)
    arc_svg = (
        f"M {arc_start[0]:.2f} {arc_start[1]:.2f} "
        f"C {arc_c1[0]:.2f} {arc_c1[1]:.2f}, {arc_c2[0]:.2f} {arc_c2[1]:.2f}, "
        f"{arc_end[0]:.2f} {arc_end[1]:.2f}"
    )
    return {
        "d_outer": d_outer,
        "d_inner": d_inner,
        "j": j_pts,
        "d_path": d_path,
        "j_path": j_path,
        "arc_svg": arc_svg,
        "arc_pts": _cubic(arc_start, arc_c1, arc_c2, arc_end, n=32),
    }


def points_to_svg(pts) -> str:
    cmds = [f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"]
    for x, y in pts[1:]:
        cmds.append(f"L {x:.2f} {y:.2f}")
    cmds.append("Z")
    return " ".join(cmds)


def write_favicon_svg(path: Path) -> None:
    geo = monogram_paths()
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="DJ">
  <title>DJ</title>
  <rect width="32" height="32" rx="7" ry="7" fill="{NAVY}"/>
  <rect x="0.7" y="0.7" width="30.6" height="30.6" rx="6.4" ry="6.4"
        fill="none" stroke="{POWDER}" stroke-width="1.15" opacity="0.55"/>
  <path fill="{POWDER}" fill-rule="evenodd" d="{geo['d_path']}"/>
  <path fill="{POWDER}" d="{geo['j_path']}"/>
  <path d="{geo['arc_svg']}" fill="none" stroke="{GOLD}" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
'''
    path.write_text(svg, encoding="utf-8")


def render_monogram(size: int, rounded: bool, supersample: int = 8) -> Image.Image:
    """Rasterize the monogram from the same 32-unit geometry."""
    geo = monogram_paths()
    N = 32 * supersample
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    navy = hex_to_rgb(NAVY) + (255,)
    powder = hex_to_rgb(POWDER) + (255,)
    gold = hex_to_rgb(GOLD) + (255,)
    scale = supersample  # 32-space * supersample = N

    def P(pts):
        return [(p[0] * scale, p[1] * scale) for p in pts]

    if rounded:
        r = 7.0 * scale
        draw.rounded_rectangle([0, 0, N - 1, N - 1], radius=r, fill=navy)
        # inner powder stroke
        inset = 0.7 * scale
        sw = 1.15 * scale
        draw.rounded_rectangle(
            [inset, inset, N - 1 - inset, N - 1 - inset],
            radius=6.4 * scale,
            outline=hex_to_rgb(POWDER) + (int(255 * 0.55),),
            width=max(1, int(round(sw))),
        )
    else:
        draw.rectangle([0, 0, N - 1, N - 1], fill=navy)

    # D with even-odd: draw outer, punch inner
    d_mask = Image.new("L", (N, N), 0)
    ddraw = ImageDraw.Draw(d_mask)
    ddraw.polygon(P(geo["d_outer"]), fill=255)
    ddraw.polygon(P(geo["d_inner"]), fill=0)
    d_layer = Image.new("RGBA", (N, N), powder)
    im.paste(d_layer, (0, 0), d_mask)

    j_mask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(j_mask).polygon(P(geo["j"]), fill=255)
    j_layer = Image.new("RGBA", (N, N), powder)
    im.paste(j_layer, (0, 0), j_mask)

    # gold arc as a thick stroke via a temporary wide line
    arc_im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arc_im)
    ap = P(geo["arc_pts"])
    ad.line(ap, fill=gold, width=max(1, int(round(1.7 * scale))), joint="curve")
    # round caps
    cap_r = 1.7 * scale / 2.0
    for cap in (ap[0], ap[-1]):
        ad.ellipse(
            [cap[0] - cap_r, cap[1] - cap_r, cap[0] + cap_r, cap[1] + cap_r],
            fill=gold,
        )
    im = Image.alpha_composite(im, arc_im)

    # downsample
    out = im.resize((size, size), Image.Resampling.LANCZOS)
    # composite onto an opaque navy-or-transparent? favicons should be opaque
    bg = Image.new("RGBA", (size, size), navy if not rounded else (0, 0, 0, 0))
    if rounded:
        # already has navy fill; just ensure opaque
        bg = Image.new("RGB", (size, size), hex_to_rgb(DEEP))
        bg.paste(out.convert("RGB"), mask=out.split()[-1])
        # The rounded corners need a true transparent... most favicons use opaque
        # rounded corners on a square. Browsers will show corner background of the
        # tab. Better: keep rounded navy on an opaque navy square (corners = navy,
        # same as fill, so the rounded stroke is the only rounded cue)... wait,
        # if the fill and the corner are both navy, the rounding disappears.
        # Use a fully opaque rounded rectangle: corners must be transparent OR
        # a dark color. I'll use a fully opaque square with rounded navy and
        # fill the corners with the same navy — rounding only shows if corners
        # differ. For favicon.png, use a transparent corner (RGBA).
        return out
    else:
        base = Image.new("RGB", (size, size), hex_to_rgb(NAVY))
        base.paste(out.convert("RGB"), mask=out.split()[-1])
        return base.convert("RGBA")


def save_ico(path: Path, images: dict[int, Image.Image]) -> None:
    """Write a multi-size ICO (16/32/48) with an explicit AND mask."""
    # Pillow can write ICO; pass the largest and the sizes list, but for
    # custom 16px art, write BMP-in-ICO manually to be safe.
    ordered = [16, 32, 48]
    blobs = []
    for s in ordered:
        im = images[s].convert("RGBA")
        # ICO PNG-compressed images (Vista+) are widely supported and keep AA
        buf = __import__("io").BytesIO()
        im.save(buf, format="PNG")
        blobs.append(buf.getvalue())
    header = struct.pack("<HHH", 0, 1, len(ordered))
    offset = 6 + 16 * len(ordered)
    entries = b""
    for s, blob in zip(ordered, blobs):
        # width/height: 0 means 256; we are 16/32/48
        entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.write_bytes(header + entries + b"".join(blobs))


def build_favicons() -> dict:
    svg_path = OUT / "favicon.svg"
    write_favicon_svg(svg_path)
    # high-quality rasters
    fav32 = render_monogram(32, rounded=True, supersample=16)
    # 16 px: even heavier supersample, then a touch of contrast
    fav16 = render_monogram(16, rounded=True, supersample=24)
    fav48 = render_monogram(48, rounded=True, supersample=12)
    apple = render_monogram(180, rounded=False, supersample=6)

    p32 = OUT / "favicon-32.png"
    p180 = OUT / "apple-touch-icon-180.png"
    pico = OUT / "favicon.ico"
    fav32.convert("RGBA").save(p32, format="PNG", optimize=True)
    apple.convert("RGBA").save(p180, format="PNG", optimize=True)
    save_ico(pico, {16: fav16, 32: fav32, 48: fav48})
    # also return 16 for a visual check (not a required deliverable)
    return {
        "favicon.svg": svg_path,
        "favicon-32.png": p32,
        "apple-touch-icon-180.png": p180,
        "favicon.ico": pico,
        "_preview16": fav16,
        "_preview48": fav48,
    }


# --- palette.md ----------------------------------------------------------
def write_palette() -> Path:
    def row(name, hexv, role, bg=NAVY, contrast_cell=None):
        if contrast_cell is not None:
            cell = contrast_cell
        else:
            r = contrast(hexv, bg)
            r2 = contrast(hexv, DEEP)
            cell = f"{r:.2f}:1 ({wcag_grade(r)}) / {r2:.2f}:1 ({wcag_grade(r2)})"
        return f"| `{hexv}` | {name} | {role} | {cell} |"

    text = f"""# Palette and type

Personal visual kit for a pitching-analytics portfolio. These colors are a
private navy / powder-blue / gold system for the site — not a team identity,
and they must not be combined with any MLB or club marks, crowns, uniforms,
or wordmarks.

## Color

| Hex | Name | Role | Contrast on bg navy / deep navy |
| --- | --- | --- | --- |
{row("Bg navy", NAVY, "Page background, hero field, favicon ground", contrast_cell="Ground (not a text color)")}
{row("Deep navy", DEEP, "Gradient terminus, footer, extra-dark panels", contrast_cell="Ground (not a text color)")}
{row("Powder blue", POWDER, "Primary line, links, monogram letters, charts")}
{row("Light blue tint", TINT, "Hover / highlight tints, secondary series")}
{row("Gold", GOLD, "Accent trajectory, key dots, focus marks")}
{row("Off-white", OFFWHITE, "Primary text and numbers on navy")}
{row("Muted grey", MUTED, "Secondary text, axis labels, captions")}

Contrast is computed from sRGB relative luminance per WCAG 2.x
\\((L1 + 0.05) / (L2 + 0.05)\\). Grades: **AA** is 4.5:1 (regular text) or
3:1 (large text / UI), **AAA** is 7:1 (regular) or 4.5:1 (large).

- **Off-white** on either navy is AAA for body text and numbers.
- **Muted grey** on bg navy is AA for body text (and AAA for large text).
- **Powder blue** on bg navy is AAA — safe for links and chart labels.
- **Gold** on bg navy is AA for text and AAA for large type. Prefer it as an
  accent, not as long-form body copy. On deep navy it reaches AAA.
- Do not set body text in gold or powder on a light panel; if a light surface
  is needed, use off-white or tint as the ground and navy (`{NAVY}`) as the
  text (off-white on navy inverted: **{contrast(NAVY, OFFWHITE):.2f}:1**, {wcag_grade(contrast(NAVY, OFFWHITE))}).

## Type

A free Google Fonts pairing: **Archivo** for headlines (compact, contemporary,
not a sports-broadcast costume), **IBM Plex Sans** for body copy (clear at
small sizes, comfortable for analysis write-ups), and **JetBrains Mono** for
numeric tables, pitch metrics, and code-like stat callouts.

```css
@import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,500;0,600;0,700;1,500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap');

:root {{
  --color-bg: {NAVY};
  --color-bg-deep: {DEEP};
  --color-powder: {POWDER};
  --color-powder-tint: {TINT};
  --color-gold: {GOLD};
  --color-text: {OFFWHITE};
  --color-text-muted: {MUTED};

  --font-display: 'Archivo', 'Arial Narrow', 'Helvetica Neue', sans-serif;
  --font-body: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace;
}}

html {{
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-weight: 400;
}}

h1, h2, h3, .display {{
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--color-text);
}}

.stat, table.numeric, code, kbd {{
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}}

a {{ color: var(--color-powder); }}
a:hover {{ color: var(--color-powder-tint); }}
.accent {{ color: var(--color-gold); }}
.muted {{ color: var(--color-text-muted); }}
```

Load only the listed weights if the site needs to stay lean; `display=swap`
is already in the `@import` line.
"""
    path = OUT / "palette.md"
    path.write_text(text, encoding="utf-8")
    return path


def verify() -> None:
    hero = Image.open(OUT / "hero.png")
    assert hero.size == (2400, 1000), hero.size
    webp = Image.open(OUT / "hero.webp")
    assert webp.size == (2400, 1000), webp.size
    sm = Image.open(OUT / "hero_sm.webp")
    assert sm.size == (1200, 500), sm.size
    assert (OUT / "hero.webp").stat().st_size <= 400 * 1024
    f32 = Image.open(OUT / "favicon-32.png")
    assert f32.size == (32, 32), f32.size
    apple = Image.open(OUT / "apple-touch-icon-180.png")
    assert apple.size == (180, 180), apple.size
    ico = Image.open(OUT / "favicon.ico")
    sizes = set()
    # ICO with PNG-encoded entries: Pillow reports the first size; walk frames
    sizes = set(ico.info.get("sizes") or {ico.size})
    assert sizes >= {(16, 16), (32, 32), (48, 48)}, sizes
    svg = (OUT / "favicon.svg").read_text(encoding="utf-8")
    assert "Royals" not in svg and "MLB" not in svg and "crown" not in svg.lower()
    print("verify: ok")
    print(f"  hero.png  {hero.size}  { (OUT/'hero.png').stat().st_size/1024:.1f} KB")
    print(f"  hero.webp {webp.size}  { (OUT/'hero.webp').stat().st_size/1024:.1f} KB")
    print(f"  hero_sm.webp {sm.size}  { (OUT/'hero_sm.webp').stat().st_size/1024:.1f} KB")
    print(f"  favicon-32.png {f32.size}")
    print(f"  apple-touch-icon-180.png {apple.size}")
    print(f"  favicon.ico frames={sorted(sizes)}")


def main() -> None:
    print("rendering hero at 2x…")
    hires = build_hero_hires(scale=2)
    # keep the 2x in /tmp for inspection if needed
    hires.save("/tmp/royals-brand/hero_2x.png")
    paths = save_hero(hires)
    print("hero written", paths)
    print("rendering favicons…")
    fav = build_favicons()
    # previews for visual QA
    fav["_preview16"].save("/tmp/royals-brand/favicon-16.png")
    fav["_preview48"].save("/tmp/royals-brand/favicon-48.png")
    fav["favicon-32.png"]  # already written
    Image.open(fav["favicon-32.png"]).resize((128, 128), Image.Resampling.NEAREST).save(
        "/tmp/royals-brand/favicon-32-zoom.png"
    )
    Image.open("/tmp/royals-brand/favicon-16.png").resize((128, 128), Image.Resampling.NEAREST).save(
        "/tmp/royals-brand/favicon-16-zoom.png"
    )
    write_palette()
    verify()
    print("done")


if __name__ == "__main__":
    main()
