import Phaser from 'phaser';

import { getGame, startNewGame } from '../core/session';
import type { GameState } from '../core/gameTypes';
import { deathCause } from '../systems/SurvivalSystem';
import { clearSave } from '../systems/SaveSystem';
import { ART_BANNER_WIN_KEY, ART_BANNER_LOSE_KEY, TITLE_BG_KEY } from '../render/artpack';
import { PALETTE, ROLE, TEXT, hex } from '../render/palette.ts';
import { buildPanelHeader, buildPanelWell, FONT_FAMILY, TYPE } from '../render/uiKit';
import { buildPanel, PANEL_DEPTH, type PanelObject } from '../render/panels';
import { textClickable } from '../render/pointer';
import { playSfx } from '../render/audio';
import { STATS_PANEL } from '../render/hudLayout';
import { recordRows, runStatRows, settleRun, type StatRow } from '../systems/StatsSystem';

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
// AG-81（结算系统）：死亡画面从「三行数字」升级为上架水准的战绩结算——
//   * 大标题「你死了」+ 死因（战斗死 = 被谁杀死，否则饥/渴/体温/伤势）；
//   * 本局统计表（StatsSystem.runStatRows 的全部 13 项计数 + 存活 + 时长）；
//   * 历史纪录对比（localStorage 'floor100000.records'，破纪录行高亮盖
//     「新纪录」章）；
//   * 两个出口：重新开始（Enter）/ 返回标题（Esc）。
// 统计表的渲染抽成导出函数 buildStatsTable——EndgameScene 的终局结算与
// GameScene 暂停菜单的统计面板复用同一套行几何（hudLayout.STATS_PANEL），
// 「一局的账」在三个画面里长得一模一样。
//
// The win branch is NOT reachable in a normal run and says so. The frozen design
// (GAME_DESIGN_LOCK.md) makes victory reaching floor 100000, which is B8; the only
// thing that sets status='won' today is isLegacyVictory(), the retired day-8
// threshold, and that is gated behind the ?devwin=1 fixture.
const BANNER_W = 300;
const BANNER_H = 88;

// ── 结算卡版面（设计画布 px）──────────────────────────────────────────────
// 1280x720 的纵向预算：横幅 2..90 → 大标题 122 → 死因条 142..170 →
// 卡片 190..560 → 出口双按钮 600..634。统计表 16 行三列（6 行 × 30px 行距），
// 纪录对比 4 行两列（行更宽：标签 + 「新纪录」章 + 窄值塞得进 288px 列）。
const PANEL_W = 640;
const PANEL_H = 370;
const GRID_COLS = 3;
const GRID_X_INSET = 20;
/** 统计网格顶距面板顶：标题栏 30 + 18px 气。 */
const GRID_TOP = 48;
/** 纪录区标签（「历史纪录」小字）距统计网格底的分隔带厚。 */
const RECORDS_LABEL_GAP = 18;
/** 纪录区首行距统计网格底。 */
const RECORDS_TOP = 42;
const FOOT_Y = 600;
const BTN_W = 220;
const BTN_H = 34;
const BTN_GAP = 24;

// 死因：饥/渴/失温优先（它们在任何时刻都成立，包括战斗中被渴死），剩下的
// 「伤势过重」再问是谁打的——state.combat 在死亡那一刻还挂着（closeCombat
// 只在 outcome 面板确认后跑），所以怪物名是现成的。
function causeOf(state: GameState): string {
  const base = deathCause(state);
  if (base === '伤势过重' && state.combat?.monster?.name) {
    return `被 ${state.combat.monster.name} 杀死`;
  }
  return base;
}

/**
 * 统计行表：label 左 / value 右的网格，按 columns 列铺开（行序优先，从左到
 * 右、从上到下）。破纪录的行（row.record）整行染 accent 薄纱、标签转 highlight、
 * 标签后盖一枚「新纪录」章——「这一趟有没有进步」必须在一眼之内看见。
 *
 * 返回占用的高度与建出的对象：高度供调用方排后面的区段，对象供有模式机的
 * 场景（EndgameScene）在切模式时整池销毁。
 *
 * 为什么住在 EndScene 而不是 render/ 或 StatsSystem：文件边界只允许本文件
 * 新建共享渲染件；StatsSystem 保持零 Phaser 依赖（Node 单测直接跑），行几何
 * 钉在 hudLayout.STATS_PANEL。三个消费者（本场景 / EndgameScene / GameScene
 * 暂停菜单）都 import 它。
 */
