import Phaser from 'phaser';

import { getGame, startNewGame } from '../core/session';
import { deathCause } from '../systems/SurvivalSystem';
import { clearSave } from '../systems/SaveSystem';
import { ART_BANNER_WIN_KEY, ART_BANNER_LOSE_KEY, TITLE_BG_KEY } from '../render/artpack';
import { PALETTE, ROLE, TEXT, hex } from '../render/palette.ts';
import { TYPE, buildPanelHeader, buildPanelWell } from '../render/uiKit';
import { buildPanel, PANEL_DEPTH } from '../render/panels';
import { depthRecord, runScore } from '../systems/progress';

// End screen (docs/01_GDD.md §5): show the actual outcome, its cause/source,
// existing run records, and the one operation this scene really supports.
//
// Production victory is still not reachable: status='won' is set only by the
// retired day-8 threshold behind ?devwin=1. Keep that fixture unmistakable here;
// do not present it as completion of the frozen floor-100000 victory condition.
const BANNER_W = 260;
const BANNER_H = 76;
const CARD_W = 720;
const CARD_H = 352;
const OUTCOME_TITLE_SIZE = 48;

export class EndScene extends Phaser.Scene {
  constructor() {
    super({ key: 'End' });
  }

  create(): void {
    const state = getGame();
    const won = state.status === 'won';
    const { width, height } = this.cameras.main;

    // ── backdrop ─────────────────────────────────────────────────────────────
    if (this.textures.exists(TITLE_BG_KEY)) {
      this.textures.get(TITLE_BG_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.add.image(width / 2, height / 2, TITLE_BG_KEY).setDisplaySize(width, height).setDepth(-30);
    } else {
      this.add.rectangle(width / 2, height / 2, width, height, PALETTE.ink).setDepth(-30);
    }
    this.add
      .rectangle(width / 2, height / 2, width, height, won ? PALETTE.clothDeep : PALETTE.lightDeep)
      .setAlpha(0.26)
      .setDepth(-29);
    this.add.rectangle(width / 2, height / 2, width, height, PALETTE.ink).setAlpha(0.46).setDepth(-28);

    // ── outcome mark and headline ────────────────────────────────────────────
    const cx = width / 2;
    const titleY = Math.round(height * 0.205);
    const depth = PANEL_DEPTH.menu.help;
    const headline = won ? '胜利 · 开发夹具' : '你没能活下来';

    if (this.textures.exists(won ? ART_BANNER_WIN_KEY : ART_BANNER_LOSE_KEY)) {
      this.add
        .image(cx, Math.round(height * 0.105), won ? ART_BANNER_WIN_KEY : ART_BANNER_LOSE_KEY)
        .setDisplaySize(BANNER_W, BANNER_H)
        .setDepth(depth + 2)
        .setAlpha(0.95);
    }
    this.add
      .text(cx, titleY, headline, {
        fontFamily: 'monospace',
        fontSize: `${OUTCOME_TITLE_SIZE}px`,
        color: won ? hex(PALETTE.clothHigh) : hex(ROLE.danger),
        stroke: hex(PALETTE.ink),
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(depth + 2);

    // ── metal result card ────────────────────────────────────────────────────
    const panelW = Math.min(CARD_W, width - 64);
    const panelH = CARD_H;
    const left = cx - panelW / 2;
    const top = Math.round(height / 2 - panelH / 2 + 18);
    const accent = won ? PALETTE.clothHigh : PALETTE.lightHigh;

    for (const o of buildPanel(this, cx, top + panelH / 2, panelW, panelH, won ? 'green' : 'yellow', depth)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    for (const o of buildPanelHeader(this, left, top, panelW, won ? '胜利来源' : '死因', accent, depth + 5, undefined, { height: 28, titleSize: TYPE.caption })) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }

    const reason = won ? '旧版第 8 天阈值 · 开发夹具（?devwin=1）' : deathCause(state);
    const reasonTop = top + 34;
    for (const o of buildPanelWell(this, left + 16, reasonTop, panelW - 32, 40, depth + 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    this.add
      .text(cx, reasonTop + 20, reason, {
        fontFamily: 'monospace',
        fontSize: `${TYPE.body}px`,
        color: hex(TEXT.primary),
        align: 'center',
        wordWrap: { width: panelW - 56 },
      })
      .setOrigin(0.5)
      .setDepth(depth + 7);

    // These are the existing values, with labels that state their actual scope:
    // deepestFloor is a cross-run record, while the score belongs to this run.
    const stats: Array<[string, string]> = [
      ['存活天数', `${state.day} 天`],
      ['最深纪录', `第 ${depthRecord(state)} 层`],
      ['本局得分', `${runScore(state)}`],
    ];
    const tileGap = 12;
    const innerMargin = 20;
    const tileW = (panelW - innerMargin * 2 - tileGap * 2) / 3;
    const tileTop = top + 90;
    const tileH = 100;

    stats.forEach(([label, value], index) => {
      const tileX = left + innerMargin + index * (tileW + tileGap);
      for (const o of buildPanelWell(this, tileX, tileTop, tileW, tileH, depth + 5)) {
        this.add.existing(o as Phaser.GameObjects.GameObject);
      }
      this.add
        .text(tileX + tileW / 2, tileTop + 29, label, {
          fontFamily: 'monospace',
          fontSize: `${TYPE.caption}px`,
          color: hex(TEXT.dim),
        })
        .setOrigin(0.5)
        .setDepth(depth + 7);
      this.add
        .text(tileX + tileW / 2, tileTop + 68, value, {
          fontFamily: 'monospace',
          fontSize: `${TYPE.title}px`,
          color: hex(TEXT.highlight),
        })
        .setOrigin(0.5)
        .setDepth(depth + 7);
    });

    if (won) {
      this.add
        .text(cx, top + 218, '正式胜利条件：抵达第 100000 层。', {
          fontFamily: 'monospace',
          fontSize: `${TYPE.caption}px`,
          color: hex(TEXT.secondary),
        })
        .setOrigin(0.5)
        .setDepth(depth + 7);
      this.add
        .text(cx, top + 244, '当前正常流程尚无可达胜利；此画面仅由开发夹具触发。', {
          fontFamily: 'monospace',
          fontSize: `${TYPE.caption}px`,
          color: hex(TEXT.dim),
          align: 'center',
          wordWrap: { width: panelW - 48 },
        })
        .setOrigin(0.5)
        .setDepth(depth + 7);
    }

    // The existing Enter handler starts a fresh run after clearing its save.
    // State that consequence instead of implying this is a non-destructive retry.
    const footY = top + panelH - 48;
    for (const o of buildPanelWell(this, left + 16, footY - 18, panelW - 32, 36, depth + 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    this.add
      .text(cx, footY, '按回车开始新一局 · 当前存档将被清除', {
        fontFamily: 'monospace',
        fontSize: `${TYPE.body}px`,
        color: hex(PALETTE.lightHigh),
      })
      .setOrigin(0.5)
      .setDepth(depth + 7);

    this.input.keyboard?.once('keydown-ENTER', () => {
      clearSave();
      startNewGame(Date.now() >>> 0);
      this.scene.start('Game');
    });
  }
}
