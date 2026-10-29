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

// A door is architectural, not a fitting: at 16x16 it was a third the height of
// the 48px player and read as a wall fitting. 24x56 makes it taller than the
// person walking through it. sceneScale.test.ts holds both facts.
function drawTileDoor(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 24, 56); // frame
  g.fillStyle(WOOD_DARK, 1);
  g.fillRect(2, 1, 20, 54); // door slab
  g.fillStyle(lighten(WOOD_DARK, 0.16), 1);
  g.fillRect(2, 1, 20, 1); // top edge
  g.fillStyle(lighten(WOOD_DARK, 0.08), 1);
  g.fillRect(4, 4, 16, 18); // upper panel
  g.fillStyle(darken(WOOD_DARK), 1);
  g.fillRect(4, 22, 16, 2); // panel gap
  g.fillStyle(lighten(WOOD_DARK, 0.08), 1);
  g.fillRect(4, 26, 16, 22); // lower panel
  g.fillStyle(darken(WOOD_DARK), 1);
  g.fillRect(4, 46, 16, 2); // lower panel shadow
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(18, 27, 2, 2); // knob
  // Two plank seams down the margins, so the slab is not one flat rectangle.
  g.fillStyle(darken(WOOD_DARK), 1);
  g.fillRect(3, 1, 1, 54);
  g.fillRect(20, 1, 1, 54);
}

// Same reasoning: 32x40, tall enough to read as a window rather than a vent.
function drawTileWindow(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 32, 40); // frame
  g.fillStyle(0x16303c, 1);
  g.fillRect(2, 2, 28, 36); // night glass
  g.fillStyle(0x21424f, 1);
  g.fillRect(2, 2, 28, 14); // sky band
  g.fillStyle(COLOR.lamp, 0.5);
  g.fillRect(6, 8, 4, 4); // distant lit window
  g.fillStyle(COLOR.lamp, 0.32);
  g.fillRect(20, 14, 4, 3); // faint reflection
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(15, 2, 2, 36); // vertical mullion
  g.fillRect(2, 19, 28, 2); // horizontal mullion
  g.fillStyle(lighten(COLOR.building, 0.25), 1);
  g.fillRect(0, 0, 32, 1); // frame highlight
  g.fillRect(0, 0, 1, 40);
  g.fillStyle(darken(COLOR.building), 1);
  g.fillRect(0, 38, 32, 2); // sill
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

  // The door and window are drawn at their own sizes — see the drawers. The wall
  // and floor are no longer baked here: they are single 1280px-wide art images
  // loaded by BootScene (render/artpack.ts ENV_FILES).
  bake(scene, 'tile_door', 24, 56, drawTileDoor);
  bake(scene, 'tile_window', 32, 40, drawTileWindow);
  bake(scene, 'tile_stairs_up', 16, 16, drawTileStairsUp);
  bake(scene, 'tile_stairs_down', 16, 16, drawTileStairsDown);
}
