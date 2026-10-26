import Phaser from 'phaser';
import { ITEM_IDS } from '../data/items';
import type { ItemId } from '../core/gameTypes';
import { itemIconKey } from './itemIcons';

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
const GLASS = 0xbfe6f0;

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

// ── 16x16 item icons (transparent background) ──────────────────────────────────
function drawIconCleanWater(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(6, 0, 4, 2); // cap
  g.fillStyle(COLOR.building, 1);
  g.fillRect(5, 2, 6, 13); // bottle outline
  g.fillStyle(GLASS, 1);
  g.fillRect(6, 3, 4, 11); // glass
  g.fillStyle(WATER, 1);
  g.fillRect(6, 7, 4, 7); // clean water
  g.fillStyle(lighten(WATER, 0.35), 1);
  g.fillRect(6, 7, 4, 1); // surface
  g.fillStyle(COLOR.cream, 0.6);
  g.fillRect(7, 4, 1, 3); // shine
}

function drawIconDirtyWater(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x6a6a5a, 1);
  g.fillRect(6, 0, 4, 2); // dull cap
  g.fillStyle(COLOR.building, 1);
  g.fillRect(5, 2, 6, 13); // bottle outline
  g.fillStyle(0x9a9a80, 1);
  g.fillRect(6, 3, 4, 11); // murky glass
  g.fillStyle(0x5a5a32, 1);
  g.fillRect(6, 7, 4, 7); // dirty water
  g.fillStyle(0x33331c, 1);
  g.fillRect(7, 9, 1, 1); // grime
  g.fillRect(9, 11, 1, 1);
  g.fillStyle(COLOR.cream, 0.6);
  g.fillRect(7, 4, 1, 3); // shine
}

function drawIconRationPack(g: Phaser.GameObjects.Graphics): void {
  const foil = 0x8a6a3a;
  g.fillStyle(COLOR.building, 1);
  g.fillRect(2, 4, 12, 9); // pouch outline
  g.fillStyle(foil, 1);
  g.fillRect(3, 5, 10, 7); // pouch body
  g.fillStyle(lighten(foil, 0.22), 1);
  g.fillRect(3, 5, 10, 1); // crimp
  g.fillStyle(darken(foil), 1);
  g.fillRect(3, 11, 10, 1);
  g.fillRect(2, 4, 1, 9); // side crimps
  g.fillRect(13, 4, 1, 9);
  g.fillStyle(COLOR.cream, 1);
  g.fillRect(5, 7, 6, 2); // label
  g.fillStyle(COLOR.danger, 1);
  g.fillRect(6, 7, 1, 2);
  g.fillRect(8, 7, 1, 2);
}

function drawIconBread(g: Phaser.GameObjects.Graphics): void {
  const crust = 0xb5855a;
  g.fillStyle(COLOR.building, 1);
  g.fillRect(2, 6, 12, 8); // outline
  g.fillStyle(crust, 1);
  g.fillRect(3, 7, 10, 6); // loaf
  g.fillStyle(lighten(crust, 0.2), 1);
  g.fillRect(3, 7, 10, 1); // top crust highlight
  g.fillStyle(darken(crust), 1);
  g.fillRect(3, 12, 10, 1); // base shadow
  g.fillRect(5, 8, 1, 3); // score marks
  g.fillRect(8, 8, 1, 3);
  g.fillRect(11, 8, 1, 2);
}

function drawIconBattery(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(METAL_LIGHT, 1);
  g.fillRect(6, 1, 4, 1); // terminal tip
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(6, 2, 4, 2); // + terminal
  g.fillStyle(COLOR.building, 1);
  g.fillRect(4, 4, 8, 11); // body outline
  g.fillStyle(0x2a2e34, 1);
  g.fillRect(5, 5, 6, 9); // body
  g.fillStyle(COLOR.safe, 1);
  g.fillRect(5, 8, 6, 3); // charge band
  g.fillStyle(COLOR.cream, 1);
  g.fillRect(8, 6, 1, 1); // lightning bolt
  g.fillRect(7, 7, 1, 1);
  g.fillRect(8, 7, 1, 1);
  g.fillRect(7, 8, 2, 1);
}

