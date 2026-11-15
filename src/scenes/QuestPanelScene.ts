import Phaser from 'phaser';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { getGame } from '../core/session';
import type { GameState } from '../core/gameTypes';
import { PLAYABLE_SEGMENTS } from '../core/segments';
import { QUEST_FLAG, evaluateAllQuests } from '../data/quests';
import type { QuestEvaluation, QuestStatus } from '../data/quests';
import { hasFlag } from '../systems/WorldFlags';
import { estimateLineHeight, wrapText } from '../render/dialogueLayout';
import { buildListRow, buildPanelHeader, FONT_FAMILY, UI } from '../render/uiKit';
import { buildPanel } from '../render/panels';
import type { PanelObject } from '../render/panels';
import { PALETTE, ROLE, TEXT, hex } from '../render/palette.ts';
import { playSfx } from '../render/audio';

// QuestPanelScene — 首章任务链的面板（docs/plans/STORY.md 的数据，UI 在这一层）。
//
// 分工照 data/quests.ts 顶部写好的界线：本场景只读不求值以外的写——
// evaluateAllQuests / evaluateBranch 是 state 的纯函数，面板渲染它们的答案；
// 分支的「后果怎么落地」（setFlag / addItem / homeUpgrades.push / score）是
// 集成层的事，面板把玩家的选择打成 'quests:changed' 事件发给 GameScene
// （契约见 docs/plans/UI.md「任务面板与 quests:changed」一节），自己不碰
// GameState。事件发出后立刻重读求值——同步落地的处理器已经改了 state，
// 面板无需重开就反映后果。
//
// 键位沿用项目既有习惯（TowerOverviewScene / GameScene 暂停菜单）：↑/↓ 选择、
// Enter 打开/确认、Esc 返回/关闭，Phaser 'down' 事件 + 每帧一次的去抖
// （GHI-03 m9：一次队列排空会把一个 keydown 送达多次）。

// ── 布局常量 ────────────────────────────────────────────────────────────────
// 导出供 src/tests/questPanel.test.ts 做算术断言。那个测试不能 import 本模块
// （import Phaser 在 Node 下会炸，见 render/panels.ts 顶部同款注释），所以
// 测试里硬编码同值并注释指向这里——与 uiLayout.test.ts 对塔楼场景 TYPE_* 表
// 的做法一致。

/** 面板 footprint（设计画布 px）。比 460 的模态宽：这一块是「列表 + 详情」双栏。
 *  高 480：详情栏最坏流到 384（questPanel.test.ts 实测六种代表 state 的全量
 *  任务），脚注带 34，余 ~60px 给数据生长。 */
export const QUEST_PANEL_W = 940;
export const QUEST_PANEL_H = 480;
/** 面板边缘 → 列表栏左缘。 */
export const QUEST_PAD = 16;
/** 列表栏宽度：行就按这个宽度建（buildListRow 的 w）。 */
export const QUEST_LIST_W = 340;
/** 第一行的顶，距面板顶（让开 20px 的 header 条）。 */
export const QUEST_LIST_TOP = 44;
/** 行距：ROW_H（26）+ 4px 透气。 */
export const QUEST_ROW_PITCH = 30;
/** 详情栏左缘，距面板左。 */
export const QUEST_DETAIL_X = QUEST_PAD + QUEST_LIST_W + QUEST_PAD;
/** 详情栏文本宽度。 */
export const QUEST_DETAIL_W = QUEST_PANEL_W - QUEST_DETAIL_X - QUEST_PAD;
/** 详情栏里的标记槽：分支/阻塞原因文本从左缘缩进这么多个 px 起排。 */
export const QUEST_BRANCH_INSET = 18;
export const QUEST_BRANCH_W = QUEST_DETAIL_W - QUEST_BRANCH_INSET;
/** 详情栏底部保留带（脚注提示行之上，分支内容不许越过）。 */
export const QUEST_DETAIL_FOOT_H = 34;

// 详情栏自己的字阶（比 uiKit 的模态字阶密一档）。标题 26、meta/摘要 20、
// 分支 22、阻塞原因 18、脚注 18。
const F_TITLE = 26;
const F_META = 20;
const F_SUMMARY = 20;
const F_BRANCH = 22;
const F_BLOCKER = 18;
const F_FOOT = 18;

