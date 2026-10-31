#!/usr/bin/env python3
"""Turn a raw AI-generated character image into a game sprite sheet.

The pipeline, in order:

  1. GRID    report whether the source has a consistent pixel grid. AI "pixel
              art" almost never does, and saying so is what stops the tool from
              pretending it read a grid it did not.
  2. CELLS   rebuild one colour per cell. NEAREST NEIGHBOUR, because the source
              is already pixel art: a box filter blends across its cells and a
              per-cell mode aliases, and both were tried and both turned the
              figure into horizontal light and dark bands.
  3. CUT     hard-cut the background: key out near-white, then flood-fill
              inward from the border so enclosed areas count as holes.
  4. FILL    fill the holes the cut leaves inside the silhouette.
  5. PALETTE snap every pixel to a locked palette - the art's own by default,
              extracted with k-means after the resize.
  6. ANIMATE lay the result onto the 15-frame sheet the game loads.

Usage:
    python tools/ingest-character.py player
    python tools/ingest-character.py player --band 0
    python tools/ingest-character.py player --no-flip
    python tools/ingest-character.py player --project-palette

Writes src/assets/characters/<key>.png (960x96, 15 frames of 64x96).
"""

import argparse
import base64
import json
import os
import sys

import numpy as np
from PIL import Image

FRAME_W = 64
FRAME_H = 96
FRAMES = 15
KEYS = ["player", "npc_alin", "npc_xiaozhou", "wanderer"]

# The project palette, in src/render/palette.ts order.
PROJECT_PALETTE = np.array(
    [
        [0x05, 0x08, 0x0B], [0x14, 0x20, 0x2C], [0x2C, 0x3F, 0x4E], [0x47, 0x65, 0x7A],
        [0x8A, 0x95, 0xA0], [0x1E, 0x4A, 0x44], [0x2F, 0x6B, 0x5E], [0x4E, 0x9C, 0x86],
        [0x77, 0xC6, 0xA4], [0x6B, 0x46, 0x30], [0xA5, 0x71, 0x4C], [0xD9, 0xB4, 0x8F],
        [0x8A, 0x4A, 0x1E], [0xD9, 0x8B, 0x3C], [0xF4, 0xB6, 0x6A], [0xFF, 0xE4, 0xB6],
    ],
    dtype=np.int16,
)

WALL_LUM = 42.0  # the audit's wall band for this scene
MARGIN = 34.0     # how far the figure's floor must clear the background


def is_background(px: np.ndarray) -> np.ndarray:
    """Near-white, or already transparent."""
    return (px.sum(axis=2) > 720) | (px[:, :, 3] < 90)


def find_bands(ink: np.ndarray, gap_frac: float = 0.03) -> list:
    """Column ranges that hold ink, merged across small gaps."""
    col = ink.sum(axis=0)
    on = col > 3
    bands = []
    start = None
    for x in range(len(on)):
        if on[x] and start is None:
            start = x
        elif not on[x] and start is not None:
            bands.append([start, x - 1])
            start = None
    if start is not None:
        bands.append([start, len(on) - 1])
    bands = [b for b in bands if b[1] - b[0] > 24]
    gap = int(ink.shape[1] * gap_frac)
    merged = []
    for b in bands:
        if merged and b[0] - merged[-1][1] < gap:
            merged[-1][1] = b[1]
        else:
            merged.append(list(b))
    return merged


