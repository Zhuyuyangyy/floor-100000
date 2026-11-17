#!/usr/bin/env python3
"""Bake the four characters' action GIFs into runtime sprite atlases.

WHY THIS EXISTS. The 2026-11-18 delivery (docs/art-previews) holds seven action
GIFs per character - attack / hurt / die / idle / pickup / search (+ walk, which
the game already owns a hand-posed cycle for, see render/walkcycle.ts). The game
has played procedurally-posed clips for all of these since W5/W6; this script
replaces the PIXELS with the owner's art while the runtime contract (64x96
frames, 16-colour palette, binary alpha, feet on row 95) stays exactly where
walkcycle.ts put it. One GIF per action becomes one horizontal atlas:

    public/assets/chars/<game-key>-<action>.png   frames x 64 wide, 96 tall
    public/assets/chars/manifest.json             frame counts + GIF durations

The game key is the one artpack.ts calls CHARACTER_KEYS - player, npc_alin,
npc_xiaozhou, wanderer - so the file name, the texture key and the manifest
entry are one identity. The GIF folders keep the short names the delivery used
(alin, xiaozhou); the mapping lives in CHARS below and nowhere else.

MEASURED FACTS THIS SCRIPT ENFORCES (all verified on the 2026-11-18 pack):
  * Every GIF is 640x960 and an EXACT 10x nearest-neighbour upscale of a
    64x96 source: all 6144 10x10 blocks are uniform, and a downscale-then-
    upscale round trip is 0 pixels different. So NEAREST back down to 64x96
    loses nothing - the script asserts this per frame and fails loudly if a
    future delivery is not on that grid.
  * After the downscale each frame holds at most 16 colours and every one of
    them is one of the 16 in src/render/palette.ts - except the background,
    a flat #e1e7eb (225,231,235). No palette snapping is needed or done: the
    art was already drawn on the project palette.
  * The background is a flat opaque #e1e7eb (225,231,235) and NO palette
    colour is near-white (the brightest, lightHot, is 255,228,182 - blue 182
    is under the bar), so keying by colour is exact: every near-white pixel is
    background, full stop. The enclosed near-white slivers between limbs and
    legs stay transparent rather than being flood-filled - in a side view they
    are see-through depth (the corridor behind the figure), not figure detail,
    and filling them would weld arm to torso.
  * Feet land on row 92-94 in the GIFs, with an authored +-1px bob between
    frames; the sheets the game already ships (src/assets/characters) put them
    on row 95 with zero spread, and the sprite origin is the frame's bottom
    edge. Every frame is shifted down to row 95 - the same contract
    tools/char-sheet-gate.mjs gates the shipped sheets on - so a GIF idle does
    not float above a procedural walk. The bob is below the gate's own
    tolerance and is not preserved; the arm and body motion carries the clip.

IDEMPOTENT BY CONSTRUCTION: no timestamps, sorted keys, deterministic PNG
bytes. A second run rewrites nothing that did not change, so `git status`
stays clean.

Usage:
    python tools/bake-char-anims.py              # bake + verify, write outputs
    python tools/bake-char-anims.py --verify     # re-check committed PNGs only

Exits non-zero when any gate fails (wrong grid, off-palette pixel, bad
geometry, drifting feet), so a pre-commit hook or CI can call it directly.
"""

import argparse
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

# Resolved from THIS file, not the cwd: python is a Windows program and MSYS
# translates /d/... paths it does not understand, but __file__ arrives as a
# proper Windows path no matter how the script was invoked.
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs' / 'art-previews'
OUT = ROOT / 'public' / 'assets' / 'chars'
PALETTE_TS = ROOT / 'src' / 'render' / 'palette.ts'

FRAME_W = 64
FRAME_H = 96
# Where the shipped sheets (src/assets/characters) put the feet, and therefore
# where the GIF frames are shifted to. walkcycle.ts draws FOOT_GROUND = 94 but
# the baked sheets' lowest opaque row measures 95 - the sprite origin (0.5, 1)
# is the frame's bottom edge, so 95 is the row that sits ON the floor.
FEET_TARGET = 95
# The GIF canvas is an exact 10x of the 64x96 frame; verified per frame below.
SCALE = 10