function drawIconScrapMetal(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(2, 9, 7, 5); // plate A outline
  g.fillTriangle(2, 9, 9, 9, 9, 4);
  g.fillRect(9, 5, 5, 9); // plate B outline
  g.fillStyle(METAL, 1);
  g.fillRect(3, 10, 5, 3); // plate A body
  g.fillTriangle(3, 10, 8, 10, 8, 6); // angled top edge
  g.fillStyle(0x8a9298, 1);
  g.fillRect(10, 6, 3, 7); // plate B body
  g.fillStyle(lighten(METAL, 0.4), 1);
  g.fillRect(4, 11, 1, 1); // rivets
  g.fillRect(6, 11, 1, 1);
  g.fillStyle(darken(0x8a9298), 1);
  g.fillRect(11, 8, 1, 1);
  g.fillRect(11, 10, 1, 1);
}

function drawIconWood(g: Phaser.GameObjects.Graphics): void {
  const plank = 0x8a5f36;
  g.fillStyle(COLOR.building, 1);
  g.fillRect(1, 5, 14, 7); // outline
  g.fillStyle(plank, 1);
  g.fillRect(2, 6, 12, 5); // plank
  g.fillStyle(lighten(plank, 0.15), 1);
  g.fillRect(2, 6, 12, 1); // top highlight
  g.fillStyle(darken(plank), 1);
  g.fillRect(2, 8, 12, 1); // grain
  g.fillRect(4, 10, 3, 1);
  g.fillRect(9, 10, 4, 1);
  g.fillRect(2, 6, 2, 5); // end grain
}

function drawIconCloth(g: Phaser.GameObjects.Graphics): void {
  const cloth = 0x5f7d74;
  g.fillStyle(COLOR.building, 1);
  g.fillRect(3, 5, 10, 7); // outline
  g.fillStyle(cloth, 1);
  g.fillRect(4, 6, 8, 5); // cloth
  g.fillStyle(lighten(cloth, 0.2), 1);
  g.fillRect(4, 6, 8, 1); // fold highlight
  g.fillStyle(darken(cloth), 1);
  g.fillRect(4, 10, 8, 1); // fold shadow
  g.fillStyle(COLOR.cream, 1);
  g.fillRect(5, 8, 1, 1); // stitch dashes
  g.fillRect(7, 8, 1, 1);
  g.fillRect(9, 8, 1, 1);
  g.fillRect(11, 8, 1, 1);
}

function drawIconTape(g: Phaser.GameObjects.Graphics): void {
  const tape = 0xb8a878;
  g.fillStyle(COLOR.building, 1);
  g.fillCircle(8, 8, 6); // outer rim
  g.fillStyle(tape, 1);
  g.fillCircle(8, 8, 5); // tape roll
  g.fillStyle(COLOR.building, 1);
  g.fillCircle(8, 8, 2); // hollow core
  g.fillStyle(tape, 1);
  g.fillRect(12, 10, 3, 2); // loose end
  g.fillStyle(lighten(tape, 0.3), 1);
  g.fillRect(5, 5, 3, 1); // highlight
}

function drawIconFilter(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(3, 3, 10, 11); // outline
  g.fillStyle(COLOR.cream, 1);
  g.fillRect(4, 4, 8, 9); // filter body
  g.fillStyle(darken(COLOR.cream), 1);
  g.fillRect(4, 6, 8, 1); // pleats
  g.fillRect(4, 8, 8, 1);
  g.fillRect(4, 10, 8, 1);
  g.fillStyle(METAL_LIGHT, 1);
  g.fillRect(3, 2, 10, 2); // top end cap
  g.fillRect(3, 13, 10, 2); // bottom end cap
  g.fillStyle(COLOR.safe, 1);
  g.fillRect(7, 1, 2, 1); // flow nub
}

function drawIconWire(g: Phaser.GameObjects.Graphics): void {
  const copper = 0xb5651d;
  g.fillStyle(copper, 1);
  g.fillRect(3, 10, 10, 2); // bottom run
  g.fillRect(3, 6, 2, 2); // left riser
  g.fillRect(3, 4, 8, 2); // top run
  g.fillRect(11, 6, 2, 2); // right riser
  g.fillStyle(lighten(copper, 0.25), 1);
  g.fillRect(3, 10, 10, 1); // highlight
  g.fillStyle(COLOR.building, 1);
  g.fillRect(1, 9, 2, 3); // plug ends
  g.fillRect(13, 5, 2, 3);
}

