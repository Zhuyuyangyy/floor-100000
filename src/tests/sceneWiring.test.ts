import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { HUD_BAR_H, HUD_FOOT_H } from '../render/uiKit';
import { TYPE, fontLineBox } from '../render/uiKit';
import { estimateLineHeight, estimateTextWidth, wrapText } from '../render/dialogueLayout';
import { RECIPES, MATERIAL_SOURCES } from '../data/recipes';
import { canCraft, recipePreview } from '../systems/CraftingSystem';
import { diaryOf, diaryKindCount, recordDiary } from '../systems/DiarySystem';
import { npcAtomsFor, sense } from '../ai/npcAtoms';
import { NPCS } from '../data/npcs';
import { QUEST_FLAG, QUESTS, evaluateAllQuests } from '../data/quests';
import { setFlag } from '../systems/WorldFlags';
import type { GameState } from '../core/gameTypes';
import type { ItemId } from '../core/gameTypes';

// AG-44（场景接线）单测镜像。三处接线的**排版与数据契约**在这一层钉死，
// 浏览器层的实测（output/ag44/<phase>/ 的截图与 getBounds 数字）由
// e2e/ag44-scene-wire.spec.ts 负责——两边互为冗余，任一层漂移都会红。
//
// 不 import 任何场景模块（Phaser 在 Node 下会炸，见 render/panels.ts 顶部
// 同款注释）：场景里的几何常量按 questPanel.test.ts 对 QuestPanelScene 的
// 既有做法在此镜像，「场景的表改了，这里的数字跟着改」。

// ── 合成面板详情块（GameScene.buildCraftPanel / refreshCraft 的镜像）────────

const CRAFT_PANEL_W = 530;
const CRAFT_ROWS = RECIPES.length;
const CRAFT_ROW_PITCH = fontLineBox(TYPE.body);
const CRAFT_DETAIL_H = 200;
const CRAFT_DETAIL_GAP = 6;
const CRAFT_DETAIL_W = CRAFT_PANEL_W - 36;
/** 详情块第一行距面板顶：30 header + 9 行 + 12 gap。 */
const CRAFT_DETAIL_TOP = 30 + CRAFT_ROWS * CRAFT_ROW_PITCH + 12;
const CRAFT_PANEL_H = 30 + CRAFT_ROWS * CRAFT_ROW_PITCH + 12 + CRAFT_DETAIL_H + 40;

/** 刷新一行选中配方时，详情块三行的文本（refreshCraft 的同款拼接）。 */
function craftDetailLines(state: GameState, id: (typeof RECIPES)[number]['id']): {
  effect: string;
  tier: string;
  hints: string;
} {
  const preview = recipePreview(state, id);
  let tier = preview.tierNote ?? '';
  if (preview.requires) {
    const req = `前置：${preview.requires.displayName} ${preview.requires.met ? '已获得' : '未获得'}`;
    tier = tier ? `${tier} · ${req}` : req;
  }
  return {
    effect: `效果：${preview.effect}`,
    tier,
    hints: preview.hints && preview.hints.length > 0 ? `去哪拿：${preview.hints.join('；')}` : '',
  };
}