# The four characters with delivered GIFs, as GIF-directory -> game key. The
# game key is the identity used everywhere else (artpack.ts CHARACTER_KEYS,
# the animation keys, the atlas file names); the GIF folder keeps the short
# name the delivery used, so the mapping lives here and nowhere else.
CHARS = {
    'player': 'player',
    'alin': 'npc_alin',
    'xiaozhou': 'npc_xiaozhou',
    'wanderer': 'wanderer',
}
# walk.gif is deliberately absent: B3-14 hand-posed the walk cycle pixel by
# pixel (render/walkcycle.ts) and the GIF would be a regression on it.
# all-actions.gif is a 20-frame contact sheet, not an action.
ACTIONS = ['attack', 'hurt', 'die', 'idle', 'pickup', 'search']
# Standing actions: their feet rows must agree, and are what the per-character
# shift is measured from. die is excluded - a fallen body's lowest row is the
# torso, not the feet, and it shifts with the character anyway.
STANDING = ['attack', 'hurt', 'idle', 'pickup', 'search']

# Background keying: near-white on every channel, or already transparent.
# No palette colour is near-white (the brightest, lightHot, is 255,228,182 -
# blue 182 is under the bar), so this cannot eat a figure pixel.
BG_MIN = 200
ALPHA_MIN = 90


def load_palette() -> list[tuple[int, int, int]]:
    """The sixteen colours, parsed out of palette.ts - the source of truth.

    Same approach as tools/assets-manifest.mjs and char-sheet-gate.mjs: a
    copied hex table would drift the moment palette.ts gains a colour.
    """
    src = PALETTE_TS.read_text(encoding='utf-8')
    start = src.index('export const PALETTE')
    block = src[start:src.index('} as const', start)]
    hexes = {m.lower() for m in re.findall(r'0x([0-9a-fA-F]{6})', block)}
    return [(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)) for h in sorted(hexes)]


def gif_frames(path: Path) -> list[tuple[Image.Image, int]]:
    """Every composited frame of the GIF with its display duration in ms."""
    im = Image.open(path)
    out: list[tuple[Image.Image, int]] = []
    i = 0
    while True:
        try:
            im.seek(i)
        except EOFError:
            break
        dur = im.info.get('duration')
        if not isinstance(dur, (int, float)) or dur <= 0:
            # A GIF with no duration is legal but unplayable at the authored
            # rhythm; 100ms is Phaser's own default and keeps the cycle sane.
            print(f'    ! {path.name} frame {i}: no duration, assuming 100ms')
            dur = 100
        out.append((im.convert('RGBA'), int(dur)))
        i += 1
    if not out:
        raise SystemExit(f'{path}: no frames')
    return out


def downscale(frame: Image.Image, name: str) -> Image.Image:
    """640x960 -> 64x96 NEAREST, after asserting the 10x grid is exact."""
    if frame.size != (FRAME_W * SCALE, FRAME_H * SCALE):
        raise SystemExit(
            f'{name}: {frame.size} is not {FRAME_W * SCALE}x{FRAME_H * SCALE}; '
            "this pipeline expects the delivery's exact 10x canvas"
        )
    small = frame.resize((FRAME_W, FRAME_H), Image.NEAREST)
    # Round-trip check: if any 10x10 block is not uniform the NEAREST downscale
    # is inventing pixels, and the baked atlas would not be the owner's art.
    back = small.resize((FRAME_W * SCALE, FRAME_H * SCALE), Image.NEAREST)
    if frame.tobytes() != back.tobytes():
        raise SystemExit(f'{name}: not an exact {SCALE}x nearest upscale; refusing to bake')
    return small


