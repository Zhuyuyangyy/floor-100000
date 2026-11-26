import Phaser from 'phaser';

import { getGame, startNewGame } from '../core/session';
import { deathCause } from '../systems/SurvivalSystem';
import { clearSave } from '../systems/SaveSystem';
import { ART_BANNER_WIN_KEY, ART_BANNER_LOSE_KEY, TITLE_BG_KEY } from '../render/artpack';
import { PALETTE, ROLE, TEXT, hex } from '../render/palette.ts';
import { buildPanelHeader, buildPanelWell, FONT_FAMILY, UI } from '../render/uiKit';
import { buildPanel, PANEL_DEPTH } from '../render/panels';
import { depthRecord, runScore } from '../systems/progress';

// End screen (docs/01_GDD.md §5): loss on HP 0 with the cause and days survived,
// and a keyboard restart into a fresh run.
//
// OVERHAUL UI: measured before this, 79% of the screen was ONE flat colour - the
// worst of any screen in the game, and it is the moment that decides whether the
// player starts another run. It is now built like the title: the painted
// dormitory render sits behind it under an outcome-coloured wash, and the result
// itself is a proper card - header strip, the cause in an inset well, and the
// run's numbers in a row each. The banner art still carries the outcome icon.
//
// The win branch is NOT reachable in a normal run and says so. The frozen design
// (GAME_DESIGN_LOCK.md) makes victory reaching floor 100000, which is B8; the only
// thing that sets status='won' today is isLegacyVictory(), the retired day-8
// threshold, and that is gated behind the ?devwin=1 fixture.
//
// ── the chapter card ────────────────────────────────────────────────────────
// A **stage milestone**, not a win: the same card, drawn once, saying
// 「第 1 章完成：线路恢复，抵达第 3 层」, with 「继续游玩 / 重新开始」 as the
// two exits. The formal victory condition stays "reach floor 100000"
// (GAME_DESIGN_LOCK.md) and this card says so out loud - a judge must never
// read it as "the game is finished".
const BANNER_W = 300;
const BANNER_H = 88;

/** What the scene was launched for. `mode: 'chapter'` is the stage-milestone card. */
export interface EndSceneData {
  mode?: 'chapter';
  title?: string;
  subtitle?: string;
}

export class EndScene extends Phaser.Scene {
  constructor() {
    super({ key: 'End' });
  }