describe('craft panel detail block (AG-44)', () => {
  it('grows the panel by the detail block and still clears the HUD bands', () => {
    // 面板居中：上下各让开 HUD（60）/ foot（40）带，横向不出画布。
    const top = (DESIGN_HEIGHT - CRAFT_PANEL_H) / 2;
    expect(CRAFT_PANEL_W).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(CRAFT_PANEL_H).toBeLessThanOrEqual(DESIGN_HEIGHT);
    expect(top).toBeGreaterThanOrEqual(HUD_BAR_H);
    expect(top + CRAFT_PANEL_H).toBeLessThanOrEqual(DESIGN_HEIGHT - HUD_FOOT_H);
  });

  it('budgets the detail block for its worst flow: 效果 2 + 档位/前置 1 + hints 4', () => {
    // 新背包（什么材料都没有）：每条配方都缺料，hints 全亮——这正是最坏流。
    const state = createNewGame(42);
    const lineH = fontLineBox(TYPE.caption);
    let worst = 0;
    for (const recipe of RECIPES) {
      const lines = craftDetailLines(state, recipe.id);
      const effectLines = wrapText(lines.effect, CRAFT_DETAIL_W, TYPE.caption).length;
      const tierLines = lines.tier ? wrapText(lines.tier, CRAFT_DETAIL_W, TYPE.caption).length : 0;
      const hintLines = lines.hints ? wrapText(lines.hints, CRAFT_DETAIL_W, TYPE.caption).length : 0;
      const flow = effectLines * lineH + CRAFT_DETAIL_GAP + tierLines * lineH + CRAFT_DETAIL_GAP + hintLines * lineH;
      worst = Math.max(worst, flow);
    }
    // 最坏流从 CRAFT_DETAIL_TOP 起，必须整块落在面板底之前。
    expect(CRAFT_DETAIL_TOP + worst).toBeLessThanOrEqual(CRAFT_PANEL_H - 40);
    expect(worst).toBeLessThanOrEqual(CRAFT_DETAIL_H);
  });

  it('renders the three lines AG-42 promised: effect, tier note, material sources', () => {
    const state = createNewGame(42);
    const lamp = craftDetailLines(state, 'lamp');
    expect(lamp.effect).toBe('效果：宿舍夜照 alpha 0.16，夜里不再全黑');
    expect(lamp.tier).toBe('档位 1');
    // 三样缺失材料的出处全部在「去哪拿」行里（保底/概率/高层梯度三列）。
    expect(lamp.hints.startsWith('去哪拿：')).toBe(true);
    for (const name of ['电池', '电线', '废金属']) {
      expect(lamp.hints).toContain(name);
    }
    expect(lamp.hints).toContain('3层地面×1'); // 电池保底
    expect(lamp.hints).toContain('100层以上各层概率'); // 高层梯度

    // 工牌（tier 2）：权力线 1 级未达，且它自己就是第一张凭证（无 requires）。
    const badge = craftDetailLines(state, 'work_badge');
    expect(badge.tier).toBe('档位 2｜权力线 1 级未达');
    expect(badge.effect).toContain('开 100-110 段电梯');

    // 通行贴（tier 3）：档位读数与前置合并成一行。
    const sticker = craftDetailLines(state, 'pass_sticker');
    expect(sticker.tier).toBe('档位 3｜权力线 1 级未达 · 前置：工牌 未获得');
  });

  it('drops the hints line once the materials are in the bag', () => {
    const state = createNewGame(42);
    state.player.inventory.slots.push({ itemId: 'battery', quantity: 1 });
    state.player.inventory.slots.push({ itemId: 'wire', quantity: 1 });
    state.player.inventory.slots.push({ itemId: 'scrap_metal', quantity: 1 });
    expect(canCraft(state, 'lamp').ok).toBe(true);
    expect(craftDetailLines(state, 'lamp').hints).toBe('');
    // 效果与档位不受影响——「做出来会怎样」与可制作状态无关。
    expect(craftDetailLines(state, 'lamp').effect).toContain('效果：');
  });

  it('keeps every rendered detail line inside the panel width', () => {
    const state = createNewGame(42);
    for (const recipe of RECIPES) {
      const lines = craftDetailLines(state, recipe.id);
      for (const [name, line] of Object.entries(lines)) {
        if (!line) continue;
        for (const wrapped of wrapText(line, CRAFT_DETAIL_W, TYPE.caption)) {
          expect(estimateTextWidth(wrapped, TYPE.caption), `${recipe.id}/${name}: "${wrapped}"`).toBeLessThanOrEqual(
            CRAFT_DETAIL_W,
          );
        }
      }
    }
  });

  it('never renders a source hint for a material without one', () => {
    // MATERIAL_SOURCES 的键就是全部九种 recipe 材料；任一缺失都会让 hints
    // 行少一条出处（canCraft 的 hints 只收有出处的料）。
    const materials = new Set<ItemId>();
    for (const recipe of RECIPES) {
      for (const itemId of Object.keys(recipe.cost)) materials.add(itemId as ItemId);
    }
    for (const itemId of materials) {
      expect(MATERIAL_SOURCES[itemId], `${itemId} has no source row`).toBeTruthy();
    }
  });
});

// ── 任务面板目标块（QuestPanelScene.refreshDetail 的镜像）────────────────────

