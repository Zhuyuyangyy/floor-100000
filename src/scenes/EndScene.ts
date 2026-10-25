import Phaser from 'phaser';
import { getGame, startNewGame } from '../core/session';
import { deathCause } from '../systems/SurvivalSystem';
import { clearSave } from '../systems/SaveSystem';

// End screen (docs/01_GDD.md §5): win at day 8 06:00, or loss on HP 0, with the
// cause and days survived, and a keyboard restart into a fresh run.
export class EndScene extends Phaser.Scene {
  constructor() {
    super({ key: 'End' });
  }

  create(): void {
    const state = getGame();
    const won = state.status === 'won';
    const { width, height } = this.cameras.main;

    this.add.rectangle(width / 2, height / 2, width, height, won ? 0x14301f : 0x2a1414);

    this.add
      .text(width / 2, 108, won ? '你活了下来' : '你没能活下来', {
        fontFamily: 'monospace',
        fontSize: '36px',
        color: won ? '#77c6a4' : '#e56d63',
        stroke: '#0b0f12',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    const reason = won
      ? `在第 ${state.day} 天 06:00 撑到了撤离评估点`
      : `死因：${deathCause(state)}`;
    this.add.text(width / 2, 168, reason, { fontFamily: 'monospace', fontSize: '16px', color: '#ece8d8' }).setOrigin(0.5);
    this.add.text(width / 2, 200, `存活 ${state.day} 天`, { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);

    this.add
      .text(width / 2, 282, '按 回车 重新开始', { fontFamily: 'monospace', fontSize: '16px', color: '#77c6a4' })
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ENTER', () => {
      clearSave();
      startNewGame(Date.now() >>> 0);
      this.scene.start('Game');
    });
  }
}
