import Phaser from 'phaser';

// GHI-04: licensed pixel UI pack (CC0 1.0, Kenney — see THIRD_PARTY_NOTICES.md).
// A panel is a dark fill plus a crisp pixel nine-slice frame. The fill keeps the
// art guide's "dark translucent background + high-contrast text" rule; the frame
// replaces the old Graphics strokeRoundedRect, whose soft anti-aliased corners
// broke the pixel look.
// Fully opaque: at 0.96 the world's furniture labels and the HUD bled through
// the panel and made the text inside hard to read. The art guide asks for a dark
// translucent background, but readability of the panel's own contents wins.
const PANEL_FILL = 0x0b0f12;
const PANEL_FILL_ALPHA = 1;

// The frame texture is 48x48 with a ~4px border, so an 8px slice keeps the
// corners crisp without pulling border pixels into the stretched centre.
const PANEL_SLICE = 8;

export type PanelAccent = 'green' | 'yellow';

// What a panel's object list holds: text, the dark fill, the nine-slice frame,
// the selection marker, and (in GameScene's container boxes) plain Graphics.
export type PanelObject =
  | Phaser.GameObjects.Text
  | Phaser.GameObjects.Rectangle
  | Phaser.GameObjects.NineSlice
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
): PanelObject[] {
  const fill = scene.add.rectangle(cx, cy, w, h, PANEL_FILL, PANEL_FILL_ALPHA);
  const frame = scene.add.nineslice(cx, cy, `ui-panel-${accent}`, undefined, w, h, PANEL_SLICE, PANEL_SLICE, PANEL_SLICE, PANEL_SLICE);
  return [fill, frame];
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