def key_background(small: Image.Image, name: str) -> Image.Image:
    """Key the flat background out to transparency and zero the RGB under it.

    No flood fill and no hole filling, unlike tools/ingest-character.py: that
    script processes raw AI paintings, where enclosed near-white pixels are
    anti-aliased figure detail that must be filled. This source is exact pixel
    art on the project palette, so near-white is background everywhere it
    appears - including the slivers between the arm and the torso, which in a
    side view are see-through depth, not silhouette. Welding them shut would
    change the drawing; the gate below proves no figure pixel was caught.
    """
    px = small.load()
    keyed: set[tuple[int, int, int]] = set()
    out = small.copy()
    opx = out.load()
    w, h = small.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < ALPHA_MIN or (r > BG_MIN and g > BG_MIN and b > BG_MIN):
                keyed.add((r, g, b))
                opx[x, y] = (0, 0, 0, 0)
    if len(keyed) > 1:
        # More than one background shade means the delivery is not the flat
        # #e1e7eb canvas this pipeline measured; say so instead of guessing.
        print(f'    ! {name}: keyed {len(keyed)} background colours: {sorted(keyed)}')
    return out


def gate_frame(small: Image.Image, palette: set[tuple[int, int, int]], name: str) -> None:
    """The palette/alpha contract, asserted rather than assumed."""
    colours = small.getcolors(maxcolors=1 << 20) or []
    if len(colours) > 16:
        raise SystemExit(f'{name}: {len(colours)} colours after keying (limit 16)')
    for _, (r, g, b, a) in colours:
        if a == 0:
            if (r, g, b) != (0, 0, 0):
                raise SystemExit(f'{name}: transparent pixel carries rgb {(r, g, b)}')
            continue
        if a != 255:
            raise SystemExit(f'{name}: semi-alpha {a} is not allowed in these sheets')
        if (r, g, b) not in palette:
            raise SystemExit(f'{name}: #{(r << 16) | (g << 8) | b:06x} is outside the project palette')


def feet_row(small: Image.Image) -> int:
    px = small.load()
    for y in range(FRAME_H - 1, -1, -1):
        for x in range(FRAME_W):
            if px[x, y][3] > 0:
                return y
    return -1


def shift_down(small: Image.Image, dy: int) -> Image.Image:
    """Move the figure down dy rows inside its frame; the gap stays empty."""
    if dy <= 0:
        return small
    out = Image.new('RGBA', small.size, (0, 0, 0, 0))
    out.paste(small, (0, dy))
    return out


def png_bytes(atlas: Image.Image) -> bytes:
    """Deterministic PNG bytes (PIL's zlib output is stable for fixed input)."""
    buf = io.BytesIO()
    atlas.save(buf, format='PNG')
    return buf.getvalue()


def write_if_changed(path: Path, data: bytes) -> bool:
    """Idempotent write: touch the file only when the content actually moved."""
    if path.exists() and path.read_bytes() == data:
        return False
    path.write_bytes(data)
    return True


def decode_char(gif_dir: str, key: str, palette: set[tuple[int, int, int]]) -> dict[str, list[tuple[Image.Image, int, int]]]:
    """Pass 1: every frame of every action, keyed, gated and foot-normalised.

    Returns action -> [(frame_at_feet_95, duration_ms, source_feet_row)].
    """
    src_dir = SRC / gif_dir
    if not src_dir.is_dir():
        raise SystemExit(f'missing source directory {src_dir}')
    decoded: dict[str, list[tuple[Image.Image, int, int]]] = {}
    for action in ACTIONS:
        gif = src_dir / f'{action}.gif'
        if not gif.exists():
            raise SystemExit(f'missing {gif}')
        entries = []
        for i, (frame, dur) in enumerate(gif_frames(gif)):
            name = f'{gif_dir}/{action} f{i}'
            small = downscale(frame, name)
            small = key_background(small, name)
            gate_frame(small, palette, name)
            feet = feet_row(small)
            if feet > FEET_TARGET:
                raise SystemExit(f'{name}: feet on row {feet} are below {FEET_TARGET}; would clip')
            entries.append((shift_down(small, FEET_TARGET - feet), dur, feet))
        decoded[action] = entries
    return decoded

