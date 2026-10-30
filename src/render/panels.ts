import Phaser from 'phaser';

// GHI-04: licensed pixel UI pack (CC0 1.0, Kenney — see THIRD_PARTY_NOTICES.md).
// A panel is a dark fill plus a crisp pixel frame. The fill keeps the art guide's
// "dark translucent background + high-contrast text" rule; the frame replaces the
// old Graphics strokeRoundedRect, whose soft anti-aliased corners broke the pixel
// look.
// Fully opaque: at 0.96 the world's furniture labels and the HUD bled through
// the panel and made the text inside hard to read. The art guide asks for a dark
// translucent background, but readability of the panel's own contents wins.
const PANEL_FILL_TOP = 0x1b2731;
const PANEL_FILL_BOTTOM = 0x090d10;
const PANEL_FILL_ALPHA = 1;

// The frame is eight plain Images, not a NineSlice. In Phaser 4 a NineSlice is
// composited in a later pass than plain Images whatever the depth — a frame at
// depth -100 lets the icons inside show, the same frame at 195 with icons at 200
// hides every one of them — so the frame has to be built out of objects that
// composite in ordinary display-list order. Four corners keep their natural size
// and the four edges stretch, which is what a nine-slice would have done.
//
// The pieces come from the riveted metal panel in the art pack (see
// tools/build-artpack.mjs). Its corner brackets are ~28px across, so that is the
// slice; the edge strips are 8px of flat bar between them.
const PANEL_SLICE = 28;

export type PanelAccent = 'green' | 'yellow';

// The two objects buildPanel() owns, so a caller's uniform depth pass can leave
// them where they are. A WeakSet rather than a flag on the object: PanelObject is
// a union of Phaser types and none of them carries a spare field for this.
const PANEL_OWNED = new WeakSet<Phaser.GameObjects.GameObject>();

// How far below a panel's own content depth its frame and fill sit.
//
// This is not tidiness, and the offsets have to be large enough to clear every
// panel's content, not just this one's. The panels carry different content depths
// so that a modal draws above whatever is open, which means a small offset puts
// one panel's frame above another panel's content: at -5 the craft frame landed
// at 205 and swallowed every icon in the inventory's rows, even though the craft
// panel was closed. -50 keeps the deepest frame (180) below the shallowest
// content (200).
//
// panels.test.ts asserts that against these constants, because the failure mode
// is silent — nothing errors, the icons are just gone.
//
// Exported for that test only: nothing in the game reads them.
export const PANEL_FRAME_OFFSET = -50;
export const PANEL_FILL_OFFSET = -60;

// Content depth per panel, grouped by the scene that owns it. The grouping is
// load-bearing: panels only ever compete for draw order inside their own scene,
// so the frame-below-content invariant has to be checked per scene and not across
// the whole table (the menu's help panel sits at 300, far above anything the game
// scene draws, and that is fine because the two scenes never render together).
export const PANEL_DEPTH = {
  game: { inventory: 200, craft: 210, dialogue: 220, pause: 230 },
  menu: { help: 300 },
  tower: { detail: 200 },
} as const;

// Depth for the HUD's standing feedback: the flash, the bag-full warning and the
// hint line. All three live in the top band of the screen, which is exactly where
// every panel in PANEL_DEPTH.game is drawn, so they have to clear the deepest one
// or a panel's opaque fill swallows them.
//
// They did not. feedbackText sat at 120 while pause sits at 230, so the B3-03
// action costs and the B3-05.2 purify count were off-screen for the whole time the
// player was acting, and bagFullWarning's "the warning survives opening the
// inventory" passed on a GameObject.visible flag rather than on pixels (B3-05 §6).
//
// panels.test.ts asserts this against PANEL_DEPTH, because the failure is silent
// in both directions: nothing errors, and a test that reads the object instead of
// the canvas still goes green.
export const HUD_FEEDBACK_DEPTH = 300;

// Linear blend between two 24-bit colours.
//
// Deliberately local rather than Phaser.Display.Color.Interpolate: this module is
// imported by panels.test.ts under Node, and Phaser's ESM bundle touches
// `window.cordova` the moment it is actually loaded. Every use of the Phaser
// namespace in this file has to stay in a TYPE position so esbuild elides the
// import — a single value-position call turns the import real and the Node test
// dies with "window is not defined".
function mixColor(a: number, b: number, t: number): number {
  const mix = (ca: number, cb: number): number => Math.round(ca + (cb - ca) * t);
  const r = mix((a >> 16) & 0xff, (b >> 16) & 0xff);
  const g = mix((a >> 8) & 0xff, (b >> 8) & 0xff);
  const bl = mix(a & 0xff, b & 0xff);
  return (r << 16) | (g << 8) | bl;
}

// The uniform pass every panel's object list goes through: park it in screen
// space at `depth`. The frame and fill are skipped, because buildPanel already
// put them just below it.
export function applyPanelDepth(objects: PanelObject[], depth: number): void {
  for (const o of objects) {
    o.setScrollFactor(0);
    if (!PANEL_OWNED.has(o)) o.setDepth(depth);
  }
}

