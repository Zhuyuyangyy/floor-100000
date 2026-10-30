import Phaser from 'phaser';
import { PALETTE } from '../render/palette.ts';
import { getGame, startNewGame } from '../core/session';
import { deathCause } from '../systems/SurvivalSystem';
import { clearSave } from '../systems/SaveSystem';
import { ART_BANNER_WIN_KEY, ART_BANNER_LOSE_KEY } from '../render/artpack';

// End screen (docs/01_GDD.md §5): loss on HP 0 with the cause and days survived,
// and a keyboard restart into a fresh run.
//
// The art pack's two message banners carry the outcome: a green check for having
// survived, a red skull for not. Their icon sits in the left third, so the text
// is centred on the remaining two thirds rather than on the banner — centring it
// on the banner would run the headline straight through the icon.
//
// The win branch is NOT reachable in a normal run and says so. The frozen design
// (GAME_DESIGN_LOCK.md) makes victory reaching floor 100000, which is B8; the only
// thing that sets status='won' today is isLegacyVictory(), the retired day-8
// threshold, and that is gated behind the ?devwin=1 fixture. The screen used to
// read 「在第 X 天 06:00 撑到了撤离评估点」, which described the retired v0.1 rule
// as if it were the game's ending.
const BANNER_W = 440;
const BANNER_H = 128;
const BANNER_TEXT_X = 386;

export class EndScene extends Phaser.Scene {
  constructor() {
    super({ key: 'End' });
  }

  create(): void {
    const state = getGame();
    const won = state.status === 'won';
    const { width, height } = this.cameras.main;

    // The result screen's wash: a deep green for a run that reached the top, a deep
    // red for one that did not. Both are the palette's cloth ramps pushed to their
    // darkest step, so the end card belongs to the same world as the run.
    this.add.rectangle(width / 2, height / 2, width, height, won ? PALETTE.cloth : PALETTE.lightDeep).setAlpha(0.22);
    this.add.rectangle(width / 2, height / 2, width, height, PALETTE.ink).setAlpha(0.55);

    this.add
      .image(width / 2, 140, won ? ART_BANNER_WIN_KEY : ART_BANNER_LOSE_KEY)
      .setDisplaySize(BANNER_W, BANNER_H);

    this.add
      .text(BANNER_TEXT_X, 112, won ? '你活了下来' : '你没能活下来', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: won ? '#77c6a4' : '#e56d63',
        stroke: '#0b0f12',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    const reason = won
      ? '旧版第 8 天阈值 · ?devwin=1 夹具'
      : `死因：${deathCause(state)}`;
    this.add.text(BANNER_TEXT_X, 150, reason, { fontFamily: 'monospace', fontSize: '15px', color: '#ece8d8' }).setOrigin(0.5);
    this.add
      .text(BANNER_TEXT_X, 176, won ? `存活 ${state.day} 天 · 正式胜利条件为抵达第 100000 层` : `存活 ${state.day} 天`, {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#f4b66a',
      })
      .setOrigin(0.5);

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