const QUEST_PANEL_W = 940;
// AG-44：场景从 480 长高到 640——目标块（最坏 5 行）+ 分支 + 阻塞原因的
// 真实行盒合计最坏 538（permit），allChosen 态 592；606 的限制线容纳两者。
// questPanel.test.ts 镜像的是它自己的 480 模型（该文件归 AG-12，本工单不改），
// 那边只断言模型内的合情理性，不断言本面板的真实高度。
const QUEST_PANEL_H = 640;
const QUEST_PAD = 16;
const QUEST_LIST_W = 340;
const QUEST_DETAIL_X = QUEST_PAD + QUEST_LIST_W + QUEST_PAD;
const QUEST_DETAIL_W = QUEST_PANEL_W - QUEST_DETAIL_X - QUEST_PAD;
const QUEST_BRANCH_INSET = 18;
const QUEST_BRANCH_W = QUEST_DETAIL_W - QUEST_BRANCH_INSET;
const QUEST_DETAIL_FOOT_H = 34;
const QUEST_OBJECTIVE_BRANCH_GAP = 8;
const QUEST_OBJECTIVE_GAP = 4;

const F_TITLE = 26;
const F_META = 20;
const F_SUMMARY = 20;
const F_BRANCH = 22;
const F_BLOCKER = 18;
const F_OBJECTIVE = 18;

const DETAIL_SUMMARY_TOP = 98;
const SUMMARY_BRANCH_GAP = 16;
const BRANCH_GAP = 10;
const BLOCKER_GAP = 2;

const STATUS_LABEL = {
  locked: '未解锁',
  available: '可接取',
  active: '进行中',
  done: '已完成',
} as const;

function freshRun(seed = 42): GameState {
  return createNewGame(seed);
}

/** floor 2，第一个主线可接，其中一条目标已完成（e2e 的同款布阵）。 */
function floor2OneObjectiveDone(): GameState {
  const state = freshRun();
  state.currentFloor = 2;
  setFlag(state, QUEST_FLAG.objective('blackout-schedule', 'schedule'));
  return state;
}

/** 全链中段：五条主线完成，站在 110 层，短接材料在手。 */
function scriptedMidGame(): GameState {
  const state = freshRun();
  setFlag(state, QUEST_FLAG.done('blackout-schedule'));
  setFlag(state, QUEST_FLAG.done('work-badge'));
  setFlag(state, QUEST_FLAG.done('pass-sticker'));
  setFlag(state, QUEST_FLAG.done('permit'));
  setFlag(state, QUEST_FLAG.done('vip-card'));
  state.currentFloor = 110;
  state.player.inventory.slots.push({ itemId: 'wire', quantity: 2 });
  state.player.inventory.slots.push({ itemId: 'tape', quantity: 1 });
  state.player.inventory.slots.push({ itemId: 'battery', quantity: 1 });
  return state;
}

/** 终局布阵：全链完成，站在山顶。 */
function scriptedFinale(): GameState {
  const state = scriptedMidGame();
  setFlag(state, QUEST_FLAG.done('tap-water'));
  setFlag(state, QUEST_FLAG.done('feast-ledger'));
  state.currentFloor = 100000;
  return state;
}

/** 每条分支都打上「已选」的态：正常玩法不可达（commitBranch 拒绝第二条分支），
 *  但旗标可被外部拨置——面板必须在这个态下也不出框（最长标签 + 最多内容）。 */
function allChosen(): GameState {
  const state = scriptedFinale();
  for (const quest of QUESTS) {
    for (const branch of quest.branches) setFlag(state, QUEST_FLAG.branch(quest.id, branch.id));
  }
  return state;
}

const REPRESENTATIVES: ReadonlyArray<{ name: string; state: GameState }> = [
  { name: 'a fresh run', state: freshRun() },
  { name: 'floor 2, one objective done', state: floor2OneObjectiveDone() },
  { name: 'the scripted mid-game', state: scriptedMidGame() },
  { name: 'the scripted finale', state: scriptedFinale() },
  { name: 'every branch chosen', state: allChosen() },
];

/** 目标行的文本（refreshDetail 的同款拼接：✓/○ + 目标全文）。 */
function objectiveLine(state: GameState, questId: string, objectiveId: string): string {
  const quest = QUESTS.find((q) => q.id === questId)!;
  const objective = quest.objectives.find((o) => o.id === objectiveId)!;
  const done = (state.flags?.[objective.doneFlag] ?? 0) > 0;
  return `${done ? '✓ ' : '○ '}${objective.text}`;
}

