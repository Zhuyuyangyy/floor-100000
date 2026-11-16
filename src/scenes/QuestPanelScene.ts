import Phaser from 'phaser';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { getGame } from '../core/session';
import type { GameState } from '../core/gameTypes';
import { PLAYABLE_SEGMENTS } from '../core/segments';
import { QUEST_FLAG, evaluateAllQuests } from '../data/quests';
import type { QuestEvaluation, QuestStatus } from '../data/quests';
import { hasFlag } from '../systems/WorldFlags';
import { estimateLineHeight, wrapText } from '../render/dialogueLayout';
import { buildListRow, buildPanelHeader, FONT_FAMILY, ROW_H, UI, fontLineBox } from '../render/uiKit';
import { hitRect } from '../render/pointer';
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
 *  高 640（AG-44 从 480 长高）：详情栏最坏流到 538（permit 的五条目标行 +
 *  两条旗标阻塞原因，questPanel.test.ts 的代表态实测，真实行盒），脚注带 34，
 *  余量给 allChosen（每条分支带「已选」后缀，592）与数据生长。面板是全覆盖
 *  场景（自有 ink 底），长高不挤 HUD；questPanel.test.ts 镜像的仍是它自己的
 *  480 模型——那边不断言本面板的真实高度，只断言它模型内的合情理性。 */
export const QUEST_PANEL_W = 940;
export const QUEST_PANEL_H = 640;
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
/** AG-44：目标块与分支块之间的透气。 */
export const QUEST_OBJECTIVE_BRANCH_GAP = 8;
/** AG-44：目标行距。 */
export const QUEST_OBJECTIVE_GAP = 4;

