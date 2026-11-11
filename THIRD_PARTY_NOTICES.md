# THIRD_PARTY NOTICES

Third-party assets bundled with this project, with their licence and provenance.

## Selection marker — Kenney, CC0 1.0

- **File:** `public/assets/ui/marker.png`
- **Used for:** the arrow selection marker in every list (menu, inventory,
  crafting, pause, dialogue) — see `src/render/panels.ts`.
- **Original source:** Kenney, "Pixel UI Pack" — https://kenney.nl/assets/pixel-ui-pack
- **Bundled via:** https://github.com/Tiddybub/2d-assets (`ui/pixel-ui-pack/`)
- **Author:** Kenney Vleugels (Kenney.nl)
- **Licence:** Creative Commons Zero 1.0 Universal (CC0 1.0, public domain
  dedication) — https://creativecommons.org/publicdomain/zero/1.0/
  Free for personal and commercial use; attribution is not required.
- **Modification:** cropped from the pack's spritesheet
  (`Spritesheet/UIpackSheet_transparent.png`, 16x16 tiles on an 18px pitch) at
  native size. It replaces the text `▶ ` prefix, which indented every label and
  broke the pixel look.

> The panel frames used to come from the same pack (`9-Slice/Outline/{green,yellow}.png`)
> but no longer do — they were replaced by the art pack described below. The
> reason is a Phaser 4 rendering trap, not a licensing one; see
> `docs/ARTPACK_INTEGRATION.md` §4.2.

---

## Art pack — supplied by the project owner

- **Files:** `public/assets/artpack/*.png`, `public/assets/ui/frame-*.png`,
  `public/assets/ui/slot.png`
- **Contents:** 15 item icons, the panel frame cut into eight pieces, the
  inventory slot frame, and the win/lose end-screen banners.
- **Provenance:** supplied to the project by its owner and integrated at their
  instruction. Not sourced from a third-party asset site.
- **Processing:** sliced and resampled out of seven 1536x1024 design sheets by
  `tools/build-artpack.mjs` (see `docs/ARTPACK_INTEGRATION.md`). Item icons are
  area-averaged from ~250px down to 16x16; the panel frame is cut into four
  natural-size corners and four stretchable edges.
- **Licence:** the owner's to state. Nothing here was taken from a third party.

> If this repository is ever published, this section is the one to settle first:
> the art is the owner's, but a public repo grants the world a licence the owner
> may not intend. The code is MIT-shaped original work; the art is not
> automatically.

---

## pixelfx — MIT

- **Files:** `public/assets/fx/melee/sword-slash/` and
  `public/assets/fx/impacts/parry/` (the existing `public/assets/fx/` atlases use
  the same source)
- **Source:** Patch Pixel, https://github.com/patch-gg/pixelfx
- **Licence:** MIT License, Copyright © 2026 Patch and Hugo Duprez.
- **Adapted source:** `src/core/sim.js` and effects that identify Sprite Fusion
  recipes adapt Hugo Duprez's open-source pixel VFX, Copyright © 2026 Hugo
  Duprez, MIT License. The current slash/parry sheets were rendered from the
  pixelfx effect definitions without copying the runtime library into this repo.
- **Additional notice:** `src/core/act.js` in pixelfx adapts Hollow Crown's
  timing approach; this project does not vendor that runtime or its characters.

---

## Everything else

All other art and audio in this repository is original and generated at runtime by
`src/render/pixelArt.ts` and `src/render/audio.ts`, except for the Kenney marker,
owner-supplied art pack, and the pixelfx atlases listed above.
