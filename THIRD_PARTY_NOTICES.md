# THIRD_PARTY NOTICES

Third-party assets and dependencies, with their licence and provenance.

**How to read this file.** Every entry below states where the claim came from.
The source is one of:

- `package.json` / the installed `node_modules/<pkg>/package.json` — machine-readable licence field.
- A `LICENSE` file shipped inside the package or the asset directory — read verbatim.
- The project owner, stated directly.

Anything not backed by one of those three is marked **来源待确认 (provenance unconfirmed)**
and must not be relied on. This file deliberately does not guess.

Last verified: 2026-11-26, against the working tree (Phaser 4.2.1; the repo now
carries a final `LICENSE` — MIT, adopted by the copyright holder on 2026-11-26).
Earlier verification was done on 2026-11-25, when no `LICENSE` file existed in the
repository root.

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
- **Licence:** MIT, as part of this repository. The copyright holder confirmed on
  2026-11-26 that the owner-supplied artwork **is** covered by the project's MIT
  grant (see `LICENSE` §Scope notes). Nothing here was taken from a third party.

---

## pixelfx — MIT

- **Files:** `public/assets/fx/melee/sword-slash/` and
  `public/assets/fx/impacts/parry/` (the existing `public/assets/fx/` atlases use
  the same source)
- **11-26 added effects:** `public/assets/fx/fire/spirit-flame/`,
  `critters/wisp/`, `critters/bat/`, `arcane/portal/`, `ice/blizzard-vortex/`,
  `impacts/bullet-impact/`. Six atlases (18 files: PNG + JSON + contact sheet
  each), exported from the same upstream with `node tools/render.mjs <id>
  --sheet` at pixelfx v0.3.1. Registered in `src/render/fx.ts` and pinned by
  `src/tests/fx.test.ts`; **not yet called from any scene** — registration alone
  is not a claim that the effects appear in the running game.
- **Source:** Patch Pixel, https://github.com/patch-gg/pixelfx
- **Licence:** MIT License, Copyright © 2026 Patch and Hugo Duprez.
- **Adapted source:** `src/core/sim.js` and effects that identify Sprite Fusion
  recipes adapt Hugo Duprez's open-source pixel VFX, Copyright © 2026 Hugo
  Duprez, MIT License. The current slash/parry sheets were rendered from the
  pixelfx effect definitions without copying the runtime library into this repo.
- **Additional notice:** `src/core/act.js` in pixelfx adapts Hollow Crown's
  timing approach; this project does not vendor that runtime or its characters.

---

## UI typeface — Ark Pixel Font, SIL OFL 1.1

- **Files:** `public/assets/fonts/ark-pixel-latin.woff2`,
  `public/assets/fonts/ark-pixel-zh_hans.woff2`, `public/assets/fonts/OFL.txt`
- **Used for:** every in-game text (HUD, panels, menus, labels) via
  `FONT_FAMILY` in `src/render/uiKit.ts`, loaded by two `@font-face` rules in
  `index.html`.
- **Original source:** TakWolf, Ark Pixel Font — https://github.com/TakWolf/ark-pixel-font,
  release `2026.11.10`, 10px monospaced, `otf.woff2` package.