export function buildStatsTable(
  scene: Phaser.Scene,
  x: number,
  y: number,
  colW: number,
  rows: readonly StatRow[],
  depth: number,
  columns = GRID_COLS,
): { height: number; objects: PanelObject[] } {
  const pitch = STATS_PANEL.rowPitch;
  const perCol = Math.ceil(rows.length / columns);
  const objects: PanelObject[] = [];
  const add = <T extends PanelObject>(o: T): T => {
    objects.push(o);
    return o;
  };
  for (const [i, row] of rows.entries()) {
    const col = Math.floor(i / perCol);
    const rowInCol = i % perCol;
    const cx0 = x + col * (colW + STATS_PANEL.colGap);
    const cy = y + rowInCol * pitch;
    const record = row.record === true;
    if (record) {
      // 选中带同款语言：整行 wash + 左侧 2px 竖线（buildListRow 的选中语言）。
      add(
        scene.add
          .rectangle(cx0 - 6, cy - 14, colW + 12, pitch - 2, ROLE.accent)
          .setOrigin(0, 0)
          .setAlpha(0.13)
          .setDepth(depth),
      );
      add(scene.add.rectangle(cx0 - 6, cy - 14, 2, pitch - 2, ROLE.accent).setOrigin(0, 0).setDepth(depth + 1));
    }
    add(
      scene.add
        .text(cx0, cy, row.label, {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: record ? hex(TEXT.highlight) : hex(TEXT.dim),
        })
        .setOrigin(0, 0.5)
        .setDepth(depth + 2),
    );
    if (record) {
      // 章钉在标签之后：所有标签都是 4 个全角字（80px @20px），+96 是安全位。
      add(
        scene.add
          .text(cx0 + 96, cy, '新纪录', {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: hex(PALETTE.lightHigh),
          })
          .setOrigin(0, 0.5)
          .setDepth(depth + 3),
      );
    }
    add(
      scene.add
        .text(cx0 + colW, cy, row.value, {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: record ? hex(TEXT.highlight) : hex(TEXT.primary),
        })
        .setOrigin(1, 0.5)
        .setDepth(depth + 2),
    );
  }
  return { height: perCol * pitch, objects };
}

export class EndScene extends Phaser.Scene {
  constructor() {
    super({ key: 'End' });
  }

