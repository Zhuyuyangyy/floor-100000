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
const COLOR = {
  building: 0x18242c, // dark blue-grey (mortar / outlines / boots)
  wall: 0x354650, // wall grey
  lamp: 0xf4b66a, // lamp orange (light, warmth, handles)
  danger: 0xe56d63, // danger red (threat, blood, warnings)
  safe: 0x77c6a4, // safe teal (purified water, allies, go-up)
  cream: 0xece8d8, // text cream (skin, paper, highlights)
} as const;

// A few neutral material tones reused across tiles / furniture / icons.
const WOOD = 0x6a4a3a;
const WOOD_DARK = 0x54391f;
const METAL = 0x7a8288;
const METAL_LIGHT = 0x9aa0a6;
const WATER = 0x3a86a8;

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

// ── shared figure (16x24) ─────────────────────────────────────────────────────
// One humanoid silhouette reused for the player and NPCs; only the body / head / eye
// colours change. The wanderer passes a near-black head so it reads as a shadowy figure.
function drawHumanoid(g: Phaser.GameObjects.Graphics, body: number, head: number, eye: number): void {
  g.fillStyle(head, 1);
  g.fillRect(5, 1, 6, 6); // head
  g.fillStyle(eye, 1);
  g.fillRect(6, 3, 1, 1); // left eye
  g.fillRect(9, 3, 1, 1); // right eye
  g.fillStyle(body, 1);
  g.fillRect(4, 7, 8, 9); // torso
  g.fillStyle(darken(body), 1);
  g.fillRect(4, 15, 8, 1); // belt
  g.fillStyle(body, 1);
  g.fillRect(2, 8, 2, 7); // left arm
  g.fillRect(12, 8, 2, 7); // right arm
  g.fillStyle(head, 1);
  g.fillRect(2, 14, 2, 2); // left hand
  g.fillRect(12, 14, 2, 2); // right hand
  g.fillStyle(darken(body), 1);
  g.fillRect(4, 16, 3, 6); // left leg
  g.fillRect(9, 16, 3, 6); // right leg
  g.fillStyle(COLOR.building, 1);
  g.fillRect(3, 22, 4, 2); // left boot
  g.fillRect(9, 22, 4, 2); // right boot
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

// ── furniture ─────────────────────────────────────────────────────────────────
function drawFurnBed(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(darken(COLOR.wall), 1);
  g.fillRect(0, 14, 32, 2); // ground shadow
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(0, 4, 32, 10); // metal frame
  g.fillStyle(darken(COLOR.wall), 1);
  g.fillRect(0, 0, 3, 16); // headboard
  g.fillStyle(COLOR.cream, 1);
  g.fillRect(3, 5, 29, 7); // mattress
  g.fillStyle(lighten(COLOR.cream, 0.4), 1);
  g.fillRect(4, 5, 7, 5); // pillow
  g.fillStyle(COLOR.safe, 1);
  g.fillRect(13, 5, 18, 7); // blanket
  g.fillStyle(lighten(COLOR.safe, 0.2), 1);
  g.fillRect(13, 5, 18, 1); // blanket top edge
  g.fillStyle(darken(COLOR.safe), 1);
  g.fillRect(13, 11, 18, 1); // blanket fold
  g.fillStyle(COLOR.building, 1);
  g.fillRect(1, 14, 2, 2); // legs
  g.fillRect(29, 14, 2, 2);
}

function drawFurnCabinet(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 24); // shadow / outline
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(1, 1, 14, 22); // body
  g.fillStyle(lighten(COLOR.wall, 0.2), 1);
  g.fillRect(1, 1, 14, 1); // top edge
  g.fillStyle(COLOR.building, 1);
  g.fillRect(3, 3, 10, 1); // vents
  g.fillRect(3, 5, 10, 1);
  g.fillRect(3, 7, 10, 1);
  g.fillStyle(lighten(COLOR.wall, 0.08), 1);
  g.fillRect(2, 9, 6, 12); // left door
  g.fillRect(9, 9, 5, 12); // right door
  g.fillStyle(darken(COLOR.wall), 1);
  g.fillRect(2, 20, 6, 1); // door bottom shadow
  g.fillRect(9, 20, 5, 1);
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(7, 13, 1, 3); // handles
  g.fillRect(9, 13, 1, 3);
  g.fillStyle(COLOR.building, 1);
  g.fillRect(1, 22, 14, 2); // base
}

