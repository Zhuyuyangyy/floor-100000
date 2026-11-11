# Character sheets (drop-in)

Put PNGs here to replace the procedural characters. File name = character key:
  player.png  npc_alin.png  npc_xiaozhou.png  wanderer.png
Layout: one horizontal strip, 20 frames, each 64x96, transparent background.
Frame order: walk 0-5, idle 6-7, attack 8-10, hurt 11-12, search 13-14, die 15-17, pickup 18-19.
Sheet size: 1280x96.
Vite picks these up automatically; if a file is absent the procedural sprite is used.
See docs/ART_BRIEF.md for the generation prompts.
