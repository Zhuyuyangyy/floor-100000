import Phaser from 'phaser';

import { FONT_FAMILY } from './uiKit';

// Mouse support, shared by every screen.
//
// The game shipped keyboard-only: menus were a list of Text objects and a
// selection index, so there was nothing to click. Rather than rewrite the
// selection model, this module puts invisible hit targets over the things that
// already exist and routes the click back into the same index-then-activate path
// the keyboard uses. One state machine, two input devices.
//
// Why a hit rectangle instead of setInteractive() on the text: menu rows are
// 12–18px tall and some are right-aligned with a custom origin, so the text's own
// hit box is both too small and offset. A rect is exact, and its fill alpha is 0
// so it never changes the picture. Phaser's input manager skips objects whose
// `visible` is false, so a hidden panel stops being clickable for free — the hit
// rects live in the same object list the panel hides.

export interface HitHandlers {
  /** Pointer entering the row. Used to move the selection cursor. */
  onOver?: () => void;
  /** Pointer pressed. Should do what Enter does on the selected row. */
  onClick: () => void;
}

function stopPropagation(args: unknown[]): void {
  // Phaser passes (pointer, localX, localY, event). Stopping the event keeps a
  // panel row from also being read as a "walk here" order by GameScene's own
  // pointer handler, which listens on the scene input, not on this object.
  const event = args[3] as { stopPropagation?: () => void } | undefined;
  event?.stopPropagation?.();
}

/**
 * An invisible, exact hit target.
 *
 * `fillAlpha: 0` keeps it out of the picture while `alpha` stays 1, which is what
 * Phaser's willRender() checks before it hit-tests — an object with alpha 0 is
 * skipped by the input manager entirely.
 */
export function hitRect(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  handlers: HitHandlers,
): Phaser.GameObjects.Rectangle {
  const rect = scene.add.rectangle(x, y, w, h, 0x000000, 0).setOrigin(0, 0).setDepth(depth);
  rect.setInteractive({ useHandCursor: true });
  if (handlers.onOver) rect.on('pointerover', handlers.onOver);
  rect.on('pointerdown', (...args: unknown[]) => {
    stopPropagation(args);
    handlers.onClick();
  });
  return rect;
}

/** Make an existing Text object clickable, with a colour swap on hover. */
export function textClickable(
  text: Phaser.GameObjects.Text,
  baseColor: string,
  hoverColor: string,
  handlers: HitHandlers,
): Phaser.GameObjects.Text {
  text.setInteractive({ useHandCursor: true });
  text.on('pointerover', () => {
    text.setColor(hoverColor);
    handlers.onOver?.();
  });
  text.on('pointerout', () => text.setColor(baseColor));
  text.on('pointerdown', (...args: unknown[]) => {
    stopPropagation(args);
    handlers.onClick();
  });
  return text;
}

export interface ButtonColors {
  fill: number;
  line: number;
  text: string;
  hover: number;
}

/** A framed button drawn as three loose objects (background, border, label).
 *
 *  Loose rather than a Container: every panel in this project hides itself by
 *  calling setVisible(false) on a flat list, and a Container would need its own
 *  hide path. The caller pushes all three into that list. */
export function framedButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  depth: number,
  onClick: () => void,
  colors: ButtonColors,
): Phaser.GameObjects.GameObject[] {
  const bg = scene.add.rectangle(x, y, w, h, colors.fill, 0.9).setOrigin(0, 0).setDepth(depth);
  const border = scene.add.rectangle(x, y, w, h, 0x000000, 0).setOrigin(0, 0).setDepth(depth).setStrokeStyle(1, colors.line, 0.9);
  const text = scene.add
    .text(x + w / 2, y + h / 2, label, { fontFamily: FONT_FAMILY, fontSize: '18px', color: colors.text })
    .setOrigin(0.5)
    .setDepth(depth + 1);
  const hit = hitRect(scene, x, y, w, h, depth + 2, {
    onOver: () => bg.setFillStyle(colors.hover, 0.95),
    onClick,
  });
  hit.on('pointerout', () => bg.setFillStyle(colors.fill, 0.9));
  return [bg, border, text, hit];
}
