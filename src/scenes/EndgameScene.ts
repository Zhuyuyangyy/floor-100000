import Phaser from 'phaser';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { getGame } from '../core/session';
import type { GameState } from '../core/gameTypes';
import { QUEST_FLAG, STORY_FLAGS, evaluateAllQuests } from '../data/quests';
import type { QuestBranch, QuestEvaluation } from '../data/quests';
import { clearFlag, hasFlag, setFlag } from '../systems/WorldFlags';
import { addItem, removeItem } from '../systems/InventorySystem';
import { saveToStorage } from '../systems/SaveSystem';
import { recordRows, runStatRows, settleRun } from '../systems/StatsSystem';
import { estimateLineHeight, wrapText } from '../render/dialogueLayout';
import { buildPanelHeader, FONT_FAMILY, TYPE, UI } from '../render/uiKit';
import { buildPanel } from '../render/panels';
import type { PanelAccent } from '../render/panels';
import { PALETTE, ROLE, TEXT, hex } from '../render/palette.ts';
import { playSfx } from '../render/audio';
import { STATS_PANEL } from '../render/hudLayout';
import { buildStatsTable } from './EndScene';

// EndgameScene — 阶层 6「统治核心」的终局演出（100000 层，Q6 `same-pen`）。
//
// 分工照 quests.ts 顶部与 STORY.md §7 写好的界线：本场景读
// evaluateAllQuests(state) 的纯函数答案来呈现分支（可得性、阻塞原因全部来自
// QuestCondition 的真实条件，不硬编码），玩家确认后由**本场景**按
// QuestConsequence 的 kind 逐类落地（setFlag/clearFlag/giveItem/takeItem/
// grantPass/score）——终局是集成层自己，不像 QuestPanel 那样发事件给
// GameScene：Q6 的后果（story:ending.*）落盘即终局，没有第二个消费者。
//
// 入口契约（AG-20 的接线依据）见 docs/plans/FINALE_UX.md：
//   scene.start('Endgame', { from: 'terminal' | 'archive' | 'fuse' })
// 三个入口对应 100000 层的三个容器：终端台（Q6 抉择）、档案柜（读三张表）、
// 配电箱（shutdown 的物理动作点）。出口一律 scene.start('Game')——handoff
// 语义，Game.create() 对同一份模块级 GameState 重跑，落地过的 flag/分数/
// 物品自然被读回（同 TowerOverviewScene 的打开方式）。
//
// 键位沿用 QuestPanelScene：↑/↓ 选择、Enter 确认/继续、Esc 离开/返回，
// Phaser 'down' 事件 + 每帧一次去抖（GHI-03 m9：一次队列排空会把一个
// keydown 送达多次）。

// ── 布局常量 ────────────────────────────────────────────────────────────────
// 导出供 src/tests/endgame.test.ts 做算术断言。那个测试不能 import 本模块
// （import Phaser 在 Node 下会炸，同 questPanel.test.ts 顶部注释），所以测试
// 里硬编码同值并注释指向这里。

/** 面板 footprint（设计画布 px）。终局是单栏大卡：四分支或一结局一幕。 */
export const ENDGAME_PANEL_W = 760;
export const ENDGAME_PANEL_H = 560;
/** 面板边缘 → 内容左缘。 */
export const ENDGAME_PAD = 20;
/** 内容宽度（分支行、演出行都按它包行）。 */
export const ENDGAME_TEXT_W = ENDGAME_PANEL_W - ENDGAME_PAD * 2;
/** 头部条之下，正文第一行的顶，距面板顶。 */
export const ENDGAME_BODY_TOP = 44;
/** 底部保留带：脚注提示行之带，内容不许越过。 */
export const ENDGAME_FOOT_H = 34;

// 本场景对象的深度。面板自成一家（handoff 后 Game 已停），不挤 PANEL_DEPTH
// 的表；buildPanel 自带 frame/fill 低于内容的偏移。
const DEPTH = 200;

// 字阶。标题走 TYPE.title（30），正文 TYPE.body（24），小字 TYPE.caption（20）；
// 结局大标题 44 是全场唯一的大字——终局配得上一个比面板标题大的字。
const F_BIG = 44;
const F_FOOT = 18;

/** choice 模式一条分支块的块间距（文本底 → 下一块顶）。 */
const BRANCH_GAP = 12;
/** 分支文本底 → 阻塞原因顶的间隙。 */
const BLOCKER_GAP = 2;

// ── 入口与模式 ──────────────────────────────────────────────────────────────

/** AG-20 传来的入口：100000 层哪个容器把玩家送进来的。 */
export type EndgameFrom = 'terminal' | 'archive' | 'fuse';

export interface EndgameEntry {
  readonly from?: EndgameFrom;
}

export type EndgameMode =
  | 'prologue' // 终端独白（terminal 入口）
  | 'tables' // 档案柜读三张表（archive 入口）
  | 'switch' // 配电箱总闸（fuse 入口）
  | 'choice' // 四分支选择
  | 'confirm' // 单分支确认（终局不可回头）
  | 'ending' // 结局演出
  | 'epilogue' // 结算
  | 'settled'; // 终局已定后的任何入口

/** Q6 的四个结局 id，与 quests.ts same-pen 的 branch id 逐字一致。 */
export type EndingId = 'shutdown' | 'hand-over' | 'throne' | 'walk-away';