function drawFurnCrate(g: Phaser.GameObjects.Graphics): void {
  const crate = 0x7a5228;
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 16); // outline
  g.fillStyle(crate, 1);
  g.fillRect(1, 1, 14, 14); // crate wood
  g.fillStyle(lighten(crate, 0.18), 1);
  g.fillRect(1, 1, 14, 1); // top highlight
  g.fillStyle(darken(crate), 1);
  g.fillRect(1, 5, 14, 1); // plank seams
  g.fillRect(1, 10, 14, 1);
  g.fillRect(1, 14, 14, 1); // bottom shadow
  g.fillStyle(METAL_LIGHT, 1);
  g.fillRect(1, 1, 2, 2); // metal corners
  g.fillRect(13, 1, 2, 2);
  g.fillRect(1, 13, 2, 2);
  g.fillRect(13, 13, 2, 2);
  g.fillStyle(COLOR.safe, 1);
  g.fillRect(6, 7, 4, 2); // stencil mark
}

function drawFurnWorkbench(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(2, 8, 3, 8); // legs
  g.fillRect(27, 8, 3, 8);
  g.fillStyle(darken(WOOD), 1);
  g.fillRect(2, 12, 28, 1); // cross brace
  g.fillStyle(WOOD, 1);
  g.fillRect(0, 4, 32, 5); // tabletop
  g.fillStyle(lighten(WOOD, 0.2), 1);
  g.fillRect(0, 4, 32, 1); // top highlight
  g.fillStyle(darken(WOOD), 1);
  g.fillRect(0, 8, 32, 1); // front shadow
  g.fillStyle(METAL, 1); // tools on top
  g.fillRect(6, 1, 1, 3);
  g.fillRect(6, 2, 4, 1);
  g.fillRect(12, 2, 1, 2);
  g.fillRect(15, 2, 1, 2);
  g.fillStyle(COLOR.lamp, 0.85);
  g.fillRect(24, 1, 2, 3); // bench lamp
  g.fillStyle(COLOR.safe, 1);
  g.fillRect(18, 2, 5, 2); // blueprint cloth
}

function drawFurnWaterTank(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 0, 16, 24); // frame / shadow
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(1, 2, 14, 20); // tank body
  g.fillStyle(darken(COLOR.wall), 1);
  g.fillRect(1, 2, 14, 2); // top cap
  g.fillStyle(METAL_LIGHT, 1);
  g.fillRect(5, 0, 6, 2); // inlet pipe
  g.fillStyle(0x16303c, 1);
  g.fillRect(3, 6, 10, 14); // level window (empty)
  g.fillStyle(WATER, 1);
  g.fillRect(3, 12, 10, 8); // water level
  g.fillStyle(lighten(WATER, 0.28), 1);
  g.fillRect(3, 12, 10, 1); // water surface
  g.fillStyle(lighten(COLOR.wall, 0.2), 1);
  g.fillRect(1, 2, 1, 20); // left highlight
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(6, 21, 4, 2); // valve
  g.fillStyle(COLOR.building, 1);
  g.fillRect(0, 22, 16, 2); // base
}

function drawFurnFuseBox(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.wall, 1);
  g.fillRect(0, 0, 16, 16); // box
  g.fillStyle(lighten(COLOR.wall, 0.25), 1);
  g.fillRect(0, 0, 16, 1); // top highlight
  g.fillStyle(COLOR.building, 1);
  g.fillRect(2, 3, 12, 12); // open interior
  g.fillStyle(0x22262a, 1);
  g.fillRect(3, 5, 3, 8); // fuse slot L
  g.fillRect(8, 5, 3, 8); // fuse slot R
  g.fillStyle(COLOR.cream, 1);
  g.fillRect(4, 6, 1, 6); // fuse bodies
  g.fillRect(9, 6, 1, 6);
  g.fillStyle(COLOR.danger, 1);
  g.fillRect(4, 8, 1, 2); // red bands
  g.fillRect(9, 8, 1, 2);
  g.fillStyle(COLOR.safe, 1);
  g.fillRect(2, 13, 4, 1); // wires
  g.fillRect(13, 3, 2, 2); // indicator light
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(10, 13, 4, 1);
}

