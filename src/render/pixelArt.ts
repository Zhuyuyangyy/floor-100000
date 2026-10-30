import Phaser from 'phaser';

import { bakeWalkSheets } from './walkcycle';
import { PALETTE } from './palette.ts';

// Procedural pixel-art factory for 《第100000层：末日宿舍》.
//
// Every texture in the game is drawn in code with Phaser's Graphics + generateTexture
// (no external image files). The palette is a slightly desaturated post-apocalyptic set:
// high-contrast silhouettes that stay readable at the 16px tile scale.
//
// Only the Phaser 4 Graphics API is used: fillStyle / fillRect / fillTriangle / fillCircle /
// generateTexture / destroy. (v3 helpers such as Create.GenerateTexture and Geom.Point are gone.)

// ── palette ────────────────────────────────────────────────────────────────
// The six project colours from docs/05_ART_GUIDE.md §2. Not every entry is used
// by a drawer below — cream and danger are carried by the text and stat-bar
// colours elsewhere — but the set is the documented palette, so it stays whole.
// The same six roles the art guide names, now pointing at the project palette
// (render/palette.ts) instead of carrying their own hexes.
//
// This is the last module that had a private colour table. When it did, a tile
// baked here could be a value off from the wall it was drawn on top of, and
// nothing in the codebase could tell - which is exactly the class of drift that
// makes a game look assembled from parts. The roles keep their names so every
// drawer below still reads the same.
const COLOR = {
  building: PALETTE.ink, // mortar / outlines / boots
  wall: PALETTE.stone, // wall grey
  lamp: PALETTE.lightHigh, // warmth, handles
  danger: 0xe56d63, // danger red: the one hue the palette deliberately lacks
  safe: PALETTE.clothHigh, // teal: purified water, allies, go-up
  cream: 0xece8d8, // text cream, paper, highlights
} as const;


// ── colour maths (pure, 24-bit) ───────────────────────────────────────────────
// Halve every channel without cross-channel bleed (mask off each byte's low bit first).
function darken(color: number): number {
  return (color & 0xfefefe) >> 1;
}

// Blend toward white by `amount` (0..1) per channel.
function lighten(color: number, amount: number): number {
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * amount);
  const r = mix((color >> 16) & 0xff);
  const g = mix((color >> 8) & 0xff);
  const b = mix(color & 0xff);
  return (r << 16) | (g << 8) | b;
}

// ── bake helper ──────────────────────────────────────────────────────────────
type DrawFn = (g: Phaser.GameObjects.Graphics) => void;

// Creates a throwaway Graphics, runs the draw callback, bakes it into a texture,
// then destroys the Graphics — the canonical generateTexture pattern for this project.
function bake(scene: Phaser.Scene, key: string, width: number, height: number, draw: DrawFn): void {
  const g = scene.add.graphics();
  draw(g);
  g.generateTexture(key, width, height);
  g.destroy();
}

function drawTileStairsUp(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 16);
  g.fillStyle(darken(COLOR.wall), 1);
  g.fillRect(0, 0, 4, 16); // solid riser column
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(4, 12, 12, 4); // step 1 (lowest)
  g.fillRect(4, 8, 8, 4); // step 2
  g.fillRect(4, 4, 4, 4); // step 3 (highest)
  g.fillStyle(lighten(COLOR.wall, 0.28), 1);
  g.fillRect(4, 12, 12, 1); // tread highlights
  g.fillRect(4, 8, 8, 1);
  g.fillRect(4, 4, 4, 1);
  g.fillStyle(COLOR.safe, 1);
  g.fillTriangle(8, 1, 6, 4, 10, 4); // up chevron
  g.fillRect(7, 4, 2, 3);
}

function drawTileStairsDown(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 16);
  g.fillStyle(darken(COLOR.wall), 1);
  g.fillRect(0, 0, 4, 16); // solid riser column
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(4, 0, 12, 4); // step 1 (highest)
  g.fillRect(4, 4, 8, 4); // step 2
  g.fillRect(4, 8, 4, 4); // step 3 (lowest)
  g.fillStyle(darken(COLOR.wall), 1);
  g.fillRect(4, 3, 12, 1); // underside shadows
  g.fillRect(4, 7, 8, 1);
  g.fillRect(4, 11, 4, 1);
  g.fillStyle(COLOR.lamp, 1);
  g.fillTriangle(8, 15, 6, 12, 10, 12); // down chevron
  g.fillRect(7, 9, 2, 3);
}

// Bakes every texture the game references. Call once from a Boot-style scene's create().
// Regenerating a key simply overwrites the existing texture.
//
// Almost nothing is baked any more. The wall, floor, door, window and the four
// characters are all single art images loaded by BootScene (see render/artpack.ts
// ENV_FILES and CHARACTER_FILES). Baking over them would throw the real art away.
//
// What is left is the transparent slot placeholder the panels need, and the two
// stairwell tiles — the stairs are a repeating 16px pattern drawn three rows tall,
// which a single image cannot do.
//
// The characters used to be baked by drawHumanoid() — one shared 16x24 silhouette
// in four colours, so the player, both neighbours and the wanderer were the same
// figure with different paint. They come from the owner's renders now, rebuilt at
// 64x96 by tools/artclean.mjs with distinct silhouettes.
export function generateAllPixelArt(scene: Phaser.Scene): void {
  // A transparent placeholder for the icon slots whose texture is chosen later
  // (inventory rows, craft rows, dialogue trade rows). Phaser 4 will not render an
  // Image that was created with an empty texture key, even after setTexture()
  // swaps in a real one — the object stays permanently invisible. So each of
  // those slots needs a real, if invisible, texture from the moment it is built.
  bake(scene, 'blank', 1, 1, () => {});

  bake(scene, 'tile_stairs_up', 16, 16, drawTileStairsUp);
  bake(scene, 'tile_stairs_down', 16, 16, drawTileStairsDown);

  // The side-view walk cycles. These are pixel data rather than Graphics calls,
  // so they are baked by walkcycle.ts through a CanvasTexture.
  bakeWalkSheets(scene);
}