  create(): void {
    const state = getGame();
    const won = state.status === 'won';
    const { width, height } = this.cameras.main;
    const cx = width / 2;

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
      .rectangle(width / 2, height / 2, width, height, won ? PALETTE.clothDeep : PALETTE.lightDeep)
      .setAlpha(0.26)
      .setDepth(-29);
    this.add.rectangle(width / 2, height / 2, width, height, PALETTE.ink).setAlpha(0.46).setDepth(-28);

    // 结局音效：死亡是警报，幸存是号角。都在 16 色板的情绪位上。
    playSfx(won ? 'goal' : 'alert');

    // ── 大标题 + 死因 ───────────────────────────────────────────────────────
    // The outcome icon sits above the headline, small: it is a stamp, not the
    // subject.
    if (this.textures.exists(won ? ART_BANNER_WIN_KEY : ART_BANNER_LOSE_KEY)) {
      this.add
        .image(cx, 46, won ? ART_BANNER_WIN_KEY : ART_BANNER_LOSE_KEY)
        .setDisplaySize(BANNER_W, BANNER_H)
        .setDepth(2)
        .setAlpha(0.95);
    }
    const headline = won ? '你活了下来' : '你死了';
    this.add
      .text(cx, 122, headline, {
        fontFamily: FONT_FAMILY,
        fontSize: '52px',
        color: won ? hex(PALETTE.clothHigh) : hex(ROLE.danger),
        stroke: hex(PALETTE.ink),
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(3);

    // 死因/标语条：失败分支印「死因：…」，胜利分支印存活标语。前缀随 won
    // 分支切换（QA-4-02：此前「死因：」硬编码，?devwin=1 胜利画面「你活了
    // 下来」下面顶着「死因：旧版第 8 天阈值」）。纯文案分支，数值不动。
    const reason = won ? '存活至第 8 天 · 旧版阈值 · ?devwin=1 夹具' : `死因：${causeOf(state)}`;
    for (const o of buildPanelWell(this, cx - 190, 142, 380, 28, 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    this.add
      .text(cx, 156, reason, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary) })
      .setOrigin(0.5)
      .setDepth(7);

    // ── the card ────────────────────────────────────────────────────────────
    const depth = PANEL_DEPTH.menu.help;
    const left = cx - PANEL_W / 2;
    const top = 190;

    for (const o of buildPanel(this, cx, top + PANEL_H / 2, PANEL_W, PANEL_H, won ? 'green' : 'yellow', depth)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    for (const o of buildPanelHeader(this, left, top, PANEL_W, won ? '这一趟' : '阵亡结算', won ? PALETTE.clothHigh : ROLE.danger, depth + 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }

    // 本局统计表（13 项计数 + 存活天数 + 游戏时长 + 得分，三列网格）。
    const gridX = left + GRID_X_INSET;
    const colW = (PANEL_W - GRID_X_INSET * 2 - STATS_PANEL.colGap * (GRID_COLS - 1)) / GRID_COLS;
    const grid = buildStatsTable(this, gridX, top + GRID_TOP, colW, runStatRows(state), depth + 5);

    // 历史纪录对比：破了的行在统计表同一套行几何里高亮。纪录行更宽（两列），
    // 因为一枚「新纪录」章要别在标签和数值之间。
    const recordsTop = top + GRID_TOP + grid.height + RECORDS_LABEL_GAP;
    const rule = this.add.graphics().setDepth(depth + 5);
    rule.fillStyle(ROLE.line, 0.6);
    rule.fillRect(gridX, recordsTop - 9, PANEL_W - GRID_X_INSET * 2, 1);
    this.add
      .text(gridX, recordsTop + 6, '历史纪录', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(TEXT.dim),
      })
      .setOrigin(0, 0.5)
      .setDepth(depth + 7);
    const settled = settleRun(state);
    const recColW = (PANEL_W - GRID_X_INSET * 2 - STATS_PANEL.colGap) / 2;
    buildStatsTable(this, gridX, recordsTop + RECORDS_TOP, recColW, recordRows(state, settled), depth + 5, 2);

    if (won) {
      this.add
        .text(cx, top + PANEL_H + 18, '正式胜利条件为抵达第 100000 层', {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: hex(TEXT.dim),
        })
        .setOrigin(0.5)
        .setDepth(depth + 7);
    }

    // ── 出口：重新开始 / 返回标题 ───────────────────────────────────────────
    // 两个出口都是铆钉板语言的小井条。Enter = 重新开始（既有语义保留），
    // Esc = 返回标题。返回标题前必须清档：死亡时存档里留着的是 status='lost'
    // 的这一局，不清掉的话标题页「继续游戏」会把玩家送进一张无限的死亡结算。
    const restart = (): void => {
      clearSave();
      startNewGame(Date.now() >>> 0);
      this.scene.start('Game');
    };
    const toTitle = (): void => {
      clearSave();
      this.scene.start('Menu');
    };
    const restartX = cx - BTN_W - BTN_GAP / 2;
    const titleX = cx + BTN_GAP / 2;
    for (const o of buildPanelWell(this, restartX, FOOT_Y, BTN_W, BTN_H, 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    for (const o of buildPanelWell(this, titleX, FOOT_Y, BTN_W, BTN_H, 5)) {
      this.add.existing(o as Phaser.GameObjects.GameObject);
    }
    const restartLabel = this.add
      .text(restartX + BTN_W / 2, FOOT_Y + BTN_H / 2, '重新开始', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.body}px`,
        color: hex(PALETTE.clothHigh),
      })
      .setOrigin(0.5)
      .setDepth(7);
    // Mouse path to the one action this screen has. Same function the key calls,
    // so a click can never drift from the keyboard.
    textClickable(restartLabel, hex(PALETTE.clothHigh), hex(PALETTE.lightHot), { onClick: restart });
    const titleLabel = this.add
      .text(titleX + BTN_W / 2, FOOT_Y + BTN_H / 2, '返回标题', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.body}px`,
        color: hex(TEXT.secondary),
      })
      .setOrigin(0.5)
      .setDepth(7);
    textClickable(titleLabel, hex(TEXT.secondary), hex(PALETTE.lightHigh), { onClick: toTitle });

    this.input.keyboard?.once('keydown-ENTER', restart);
    this.input.keyboard?.once('keydown-ESC', toTitle);
  }
}