/** 四个 ending flag。任一已落 = 终局已定（settled 的判据，也是幂等守卫）。 */
export const ENDING_FLAGS: readonly string[] = [
  STORY_FLAGS.endingShutdown,
  STORY_FLAGS.endingHandOver,
  STORY_FLAGS.endingThrone,
  STORY_FLAGS.endingWalkAway,
];

// ── 四结局演出稿 ────────────────────────────────────────────────────────────
// 每个结局是独立画面：自己的标题、正文、色调与节奏（STORY.md §5 的核心终端
// 台词 + branch.detail）。调子四样：shutdown 是黑（关掉它）、throne 是金
// （坐上它）、hand-over 是青（交回底层）、walk-away 是石灰（下楼）。
// route 是 GAME_DESIGN_LOCK.md §6 的路线映射（STORY.md Q6 详卡同表）。

interface EndingScript {
  readonly title: string;
  /** settled 态的一句话收尾（终局已定后重访终端/档案柜/配电箱时显示）。 */
  readonly coda: string;
  /** 路线映射，epilogue 展示。 */
  readonly route: string;
  /** 全屏色调（矩形，画在面板后面当背景）。 */
  readonly wash: number;
  readonly washAlpha: number;
  readonly titleColor: number;
  readonly panel: PanelAccent;
  /** 演出正文，逐行 fade-in。 */
  readonly lines: readonly string[];
}

export const ENDINGS: Record<EndingId, EndingScript> = {
  shutdown: {
    title: '关上它',
    coda: '塔已经黑了。从一楼开始，一级一级暗下去的。',
    route: 'C / D · 掀桌子，塔黑掉',
    wash: PALETTE.ink,
    washAlpha: 0.55,
    titleColor: PALETTE.lightHot,
    panel: 'yellow',
    lines: [
      '你按下确认。终端把整座塔的供电，放进了你手里。',
      '你走到配电箱前，拉下总闸。',
      '配电房的灯一颗颗灭掉。从一楼开始。',
      '周三、周五从此只是一个日子。',
      '塔还在。只是再也不按表停电了。',
    ],
  },
  'hand-over': {
    title: '交回底层',
    coda: '笔交给了底层。后面的事，与他们有关了。',
    route: 'C · 底层起义的物质基础',
    wash: PALETTE.clothDeep,
    washAlpha: 0.34,
    titleColor: PALETTE.clothHigh,
    panel: 'green',
    lines: [
      '账本、签字页、处决名单。你一页一页，交给了最开始就在底层的人。',
      '停电表、配给表、处决名单，是同一支笔写的——',
      '现在，拿到笔的人，换成了他们。',
      '钥匙留在终端上。塔的命运，从此由住在一楼的人决定。',
    ],
  },
  throne: {
    title: '坐上它',
    coda: '椅子坐着你呢。终端不再说话，像一名称职的雇员。',
    route: 'A / D · 你本就是系统的一部分',
    wash: PALETTE.lightDeep,
    washAlpha: 0.3,
    titleColor: PALETTE.lightHigh,
    panel: 'yellow',
    lines: [
      '椅子是空的，也是为你留的。',
      '编号也好，请柬也好，后门也好——路早就选过了。',
      '你坐下。终端安静下来，像一名称职的雇员。',
      '从明天起，停电表由你来签。',
      '笔还是那支笔。写什么的，换成了你。',
    ],
  },
  'walk-away': {
    title: '转身下楼',
    coda: '你已经在下楼的某一级台阶上。塔还是塔。',
    route: 'B · 独立者不坐这把椅子',
    wash: PALETTE.shadow,
    washAlpha: 0.5,
    titleColor: PALETTE.dust,
    panel: 'green',
    lines: [
      '你把权限卡在终端上，一级一级走下楼。',
      '塔还是塔。周三照旧停电，配给照旧发放。',
      '笔还在桌上，名单还会变长。',
      '你一级一级走下去，从此不提这件事。',
    ],
  },
};

// ── 档案柜的三张表（archive 入口；纸条 T6-2「同一支笔」的现场）──────────────

export const TABLE_PAGES: readonly {
  readonly title: string;
  readonly body: readonly string[];
  readonly aside: string;
}[] = [
  {
    title: '停电表',
    body: ['周三 · 周五 00:00–06:00，底层全区停电。', '执行：配给调度。签字：核心办公室。'],
    aside: '你在 4 层配电房抄过这张表。字迹一样。',
  },
  {
    title: '配给表',
    body: ['第七批：口粮 0.6 份/人/日；净水改接配给主线。', '签字：核心办公室。'],
    aside: '5 层食堂墙上被划掉的名字，走了一半。',
  },
  {
    title: '处决名单',
    body: ['编号、罪名、日期。一页一页，一支笔。'],
    aside: '三张表并排看：同一支笔写的。',
  },
];

// ── 核心终端独白（prologue；STORY.md §5 的 core_terminal 台词）─────────────

export const PROLOGUE_LINES: readonly string[] = [
  '权限已移交。',
  '停电表、配给表、处决名单，同一支笔。',
  '钥匙在你手里——现在你也是这套系统的一部分。',
  '三张表并排摆着：停电表、配给表、处决名单。',
  '你要么关上它，要么坐上它。',
];

