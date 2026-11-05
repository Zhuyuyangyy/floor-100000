#!/usr/bin/env python3
"""Assemble rig frames into the game's character sheet.

The rig tool writes one PNG per clip frame (walk-00.png ... pickup-01.png).
The game's walk sheet is a single strip whose frame order is fixed by
src/render/walkcycle.ts:

    0-5   walk      (WALK_FRAMES 6)
    6-7   idle      (IDLE_FRAMES 2)
    8-10  attack    (ATTACK_FRAMES 3)
    11-12 hurt      (HURT_FRAMES 2)
    13-14 search    (SEARCH_FRAMES 2)
    15-17 die       (DIE_FRAMES 3)
    18-19 pickup    (PICKUP_FRAMES 2)

Usage:
    python tools/assemble-rig-sheet.py <frames-dir> <key>
"""
import os
import sys

from PIL import Image

FRAME_W, FRAME_H = 64, 96
# clip name -> how many frames the game expects, in sheet order
ORDER = [
    ("walk", 6),
    ("idle", 2),
    ("attack", 3),
    ("hurt", 2),
    ("search", 2),
    ("die", 3),
    ("pickup", 2),
]
KEYS = ["player", "npc_alin", "npc_xiaozhou", "wanderer"]


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: assemble-rig-sheet.py <frames-dir> <key>")
        return 2
    frames_dir, key = sys.argv[1], sys.argv[2]
    if key not in KEYS:
        print(f"key must be one of {KEYS}")
        return 2

    total = sum(n for _, n in ORDER)
    sheet = Image.new("RGBA", (FRAME_W * total, FRAME_H), (0, 0, 0, 0))
    slot = 0
    for clip, count in ORDER:
        for i in range(count):
            src = os.path.join(frames_dir, f"{clip}-{i:02d}.png")
            if not os.path.exists(src):
                print(f"missing {src}")
                return 1
            frame = Image.open(src).convert("RGBA")
            if frame.size != (FRAME_W, FRAME_H):
                print(f"{src} is {frame.size}, expected {(FRAME_W, FRAME_H)}")
                return 1
            sheet.paste(frame, (slot * FRAME_W, 0))
            slot += 1

    dst_dir = os.path.join("src", "assets", "characters")
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, f"{key}.png")
    sheet.save(dst)
    print(f"wrote {dst} ({sheet.width}x{sheet.height}, {slot} frames)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
