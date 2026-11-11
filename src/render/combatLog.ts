import type Phaser from 'phaser';

import { PALETTE, TEXT, hex } from './palette.ts';
import { buildPanelWell, TYPE, type UiObject } from './uiKit';

/** Geometry for the inset combat-log area; coordinates and depth match panel helpers. */
export interface CombatLogLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  depth: number;
  /** Maximum number of the newest messages to show; defaults to three. */
  maxEntries?: number;
}

/**
 * Select the newest messages without changing the source event array.
 * The returned order stays chronological (oldest first, newest last).
 */
export function combatLogTail(lines: readonly string[], maxEntries = 3): string[] {
  const count = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 0;
  return count === 0 ? [] : lines.slice(-count);
}

/**
 * Draw a read-only view of the existing combat event strings.
 * Pass CombatState.log directly; this component neither creates events nor mutates state.
 */
export function buildCombatLog(
  scene: Phaser.Scene,
  lines: readonly string[],
  layout: CombatLogLayout,
): UiObject[] {
  const { left, top, width, height, depth } = layout;
  const objects: UiObject[] = [...buildPanelWell(scene, left, top, width, height, depth)];
  const tail = combatLogTail(lines, layout.maxEntries);
  if (tail.length === 0) return objects;

  const insetX = 10;
  const insetY = 4;
  const availableHeight = Math.max(TYPE.caption, height - insetY * 2);
  // Keep Chinese text at the design-system caption floor. If the well is short,
  // show fewer recent events rather than shrinking the glyphs into unreadability.
  const rowCapacity = Math.max(1, Math.floor(availableHeight / TYPE.caption));
  const visible = tail.slice(-rowCapacity);
  const rowHeight = availableHeight / visible.length;

  visible.forEach((line, index) => {
    const y = top + insetY + index * rowHeight;
    const isLatest = index === visible.length - 1;
    if (isLatest) {
      objects.push(
        scene.add
          .rectangle(left + 4, y + Math.max(2, (rowHeight - 12) / 2), 2, Math.min(12, rowHeight - 2), PALETTE.lightHigh)
          .setOrigin(0, 0)
          .setScrollFactor(0)
          .setDepth(depth + 2),
      );
    }
    objects.push(
      scene.add
        .text(left + insetX, y, line, {
          fontFamily: 'monospace',
          fontSize: `${TYPE.caption}px`,
          color: hex(isLatest ? PALETTE.lightHigh : TEXT.secondary),
          wordWrap: { width: Math.max(1, width - insetX - 8) },
        })
        .setScrollFactor(0)
        .setDepth(depth + 3),
    );
  });

  return objects;
}