def flood_background(mask_bg: np.ndarray) -> np.ndarray:
    """True where the background can be reached from the border."""
    from collections import deque

    h, w = mask_bg.shape
    seen = np.zeros_like(mask_bg, dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if mask_bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if mask_bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and mask_bg[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((nx, ny))
    return seen


def kmeans(pixels: np.ndarray, k: int, iters: int = 8) -> np.ndarray:
    """Deterministic k-means, seeded from evenly spaced samples."""
    if len(pixels) == 0:
        return PROJECT_PALETTE
    k = max(1, min(k, len(pixels)))
    idx = np.linspace(0, len(pixels) - 1, k).round().astype(int)
    centres = pixels[idx].astype(np.float64)
    for _ in range(iters):
        d = ((pixels[:, None, :] - centres[None, :, :]) ** 2 * np.array([0.3, 0.59, 0.11])).sum(axis=2)
        assign = d.argmin(axis=1)
        for c in range(k):
            sel = pixels[assign == c]
            if len(sel):
                centres[c] = sel.mean(axis=0)
    # merge near-duplicates so the lock is real
    keep = []
    for c in centres:
        c = np.asarray(c)
        if keep and np.abs(np.array(keep) - c).sum(axis=1).min() < 12:
            continue
        keep.append(c)
    return np.array(keep, dtype=np.int16) if keep else PROJECT_PALETTE


def snap(pixels: np.ndarray, palette: np.ndarray) -> np.ndarray:
    """Nearest palette colour for every pixel."""
    d = ((pixels[:, None, :].astype(np.int32) - palette[None, :, :].astype(np.int32)) ** 2
         * np.array([0.3, 0.59, 0.11])).sum(axis=2)
    return palette[d.argmin(axis=1)]


def process_band(img: Image.Image, x0: int, x1: int, args) -> dict:
    """Cut, fill, resize, remap, lock. Returns the figure as RGBA at target size."""
    px = np.asarray(img.convert("RGBA")).astype(np.int16)
    bg = is_background(np.asarray(img.convert("RGBA")))

    # tight row extent of this figure
    sub_bg = bg[:, x0:x1 + 1]
    rows = np.where((~sub_bg).sum(axis=1) > 2)[0]
    if len(rows) == 0:
        return None
    ry0, ry1 = int(rows[0]), int(rows[-1])
    # every later array is the figure's own box, so the mask is sliced to it here
    sub_bg = sub_bg[ry0:ry1 + 1]
    fw = x1 - x0 + 1
    fh = ry1 - ry0 + 1

    # STEP 3: flood the background in from the border
    reach = flood_background(sub_bg)

    # STEP 4: a hole is an opaque pixel the flood never reached
    cut = px[ry0:ry1 + 1, x0:x1 + 1].copy()
    hole = (~reach) & sub_bg
    holes = int(hole.sum())
    if holes:
        # fill each hole with the nearest kept neighbour's colour. Vectorised
        # with a distance transform rather than a per-pixel search, which is both
        # faster and correct when the hole wraps the figure's outline.
        kept = (~reach) & (~sub_bg)
        if kept.any():
            from scipy import ndimage

            dist, (iy, ix) = ndimage.distance_transform_edt(
                ~kept, return_indices=True
            )
            ys, xs = np.where(hole)
            cut[ys, xs, :3] = cut[iy[ys, xs], ix[ys, xs], :3]
        cut[:, :, 3] = np.where(reach, 0, 255)

    # STEP 2: nearest neighbour to the target box
    target_h = min(FRAME_H - 2, fh)
    target_w = max(1, round(fw * target_h / fh))
    src = Image.fromarray(cut.astype(np.uint8), "RGBA")
    small = np.asarray(src.resize((target_w, target_h), Image.NEAREST)).astype(np.int16)

    # the resize can reintroduce background at the silhouette's edge; drop any
    # target pixel whose source cell the flood fill rejected
    sy = np.minimum(fh - 1, (np.arange(target_h) * fh / target_h).astype(int))
    sx = np.minimum(fw - 1, (np.arange(target_w) * fw / target_w).astype(int))
    keep = ~reach[np.ix_(sy, sx)]
    small[:, :, 3] = np.where(keep, 255, 0)

    opaque = small[:, :, 3] > 0
    if not opaque.any():
        return None

    # STEP 5b: VALUE SEPARATION - stretch the figure's own luminance range so its
    # floor clears the background. A muted painting sits at the brightness of the
    # wall it stands in front of and dissolves, and that is invisible in the
    # source because there the figure is on white.
    rgb = small[:, :, :3][opaque].astype(np.float64)
    lum = 0.299 * rgb[:, 0] + 0.587 * rgb[:, 1] + 0.114 * rgb[:, 2]
    lo, hi = np.percentile(lum, 5), np.percentile(lum, 95)
    span = max(1.0, hi - lo)
    target_lo = WALL_LUM + MARGIN
    target_hi = max(target_lo + 40, min(255.0, hi + (target_lo - lo)))
    k = np.clip((lum - lo) / span, 0, 1)
    new_lum = target_lo + k * (target_hi - target_lo)
    delta = (new_lum - lum)[:, None]
    rgb = np.clip(rgb + delta, 0, 255)
    small[:, :, :3][opaque] = rgb.astype(np.int16)

    # STEP 5: lock the palette - the art's own by default
    if args.project_palette:
        lock = PROJECT_PALETTE
    else:
        lock = kmeans(small[:, :, :3][opaque].astype(np.float64), 14)
    snapped = small.copy()
    snapped[:, :, :3][opaque] = snap(small[:, :, :3][opaque].astype(np.float64), lock)

    moved = int(
        (np.abs(snapped[:, :, :3][opaque] - small[:, :, :3][opaque]).sum(axis=1) > 12).sum()
    )

    return {
        "w": target_w,
        "h": target_h,
        "px": snapped,
        "src_w": fw,
        "src_h": fh,
        "opaque": int(opaque.sum()),
        "holes": holes,
        "lock_size": len(lock),
        "moved_share": moved / max(1, int(opaque.sum())),
        "lum_lo": float(lo),
        "lum_hi": float(hi),
        "target_lo": float(target_lo),
        "target_hi": float(target_hi),
    }


def compose(fig: dict, flip: bool) -> np.ndarray:
    """Place the figure on a 64x96 frame, feet on the last row."""
    frame = np.zeros((FRAME_H, FRAME_W, 4), dtype=np.uint8)
    w, h, px = fig["w"], fig["h"], fig["px"]
    off_x = (FRAME_W - w) // 2
    off_y = FRAME_H - h
    src = px[:, ::-1, :] if flip else px
    frame[off_y:off_y + h, off_x:off_x + w] = src.astype(np.uint8)
    return frame


def animate(fig: dict, args) -> list:
    """Derive the 15 animation frames from one painted pose.

    A single pose repeated 15 times makes the character slide across the floor
    without moving, which is worse than standing still. Splitting the figure at
    the hip and offsetting the legs per frame is the cheapest thing that reads as
    a walk at this size: the head, torso and backpack stay locked - so the
    silhouette never morphs - while the legs shift and the whole figure bobs.

    Frame layout must match src/render/walkcycle.ts:
      0-5 walk, 6-7 idle, 8-10 attack, 11-12 hurt, 13-14 search.
    """
    px = fig["px"]          # (h, w, 4)
    h, w = px.shape[:2]
    out = []

    def shift(region: np.ndarray, dx: int, dy: int) -> np.ndarray:
        """Move a block by (dx, dy) within its own box; the gap stays empty."""
        rh, rw = region.shape[:2]
        res = np.zeros_like(region)
        ys = slice(max(0, dy), min(rh, rh + dy))
        xs = slice(max(0, dx), min(rw, rw + dx))
        src_y = slice(max(0, -dy), min(rh, rh - dy))
        src_x = slice(max(0, -dx), min(rw, rw - dx))
        res[ys, xs] = region[src_y, src_x]
        return res

    hip = int(h * 0.52)     # where the legs start, measured on this figure

    def build(leg_dx: int, bob: int, upper_dx: int = 0, upper_dy: int = 0) -> np.ndarray:
        f = px.copy()
        # legs: horizontal stride
        if leg_dx:
            f[hip:] = shift(px[hip:], leg_dx, 0)
        # whole figure: vertical bob, applied by shifting everything up
        if bob:
            f = shift(f, 0, -bob)
        # upper body: lean for attack / search
        if upper_dx or upper_dy:
            f[:hip] = shift(px[:hip], upper_dx, upper_dy)
        return f

    walk = [(2, 0), (1, 1), (0, 0), (-1, 1), (-2, 0), (-1, 1)]
    for leg_dx, bob in walk:
        out.append(build(leg_dx, bob))
    for bob in (0, 1):                       # idle: breathe
        out.append(build(0, bob))
    for upper_dx in (0, 1, 2):               # attack: wind-up, strike, recover
        out.append(build(0, 0, upper_dx, 0))
    for back in (2, 1):                      # hurt: recoil
        out.append(build(0, 0, -back, 0))
    for fwd in (1, 2):                       # search: bend in
        out.append(build(0, 0, fwd, 1))

    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("--band", type=int, default=None)
    ap.add_argument("--no-flip", action="store_true")
    ap.add_argument("--project-palette", action="store_true")
    ap.add_argument("--debug", action="store_true", help="write intermediate PNGs to re/")
    ap.add_argument("--static", action="store_true", help="one pose for every frame, no derived motion")
    args = ap.parse_args()

    if args.key not in KEYS:
        print(f"usage: ingest-character.py <{'|'.join(KEYS)}> [--band N] [--no-flip] [--project-palette]")
        return 1

    src_path = os.path.join("art-src", "characters", f"{args.key}.png")
    if not os.path.exists(src_path):
        print(f"missing {src_path}")
        return 1

    img = Image.open(src_path)
    rgba = np.asarray(img.convert("RGBA"))
    bg = is_background(rgba)
    ink = ~bg

    # STEP 1: is there a pixel grid?
    ones = total = 0
    h, w = ink.shape
    for y in range(int(h * 0.2), int(h * 0.8), 11):
        row = rgba[y, :, :3].astype(int)
        diff = np.abs(np.diff(row, axis=0)).sum(axis=1)
        runs = np.split(diff, np.where(diff > 6)[0] + 1)
        for r in runs:
            total += 1
            if len(r) == 1:
                ones += 1
    noise = ones / max(1, total)

    bands = find_bands(ink)
    if args.band is not None and args.band < len(bands):
        bands = [bands[args.band]]

    print(f"source   {img.width}x{img.height}, {len(bands)} figure(s)")
    print(f"grid     {noise*100:.0f}% of colour runs are 1px -> "
          f"{'no consistent grid; treated as a draft and resampled' if noise > 0.4 else 'a grid is present'}")

    figs = []
    for i, (x0, x1) in enumerate(bands):
        fig = process_band(img, x0, x1, args)
        if fig is None:
            continue
        figs.append(fig)
        if args.debug:
            Image.fromarray(fig["px"].astype(np.uint8), "RGBA").resize(
                (fig["w"] * 6, fig["h"] * 6), Image.NEAREST
            ).save(f"re/debug-band{i}.png")
        print(f"band {i}   {fig['src_w']}x{fig['src_h']} -> {fig['w']}x{fig['h']} "
              f"({fig['opaque']} opaque, {fig['holes']} holes filled)")

    if not figs:
        print("no figure found")
        return 1

    if len(bands) > 1 and args.band is None:
        print(f"\nthis sheet holds {len(bands)} figures. Run again with --band N:")
        for i, f in enumerate(figs):
            print(f"  --band {i}   {f['w']}x{f['h']}")
        return 0

    fig = figs[0]
    flip = not args.no_flip
    print(f"value    figure range {fig['lum_lo']:.0f}..{fig['lum_hi']:.0f} remapped to "
          f"clear the wall (lum {WALL_LUM:.0f}) by {MARGIN:.0f} -> "
          f"{fig['target_lo']:.0f}..{fig['target_hi']:.0f}")
    print(f"palette  {fig['lock_size']} colours locked from the "
          f"{'project' if args.project_palette else 'art itself'}; "
          f"{fig['moved_share']*100:.0f}% of pixels moved")
    print(f"facing   {'flipped to face right' if flip else 'left as drawn (--no-flip)'}")
    frames = [compose(fig, flip)]
    if not args.static:
        # animate every frame after the first, so the sheet carries a walk
        for pose in animate(fig, args)[1:]:
            f2 = dict(fig)
            f2["px"] = pose
            frames.append(compose(f2, flip))

    ys = np.where(frames[0][:, :, 3] > 0)[0]
    feet = int(ys[-1]) if len(ys) else -1
    print(f"feet     lowest opaque row {feet} of 0..{FRAME_H-1}"
          + ("  (good)" if feet == FRAME_H - 1 else f"  <-- {FRAME_H-1-feet}px short, it will float"))
    print(f"motion   {len(frames)} frames, {len(set(f.tobytes() for f in frames))} distinct"
          + ("" if len(set(f.tobytes() for f in frames)) > 1 else "  <-- STATIC, the character will not move"))

    # STEP 6: the 15-frame sheet. A single figure fills every frame, so the
    # character looks hand-drawn and the procedural art carries the motion.
    #
    # Transparent pixels are zeroed in RGB as well as alpha. The nearest-neighbour
    # resize samples source pixels whose alpha is 0 but whose RGB is not, so the
    # exported sheet carried 147 distinct RGBA tuples for 14 visible colours -
    # which is what the create-game-assets QA script reports as "more than 16
    # colors" and fails the asset on. Zeroing the invisible channel makes the
    # file's colour count mean what it says.
    for f in frames:
        f[:, :, :3][f[:, :, 3] == 0] = 0

    sheet = np.zeros((FRAME_H, FRAME_W * FRAMES, 4), dtype=np.uint8)
    for i, f in enumerate(frames[:FRAMES]):
        sheet[:, i * FRAME_W:(i + 1) * FRAME_W] = f
    sheet[:, :, :3][sheet[:, :, 3] == 0] = 0

    out_dir = os.path.join("src", "assets", "characters")
    os.makedirs(out_dir, exist_ok=True)
    dst = os.path.join(out_dir, f"{args.key}.png")
    Image.fromarray(sheet, "RGBA").save(dst)
    print(f"\nwrote    {dst}  ({FRAME_W*FRAMES}x{FRAME_H}, {FRAMES} frames)")
    if args.debug:
        Image.fromarray(frames[0], "RGBA").resize((FRAME_W * 6, FRAME_H * 6), Image.NEAREST).save(
            f"re/debug-{args.key}.png")
        # a contact sheet of all 15 frames, nearest-neighbour, so the cycle can
        # be read in one image
        sheet_img = Image.fromarray(sheet, "RGBA")
        sheet_img.resize((sheet_img.width * 2, sheet_img.height * 2), Image.NEAREST).save(
            f"re/debug-{args.key}-sheet.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