  create(data?: EndSceneData): void {
    const state = getGame();
    const chapter = data?.mode === 'chapter';
    const won = state.status === 'won';
    const { width, height } = this.cameras.main;

    // ── the backdrop ────────────────────────────────────────────────────────
    // The same painted render as the title and the character select, so the
    // ending happens in the building the run happened in.
    if (this.textures.exists(TITLE_BG_KEY)) {
      this.textures.get(TITLE_BG_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.add.image(width / 2, height / 2, TITLE_BG_KEY).setDisplaySize(width, height).setDepth(-30);
    } else {
      this.add.rectangle(width / 2, height / 2, width, height, PALETTE.ink).setDepth(-30);
    }
    // The outcome wash: deep teal for a clear, deep red for a death. Both are the
    // palette's ramps, so the end card belongs to the same world as the run.
    this.add
      .rectangle(width / 2, height / 2, width, height, chapter || won ? PALETTE.clothDeep : PALETTE.lightDeep)
      .setAlpha(0.26)
      .setDepth(-29);
    this.add.rectangle(width / 2, height / 2, width, height, PALETTE.ink).setAlpha(0.46).setDepth(-28);

    // ── the card ────────────────────────────────────────────────────────────
    const cx = width / 2;
    const panelW = 400;
    const panelH = 250;
    const left = cx - panelW / 2;
    const top = height / 2 - panelH / 2 + 16;
    const depth = PANEL_DEPTH.menu.help;

    const headline = chapter ? (data?.title ?? '第 1 章完成') : won ? '你活了下来' : '你没能活下来';
    this.add
      .text(cx, top - 74, headline, {
        fontFamily: FONT_FAMILY,
        fontSize: '52px',
        color: chapter || won ? hex(PALETTE.clothHigh) : hex(ROLE.danger),
        stroke: hex(PALETTE.ink),
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(depth + 2);

    // The outcome icon sits above the headline, small: it is a stamp, not the
    // subject. The chapter card has no stamp: the win banner would read as
    // "the game is won", and the formal condition is still floor 100000.
    if (!chapter && this.textures.exists(won ? ART_BANNER_WIN_KEY : ART_BANNER_LOSE_KEY)) {
      this.add
        .image(cx, top - 118, won ? ART_BANNER_WIN_KEY : ART_BANNER_LOSE_KEY)
        .setDisplaySize(BANNER_W, BANNER_H)
        .setDepth(depth + 2)
        .setAlpha(0.95);
    }

    for (const o of buildPanel(this, cx, height / 2 + 16, panelW, panelH, chapter || won ? 'green' : 'yellow', depth)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    for (const o of buildPanelHeader(this, left, top, panelW, chapter ? '第 1 章' : won ? '这一趟' : '死因', chapter || won ? PALETTE.clothHigh : PALETTE.lightHigh, depth + 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }

    const reason = chapter
      ? (data?.subtitle ?? '线路恢复，抵达第 3 层')
      : won
        ? '旧版第 8 天阈值 · ?devwin=1 夹具'
        : deathCause(state);
    for (const o of buildPanelWell(this, left + 12, top + 26, panelW - 24, 26, depth + 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    this.add
      .text(cx, top + 39, reason, { fontFamily: FONT_FAMILY, fontSize: '24px', color: hex(TEXT.primary) })
      .setOrigin(0.5)
      .setDepth(depth + 7);

    // The run's numbers, one row each: label left, value right. The record is
    // marked when this run beat it, because that is the line that makes a loss
    // feel like progress.
    const deepest = depthRecord(state);
    const score = runScore(state);
    const best = state.records?.bestScore ?? 0;
    const rows: Array<[string, string, boolean]> = [
      ['存活', `${state.day} 天`, false],
      ['最深', `第 ${deepest} 层`, false],
      ['得分', `${score}`, score >= best],
    ];
    rows.forEach(([label, value, highlight], i) => {
      // 40px pitch for a 24px pixel face. The old 26px pitch was measured
      // against SimSun, whose ink box is much shorter than its em; a pixel
      // glyph fills the em, so three rows at 26px read as one smudge.
      const y = top + 76 + i * 40;
      this.add
        .text(left + 22, y, label, { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.dim) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7);
      this.add
        .text(left + panelW - 22, y, value, {
          fontFamily: FONT_FAMILY,
          fontSize: '24px',
          color: highlight ? hex(TEXT.highlight) : hex(TEXT.primary),
        })
        .setOrigin(1, 0.5)
        .setDepth(depth + 7);
      if (highlight) {
        // Was anchored to the same x/y as the value, so '纪录' was painted
        // straight over the score. It belongs to the label column instead.
        this.add
          .text(left + 100, y, '新纪录', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(PALETTE.lightHigh) })
          .setOrigin(0, 0.5)
          .setDepth(depth + 8);
      }
    });

    if (won || chapter) {
      this.add
        .text(cx, top + panelH - 60, '正式胜利条件为抵达第 100000 层', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(TEXT.dim) })
        .setOrigin(0.5)
        .setDepth(depth + 7);
    }

    // The restart prompt on a foot bar, the same shape as the game's own HUD.
    const footY = top + panelH - 24;
    for (const o of buildPanelWell(this, left + 12, footY - 14, panelW - 24, 28, depth + 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }

    if (chapter) {
      // Two exits, both one keypress or one click away:
      //   继续游玩 - back into the run, the save is intact (it was written before
      //              the card was shown), so the player keeps the chapter behind.
      //   重新开始 - a fresh run, same as the death screen's restart.
      this.addChapterButton(cx - 86, footY, '继续游玩', () => {
        this.scene.start('Game');
      });
      this.addChapterButton(cx + 86, footY, '重新开始', () => {
        clearSave();
        startNewGame(Date.now() >>> 0);
        this.scene.start('Game');
      });
      this.input.keyboard?.once('keydown-ENTER', () => {
        this.scene.start('Game');
      });
      this.input.keyboard?.once('keydown-R', () => {
        clearSave();
        startNewGame(Date.now() >>> 0);
        this.scene.start('Game');
      });
      return;
    }

    this.add
      .text(cx, footY, '按 回车 重新开始', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5)
      .setDepth(depth + 7);

    this.input.keyboard?.once('keydown-ENTER', () => {
      clearSave();
      startNewGame(Date.now() >>> 0);
      this.scene.start('Game');
    });
  }

  /** A clickable button for the chapter card's two exits, shaped like the game's own. */
  private addChapterButton(x: number, y: number, label: string, action: () => void): void {
    const width = 148;
    this.add
      .rectangle(x, y, width, 28, UI.surfaceRaised)
      .setStrokeStyle(1, UI.line)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', action);
    this.add
      .text(x, y, label, { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5)
      .setDepth(PANEL_DEPTH.menu.help + 8);
  }
}