/** meta 行的文本（含 AG-44 补的「目标 n/m」）。 */
function metaLine(state: GameState, questId: string): string {
  const quest = QUESTS.find((q) => q.id === questId)!;
  const evaluations = evaluateAllQuests(state);
  const ev = evaluations.find((e) => e.quest.id === questId)!;
  const done = quest.objectives.filter((o) => (state.flags?.[o.doneFlag] ?? 0) > 0).length;
  return `阶层 ${quest.segment} · 阶层名 · ${STATUS_LABEL[ev.status]} · 目标 ${done}/${quest.objectives.length}`;
}

/** 详情栏（含 AG-44 目标块）的底边，模型与 refreshDetail 逐行同构：摘要与
 *  分支沿用场景既有的 estimateLineHeight 流，目标块用 fontLineBox 的实测
 *  行盒（场景同款）。 */
function detailBottom(state: GameState, questId: string): number {
  const quest = QUESTS.find((q) => q.id === questId)!;
  const ev = evaluateAllQuests(state).find((e) => e.quest.id === questId)!;
  const summaryLines = wrapText(quest.summary, QUEST_DETAIL_W, F_SUMMARY).length;
  let y = DETAIL_SUMMARY_TOP + summaryLines * estimateLineHeight(F_SUMMARY) + SUMMARY_BRANCH_GAP;
  for (const objective of quest.objectives) {
    const line = objectiveLine(state, questId, objective.id);
    y += wrapText(line, QUEST_BRANCH_W, F_OBJECTIVE).length * fontLineBox(F_OBJECTIVE) + QUEST_OBJECTIVE_GAP;
  }
  y += QUEST_OBJECTIVE_BRANCH_GAP;
  quest.branches.forEach((branch, b) => {
    const chosen = (state.flags?.[QUEST_FLAG.branch(questId, branch.id)] ?? 0) > 0;
    const label = chosen ? `${branch.text}（已选）` : branch.text;
    let blockH = wrapText(label, QUEST_BRANCH_W, F_BRANCH).length * estimateLineHeight(F_BRANCH);
    if (!ev.branches[b].available && ev.branches[b].blockers.length > 0) {
      const reason = ev.branches[b].blockers.join(' · ');
      blockH += BLOCKER_GAP + wrapText(reason, QUEST_BRANCH_W, F_BLOCKER).length * estimateLineHeight(F_BLOCKER);
    }
    y += blockH + BRANCH_GAP;
  });
  return y - BRANCH_GAP;
}

describe('quest panel objectives block (AG-44)', () => {
  it('marks completion per objective: ✓ done, ○ pending, from the doneFlag', () => {
    const state = floor2OneObjectiveDone();
    expect(objectiveLine(state, 'blackout-schedule', 'schedule').startsWith('✓ ')).toBe(true);
    expect(objectiveLine(state, 'blackout-schedule', 'schedule')).toContain('抄下停电表');
    expect(objectiveLine(state, 'blackout-schedule', 'boil-water').startsWith('○ ')).toBe(true);
    expect(objectiveLine(state, 'blackout-schedule', 'names').startsWith('○ ')).toBe(true);
    // 干净局里全部未完成。
    const fresh = freshRun();
    expect(objectiveLine(fresh, 'blackout-schedule', 'schedule').startsWith('○ ')).toBe(true);
  });

  it('counts the objectives on the meta line', () => {
    expect(metaLine(floor2OneObjectiveDone(), 'blackout-schedule')).toContain('目标 1/3');
    expect(metaLine(freshRun(), 'blackout-schedule')).toContain('目标 0/3');
    expect(metaLine(scriptedFinale(), 'same-pen')).toContain('目标 0/3');
  });

  it('keeps the meta line on one line with the 目标 suffix included', () => {
    for (const rep of REPRESENTATIVES) {
      for (const ev of evaluateAllQuests(rep.state)) {
        const quest = ev.quest;
        const done = quest.objectives.filter((o) => (rep.state.flags?.[o.doneFlag] ?? 0) > 0).length;
        // 最坏宽度按六字段阶层名 + 三字符状态 + 3/3 计数预算。
        const worst = estimateTextWidth(
          `阶层 6 · 工业与交易区 · ${STATUS_LABEL.done} · 目标 3/3`,
          F_META,
        );
        expect(worst, `${quest.id}: meta worst`).toBeLessThanOrEqual(QUEST_DETAIL_W);
        expect(done).toBeLessThanOrEqual(quest.objectives.length);
      }
    }
  });

  it('flows every representative state inside the detail column, objectives included', () => {
    // questPanel.test.ts 的 detailBottom 模型不知道目标块的存在（该文件归
    // AG-12，本工单不改）；这个用例补上那一块之后的真实底边。
    for (const rep of REPRESENTATIVES) {
      for (const ev of evaluateAllQuests(rep.state)) {
        const bottom = detailBottom(rep.state, ev.quest.id);
        expect(bottom, `${ev.quest.id} @ ${rep.name}`).toBeLessThanOrEqual(QUEST_PANEL_H - QUEST_DETAIL_FOOT_H);
      }
    }
  });

  it('wraps every objective line inside the column width', () => {
    for (const rep of REPRESENTATIVES) {
      for (const ev of evaluateAllQuests(rep.state)) {
        for (const objective of ev.quest.objectives) {
          const line = objectiveLine(rep.state, ev.quest.id, objective.id);
          for (const wrapped of wrapText(line, QUEST_BRANCH_W, F_OBJECTIVE)) {
            expect(
              estimateTextWidth(wrapped, F_OBJECTIVE),
              `${ev.quest.id}/${objective.id}: "${wrapped}"`,
            ).toBeLessThanOrEqual(QUEST_BRANCH_W);
          }
        }
      }
    }
  });

  it('sizes the pools from the data: three objectives at most, four branches at most', () => {
    expect(Math.max(...QUESTS.map((q) => q.objectives.length))).toBe(3);
    expect(Math.max(...QUESTS.map((q) => q.branches.length))).toBe(4);
  });

  it('orders the detail anchors: title clears meta, meta clears summary', () => {
    // 与 questPanel.test.ts 的同名断言一致（目标块插在 summary 之后，不移动
    // 这三个锚点）。
    expect(40 + estimateLineHeight(F_TITLE)).toBeLessThanOrEqual(72);
    expect(72 + estimateLineHeight(F_META)).toBeLessThanOrEqual(DETAIL_SUMMARY_TOP);
  });
});

