import Phaser from 'phaser';
import type { CombatAction } from '../systems/combat.ts';
import { hex, PALETTE, TEXT } from './palette.ts';
import { TYPE, UI } from './uiKit.ts';

/** Display copy only; the action ids are the existing combat-engine contract. */
export const COMBAT_ACTION_BUTTONS: ReadonlyArray<{
  action: CombatAction;
  label: string;
  note: string;
}> = [
  { action: 'attack', label: '攻击', note: '武器伤害' },
  { action: 'guard', label: '格挡', note: '减伤 +3精力' },
  { action: 'flee', label: '撤退', note: '可能失败' },
];

export interface CombatActionButtonsOptions {
  /** Top-left of the action area in fixed-screen coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The caller's existing combatSelected cursor; this component owns no state. */
  selectedIndex: number;
  depth: number;
}

/**
 * Draw the combat action controls as a small bank of dark-metal buttons.
 *
 * This is intentionally presentational: pass the existing combatSelected value
 * from GameScene and keep Enter/ESC routed through its existing handlers. The
 * returned Phaser objects can be added to the scene's existing encounterObjects
 * list and destroyed with the rest of that panel.
 */
export function buildCombatActionButtons(
  scene: Phaser.Scene,
  opts: CombatActionButtonsOptions,
): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  const gap = 8;
  const count = COMBAT_ACTION_BUTTONS.length;
  const buttonW = (opts.width - gap * (count - 1)) / count;
  const buttonH = opts.height;

  COMBAT_ACTION_BUTTONS.forEach((button, index) => {
    const x = opts.x + index * (buttonW + gap);
    const selected = index === opts.selectedIndex;
    const border = selected ? UI.accent : UI.line;
    const fill = selected ? PALETTE.stone : PALETTE.shadow;

    out.push(
      scene.add
        .rectangle(x, opts.y, buttonW, buttonH, fill)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setAlpha(selected ? 0.96 : 0.84)
        .setDepth(opts.depth),
    );

    const frame = scene.add.graphics().setScrollFactor(0).setDepth(opts.depth + 1);
    frame.lineStyle(1, border, selected ? 1 : 0.72);
    frame.strokeRect(Math.round(x) + 0.5, Math.round(opts.y) + 0.5, Math.round(buttonW) - 1, Math.round(buttonH) - 1);
    // A restrained warm-metal cap marks the active control without changing
    // the project's existing amber-and-stone palette.
    frame.fillStyle(selected ? UI.accent : UI.line, selected ? 1 : 0.55);
    frame.fillRect(Math.round(x) + 1, Math.round(opts.y) + 1, Math.round(buttonW) - 2, 2);
    out.push(frame);

    out.push(
      scene.add
        .text(x + buttonW / 2, opts.y + buttonH * 0.32, button.label, {
          fontFamily: 'monospace',
          fontSize: `${TYPE.body}px`,
          color: hex(selected ? PALETTE.lightHot : TEXT.primary),
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(opts.depth + 2),
      scene.add
        .text(x + buttonW / 2, opts.y + buttonH * 0.78, button.note, {
          fontFamily: 'monospace',
          fontSize: `${TYPE.caption}px`,
          color: hex(selected ? PALETTE.lightHigh : TEXT.dim),
          align: 'center',
          wordWrap: { width: buttonW - 12 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(opts.depth + 2),
    );
  });

  return out;
}