// 详情栏自己的字阶（比 uiKit 的模态字阶密一档）。标题 26、meta/摘要 20、
// 分支 22、阻塞原因 18、目标 18、脚注 18。
const F_TITLE = 26;
const F_META = 20;
const F_SUMMARY = 20;
const F_BRANCH = 22;
const F_BLOCKER = 18;
/** AG-44：目标行与阻塞原因同阶（18）——都是详情栏里的次级信息。 */
const F_OBJECTIVE = 18;
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
  /** AG-44：目标完成度行（✓/○ + 目标文本）。池按数据里最宽的任务长。 */
  private objectiveTexts: Phaser.GameObjects.Text[] = [];
  private branchTexts: Phaser.GameObjects.Text[] = [];
  private blockerTexts: Phaser.GameObjects.Text[] = [];
  private branchBands: Array<{ band: Phaser.GameObjects.Rectangle; rule: Phaser.GameObjects.Rectangle }> = [];
  /** AG-44：分支块的指针命中区。每次 refreshDetail 按块的实际位置/尺寸重建
   *  （见 refreshDetail 开头的说明），不是常驻池。 */
  private branchHits: Phaser.GameObjects.Rectangle[] = [];
  private footText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  /** AG-44：面板 footprint，供「面板外点击 = 关闭」判定。 */
  private panelRect!: { x: number; y: number; w: number; h: number };

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
    // Field initialisers do not re-run on a scene restart, and Phaser DESTROYS
    // every child on shutdown (DisplayList.shutdown calls destroy(true) on
    // each) — close → reopen re-runs create() against the same instance, so
    // the pools must be emptied here or the second open would index into dead
    // objects and render nothing. Same reset GameScene.create() does for its
    // panel arrays (its comment records the 重新开始 variant of this bug).
    this.rowObjects = [];
    this.objectiveTexts = [];
    this.branchTexts = [];
    this.blockerTexts = [];
    this.branchBands = [];
    this.branchHits = [];
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
    // Remembered for the pointer: a click outside this rectangle closes the
    // panel, the same way ESC does (AG-44 的指针交互范式）。
    this.panelRect = { x: left, y: top, w: QUEST_PANEL_W, h: QUEST_PANEL_H };

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

    // AG-44：dev 句柄改由 src/main.ts 统一挂载（__PHASER_QUESTS__），selection /
    // message 两个读数委托到本场景的 devSelection() / devMessage()。修前这里
    // 自己往 window 上挂一份，代价是面板没开过就答不上话、开过关掉后又把陈旧
    // 的 evaluations 留在窗口上；统一挂载后求值永远对活 state 现算。
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

    // AG-44：目标完成度行。与分支文本同一个池化思路——按数据里最宽的任务
    // （3 条目标）长池，refreshDetail 重排、用不到的收起。
    const maxObjectives = Math.max(1, ...this.evaluations.map((e) => e.quest.objectives.length));
    for (let i = 0; i < maxObjectives; i++) {
      this.objectiveTexts.push(
        this.add
          .text(x + QUEST_BRANCH_INSET, 0, '', {
            fontFamily: FONT_FAMILY,
            fontSize: `${F_OBJECTIVE}px`,
            color: hex(TEXT.dim),
            wordWrap: { width: QUEST_BRANCH_W, useAdvancedWrap: true },
          })
          .setOrigin(0, 0)
          .setDepth(DEPTH + 6)
          .setVisible(false),
      );
    }

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
      // AG-44：行的指针命中区。纯点击驱动（不做 hover 选行——指针滑过会
      // 先于 pointerdown 把选择移走，「首击选择、再击执行」会退化成一击直穿，
      // 分支的二击确认也会撞上「已经选过了」）。首击选择该行（从分支模式落回
      // 列表并换任务），再击同一行进入分支模式（等同 Enter）——与 GameScene
      // 合成面板行同一范式；键盘 ↑/↓ + Enter 的原路径不受影响。
      this.rowObjects.push(
        hitRect(this, left + QUEST_PAD, y, QUEST_LIST_W, ROW_H, DEPTH + 7, {
          onClick: () => {
            if (this.mode !== 'list' || this.sel !== i) {
              this.sel = i;
              this.branchSel = 0;
              this.mode = 'list';
              this.refresh();
              playSfx('click');
              return;
            }
            this.onConfirm();
          },
        }),
      );
    });
  }

  private refreshDetail(): void {
    const ev = this.evaluations[this.sel];
    const left = DESIGN_WIDTH / 2 - QUEST_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - QUEST_PANEL_H / 2;
    const x = left + QUEST_DETAIL_X;

    // AG-44：分支命中区每次 refresh 重建（与 refreshList 的行同一范式）——
    // 块高随内容变，而 Phaser 的默认 hitArea 在 setInteractive 时按创建尺寸
    // 定格（setHitAreaFromTexture 跳过零尺寸对象，会留下 hitAreaCallback 为
    // null 的坏输入对象，整个场景的命中测试会在它身上抛异常——行点击全失效
    /// 就是这么来的）。重建即「创建时就是最终尺寸」。
    for (const o of this.branchHits) o.destroy();
    this.branchHits = [];

    this.detailTitle.setText(ev.quest.title);
    // AG-44：meta 行补「目标 n/m」。完成度数据是 objectives 各自的 doneFlag
    // （data/quests.ts 把「这个目标完成了没」写成 WorldFlags 的旗），面板只读。
    const doneCount = ev.quest.objectives.filter((o) => hasFlag(this.state, o.doneFlag)).length;
    this.detailMeta.setText(
      `阶层 ${ev.quest.segment} · ${segmentName(ev.quest.segment)} · ${STATUS_LABEL[ev.status]} · 目标 ${doneCount}/${ev.quest.objectives.length}`,
    );
    this.detailSummary.setText(ev.quest.summary);

    // Vertical flow: title → meta → summary (wrapped) → the objectives block
    // (✓/○ per objective, AG-44) → one block per branch (text wrapped, then
    // its blockers when the branch is greyed out). Every height comes from
    // wrapText on the same widths the Text objects wrap at, so
    // questPanel.test.ts's arithmetic IS this layout.
    const summaryLines = wrapText(ev.quest.summary, QUEST_DETAIL_W, F_SUMMARY).length;
    let y = top + 98 + summaryLines * estimateLineHeight(F_SUMMARY) + 16;
    const limit = top + QUEST_PANEL_H - QUEST_DETAIL_FOOT_H;

    // ── objectives（AG-44）────────────────────────────────────────────────
    // 形状冗余：✓/○ 是文字标记（字体子集里有这两个字形），颜色再分一层
    // （done=highlight、pending=dim）——不依赖单一通道传达「完成/未完成」。
    // 行内起点与分支文本同一缩进，视觉上同属「详情栏里的清单」。
    // 行高取 fontLineBox（GameSans 的实测行盒），不用 estimateLineHeight 的
    // 1.1em 估计——估计值比真实渲染每行低 2px，五条目标行就是 10px 的隐性
    // 溢出；uiKit 对「必须容纳行盒的车道」的既定要求就是这个实测因子。
    ev.quest.objectives.forEach((objective, i) => {
      const text = this.objectiveTexts[i];
      if (!text) return;
      const done = hasFlag(this.state, objective.doneFlag);
      const line = `${done ? '✓ ' : '○ '}${objective.text}`;
      text.setText(line);
      text.setPosition(x + QUEST_BRANCH_INSET, y);
      text.setColor(hex(done ? TEXT.highlight : TEXT.dim));
      text.setVisible(true);
      y += wrapText(line, QUEST_BRANCH_W, F_OBJECTIVE).length * fontLineBox(F_OBJECTIVE) + QUEST_OBJECTIVE_GAP;
    });
    // Objectives past this quest's count stay hidden (the pool is shared).
    for (let i = ev.quest.objectives.length; i < this.objectiveTexts.length; i++) {
      this.objectiveTexts[i]?.setVisible(false);
    }
    y += QUEST_OBJECTIVE_BRANCH_GAP;

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
      // AG-44：分支块的指针命中区，按本块的最终位置与尺寸现建（见方法开头的
      // 重建说明）。纯点击驱动：首击进入 branch 模式并选中该分支（等同 Enter
      // 查看分支），再击确认（等同 branch 模式里的 Enter）——与行、与
      // GameScene 合成面板同一「首击选择、再击执行」范式。
      this.branchHits.push(
        hitRect(this, x + 4, y - 4, QUEST_DETAIL_W - 4, blockH + 8, DEPTH + 8, {
          onClick: () => {
            if (this.mode !== 'branch' || this.branchSel !== b) {
              this.mode = 'branch';
              this.branchSel = b;
              playSfx('click');
              this.refresh();
              return;
            }
            this.commitBranch();
          },
        }),
      );

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
    // AG-44：面板外点击 = 关闭（指针的 Esc）。GameScene 的指针处理器在
    // questsOpen 时直接让位（GameScene.onPointerDown 的早退），所以这里不会
    // 出现「点外面既关面板又派 walkTarget」的双重响应。
    this.input.on('pointerdown', this.onPointerDownOutside, this);
  }

  private onPointerDownOutside(pointer: Phaser.Input.Pointer): void {
    const box = this.panelRect;
    if (!box) return;
    const inside = pointer.x >= box.x && pointer.x <= box.x + box.w && pointer.y >= box.y && pointer.y <= box.y + box.h;
    if (!inside) this.close();
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
    // The scene-level pointer handler: bound per create(), so a restart would
    // stack a second one — same reasoning as the keys above.
    this.input.off('pointerdown', this.onPointerDownOutside, this);
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

  // ── dev 句柄读数（main.ts 的 __PHASER_QUESTS__ 委托到这）───────────────────
  //
  // 面板没在显示时回答「没有选择 / 没有消息」：把上一次的光标位置说成当前
  // 状态会误导探针（AG-32 的用法就是在面板外先问一遍 getSelection）。

  /** 当前选择态；面板未激活时为列表首项的空选择。 */
  devSelection(): { mode: PanelMode; quest: number; branch: number } {
    if (!this.sys.isActive()) return { mode: 'list', quest: 0, branch: 0 };
    return { mode: this.mode, quest: this.sel, branch: this.branchSel };
  }

  /** 当前 transient message 的文本；面板未激活时没有消息可读。 */
  devMessage(): string {
    return this.sys.isActive() ? this.messageText.text : '';
  }
}
