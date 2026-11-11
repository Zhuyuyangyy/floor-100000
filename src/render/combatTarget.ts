import Phaser from 'phaser';
import type { CombatMonster } from '../core/gameTypes';
import { TEXT, hex } from './palette';
import { TYPE, UI, buildPanelWell, drawStatBar, type UiObject } from './uiKit';

export interface CombatTargetCardOptions {
  scene: Phaser.Scene;
  /** The live `state.combat.monster`; no copies or synthetic targets required. */
  monster: CombatMonster;
  /** Whether the caller's current target selection points at this monster. */
  selected: boolean;
  isBoss: boolean;
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Defaults to 76 design pixels. */
  height?: number;
}

/**
 * Read-only target card for the sole live combat enemy. The parent owns target
 * input/selection and panel lifecycle; this helper only renders the supplied
 * real monster fields and selected state, returning objects for cleanup.
 */
export function buildCombatTargetCard(options: CombatTargetCardOptions): UiObject[] {
  const {
    scene, monster, selected, isBoss, x, y, width, depth,
  } = options;
  const height = options.height ?? 76;
  const accent = isBoss ? UI.danger : UI.accent;
  const hpFraction = Math.max(0, Math.min(1, monster.hp / Math.max(1, monster.maxHp)));
  const out: UiObject[] = [];

  out.push(...buildPanelWell(scene, x, y, width, height, depth));
  if (selected) {
    out.push(scene.add.rectangle(x, y, 3, height, accent)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(depth + 2));
  }
  out.push(
    scene.add.text(x + 10, y + 8, `${monster.name}${isBoss ? '（守门人）' : ''}`, {
      fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: hex(TEXT.primary),
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(depth + 3),
    scene.add.text(x + width - 10, y + 10, selected ? '当前目标' : '敌方目标', {
      fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: hex(selected ? accent : TEXT.dim),
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(depth + 3),
    scene.add.text(x + 10, y + 38, `生命 ${monster.hp}/${monster.maxHp}`, {
      fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary),
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(depth + 3),
  );
  const bar = scene.add.graphics().setScrollFactor(0).setDepth(depth + 3);
  drawStatBar(bar, x + 112, y + 42, Math.max(24, width - 122), 7, hpFraction, accent, 16);
  out.push(bar);
  return out;
}
