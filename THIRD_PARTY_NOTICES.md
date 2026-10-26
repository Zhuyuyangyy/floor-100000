# THIRD_PARTY NOTICES

Third-party assets bundled with this project, with their licence and provenance.

## Pixel UI frames — Kenney, CC0 1.0

- **Files:** `public/assets/ui/panel-green.png`, `public/assets/ui/panel-yellow.png`,
  `public/assets/ui/marker.png`
- **Used for:** the nine-slice frames around the inventory, crafting, pause,
  dialogue and help panels, and the arrow selection marker in every list (menu,
  inventory, crafting, pause, dialogue) — see `src/render/panels.ts`.
- **Original source:** Kenney, "Pixel UI Pack" — https://kenney.nl/assets/pixel-ui-pack
- **Bundled via:** https://github.com/Tiddybub/2d-assets (`ui/pixel-ui-pack/`)
- **Author:** Kenney Vleugels (Kenney.nl)
- **Licence:** Creative Commons Zero 1.0 Universal (CC0 1.0, public domain
  dedication) — https://creativecommons.org/publicdomain/zero/1.0/
  Free for personal and commercial use; attribution is not required.

### Modification

Two changes, both permitted by CC0:

1. **Panel frames** (`9-Slice/Outline/{green,yellow}.png`) — the originals are a
   2px coloured border with an **opaque** `#EEEEEE` interior. This project's UI
   rule is a dark translucent background with high-contrast light text
   (`docs/05_ART_GUIDE.md` §2), so the interior was cleared to transparent and
   the dark fill is drawn behind it. The border pixels and the rounded corners
   are untouched.
2. **Selection marker** — cropped from the pack's spritesheet
   (`Spritesheet/UIpackSheet_transparent.png`, 16x16 tiles on an 18px pitch) at
   native size. It replaces the text `▶ ` prefix, which indented every label and
   broke the pixel look.

---

## Everything else

All other art, audio and code in this repository is original and generated at
runtime by `src/render/pixelArt.ts` and `src/render/audio.ts` — no other
third-party assets are bundled.