function drawIconMedkit(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(6, 3, 4, 2); // handle
  g.fillRect(7, 2, 2, 1);
  g.fillStyle(COLOR.building, 1);
  g.fillRect(2, 5, 12, 9); // box outline
  g.fillStyle(COLOR.cream, 1);
  g.fillRect(3, 6, 10, 7); // box
  g.fillStyle(COLOR.danger, 1);
  g.fillRect(7, 7, 2, 5); // red cross (vertical)
  g.fillRect(5, 9, 6, 2); // red cross (horizontal)
  g.fillStyle(darken(COLOR.cream), 1);
  g.fillRect(3, 12, 10, 1); // bottom shade
}

function drawIconCrowbar(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.danger, 1);
  g.fillRect(3, 12, 3, 2); // handle end
  g.fillRect(5, 10, 2, 2); // ascending shaft
  g.fillRect(7, 8, 2, 2);
  g.fillRect(9, 6, 2, 2);
  g.fillRect(11, 4, 2, 2);
  g.fillStyle(darken(COLOR.danger), 1);
  g.fillRect(5, 10, 2, 1); // grip wraps
  g.fillRect(7, 8, 2, 1);
  g.fillStyle(METAL_LIGHT, 1);
  g.fillRect(12, 2, 2, 2); // chisel tip
  g.fillStyle(COLOR.danger, 1);
  g.fillRect(2, 12, 1, 3); // hook
  g.fillRect(3, 14, 2, 1);
}

function drawIconFuse(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(4, 5, 8, 7); // outline
  g.fillStyle(METAL_LIGHT, 1);
  g.fillRect(3, 5, 2, 7); // end caps
  g.fillRect(11, 5, 2, 7);
  g.fillStyle(0xd8c8a8, 1);
  g.fillRect(5, 6, 6, 5); // glass body
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(5, 8, 6, 2); // colour band
  g.fillStyle(lighten(0xd8c8a8, 0.3), 1);
  g.fillRect(6, 6, 1, 4); // shine
}

function drawIconFlashlight(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLOR.building, 1);
  g.fillRect(3, 6, 8, 5); // body outline
  g.fillStyle(0x2a2e34, 1);
  g.fillRect(4, 7, 6, 3); // body
  g.fillStyle(METAL_LIGHT, 1);
  g.fillRect(2, 7, 2, 3); // tail cap
  g.fillStyle(COLOR.lamp, 1);
  g.fillRect(10, 6, 2, 5); // lamp head
  g.fillStyle(lighten(COLOR.lamp, 0.4), 1);
  g.fillRect(12, 7, 1, 3); // lens
  g.fillStyle(METAL_LIGHT, 1);
  g.fillRect(6, 9, 2, 1); // switch
  g.fillStyle(COLOR.lamp, 0.3);
  g.fillTriangle(12, 7, 12, 10, 15, 8); // beam
}

// ── public entry point ─────────────────────────────────────────────────────────
// One drawer per item, keyed by ItemId. The Record type forces every ItemId to
// have an icon, so adding an item without art is a compile error rather than a
// silently missing texture.
const ICON_DRAWERS: Record<ItemId, DrawFn> = {
  clean_water: drawIconCleanWater,
  dirty_water: drawIconDirtyWater,
  ration_pack: drawIconRationPack,
  bread: drawIconBread,
  battery: drawIconBattery,
  scrap_metal: drawIconScrapMetal,
  wood: drawIconWood,
  cloth: drawIconCloth,
  tape: drawIconTape,
  filter: drawIconFilter,
  wire: drawIconWire,
  medkit: drawIconMedkit,
  crowbar: drawIconCrowbar,
  fuse: drawIconFuse,
  flashlight: drawIconFlashlight,
};

// Bakes every texture the game references. Call once from a Boot-style scene's create().
// Regenerating a key simply overwrites the existing texture.
export function generateAllPixelArt(scene: Phaser.Scene): void {
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

  // 16x16 item icons — baked under each item's own id (see ICON_DRAWERS).
  for (const id of ITEM_IDS) bake(scene, itemIconKey(id), 16, 16, ICON_DRAWERS[id]);
}