// 本场景对象的深度。面板自成一家（打开时 Game 要么停要么被它盖住），所以
// 不必挤 PANEL_DEPTH 的表；buildPanel 自带 frame/fill 低于内容的偏移。
const DEPTH = 200;

const STATUS_LABEL: Record<QuestStatus, string> = {
  locked: '未解锁',
  available: '可接取',
  active: '进行中',
  done: '已完成',
};

/** 任务段位的中文名。段与阶层一一对应（docs/18 §2），段名就是阶层名。 */
function segmentName(segment: number): string {
  return PLAYABLE_SEGMENTS.find((s) => s.id === segment)?.name ?? `阶层${segment}`;
}

type PanelMode = 'list' | 'branch';
type NavSlot = 'up' | 'down' | 'enter' | 'esc';

export class QuestPanelScene extends Phaser.Scene {
  private state!: GameState;
  private evaluations: readonly QuestEvaluation[] = [];

  private mode: PanelMode = 'list';
  private sel = 0;
  private branchSel = 0;

  private panelParts!: PanelObject[];
  private dividerGfx!: Phaser.GameObjects.Graphics;
  private rowObjects: PanelObject[] = [];

  private detailTitle!: Phaser.GameObjects.Text;
  private detailMeta!: Phaser.GameObjects.Text;
  private detailSummary!: Phaser.GameObjects.Text;
  private branchTexts: Phaser.GameObjects.Text[] = [];
  private blockerTexts: Phaser.GameObjects.Text[] = [];
  private branchBands: Array<{ band: Phaser.GameObjects.Rectangle; rule: Phaser.GameObjects.Rectangle }> = [];
  private footText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    enter: Phaser.Input.Keyboard.Key;
    esc: Phaser.Input.Keyboard.Key;
  };

  // Per-frame input guard, same as TowerOverviewScene (GHI-03 m9).
  private lastInputFrame: Record<NavSlot, number> = { up: -1, down: -1, enter: -1, esc: -1 };

  constructor() {
    super('QuestPanel');
  }

  create(): void {
    this.lastInputFrame = { up: -1, down: -1, enter: -1, esc: -1 };
    this.state = getGame();
    this.evaluations = evaluateAllQuests(this.state);
    // Open on the quest the player is actually in the middle of: the first
    // active one, else the first they could take, else the top of the list.
    // Deterministic — no clock, no randomness.
    const firstActive = this.evaluations.findIndex((e) => e.status === 'active');
    const firstAvailable = this.evaluations.findIndex((e) => e.status === 'available');
    this.sel = firstActive >= 0 ? firstActive : firstAvailable >= 0 ? firstAvailable : 0;
    this.mode = 'list';
    this.branchSel = 0;

    this.cameras.main.setBackgroundColor(PALETTE.ink);

    const cx = DESIGN_WIDTH / 2;
    const cy = DESIGN_HEIGHT / 2;
    const left = cx - QUEST_PANEL_W / 2;
    const top = cy - QUEST_PANEL_H / 2;

    this.panelParts = buildPanel(this, cx, cy, QUEST_PANEL_W, QUEST_PANEL_H, 'green', DEPTH);
    this.panelParts.push(...buildPanelHeader(this, left, top, QUEST_PANEL_W, '任务', UI.good, DEPTH + 5));

    // A 1px hairline between the two columns: the list is a list and the
    // detail is prose, and without the rule they read as one ragged column.
    this.dividerGfx = this.add.graphics().setDepth(DEPTH + 1);
    this.dividerGfx.fillStyle(UI.line, 0.5);
    this.dividerGfx.fillRect(left + QUEST_DETAIL_X - 8, top + 34, 1, QUEST_PANEL_H - 62);

    this.buildDetailObjects(left, top);
    this.bindInput();
    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unbindInput();
    });

    // Dev-only handle so Playwright (and AG-11's e2e) can assert on the real
    // evaluations, the selection and the transient message instead of pixels.
    if (import.meta.env.DEV) {
      (window as unknown as { __PHASER_QUESTS__?: unknown }).__PHASER_QUESTS__ = {
        getEvaluations: () => this.evaluations,
        getSelection: () => ({ mode: this.mode, quest: this.sel, branch: this.branchSel }),
        getMessage: () => this.messageText.text,
      };
    }
  }

  // ── building ───────────────────────────────────────────────────────────────

  // The detail column is a fixed pool, re-placed on every refresh: the widest
  // quest (same-pen) has four branches, and the pool is sized from the data so
  // a quest that grows a fifth branch grows the pool with it rather than
  // silently dropping it.
  private buildDetailObjects(left: number, top: number): void {
    const x = left + QUEST_DETAIL_X;
    this.detailTitle = this.add
      .text(x, top + 40, '', { fontFamily: FONT_FAMILY, fontSize: `${F_TITLE}px`, color: hex(PALETTE.lightHigh) })
      .setOrigin(0, 0)
      .setDepth(DEPTH + 6);
    this.detailMeta = this.add
      .text(x, top + 72, '', { fontFamily: FONT_FAMILY, fontSize: `${F_META}px`, color: hex(TEXT.highlight) })
      .setOrigin(0, 0)
      .setDepth(DEPTH + 6);
    this.detailSummary = this.add
      .text(x, top + 98, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${F_SUMMARY}px`,
        color: hex(TEXT.primary),
        wordWrap: { width: QUEST_DETAIL_W, useAdvancedWrap: true },
      })
      .setOrigin(0, 0)
      .setDepth(DEPTH + 6);

    const maxBranches = Math.max(1, ...this.evaluations.map((e) => e.quest.branches.length));
    for (let i = 0; i < maxBranches; i++) {
      this.branchTexts.push(
        this.add
          .text(x + QUEST_BRANCH_INSET, 0, '', {
            fontFamily: FONT_FAMILY,
            fontSize: `${F_BRANCH}px`,
            color: hex(TEXT.primary),
            wordWrap: { width: QUEST_BRANCH_W, useAdvancedWrap: true },
          })
          .setOrigin(0, 0)
          .setDepth(DEPTH + 6),
      );
      this.blockerTexts.push(
        this.add
          .text(x + QUEST_BRANCH_INSET, 0, '', {
            fontFamily: FONT_FAMILY,
            fontSize: `${F_BLOCKER}px`,
            color: hex(ROLE.danger),
            wordWrap: { width: QUEST_BRANCH_W, useAdvancedWrap: true },
          })
          .setOrigin(0, 0)
          .setDepth(DEPTH + 6)
          .setVisible(false),
      );
      // Selection band behind the focused branch block, mirroring
      // buildListRow's wash + accent rule (the block is multi-line, so it is
      // sized from the block's own wrapped height rather than ROW_H).
      const band = this.add
        .rectangle(x + 4, 0, QUEST_DETAIL_W - 4, 0, UI.accent)
        .setOrigin(0, 0)
        .setAlpha(0.13)
        .setDepth(DEPTH + 4)
        .setVisible(false);
      const rule = this.add
        .rectangle(x + 4, 0, 2, 0, UI.accent)
        .setOrigin(0, 0)
        .setDepth(DEPTH + 5)
        .setVisible(false);
      this.branchBands.push({ band, rule });
    }

    this.footText = this.add
      .text(x, top + QUEST_PANEL_H - 26, '', { fontFamily: FONT_FAMILY, fontSize: `${F_FOOT}px`, color: hex(TEXT.secondary) })
      .setOrigin(0, 0)
      .setDepth(DEPTH + 6);
    this.messageText = this.add
      .text(left + QUEST_PANEL_W / 2, top + QUEST_PANEL_H - 52, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${F_META}px`,
        color: hex(TEXT.warn),
        backgroundColor: '#0b0f12cc',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH + 7)
      .setVisible(false);
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private refresh(): void {
    this.refreshList();
    this.refreshDetail();
    this.footText.setText(
      this.mode === 'list' ? '↑/↓ 选择 · Enter 查看分支 · Esc 关闭' : '↑/↓ 选择分支 · Enter 确认 · Esc 返回列表',
    );
  }

  // The rows are rebuilt on each cursor move, the same way GameScene's shop
  // panel rebuilds: buildListRow only draws its selection band when the row is
  // the selected one, and 8 rows x 4 objects per keypress is cheaper than a
  // second bookkeeping pass over per-row colour state.
  private refreshList(): void {
    for (const o of this.rowObjects) o.destroy();
    this.rowObjects = [];
    const left = DESIGN_WIDTH / 2 - QUEST_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - QUEST_PANEL_H / 2;
    this.evaluations.forEach((ev, i) => {
      const y = top + QUEST_LIST_TOP + i * QUEST_ROW_PITCH;
      // locked / done rows go dim through buildListRow's own dim colour; the
      // status word carries the state either way, so colour is reinforcement
      // rather than the only signal.
      const settled = ev.status === 'locked' || ev.status === 'done';
      this.rowObjects.push(
        ...buildListRow(this, left + QUEST_PAD, y, QUEST_LIST_W, DEPTH + 5, {
          label: ev.quest.title,
          value: `阶层${ev.quest.segment} · ${STATUS_LABEL[ev.status]}`,
          selected: i === this.sel,
          dim: settled,
        }),
      );
    });
  }

  private refreshDetail(): void {
    const ev = this.evaluations[this.sel];
    const left = DESIGN_WIDTH / 2 - QUEST_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - QUEST_PANEL_H / 2;
    const x = left + QUEST_DETAIL_X;

    this.detailTitle.setText(ev.quest.title);
    this.detailMeta.setText(`阶层 ${ev.quest.segment} · ${segmentName(ev.quest.segment)} · ${STATUS_LABEL[ev.status]}`);
    this.detailSummary.setText(ev.quest.summary);

    // Vertical flow: title → meta → summary (wrapped) → one block per branch
    // (text wrapped, then its blockers when the branch is greyed out). Every
    // height comes from wrapText on the same widths the Text objects wrap at,
    // so questPanel.test.ts's arithmetic IS this layout.
    const summaryLines = wrapText(ev.quest.summary, QUEST_DETAIL_W, F_SUMMARY).length;
    let y = top + 98 + summaryLines * estimateLineHeight(F_SUMMARY) + 16;
    const limit = top + QUEST_PANEL_H - QUEST_DETAIL_FOOT_H;

    ev.quest.branches.forEach((branch, b) => {
      const chosen = hasFlag(this.state, QUEST_FLAG.branch(ev.quest.id, branch.id));
      const text = this.branchTexts[b];
      const blocker = this.blockerTexts[b];
      const { band, rule } = this.branchBands[b];
      if (!text) return;

      const evaluation = ev.branches[b];
      const label = chosen ? `${branch.text}（已选）` : branch.text;
      text.setText(label);
      text.setPosition(x + QUEST_BRANCH_INSET, y);
      // Blocked branches read as disabled; a chosen one keeps the highlight
      // even if its requirements have since lapsed — the path taken is history.
      text.setColor(hex(chosen ? TEXT.highlight : evaluation.available ? TEXT.primary : TEXT.disabled));

      const textLines = wrapText(label, QUEST_BRANCH_W, F_BRANCH).length;
      let blockH = textLines * estimateLineHeight(F_BRANCH);
      if (evaluation.available || evaluation.blockers.length === 0) {
        blocker.setVisible(false);
      } else {
        const reason = evaluation.blockers.join(' · ');
        blocker.setText(reason);
        blocker.setPosition(x + QUEST_BRANCH_INSET, y + blockH + 2);
        blocker.setVisible(true);
        blockH += 2 + wrapText(reason, QUEST_BRANCH_W, F_BLOCKER).length * estimateLineHeight(F_BLOCKER);
      }

      const selected = this.mode === 'branch' && b === this.branchSel;
      band.setPosition(x + 4, y - 4).setDisplaySize(QUEST_DETAIL_W - 4, blockH + 8).setVisible(selected);
      rule.setPosition(x + 4, y - 4).setDisplaySize(2, blockH + 8).setVisible(selected);

      y += blockH + 10;
    });

    // Branches past this quest's count stay hidden (the pool is shared).
    for (let b = ev.quest.branches.length; b < this.branchTexts.length; b++) {
      this.branchTexts[b]?.setVisible(false);
      this.blockerTexts[b]?.setVisible(false);
      this.branchBands[b]?.band.setVisible(false);
      this.branchBands[b]?.rule.setVisible(false);
    }
    ev.quest.branches.forEach((_, b) => this.branchTexts[b]?.setVisible(true));

    if (y > limit) {
      // Layout guard, not a silent clamp: the arithmetic in
      // questPanel.test.ts is what keeps this from ever firing. If it does,
      // the panel grew past its card and the test that predicted the fit is
      // the thing to fix.
      console.warn(`QuestPanel: detail column overflow (${Math.round(y - limit)}px past the card)`);
    }
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private accept(slot: NavSlot): boolean {
    const frame = this.game.getFrame();
    if (this.lastInputFrame[slot] === frame) return false;
    this.lastInputFrame[slot] = frame;
    return true;
  }

  private bindInput(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = {
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        enter: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
        esc: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      };
      this.keys.up.on('down', () => this.onArrow(-1), this);
      this.keys.down.on('down', () => this.onArrow(1), this);
      this.keys.enter.on('down', this.onConfirm, this);
      this.keys.esc.on('down', this.onBack, this);
    }
  }

  private unbindInput(): void {
    // removeAllListeners per key rather than off(): the handlers above are
    // closures, and Phaser does not re-run field initialisers on a scene
    // restart — addKey() hands back the same Key object, so a restart would
    // otherwise stack a second set of listeners on it.
    if (this.keys) {
      this.keys.up?.removeAllListeners();
      this.keys.down?.removeAllListeners();
      this.keys.enter?.removeAllListeners();
      this.keys.esc?.removeAllListeners();
    }
  }

  private onArrow(delta: number): void {
    if (!this.accept(delta < 0 ? 'up' : 'down')) return;
    if (this.mode === 'list') {
      const next = Phaser.Math.Clamp(this.sel + delta, 0, this.evaluations.length - 1);
      if (next === this.sel) return;
      this.sel = next;
      this.branchSel = 0;
    } else {
      const count = this.evaluations[this.sel].quest.branches.length;
      this.branchSel = Phaser.Math.Clamp(this.branchSel + delta, 0, count - 1);
    }
    this.refresh();
  }

  private onConfirm(): void {
    if (!this.accept('enter')) return;
    if (this.mode === 'list') {
      this.mode = 'branch';
      this.branchSel = 0;
      playSfx('click');
      this.refresh();
      return;
    }
    this.commitBranch();
  }

  private onBack(): void {
    if (!this.accept('esc')) return;
    if (this.mode === 'branch') {
      this.mode = 'list';
      this.refresh();
      return;
    }
    this.close();
  }

  // ── the event contract ────────────────────────────────────────────────────
  // Emitted on the GAME scene's emitter (this.scene.get('Game').events), NOT
  // on this scene's: GameScene listens for it whether it is running beneath
  // an overlay launch or stopped behind a handoff start — scene events live
  // on the Scene object, not on its running state. Payload and integration
  // duties are documented in docs/plans/UI.md.
  private commitBranch(): void {
    const ev = this.evaluations[this.sel];
    const branch = ev.quest.branches[this.branchSel];
    const evaluation = ev.branches[this.branchSel];
    if (!branch || !evaluation) return;

    if (ev.status === 'done') {
      this.showMessage('任务已完成，分支不可更改');
      return;
    }
    if (hasFlag(this.state, QUEST_FLAG.branch(ev.quest.id, branch.id))) {
      this.showMessage('这条分支已经选过了');
      return;
    }
    if (!evaluation.available) {
      // The blockers are already printed under the branch; Enter spells them
      // out in one line so the refusal is never a silent no-op.
      this.showMessage(evaluation.blockers.join(' · '));
      return;
    }

    playSfx('click');
    this.scene.get('Game')?.events.emit('quests:changed', { questId: ev.quest.id, branchId: branch.id });
    // Re-read the pure evaluation: a synchronous integration handler has
    // already applied the consequences, so the panel shows them (and the
    // 已选 mark) without being reopened.
    this.evaluations = evaluateAllQuests(this.state);
    this.refresh();
    this.showMessage(`已记录：${branch.text}`);
  }

  /**
   * Close the panel, whichever way it was opened.
   *
   * Overlay (launch): the game is still active beneath — stopping this scene
   * gets out of its way. Launched over a paused game: resume it first, or the
   * player comes back to a frozen run. Handoff (start, the way
   * TowerOverviewScene is opened): the game was stopped, so bring it back —
   * create() re-runs against the same module-level GameState, which is also
   * how a quest HUD picks up any change made while the panel was open.
   */
  private close(): void {
    const manager = this.scene;
    if (manager.isActive('Game')) {
      manager.stop();
    } else if (manager.isPaused('Game')) {
      manager.resume('Game');
      manager.stop();
    } else {
      manager.start('Game');
    }
  }

  private showMessage(text: string): void {
    this.messageText.setText(text).setVisible(true);
    this.time.delayedCall(2200, () => this.messageText.setVisible(false));
  }
}
