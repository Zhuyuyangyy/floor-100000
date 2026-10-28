import Phaser from 'phaser';

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
const COLOR = {
  building: 0x18242c, // dark blue-grey (mortar / outlines / boots)
  wall: 0x354650, // wall grey
  lamp: 0xf4b66a, // lamp orange (light, warmth, handles)
  danger: 0xe56d63, // danger red (threat, blood, warnings)
  safe: 0x77c6a4, // safe teal (purified water, allies, go-up)
  cream: 0xece8d8, // text cream (skin, paper, highlights)
} as const;

// Dark wood, reused by the tile drawers.
const WOOD_DARK = 0x54391f;


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

// ── 16x16 tiles ───────────────────────────────────────────────────────────────
function drawTileWall(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 16); // mortar
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(1, 1, 6, 6); // top-left brick
  g.fillRect(9, 1, 6, 6); // top-right brick
  g.fillRect(1, 9, 7, 6); // bottom-left brick (staggered joint)
  g.fillRect(9, 9, 6, 6); // bottom-right brick
  g.fillStyle(lighten(COLOR.wall, 0.22), 1);
  g.fillRect(1, 1, 6, 1);
  g.fillRect(9, 1, 6, 1);
  g.fillRect(1, 9, 7, 1);
  g.fillRect(9, 9, 6, 1);
  g.fillStyle(darken(COLOR.wall), 1);
  g.fillRect(1, 6, 6, 1);
  g.fillRect(9, 6, 6, 1);
  g.fillRect(1, 14, 7, 1);
  g.fillRect(9, 14, 6, 1);
}

function drawTileFloor(g: Phaser.GameObjects.Graphics): void {
  const base = 0x2b3742;
  g.fillStyle(base, 1);
  g.fillRect(0, 0, 16, 16);
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 1); // top seam
  g.fillRect(0, 0, 1, 16); // left seam
  g.fillStyle(lighten(base, 0.1), 1); // grime speckles
  g.fillRect(4, 4, 1, 1);
  g.fillRect(11, 7, 1, 1);
  g.fillRect(7, 12, 1, 1);
  g.fillStyle(darken(base), 1);
  g.fillRect(9, 3, 1, 1);
  g.fillRect(3, 10, 2, 1);
  g.fillRect(12, 12, 2, 1);
}

function drawTileDoor(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 16); // frame
  g.fillStyle(WOOD_DARK, 1);
  g.fillRect(2, 1, 12, 15); // door slab
  g.fillStyle(lighten(WOOD_DARK, 0.16), 1);
  g.fillRect(2, 1, 12, 1); // top edge
  g.fillStyle(lighten(WOOD_DARK, 0.08), 1);
  g.fillRect(3, 3, 10, 4); // upper panel
  g.fillRect(3, 9, 10, 5); // lower panel
  g.fillStyle(darken(WOOD_DARK), 1);
  g.fillRect(3, 7, 10, 2); // panel gap
  g.fillRect(3, 14, 10, 1); // lower panel shadow
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(11, 8, 2, 2); // knob
}

function drawTileWindow(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 16); // frame
  g.fillStyle(0x16303c, 1);
  g.fillRect(1, 1, 14, 14); // night glass
  g.fillStyle(0x21424f, 1);
  g.fillRect(1, 1, 14, 6); // sky band
  g.fillStyle(COLOR.lamp, 0.5);
  g.fillRect(3, 3, 3, 3); // distant lit window
  g.fillStyle(COLOR.lamp, 0.32);
  g.fillRect(10, 9, 3, 2); // faint reflection
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(7, 1, 2, 14); // vertical mullion
  g.fillRect(1, 7, 14, 2); // horizontal mullion
  g.fillStyle(lighten(COLOR.building, 0.25), 1);
  g.fillRect(0, 0, 16, 1); // frame highlight
  g.fillRect(0, 0, 1, 16);
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
// The 15 item icons, the 9 furniture textures and the 4 characters are deliberately
// NOT baked here: they are loaded from the art pack (see BootScene and
// render/artpack.ts). Baking over them would throw the real art away.
//
// The characters used to be baked by drawHumanoid() below — one shared 16x24
// silhouette in four colours, so the player, both neighbours and the wanderer were
// the same figure with different paint. tools/build-characters.mjs draws them
// instead, at 32x48 with distinct silhouettes.
export function generateAllPixelArt(scene: Phaser.Scene): void {
  // A transparent placeholder for the icon slots whose texture is chosen later
  // (inventory rows, craft rows, dialogue trade rows). Phaser 4 will not render an
  // Image that was created with an empty texture key, even after setTexture()
  // swaps in a real one — the object stays permanently invisible. So each of
  // those slots needs a real, if invisible, texture from the moment it is built.
  bake(scene, 'blank', 1, 1, () => {});

  // 16x16 tiles
  bake(scene, 'tile_wall', 16, 16, drawTileWall);
  bake(scene, 'tile_floor', 16, 16, drawTileFloor);
  bake(scene, 'tile_door', 16, 16, drawTileDoor);
  bake(scene, 'tile_window', 16, 16, drawTileWindow);
  bake(scene, 'tile_stairs_up', 16, 16, drawTileStairsUp);
  bake(scene, 'tile_stairs_down', 16, 16, drawTileStairsDown);
}