function drawFurnShelf(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(WOOD, 1);
  g.fillRect(0, 0, 16, 24); // frame
  g.fillStyle(darken(WOOD), 1);
  g.fillRect(1, 1, 14, 22); // back panel
  g.fillStyle(lighten(WOOD, 0.15), 1);
  g.fillRect(0, 0, 16, 1); // top board highlight
  g.fillStyle(WOOD, 1);
  g.fillRect(1, 7, 14, 1); // shelf boards
  g.fillRect(1, 15, 14, 1);
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(2, 3, 4, 4); // shelf 1: ration pack
  g.fillStyle(METAL, 1);
  g.fillRect(8, 4, 3, 3); // can
  g.fillStyle(COLOR.safe, 1);
  g.fillRect(12, 4, 2, 3); // bottle
  g.fillStyle(WATER, 1);
  g.fillRect(3, 10, 3, 5); // shelf 2: water bottle
  g.fillStyle(COLOR.safe, 1);
  g.fillRect(8, 11, 3, 4); // jug
  g.fillStyle(WOOD_DARK, 1);
  g.fillRect(2, 18, 5, 5); // shelf 3: small crate
  g.fillStyle(COLOR.cream, 1);
  g.fillRect(9, 18, 4, 4); // medkit
  g.fillStyle(COLOR.danger, 1);
  g.fillRect(10, 19, 2, 2); // cross
  g.fillStyle(darken(WOOD), 1);
  g.fillRect(1, 8, 14, 1); // board shadows
  g.fillRect(1, 16, 14, 1);
}

// Bakes every texture the game references. Call once from a Boot-style scene's create().
// Regenerating a key simply overwrites the existing texture.
//
// The 15 item icons are deliberately NOT baked here: they are loaded from the
// art pack under their own item ids (see BootScene and render/artpack.ts).
// Baking over them would throw the real art away.
export function generateAllPixelArt(scene: Phaser.Scene): void {
  // A transparent placeholder for the icon slots whose texture is chosen later
  // (inventory rows, craft rows, dialogue trade rows). Phaser 4 will not render an
  // Image that was created with an empty texture key, even after setTexture()
  // swaps in a real one — the object stays permanently invisible. So each of
  // those slots needs a real, if invisible, texture from the moment it is built.
  bake(scene, 'blank', 1, 1, () => {});

  // figures (the game already references these four keys)
  bake(scene, 'player', 16, 24, (g) => drawHumanoid(g, COLOR.safe, COLOR.cream, COLOR.building));
  bake(scene, 'npc_alin', 16, 24, (g) => drawHumanoid(g, 0x5a8ab5, COLOR.cream, COLOR.building));
  bake(scene, 'npc_xiaozhou', 16, 24, (g) => drawHumanoid(g, 0xb5855a, COLOR.cream, COLOR.building));
  bake(scene, 'wanderer', 16, 24, (g) => drawHumanoid(g, 0x3a1e24, lighten(0x3a1e24, 0.18), COLOR.danger));

  // 16x16 tiles
  bake(scene, 'tile_wall', 16, 16, drawTileWall);
  bake(scene, 'tile_floor', 16, 16, drawTileFloor);
  bake(scene, 'tile_door', 16, 16, drawTileDoor);
  bake(scene, 'tile_window', 16, 16, drawTileWindow);
  bake(scene, 'tile_stairs_up', 16, 16, drawTileStairsUp);
  bake(scene, 'tile_stairs_down', 16, 16, drawTileStairsDown);

  // furniture
  bake(scene, 'furn_bed', 32, 16, drawFurnBed);
  bake(scene, 'furn_cabinet', 16, 24, drawFurnCabinet);
  bake(scene, 'furn_crate', 16, 16, drawFurnCrate);
  bake(scene, 'furn_workbench', 32, 16, drawFurnWorkbench);
  bake(scene, 'furn_watertank', 16, 24, drawFurnWaterTank);
  bake(scene, 'furn_fusebox', 16, 16, drawFurnFuseBox);
  bake(scene, 'furn_shelf', 16, 24, drawFurnShelf);
}