/** choice 模式标题下的两行定场（STORY.md Q6 详卡：「终局不是四个按钮」）。 */
export const CHOICE_INTRO: readonly string[] = [
  '钥匙在你手里。现在你也是这套系统的一部分。',
  '终局不是四个按钮，是六个阶层攒出来的账。',
];

/** 每种模式脚注带里的一行键位提示。 */
export const FOOT_LABELS: Record<EndgameMode, string> = {
  prologue: 'Enter 继续 · Esc 离开',
  tables: 'Enter 翻页 · Esc 离开',
  switch: 'Enter 拉闸 · Esc 离开',
  choice: '↑/↓ 选择 · Enter 确认 · Esc 离开',
  confirm: 'Enter 确认，不可回头 · Esc 返回',
  ending: 'Enter 继续',
  epilogue: 'Enter 回到塔楼',
  settled: 'Esc 回到塔楼',
};

const STATUS_LABEL: Record<string, string> = {
  locked: '未解锁',
  available: '可接取',
  active: '进行中',
  done: '已完成',
};

type NavSlot = 'up' | 'down' | 'enter' | 'esc';

export class EndgameScene extends Phaser.Scene {
  private state!: GameState;
  private evaluation!: QuestEvaluation;

  private entry: EndgameFrom = 'terminal';
  private mode: EndgameMode = 'prologue';

  /** choice 模式的选中分支索引；confirm 时记着被确认的分支。 */
  private sel = 0;
  private pendingBranch: QuestBranch | null = null;
  /** 已确认落地的结局（ending/epilogue 用）。 */
  private ending: EndingId | null = null;
  private scoreDelta = 0;

  /** prologue 已翻到第几行（0 起）；tables 已翻到第几张表。 */
  private prologueLine = 0;
  private tablePage = 0;

  /** ending 模式已揭到第几行演出文字。 */
  private revealed = 0;
  private revealTimers: Phaser.Time.TimerEvent[] = [];