- **Author / copyright:** TakWolf (https://takwolf.com), Copyright (c) 2021.
- **Licence:** SIL Open Font License 1.1 for the font (full text bundled as
  `OFL.txt`, taken verbatim from the release archive). The upstream repository
  additionally licenses its build tooling under MIT; no tooling is vendored here.
- **Modification:** none to the outlines. Only the `latin` and `zh_hans` language
  subsets were extracted from the release zip and renamed; the other five
  language subsets were dropped to keep the bundle at 136 KB.
- **Why not Zpix:** considered first, but its README restricts commercial use to
  paid licences and explicitly forbids format conversion and redistribution of
  subsets, which a bundled `.woff2` would require.

---

## Verification status of the asset entries above

Checked on 2026-11-25 by listing the filesystem and reading the bundled files.
"Verified" means the file exists **and** its licence text or metadata was read
locally. "Claim only" means the file exists but the upstream provenance in the
entry above was written by an earlier contributor and cannot be re-checked
offline — those must be confirmed against the upstream source before publication.

| Entry | File present? | Licence text present? | Status |
| --- | --- | --- | --- |
| Kenney selection marker | `public/assets/ui/marker.png` — yes | no local copy; CC0 needs no bundled text | **Claim only** (upstream URL + crop coordinates not re-verified) |
| Art pack (owner) | `public/assets/artpack/` — 30 files; `ui/frame-*.png`, `ui/slot.png` — yes | n/a | **Owner confirmed 2026-11-26**: artwork included in the MIT grant (see `LICENSE`) |
| Art added 11-26 (owner) | `public/assets/ui/chapter1_clear_bg.png`, `public/assets/ui/night_overlay.png`, `src/assets/characters/npc_azhen.png` — yes | n/a | **Owner-supplied original AI-assisted artwork**; no third-party assets, covered by the same MIT grant. Provenance: `floor100000_art_20261126.zip`; static checks in `docs/competition/ART_NEEDS.md` |
| pixelfx effect sheets | `public/assets/fx/` — 27 original PNGs + 6 atlases added 11-26 (33 atlases total) across `melee/`, `impacts/`, `fire/`, `water/`, `pickups/`, `status/`, `critters/`, `arcane/`, `ice/` — yes | no local `LICENSE` copy; MIT attribution is in this file only | **Claim only** (which of the original 27 sheets derive from pixelfx vs. project-drawn is not recorded per-file; the 6 new ones are individually traceable to their upstream ids) |
| Ark Pixel Font | `public/assets/fonts/ark-pixel-latin.woff2`, `public/assets/fonts/ark-pixel-zh_hans.woff2` — yes | `public/assets/fonts/OFL.txt` — yes, SIL OFL 1.1, "Copyright (c) 2021, TakWolf" | **Verified** (release tag `2026.11.10` in the entry above is not verifiable offline) |
| Audio | no audio files anywhere under `public/` | n/a | **Verified by absence** — `src/render/audio.ts` synthesises every SFX via Web Audio |
| Character rigs | `art-src/rigs/` — 5 rig SVGs + 5 anim JSONs | n/a | **Project-generated, per repo docs; copyright holder unrecorded** |

Where a table row says "Claim only", the honest public statement is: *"bundled
from the source named above; licence believed to be X; not re-verified for this
release."* Do not upgrade that to a flat assertion without checking upstream.

---

## Everything else

All other art and audio in this repository is original and generated at runtime by
`src/render/pixelArt.ts` and `src/render/audio.ts`, except for the Kenney marker,
owner-supplied art pack, the pixelfx atlases and the Ark Pixel typeface listed above.

---

## Build and test dependencies (npm)

None of these are bundled into the shipped game except Phaser. The rest are
build-time or test-time only, and their licences are recorded here because a
public repository distributes them via `package-lock.json`.

Verified by reading the installed `node_modules/<pkg>/package.json` on 2026-11-25.

| Package | Version | Licence (from its `package.json`) | Runtime or build-only |
| --- | --- | --- | --- |
| `phaser` | 4.2.1 | **MIT** — `node_modules/phaser/LICENSE.md`, "Copyright (c) 2026 Richard Davey, Phaser Studio Inc." | **runtime**, bundled into `dist/` |
| `typescript` | 7.0.2 | **Apache-2.0** | build only (`tsc`) |
| `vite` | 8.3.5 | **MIT** | build only |
| `vitest` | 5.0.5 | **MIT** | test only |
| `@playwright/test` | 1.64.1 | **Apache-2.0** | test only |
| `electron` | 45.0.0 | **MIT** | desktop packaging only |
| `electron-builder` | 26.18.0 | **MIT** | desktop packaging only |
| `@electron/packager` | 20.3.0 | **BSD-2-Clause** | desktop packaging only |
| `@types/node` | 26.6.5 | **MIT** | types only |

Notes worth knowing:

- **Only Phaser reaches the player.** `dist/` contains the Phaser engine plus this
  project's own code and assets. Everything else in the table above is a
  development dependency and is absent from the production bundle.
- **Transitive dependencies are not enumerated here.** `package-lock.json` pins
  several hundred of them; each carries its own licence. For a formal audit run
  `npx license-checker --summary` or equivalent against the lockfile. This file
  covers the direct, declared dependencies only.
- **TypeScript 7.0.2 and Vite 8.3.5 are ahead of the widely deployed versions.**
  The versions above are what is actually installed, read from disk, not what a
  package registry currently recommends.

---

## Environment variables and secrets

The deployed configuration moves the model API key out of the browser and into
the server process (`server/npc-proxy.mjs`, variable `NPC_API_KEY`). No key,
token, upstream URL or account identifier is present in the frontend bundle —
this is asserted by a test, not by inspection: `output/online-verify/api-verify.json`
entry "前端产物无密钥/上游地址" reports `clean` against a real deployed build.

---

## Open items — do not publish without settling these

| Item | What is unknown | Who can settle it |
| --- | --- | --- |
| Source code licence | No `LICENSE`, no `package.json` `license` field. `LICENSE` is a draft. | Project owner |
| Owner-supplied art pack, `env/`, `title/`, `weapons/` | The owner has not stated terms for redistribution. A public repo grants a licence the owner may not intend. | Project owner |
| `art-src/rigs/*.svg` + `*.anim.json` | Described in-repo as project-generated. Copyright holder name not recorded. | Project owner |
| `素材库/` design-collection directory | Contents and their individual provenances are catalogued in that directory's own README; not audited here. | Project owner |
| Ship-time audio | No audio files exist — all SFX are synthesised at runtime. Nothing to license. | — (closed) |