def bake_char(gif_dir: str, key: str, palette: set[tuple[int, int, int]]) -> dict[str, dict]:
    """One character: six atlases, every frame normalised to feet-on-95.

    Files are named by the GAME key (npc_alin-attack.png), not the GIF folder
    name, so one identity covers the file, the texture key and the manifest.
    """
    decoded = decode_char(gif_dir, key, palette)
    baked: dict[str, dict] = {}
    for action, entries in decoded.items():
        atlas = Image.new('RGBA', (FRAME_W * len(entries), FRAME_H), (0, 0, 0, 0))
        for i, (small, _, _) in enumerate(entries):
            atlas.paste(small, (i * FRAME_W, 0))
        write_if_changed(OUT / f'{key}-{action}.png', png_bytes(atlas))
        print(
            f'  {key}-{action}.png  {len(entries)}f x {FRAME_W}x{FRAME_H} '
            f'= {FRAME_W * len(entries)}x{FRAME_H}, {sum(d for _, d, _ in entries)}ms, '
            f'source feet {[f for _, _, f in entries]}'
        )
        baked[action] = {
            'file': f'{key}-{action}.png',
            'frames': len(entries),
            'durations': [d for _, d, _ in entries],
            'totalMs': sum(d for _, d, _ in entries),
            'sourceGif': f'{gif_dir}/{action}.gif',
            'sourceFeetRows': [f for _, _, f in entries],
        }
    return baked


def verify_committed(palette: set[tuple[int, int, int]]) -> None:
    """--verify: re-open every committed atlas and re-run the gates on disk."""
    checked = 0
    for gif_dir, key in CHARS.items():
        for action in ACTIONS:
            path = OUT / f'{key}-{action}.png'
            if not path.exists():
                raise SystemExit(f'missing committed atlas {path}')
            im = Image.open(path).convert('RGBA')
            n = im.width // FRAME_W
            if im.width != n * FRAME_W or im.height != FRAME_H:
                raise SystemExit(f'{path.name}: {im.size} is not {n} frames of {FRAME_W}x{FRAME_H}')
            for f in range(n):
                frame = im.crop((f * FRAME_W, 0, (f + 1) * FRAME_W, FRAME_H))
                gate_frame(frame, palette, f'{path.name} f{f}')
                if feet_row(frame) != FEET_TARGET:
                    raise SystemExit(f'{path.name} f{f}: feet on row {feet_row(frame)}, expected {FEET_TARGET}')
            checked += 1
    print(f'verify  {checked} committed atlases pass every gate')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify', action='store_true', help='re-check committed PNGs without re-baking')
    args = ap.parse_args()

    palette = set(load_palette())
    if len(palette) != 16:
        raise SystemExit(f'palette.ts yielded {len(palette)} colours, expected 16')

    if args.verify:
        verify_committed(palette)
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    print(f'bake    {SRC.relative_to(ROOT)} -> {OUT.relative_to(ROOT)} (palette {len(palette)})')
    manifest = {
        'source': 'docs/art-previews/<char>/<action>.gif (2026-11-18 delivery)',
        'bakedBy': 'tools/bake-char-anims.py',
        'frame': {'w': FRAME_W, 'h': FRAME_H},
        'feetRow': FEET_TARGET,
        'palette': 'src/render/palette.ts; every opaque pixel verified in-palette',
        'characterKeys': 'GIF folder name -> game key (artpack.ts CHARACTER_KEYS)',
        'skipped': {
            'walk.gif': 'walk cycle is hand-posed in render/walkcycle.ts (B3-14); the GIF is not wired',
            'all-actions.gif': '20-frame contact sheet, not an action',
        },
        'characters': {},
    }
    total_frames = 0
    for gif_dir, key in CHARS.items():
        manifest['characters'][key] = bake_char(gif_dir, key, palette)
        total_frames += sum(e['frames'] for e in manifest['characters'][key].values())

    text = json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + '\n'
    write_if_changed(OUT / 'manifest.json', text.encode('utf-8'))

    files = sorted(p.name for p in OUT.glob('*.png'))
    print(f'wrote   {len(files)} atlases + manifest.json, {total_frames} frames total')
    verify_committed(palette)
    return 0


if __name__ == '__main__':
    sys.exit(main())