  /** 每种模式的对象池，切模式时整池销毁重建（终局切换少，重建比复用便宜）。 */
  private modeObjects: Phaser.GameObjects.GameObject[] = [];
  private footText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer: Phaser.Time.TimerEvent | null = null;

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    enter: Phaser.Input.Keyboard.Key;
    esc: Phaser.Input.Keyboard.Key;
  };

  // Per-frame input guard, same as QuestPanelScene (GHI-03 m9).
  private lastInputFrame: Record<NavSlot, number> = { up: -1, down: -1, enter: -1, esc: -1 };

  constructor() {
    super('Endgame');
  }

  init(data?: EndgameEntry): void {
    this.entry = data?.from ?? 'terminal';
  }

  create(): void {
    this.lastInputFrame = { up: -1, down: -1, enter: -1, esc: -1 };
    this.state = getGame();
    this.evaluation = evaluateAllQuests(this.state).find((e) => e.quest.id === 'same-pen')!;
    this.sel = 0;
    this.pendingBranch = null;
    this.ending = null;
    this.scoreDelta = 0;
    this.revealed = 0;

    this.cameras.main.setBackgroundColor(PALETTE.ink);

    const takenEnding = this.takenEnding();
    if (takenEnding) {
      // 终局已定（含从任务面板走 quests:changed 落地的情况）：任何入口都只
      // 显示历史结局，不重复演出、不重复落地。
      this.mode = 'settled';
    } else if (this.entry === 'archive') {
      this.mode = 'tables';
      this.tablePage = 0;
    } else if (this.entry === 'fuse') {
      this.mode = 'switch';
      // 总闸前站着的是 already 拿到权限的人：三个事实都在这一屏上，按
      // STORY.md §7「doneFlag 由集成层（玩法过程）写入」记下 key/pen。
      this.writeObjective('key');
      this.writeObjective('pen');
    } else {
      this.mode = 'prologue';
      this.prologueLine = 0;
    }

    this.footText = this.add
      .text(0, 0, '', { fontFamily: FONT_FAMILY, fontSize: `${F_FOOT}px`, color: hex(TEXT.secondary) })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH + 7);
    this.messageText = this.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(TEXT.warn),
        backgroundColor: '#0b0f12cc',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH + 8)
      .setVisible(false);

    this.bindInput();
    this.buildMode();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearRevealTimers();
      this.messageTimer?.remove(false);
      this.unbindInput();
    });

    // Dev-only handle so Playwright (and AG-17's e2e) can assert on the real
    // mode machine, the chosen ending and the transient message instead of
    // pixels. Mirrors __PHASER_QUESTS__.
    if (import.meta.env.DEV) {
      (window as unknown as { __PHASER_ENDGAME__?: unknown }).__PHASER_ENDGAME__ = {
        getMode: () => this.mode,
        getEntry: () => this.entry,
        getEnding: () => this.ending,
        getSelection: () => this.sel,
        getMessage: () => this.messageText.text,
      };
    }
  }

  // ── 模式机 ────────────────────────────────────────────────────────────────

  private enterMode(mode: EndgameMode): void {
    this.mode = mode;
    this.buildMode();
  }

  /** 切模式：销毁上一池对象、取消未揭完的演出计时器，重建本模式。 */
  private buildMode(): void {
    for (const o of this.modeObjects) o.destroy();
    this.modeObjects = [];
    this.clearRevealTimers();
    this.hideMessage();

    switch (this.mode) {
      case 'prologue':
        this.buildPrologue();
        break;
      case 'tables':
        this.buildTables();
        break;
      case 'switch':
        this.buildSwitch();
        break;
      case 'choice':
        this.buildChoice();
        break;
      case 'confirm':
        this.buildConfirm();
        break;
      case 'ending':
        this.buildEnding();
        break;
      case 'epilogue':
        this.buildEpilogue();
        break;
      case 'settled':
        this.buildSettled();
        break;
    }
    this.refreshFoot();
  }

  private refreshFoot(): void {
    const left = DESIGN_WIDTH / 2 - ENDGAME_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    this.footText.setText(FOOT_LABELS[this.mode]);
    this.footText.setPosition(left + ENDGAME_PANEL_W / 2, top + ENDGAME_PANEL_H - 18).setVisible(true);
    // 瞬态消息（阻塞原因等）挂在脚注上方一行的中央带，同 QuestPanel。
    this.messageText.setPosition(left + ENDGAME_PANEL_W / 2, top + ENDGAME_PANEL_H - 42);
  }

  // ── 各模式的建造 ──────────────────────────────────────────────────────────

  private addObject<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.modeObjects.push(o);
    return o;
  }

  private addText(
    x: number,
    y: number,
    text: string,
    size: number,
    color: string,
    origin: { x: number; y: number },
    wrapW?: number,
  ): Phaser.GameObjects.Text {
    return this.addObject(
      this.add
        .text(x, y, text, {
          fontFamily: FONT_FAMILY,
          fontSize: `${size}px`,
          color,
          ...(wrapW ? { wordWrap: { width: wrapW, useAdvancedWrap: true } } : {}),
        })
        .setOrigin(origin.x, origin.y)
        .setDepth(DEPTH + 6),
    );
  }

  /** 面板 + 头部条。ending 模式自己排版（大标题），不套这个头。 */
  private buildChrome(accent: PanelAccent, header: string, accentColor: number): void {
    const cx = DESIGN_WIDTH / 2;
    const cy = DESIGN_HEIGHT / 2;
    const left = cx - ENDGAME_PANEL_W / 2;
    const top = cy - ENDGAME_PANEL_H / 2;
    for (const o of buildPanel(this, cx, cy, ENDGAME_PANEL_W, ENDGAME_PANEL_H, accent, DEPTH)) {
      this.addObject(o);
    }
    for (const o of buildPanelHeader(this, left, top, ENDGAME_PANEL_W, header, accentColor, DEPTH + 5)) {
      this.addObject(o);
    }
  }

  private buildPrologue(): void {
    this.buildChrome('green', '核心终端 · 第 100000 层', UI.good);
    const left = DESIGN_WIDTH / 2 - ENDGAME_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    const x = left + ENDGAME_PAD;
    // 独白一行一行揭：Enter 翻一行，翻到倒数第二行时记 key、最后一行前记 pen
    // （玩法过程写 objective doneFlag，见 FINALE_UX.md §3.1）。
    let y = top + ENDGAME_BODY_TOP + 30;
    for (let i = 0; i <= this.prologueLine && i < PROLOGUE_LINES.length; i++) {
      this.addText(x, y, PROLOGUE_LINES[i], TYPE.body, hex(TEXT.primary), { x: 0, y: 0 }, ENDGAME_TEXT_W);
      y += estimateLineHeight(TYPE.body) + 14;
    }
    if (this.prologueLine >= 2) this.writeObjective('key');
    if (this.prologueLine >= 3) this.writeObjective('pen');
    // 一个呼吸点：终端还通着电，光标一样的光标位。
    this.addText(x, y + 10, '▍', TYPE.body, hex(UI.good), { x: 0, y: 0 });
  }

  private buildTables(): void {
    this.buildChrome('yellow', `档案柜 · 三张表（${this.tablePage + 1}/${TABLE_PAGES.length}）`, UI.accent);
    const left = DESIGN_WIDTH / 2 - ENDGAME_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    const x = left + ENDGAME_PAD;
    const page = TABLE_PAGES[this.tablePage];

    let y = top + ENDGAME_BODY_TOP + 20;
    this.addText(x, y, page.title, TYPE.title, hex(TEXT.highlight), { x: 0, y: 0 });
    y += estimateLineHeight(TYPE.title) + 18;
    for (const line of page.body) {
      const lines = wrapText(line, ENDGAME_TEXT_W, TYPE.body).length;
      this.addText(x, y, line, TYPE.body, hex(TEXT.primary), { x: 0, y: 0 }, ENDGAME_TEXT_W);
      y += lines * estimateLineHeight(TYPE.body) + 10;
    }
    y += 16;
    // 旁注：这张表与玩家爬过的哪一层对得上——三张表因此是证据，不是背景。
    const asideLines = wrapText(page.aside, ENDGAME_TEXT_W, TYPE.caption).length;
    this.addText(x, y, page.aside, TYPE.caption, hex(TEXT.secondary), { x: 0, y: 0 }, ENDGAME_TEXT_W);
    y += asideLines * estimateLineHeight(TYPE.caption) + 24;

    if (this.tablePage === TABLE_PAGES.length - 1) {
      this.addText(x, y, '同一支笔。三种纸。', TYPE.body, hex(UI.accent), { x: 0, y: 0 });
      // 读毕三张表 = Q6 目标 pen（把三张表并排看）。
      this.writeObjective('pen');
    }
  }

  private buildSwitch(): void {
    this.buildChrome('yellow', '配电箱 · 电源总闸', UI.accent);
    const left = DESIGN_WIDTH / 2 - ENDGAME_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    const x = left + ENDGAME_PAD;
    const lines: readonly string[] = [
      '钥匙在你手里——现在你也是这套系统的一部分。',
      '总闸。标签写着：整塔供电。',
      '墙上并排摆着三张表：停电表、配给表、处决名单。',
      '拉下它，从一楼开始黑。',
    ];
    let y = top + ENDGAME_BODY_TOP + 20;
    for (const line of lines) {
      const wrapped = wrapText(line, ENDGAME_TEXT_W, TYPE.body).length;
      this.addText(x, y, line, TYPE.body, hex(TEXT.primary), { x: 0, y: 0 }, ENDGAME_TEXT_W);
      y += wrapped * estimateLineHeight(TYPE.body) + 12;
    }
    // 总闸画出来：一根把手压进底座。shutdown 的物理动作点不是文案，是它。
    const gfx = this.addObject(this.add.graphics().setDepth(DEPTH + 6));
    const switchX = left + ENDGAME_PANEL_W / 2;
    const switchY = top + ENDGAME_PANEL_H - 130;
    gfx.fillStyle(ROLE.surfaceRaised, 1);
    gfx.fillRect(switchX - 46, switchY, 92, 26);
    gfx.fillStyle(UI.accent, 1);
    gfx.fillRect(switchX - 14, switchY - 16, 28, 16);
    gfx.lineStyle(2, UI.line, 0.9);
    gfx.strokeRect(switchX - 46, switchY, 92, 26);
  }

  private buildChoice(): void {
    this.buildChrome('green', '同一支笔', UI.good);
    const left = DESIGN_WIDTH / 2 - ENDGAME_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    const x = left + ENDGAME_PAD;

    let y = top + ENDGAME_BODY_TOP;
    for (const line of CHOICE_INTRO) {
      const wrapped = wrapText(line, ENDGAME_TEXT_W, TYPE.caption).length;
      this.addText(x, y, line, TYPE.caption, hex(TEXT.secondary), { x: 0, y: 0 }, ENDGAME_TEXT_W);
      y += wrapped * estimateLineHeight(TYPE.caption) + 6;
    }
    this.addText(
      x,
      y + 2,
      `阶层 6 · 统治核心 · ${STATUS_LABEL[this.evaluation.status] ?? this.evaluation.status}`,
      TYPE.caption,
      hex(TEXT.dim),
      { x: 0, y: 0 },
    );
    y += estimateLineHeight(TYPE.caption) + 16;
    // 呈现四分支 = 目标 door（你要么关上它，要么坐上它）。
    this.writeObjective('door');

    const quest = this.evaluation.quest;
    quest.branches.forEach((branch, b) => {
      const evaluation = this.evaluation.branches[b];
      if (!evaluation) return;
      const chosen = hasFlag(this.state, QUEST_FLAG.branch(quest.id, branch.id));
      const selected = b === this.sel;
      const label = chosen ? `${branch.text}（已选）` : branch.text;
      const textColor = chosen
        ? hex(TEXT.highlight)
        : evaluation.available
          ? selected
            ? hex(PALETTE.lightHigh)
            : hex(TEXT.primary)
          : hex(TEXT.disabled);

      const textLines = wrapText(label, ENDGAME_TEXT_W - 28, TYPE.body).length;
      let blockH = textLines * estimateLineHeight(TYPE.body);
      let blockerH = 0;
      if (!evaluation.available && evaluation.blockers.length > 0) {
        blockerH = BLOCKER_GAP + wrapText(evaluation.blockers.join(' · '), ENDGAME_TEXT_W - 28, TYPE.caption).length * estimateLineHeight(TYPE.caption);
        blockH += blockerH;
      }

      if (selected) {
        // 选中带：整行 wash + 左侧 2px 竖线，同 buildListRow 的选中语言。
        this.addObject(
          this.add
            .rectangle(x - 6, y - 4, ENDGAME_TEXT_W + 12, blockH + 8, UI.accent)
            .setOrigin(0, 0)
            .setAlpha(0.13)
            .setDepth(DEPTH + 4),
        );
        this.addObject(
          this.add.rectangle(x - 6, y - 4, 2, blockH + 8, UI.accent).setOrigin(0, 0).setDepth(DEPTH + 5),
        );
      }
      this.addText(x, y, selected ? '▸' : '·', TYPE.body, textColor, { x: 0, y: 0 });
      this.addText(x + 28, y, label, TYPE.body, textColor, { x: 0, y: 0 }, ENDGAME_TEXT_W - 28);
      if (blockerH > 0) {
        this.addText(
          x + 28,
          y + textLines * estimateLineHeight(TYPE.body) + BLOCKER_GAP,
          evaluation.blockers.join(' · '),
          TYPE.caption,
          hex(ROLE.danger),
          { x: 0, y: 0 },
          ENDGAME_TEXT_W - 28,
        );
      }
      y += blockH + BRANCH_GAP;
    });
  }

  private buildConfirm(): void {
    this.buildChrome('yellow', '确认', UI.accent);
    const left = DESIGN_WIDTH / 2 - ENDGAME_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    const x = left + ENDGAME_PAD;
    const branch = this.pendingBranch;
    if (!branch) return;

    let y = top + ENDGAME_BODY_TOP + 30;
    const textLines = wrapText(branch.text, ENDGAME_TEXT_W, TYPE.title).length;
    this.addText(x, y, branch.text, TYPE.title, hex(TEXT.highlight), { x: 0, y: 0 }, ENDGAME_TEXT_W);
    y += textLines * estimateLineHeight(TYPE.title) + 20;
    if (branch.detail) {
      const detailLines = wrapText(branch.detail, ENDGAME_TEXT_W, TYPE.body).length;
      this.addText(x, y, branch.detail, TYPE.body, hex(TEXT.primary), { x: 0, y: 0 }, ENDGAME_TEXT_W);
      y += detailLines * estimateLineHeight(TYPE.body) + 24;
    }
    this.addText(x, y, '终局不可回头。确认之后，塔就不是这座塔了。', TYPE.body, hex(TEXT.warn), { x: 0, y: 0 }, ENDGAME_TEXT_W);
  }

  private buildEnding(): void {
    const ending = this.ending ? ENDINGS[this.ending] : null;
    if (!ending) return;
    const cx = DESIGN_WIDTH / 2;
    const cy = DESIGN_HEIGHT / 2;
    const top = cy - ENDGAME_PANEL_H / 2;

    // 全屏色调画在面板后面当背景：四个结局四种调子（黑/金/青/石灰）。
    const wash = this.addObject(
      this.add.rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, ending.wash).setOrigin(0, 0).setAlpha(0.12).setDepth(DEPTH - 20),
    );
    if (this.ending === 'shutdown') {
      // shutdown 是唯一一个「世界在变」的结局：屏幕跟着总闸一起黑下去。
      this.tweens.add({ targets: wash, alpha: ending.washAlpha, duration: 1600, ease: 'Sine.InOut' });
    } else {
      wash.setAlpha(ending.washAlpha);
    }

    for (const o of buildPanel(this, cx, cy, ENDGAME_PANEL_W, ENDGAME_PANEL_H, ending.panel, DEPTH)) {
      this.addObject(o);
    }
    this.addText(cx, top + 84, ending.title, F_BIG, hex(ending.titleColor), { x: 0.5, y: 0.5 }).setStroke(hex(PALETTE.ink), 6);
    // 标题下一条发丝线，把大标题和正文分开。
    const rule = this.addObject(this.add.graphics().setDepth(DEPTH + 6));
    rule.fillStyle(UI.line, 0.6);
    rule.fillRect(cx - 120, top + 128, 240, 1);

    // 演出文字逐行揭晓：每行一个 Text，delayCall 到点才建（没揭的不占位，
    // 版面因此是从上往下「长」出来的，而不是一整块同时出现）。
    const revealLine = (i: number): void => {
      if (i >= ending.lines.length || this.mode !== 'ending') return;
      const lineY = top + 176 + i * (estimateLineHeight(TYPE.body) + 16);
      const t = this.addText(cx, lineY, ending.lines[i], TYPE.body, hex(TEXT.primary), { x: 0.5, y: 0 }, ENDGAME_TEXT_W);
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: 420 });
      playSfx('click');
      // revealed 记「已揭到第几行」，revealAll 与 Enter 的「揭完再走」判断都读
      // 它——不每行更新会让 revealAll 从 0 重刷，把第一行画两遍。
      this.revealed = i + 1;
      if (i + 1 < ending.lines.length) {
        this.revealTimers.push(this.time.delayedCall(700, () => revealLine(i + 1)));
      }
    };
    this.revealed = 0;
    this.revealTimers.push(this.time.delayedCall(500, () => revealLine(0)));
  }

  private buildEpilogue(): void {
    this.buildChrome('green', '终局结算', UI.good);
    const left = DESIGN_WIDTH / 2 - ENDGAME_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    const x = left + ENDGAME_PAD;
    const ending = this.ending ? ENDINGS[this.ending] : null;
    if (!ending) return;

    // 第一段：这一局怎么收场的（结局/路线/本结局得分）。三项就够——楼层、
    // 存活、得分都进了下面的统计表，不在这里重复。
    const rows: ReadonlyArray<readonly [string, string, boolean]> = [
      ['结局', ending.title, true],
      ['路线', ending.route, false],
      ['本结局得分', `+${this.scoreDelta}`, false],
    ];
    let y = top + ENDGAME_BODY_TOP + 24;
    for (const [label, value, highlight] of rows) {
      this.addText(x, y, label, TYPE.caption, hex(TEXT.dim), { x: 0, y: 0.5 });
      this.addText(x + ENDGAME_TEXT_W, y, value, TYPE.body, hex(highlight ? TEXT.highlight : TEXT.primary), { x: 1, y: 0.5 });
      y += 40;
    }

    // 第二段：本局统计表（AG-81，与死亡结算同一组件 buildStatsTable + 同一
    // 行几何 hudLayout.STATS_PANEL）。16 行四列：3 项定场 + 120px 的网格，
    // 终局面板 760 宽撑得下。
    y += 8;
    const divider = this.addObject(this.add.graphics().setDepth(DEPTH + 6));
    divider.fillStyle(UI.line, 0.6);
    divider.fillRect(x, y, ENDGAME_TEXT_W, 1);
    y += 16;
    this.addText(x, y, '本局统计', TYPE.caption, hex(TEXT.dim), { x: 0, y: 0.5 });
    y += 24;
    const statColW = (ENDGAME_TEXT_W - STATS_PANEL.colGap * 3) / 4;
    const stats = buildStatsTable(this, x, y, statColW, runStatRows(this.state), DEPTH + 5, 4);
    for (const o of stats.objects) this.addObject(o);
    y += stats.height + 16;

    // 第三段：历史纪录对比（localStorage 'floor100000.records'）。破纪录的
    // 行由 buildStatsTable 盖「新纪录」章——走到终局的人值得知道自己破了什么。
    this.addText(x, y, '历史纪录', TYPE.caption, hex(TEXT.dim), { x: 0, y: 0.5 });
    y += 24;
    const recColW = (ENDGAME_TEXT_W - STATS_PANEL.colGap) / 2;
    const records = buildStatsTable(this, x, y, recColW, recordRows(this.state, settleRun(this.state)), DEPTH + 5, 2);
    for (const o of records.objects) this.addObject(o);
    y += records.height + 20;

    this.addText(
      x,
      y,
      '权限已经落定。塔继续运转——以你知道的那种方式。',
      TYPE.caption,
      hex(TEXT.secondary),
      { x: 0, y: 0 },
      ENDGAME_TEXT_W,
    );
  }

  private buildSettled(): void {
    this.buildChrome('green', '终局已定', UI.good);
    const left = DESIGN_WIDTH / 2 - ENDGAME_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    const x = left + ENDGAME_PAD;
    const taken = this.takenEnding();
    if (!taken) return;
    const ending = ENDINGS[taken];

    this.addText(x, top + ENDGAME_BODY_TOP + 30, ending.title, TYPE.title, hex(TEXT.highlight), { x: 0, y: 0 });
    const codaLines = wrapText(ending.coda, ENDGAME_TEXT_W, TYPE.body).length;
    this.addText(
      x,
      top + ENDGAME_BODY_TOP + 30 + estimateLineHeight(TYPE.title) + 20,
      ending.coda,
      TYPE.body,
      hex(TEXT.primary),
      { x: 0, y: 0 },
      ENDGAME_TEXT_W,
    );
    this.addText(
      x,
      top + ENDGAME_BODY_TOP + 30 + estimateLineHeight(TYPE.title) + 20 + codaLines * estimateLineHeight(TYPE.body) + 24,
      '这条路已经选过了。终端不再问第二遍。',
      TYPE.caption,
      hex(TEXT.dim),
      { x: 0, y: 0 },
      ENDGAME_TEXT_W,
    );
  }

  // ── 输入 ─────────────────────────────────────────────────────────────────

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
    // otherwise stack a second set of listeners on it. (Same as QuestPanelScene.)
    if (this.keys) {
      this.keys.up?.removeAllListeners();
      this.keys.down?.removeAllListeners();
      this.keys.enter?.removeAllListeners();
      this.keys.esc?.removeAllListeners();
    }
  }

  private onArrow(delta: number): void {
    if (!this.accept(delta < 0 ? 'up' : 'down')) return;
    if (this.mode !== 'choice') return;
    const count = this.evaluation.quest.branches.length;
    const next = Phaser.Math.Clamp(this.sel + delta, 0, count - 1);
    if (next === this.sel) return;
    this.sel = next;
    playSfx('click');
    this.buildMode();
  }

  private onConfirm(): void {
    if (!this.accept('enter')) return;
    switch (this.mode) {
      case 'prologue': {
        if (this.prologueLine < PROLOGUE_LINES.length - 1) {
          this.prologueLine += 1;
          playSfx('click');
          this.buildMode();
        } else {
          playSfx('click');
          this.enterMode('choice');
        }
        return;
      }
      case 'tables': {
        if (this.tablePage < TABLE_PAGES.length - 1) {
          this.tablePage += 1;
          playSfx('click');
          this.buildMode();
        } else {
          // 读毕：回塔楼。pen 已写，终端台入口的 prologue 不再要求重读。
          playSfx('click');
          this.returnToTower();
        }
        return;
      }
      case 'switch': {
        // 拉闸 = shutdown 结局的物理动作点，走与终端确认完全相同的路径。
        this.confirmBranch('shutdown');
        return;
      }
      case 'choice': {
        const branch = this.evaluation.quest.branches[this.sel];
        const evaluation = this.evaluation.branches[this.sel];
        if (!branch || !evaluation) return;
        if (!evaluation.available) {
          // 阻塞原因已经印在行下；Enter 把它们拼成一行，拒绝不是无声的 no-op。
          this.showMessage(evaluation.blockers.join(' · '));
          return;
        }
        this.pendingBranch = branch;
        playSfx('click');
        this.enterMode('confirm');
        return;
      }
      case 'confirm': {
        if (this.pendingBranch) this.commit(this.pendingBranch.id);
        return;
      }
      case 'ending': {
        if (this.revealed >= (this.ending ? ENDINGS[this.ending].lines.length : 0)) {
          playSfx('click');
          this.enterMode('epilogue');
        } else {
          // 没揭完：Enter 一次揭完，不让玩家对着一屏空白按键。
          this.revealAll();
        }
        return;
      }
      case 'epilogue': {
        playSfx('click');
        this.returnToTower();
        return;
      }
      case 'settled':
        return;
    }
  }

  private onBack(): void {
    if (!this.accept('esc')) return;
    switch (this.mode) {
      case 'confirm':
        playSfx('click');
        this.enterMode('choice');
        return;
      case 'ending':
        // 演出中按 Esc 不打断结局：先揭完。已揭完再按 Esc 才回塔楼——
        // 终局是要看完的，但玩家有权提前离场。
        if (this.revealed >= (this.ending ? ENDINGS[this.ending].lines.length : 0)) {
          this.returnToTower();
        } else {
          this.revealAll();
        }
        return;
      default:
        this.returnToTower();
        return;
    }
  }

  // ── 分支确认与落地 ────────────────────────────────────────────────────────

  /** 从任意模式（choice / fuse 拉闸）进入某分支的确认态。 */
  private confirmBranch(branchId: string): void {
    const branch = this.evaluation.quest.branches.find((b) => b.id === branchId);
    const evaluation = this.evaluation.branches.find((b) => b.branch.id === branchId);
    if (!branch || !evaluation) return;
    if (!evaluation.available) {
      this.showMessage(evaluation.blockers.join(' · '));
      return;
    }
    this.pendingBranch = branch;
    playSfx('click');
    this.enterMode('confirm');
  }

  /**
   * 落地一条 Q6 分支。按 STORY.md §7 的接口契约逐类实现 QuestConsequence
   * （不发明新后果类型），外加生命周期旗与存档。幂等：ending flag 任一已落
   * 直接转 settled。
   */
  private commit(branchId: string): void {
    const quest = this.evaluation.quest;
    const branch = quest.branches.find((b) => b.id === branchId);
    if (!branch) return;
    if (this.takenEnding()) {
      this.enterMode('settled');
      return;
    }

    const state = this.state;
    setFlag(state, QUEST_FLAG.accepted(quest.id));
    setFlag(state, QUEST_FLAG.branch(quest.id, branch.id));
    for (const c of branch.consequences) {
      switch (c.kind) {
        case 'setFlag':
          setFlag(state, c.flag);
          break;
        case 'clearFlag':
          clearFlag(state, c.flag);
          break;
        case 'giveItem':
          addItem(state.player.inventory, c.itemId, c.count);
          break;
        case 'takeItem':
          removeItem(state.player.inventory, c.itemId, c.count);
          break;
        case 'grantPass':
          // 与 craft() 同一落点：凭证就是 homeUpgrades 的一条，不额外写 upg: flag。
          if (!state.player.homeUpgrades.includes(c.pass)) state.player.homeUpgrades.push(c.pass);
          break;
        case 'score':
          if (!state.records) state.records = { deepestFloor: state.currentFloor, bestScore: 0 };
          state.records.bestScore += c.delta;
          this.scoreDelta += c.delta;
          break;
      }
    }
    // 目标齐了 → done（doneFlag 由玩法过程写入，这里只做收口）。
    if (quest.objectives.every((o) => hasFlag(state, o.doneFlag))) {
      setFlag(state, QUEST_FLAG.done(quest.id));
    }
    saveToStorage(state);

    this.ending = branch.id as EndingId;
    playSfx('goal');
    this.enterMode('ending');
  }

  /** 已落盘的结局 id；没有则 null。settled 的判据 + 幂等守卫。 */
  private takenEnding(): EndingId | null {
    const map: ReadonlyArray<readonly [string, EndingId]> = [
      [STORY_FLAGS.endingShutdown, 'shutdown'],
      [STORY_FLAGS.endingHandOver, 'hand-over'],
      [STORY_FLAGS.endingThrone, 'throne'],
      [STORY_FLAGS.endingWalkAway, 'walk-away'],
    ];
    for (const [flag, id] of map) {
      if (hasFlag(this.state, flag)) return id;
    }
    return null;
  }

  private writeObjective(objectiveId: string): void {
    const objective = this.evaluation.quest.objectives.find((o) => o.id === objectiveId);
    if (objective) setFlag(this.state, objective.doneFlag);
  }

  // ── 出口与辅助 ────────────────────────────────────────────────────────────

  /** 四种出口一律 scene.start('Game')：handoff 语义（FINALE_UX.md §2.4）。 */
  private returnToTower(): void {
    this.scene.start('Game');
  }

  private revealAll(): void {
    this.clearRevealTimers();
    const ending = this.ending ? ENDINGS[this.ending] : null;
    if (!ending || this.mode !== 'ending') return;
    const top = DESIGN_HEIGHT / 2 - ENDGAME_PANEL_H / 2;
    const cx = DESIGN_WIDTH / 2;
    for (let i = this.revealed; i < ending.lines.length; i++) {
      const lineY = top + 176 + i * (estimateLineHeight(TYPE.body) + 16);
      this.addText(cx, lineY, ending.lines[i], TYPE.body, hex(TEXT.primary), { x: 0.5, y: 0 }, ENDGAME_TEXT_W);
    }
    this.revealed = ending.lines.length;
  }

  private clearRevealTimers(): void {
    for (const t of this.revealTimers) t.remove(false);
    this.revealTimers = [];
  }

  private showMessage(text: string): void {
    this.messageText.setText(text).setVisible(true);
    this.messageTimer?.remove(false);
    this.messageTimer = this.time.delayedCall(2400, () => this.messageText.setVisible(false));
  }

  private hideMessage(): void {
    this.messageTimer?.remove(false);
    this.messageTimer = null;
    this.messageText.setVisible(false);
  }
}