// ── dev 句柄的委托目标（main.ts 三个句柄背后的产品函数）─────────────────────

describe('dev handle delegation targets (AG-44)', () => {
  it('resolves NPC ids the way __PHASER_NPC_ATOMS__ does: known → def, unknown → null', () => {
    const byId = (npcId: string): (typeof NPCS)[number] | null => NPCS.find((n) => n.id === npcId) ?? null;
    expect(byId('alin')?.id).toBe('alin');
    expect(byId('nobody')).toBeNull();
  });

  it('answers atoms and sense for a neighbour on another floor (no speak atom)', () => {
    // 玩家在 1 层（起始层），阿林在 2 层：跨层 → 感知门关闭 → 只有 goTo +
    // playAnimation 两个原子。这正是 e2e 断言的序列。
    const state = createNewGame(42);
    const alin = NPCS.find((n) => n.id === 'alin')!;
    const atoms = npcAtomsFor(alin, state);
    expect(atoms.map((a) => a.kind)).toEqual(['goTo', 'playAnimation']);
    const snapshot = sense(alin, state);
    expect(snapshot.npcId).toBe('alin');
    expect(snapshot.player.sameFloor).toBe(false);
  });

  it('reads the diary through the product functions the handle wraps', () => {
    const state = createNewGame(42);
    expect(diaryOf(state)).toEqual([]);
    expect(diaryKindCount(state, 'visitor')).toBe(0);
    recordDiary(state, { kind: 'visitor', day: 1, minute: 600, text: '探针条目', actorId: null });
    recordDiary(state, { kind: 'shelterAttacked', day: 1, minute: 601, text: '后写的一条', actorId: null });
    // diaryOf 按 day 倒序（新的在前），可限条数。
    const entries = diaryOf(state, 5);
    expect(entries.map((e) => e.text)).toEqual(['后写的一条', '探针条目']);
    expect(diaryOf(state, 1).map((e) => e.text)).toEqual(['后写的一条']);
    // 计数走旗，不被 64 条上限裁剪影响。
    expect(diaryKindCount(state, 'visitor')).toBe(1);
    expect(diaryKindCount(state, 'shelterAttacked')).toBe(1);
  });

  it('evaluates the quests live, before any panel is open', () => {
    // __PHASER_QUESTS__.getEvaluations 对活 state 现算；面板从未打开时也要
    // 答得上话（AG-32 的用法）。
    const state = createNewGame(42);
    const evaluations = evaluateAllQuests(state);
    expect(evaluations.length).toBe(8);
    expect(evaluations[0].quest.id).toBe('blackout-schedule');
  });
});