// What a panel's object list holds: text, the dark fill, the eight frame pieces,
// the selection marker, and (in GameScene's container boxes) plain Graphics.
//
// The fill is kept even though the frame already covers the border: callers only
// ever push the returned list into a visibility group, so dropping it would save
// nothing and would change what the list contains.
export type PanelObject =
  | Phaser.GameObjects.Text
  | Phaser.GameObjects.Rectangle
  | Phaser.GameObjects.Image
  | Phaser.GameObjects.Graphics;

// `green` is the 安全青 accent (inventory / dialogue / help), `yellow` the
// 灯光橙 accent (crafting / pause) — matching what each panel used to stroke.
export function buildPanel(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  w: number,
  h: number,
  accent: PanelAccent,
  depth: number,
): PanelObject[] {
  const left = cx - w / 2;
  const top = cy - h / 2;

  // OVERHAUL UI: the fill is FIVE stepped bands, not one rectangle.
  //
  // Measured before: a 460x300 panel covers 60% of the 640x360 canvas, and a
  // single flat fill meant ~50% of every screenshot was one colour — the exact
  // "big flat slab" that made the interface look like a prototype. Stepping the
  // brightness from a raised header tone down to the base surface breaks the
  // slab into a gradient you can feel without a smooth blur (which would break
  // the pixel look), and it costs four extra rectangles.
  const FILL_BANDS = 5;
  const fill: Phaser.GameObjects.Rectangle[] = [];
  for (let i = 0; i < FILL_BANDS; i++) {
    const t0 = i / FILL_BANDS;
    const t1 = (i + 1) / FILL_BANDS;
    const k = t0; // 0 at the top, ~0.8 at the bottom
    const bandColor = mixColor(PANEL_FILL_TOP, PANEL_FILL_BOTTOM, k);
    fill.push(
      scene.add
        .rectangle(cx, cy - h / 2 + h * ((t0 + t1) / 2), w, h * (t1 - t0) + 1, bandColor, PANEL_FILL_ALPHA)
        .setDepth(depth + PANEL_FILL_OFFSET),
    );
  }

  // Corners sit at their natural size; edges stretch to fill the gap between
  // them. Origin (0,0) everywhere so each piece is placed by its top-left. The
  // keys are spelled out rather than built by a helper: a helper's calls read
  // like texture lookups, which defeats the source scan in textureKeys.test.ts.
  const frame: Phaser.GameObjects.Image[] = [
    scene.add.image(left, top, `ui-frame-${accent}-tl`).setOrigin(0, 0),
    scene.add.image(left + w - PANEL_SLICE, top, `ui-frame-${accent}-tr`).setOrigin(0, 0),
    scene.add.image(left, top + h - PANEL_SLICE, `ui-frame-${accent}-bl`).setOrigin(0, 0),
    scene.add.image(left + w - PANEL_SLICE, top + h - PANEL_SLICE, `ui-frame-${accent}-br`).setOrigin(0, 0),
    scene.add.image(left + PANEL_SLICE, top, `ui-frame-${accent}-top`).setOrigin(0, 0).setDisplaySize(w - PANEL_SLICE * 2, PANEL_SLICE),
    scene.add.image(left + PANEL_SLICE, top + h - PANEL_SLICE, `ui-frame-${accent}-bottom`).setOrigin(0, 0).setDisplaySize(w - PANEL_SLICE * 2, PANEL_SLICE),
    scene.add.image(left, top + PANEL_SLICE, `ui-frame-${accent}-left`).setOrigin(0, 0).setDisplaySize(PANEL_SLICE, h - PANEL_SLICE * 2),
    scene.add.image(left + w - PANEL_SLICE, top + PANEL_SLICE, `ui-frame-${accent}-right`).setOrigin(0, 0).setDisplaySize(PANEL_SLICE, h - PANEL_SLICE * 2),
  ];
  for (const o of frame) o.setDepth(depth + PANEL_FRAME_OFFSET);

  for (const f of fill) PANEL_OWNED.add(f);
  for (const o of frame) PANEL_OWNED.add(o);
  return [...fill, ...frame];
}

// The licensed arrow used as the selection marker in every list, replacing the
// old text "▶ " prefix (which shifted each label and broke the pixel look).
// Starts hidden: each list's refresh places and reveals its own marker, and the
// marker is pushed into the panel's object list so it toggles with the panel.
export function createMarker(scene: Phaser.Scene): Phaser.GameObjects.Image {
  return scene.add.image(0, 0, 'ui-marker').setVisible(false);
}

// Park the marker just left of a centred label.
export function placeMarker(marker: Phaser.GameObjects.Image, label: Phaser.GameObjects.Text): void {
  marker.setPosition(label.getBounds().left - 12, label.y);
}

// Park the marker just left of a row's first element. Offsetting from the icon
// rather than the label matters: the label sits 16px right of the icon, so
// offsetting from the label put the marker on top of the icon.
export function placeMarkerLeftOf(
  marker: Phaser.GameObjects.Image,
  element: { getBounds: () => Phaser.Geom.Rectangle },
): void {
  const b = element.getBounds();
  marker.setPosition(b.x - 12, b.y + b.height / 2);
}
