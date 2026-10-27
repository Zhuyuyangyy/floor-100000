import Phaser from 'phaser';

// GHI-04: licensed pixel UI pack (CC0 1.0, Kenney — see THIRD_PARTY_NOTICES.md).
// A panel is a dark fill plus a crisp pixel frame. The fill keeps the art guide's
// "dark translucent background + high-contrast text" rule; the frame replaces the
// old Graphics strokeRoundedRect, whose soft anti-aliased corners broke the pixel
// look.
// Fully opaque: at 0.96 the world's furniture labels and the HUD bled through
// the panel and made the text inside hard to read. The art guide asks for a dark
// translucent background, but readability of the panel's own contents wins.
const PANEL_FILL = 0x0b0f12;
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
  const key = (part: string) => `ui-frame-${accent}-${part}`;

  const fill = scene.add.rectangle(cx, cy, w, h, PANEL_FILL, PANEL_FILL_ALPHA).setDepth(depth + PANEL_FILL_OFFSET);

  // Corners sit at their natural size; edges stretch to fill the gap between
  // them. Origin (0,0) everywhere so each piece is placed by its top-left.
  const frame: Phaser.GameObjects.Image[] = [
    scene.add.image(left, top, key('tl')).setOrigin(0, 0),
    scene.add.image(left + w - PANEL_SLICE, top, key('tr')).setOrigin(0, 0),
    scene.add.image(left, top + h - PANEL_SLICE, key('bl')).setOrigin(0, 0),
    scene.add.image(left + w - PANEL_SLICE, top + h - PANEL_SLICE, key('br')).setOrigin(0, 0),
    scene.add.image(left + PANEL_SLICE, top, key('top')).setOrigin(0, 0).setDisplaySize(w - PANEL_SLICE * 2, PANEL_SLICE),
    scene.add.image(left + PANEL_SLICE, top + h - PANEL_SLICE, key('bottom')).setOrigin(0, 0).setDisplaySize(w - PANEL_SLICE * 2, PANEL_SLICE),
    scene.add.image(left, top + PANEL_SLICE, key('left')).setOrigin(0, 0).setDisplaySize(PANEL_SLICE, h - PANEL_SLICE * 2),
    scene.add.image(left + w - PANEL_SLICE, top + PANEL_SLICE, key('right')).setOrigin(0, 0).setDisplaySize(PANEL_SLICE, h - PANEL_SLICE * 2),
  ];
  for (const o of frame) o.setDepth(depth + PANEL_FRAME_OFFSET);

  PANEL_OWNED.add(fill);
  for (const o of frame) PANEL_OWNED.add(o);
  return [fill, ...frame];
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
