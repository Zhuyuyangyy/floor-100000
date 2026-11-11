import Phaser from 'phaser';
import { UI, TYPE, buildPanelHeader, buildPanelWell, drawLine } from './uiKit.ts';
import { hex, TEXT } from './palette.ts';
import { buildPanel, type PanelObject } from './panels.ts';

/** Existing combat-resolution outcomes shown by GameScene.finishCombat. */
export type CombatOutcome = 'win' | 'coward';

/** Read-only snapshot supplied by the caller; this view never resolves combat. */
export interface CombatOutcomeView {
  outcome: CombatOutcome;
  isBoss: boolean;
  monsterName: string;
  floor: number;
  turn: number;
  log: readonly string[];
  centerX: number;
  centerY: number;
  depth: number;
}

/**
 * Draw the combat result panel and return every owned Phaser object.
 *
 * Pass the actual outcome and combat log from finishCombat. Continue/retreat
 * input remains the owning scene's responsibility (Enter/ESC -> closeCombat);
 * this display-only builder has no click handlers and changes no game state.
 */
export function buildCombatOutcome(
  scene: Phaser.Scene,
  view: CombatOutcomeView,
): PanelObject[] {
  const width = 440;
  const height = 236;
  const left = view.centerX - width / 2;
  const top = view.centerY - height / 2;
  const { depth } = view;
  const isWin = view.outcome === 'win';
  const accent = isWin ? UI.good : UI.accent;
  const headline = isWin
    ? (view.isBoss ? '守门人倒下了' : '战斗胜利')
    : '敌人逃走了';

  const objects: PanelObject[] = [
    ...buildPanel(scene, view.centerX, view.centerY, width, height, 'yellow', depth),
    ...buildPanelHeader(scene, left, top, width, headline, accent, depth + 5, undefined, { height: 28, titleSize: TYPE.caption }),
  ];

  // Compact context row: all values come directly from the active combat state.
  objects.push(
    scene.add
      .text(left + 14, top + 46, view.isBoss ? '守门人遭遇' : view.monsterName, {
        fontFamily: 'monospace',
        fontSize: `${TYPE.body}px`,
        color: hex(TEXT.primary),
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 7),
    scene.add
      .text(left + width - 14, top + 46, `第 ${view.floor} 层 · ${view.turn} 回合`, {
        fontFamily: 'monospace',
        fontSize: `${TYPE.caption}px`,
        color: hex(TEXT.dim),
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 7),
  );

  const logLeft = left + 12;
  const logTop = top + 64;
  const logWidth = width - 24;
  const logHeight = 94;
  objects.push(...buildPanelWell(scene, logLeft, logTop, logWidth, logHeight, depth + 5));

  // Keep the two most recent lines from the live combat log; no reward or
  // result text is synthesized here, so the game log remains the source of truth.
  // Advanced wrapping is required because Chinese text without spaces is one
  // unbroken token to Phaser's basic word wrapper. Measure each rendered row so
  // a wrapped loot line pushes the route result down instead of covering it.
  const tail = view.log.slice(-2);
  let logY = logTop + 6;
  tail.forEach((line, index) => {
    const logText = scene.add
      .text(logLeft + 8, logY, line, {
        fontFamily: 'monospace',
        fontSize: `${TYPE.caption}px`,
        color: index === tail.length - 1 ? hex(TEXT.primary) : hex(TEXT.dim),
        wordWrap: { width: logWidth - 16, useAdvancedWrap: true },
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth + 7);
    objects.push(logText);
    logY += logText.height + 4;
  });

  const rule = scene.add.graphics().setScrollFactor(0).setDepth(depth + 7);
  drawLine(rule, left + 14, top + 166, width - 28, accent, 0.65);
  objects.push(rule);
  objects.push(
    scene.add
      .text(view.centerX, top + 184, 'Enter 继续', {
        fontFamily: 'monospace',
        fontSize: `${TYPE.caption}px`,
        color: hex(TEXT.dim),
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 7),
  );

  return objects;
}
