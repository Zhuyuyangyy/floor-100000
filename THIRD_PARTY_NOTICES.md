# THIRD_PARTY NOTICES

Third-party assets bundled with this project, with their licence and provenance.

## Pixel UI frames — Kenney, CC0 1.0

- **Files:** `public/assets/ui/panel-green.png`, `public/assets/ui/panel-yellow.png`
- **Used for:** the nine-slice frames around the inventory, crafting, pause,
  dialogue and help panels (see `src/render/panels.ts`).
- **Original source:** Kenney, "Pixel UI Pack" — https://kenney.nl/assets/pixel-ui-pack
- **Bundled via:** https://github.com/Tiddybub/2d-assets (`ui/pixel-ui-pack/9-Slice/Outline/{green,yellow}.png`)
- **Author:** Kenney Vleugels (Kenney.nl)
- **Licence:** Creative Commons Zero 1.0 Universal (CC0 1.0, public domain
  dedication) — https://creativecommons.org/publicdomain/zero/1.0/
  Free for personal and commercial use; attribution is not required.

### Modification

The originals are a 2px coloured border with an **opaque** `#EEEEEE` interior.
This project's UI rule is a dark translucent background with high-contrast light
text (`docs/05_ART_GUIDE.md` §2), so the interior was cleared to transparent and
the dark fill is drawn behind it. The border pixels and the rounded corners are
untouched. CC0 permits modification without additional conditions.

### Not bundled

`ui/pixel-ui-pack` also contains a marker arrow and a full spritesheet. Those are
**not** used: replacing the text `▶` selection marker would touch five separate
list renderers, each with its own layout and visibility group, which is out of
scope for the frame swap. See `docs/GHI-04_ASSET_TRIAL.md` §5.

---

## Everything else

All other art, audio and code in this repository is original and generated at
runtime by `src/render/pixelArt.ts` and `src/render/audio.ts` — no other
third-party assets are bundled.
