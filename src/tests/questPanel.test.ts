import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { DESIGN_HEIGHT } from '../core/design';
import { CONTENT_TOP, HUD_BOTTOM } from '../systems/TowerNav';
import { hasFloorContent } from '../data/floorTemplates';
import { summarizeFloor } from '../core/worldgen';
import { getItem } from '../data/items';
import { QUEST_FLAG, QUESTS, STORY_FLAGS, evaluateAllQuests } from '../data/quests';
import type { QuestEvaluation, QuestStatus } from '../data/quests';
import { hasFlag, setFlag } from '../systems/WorldFlags';
import type { GameState } from '../core/gameTypes';
import { estimateLineHeight, estimateTextWidth, wrapText } from '../render/dialogueLayout';
import {
  DETAIL_CONTENT_ACTION_GAP,
  DETAIL_CONTENT_W,
  DETAIL_FOOT_PAD,
  DETAIL_PANEL_H,
  DETAIL_ROW_COUNT,
  DETAIL_ROW_PITCH,
  DETAIL_ROWS_TOP,
} from '../render/hudLayout';
import { ROW_H, TYPE } from '../render/uiKit';

// AG-12: layout guards for the quest panel (src/scenes/QuestPanelScene.ts) and
// for the tower overview detail card's new worldgen source, plus the stability
// of evaluateAllQuests across the states the panel renders.
//
// No screenshots: estimateTextWidth/wrapText predict the line counts, the
// geometry comes from the constants below, so a task name that outgrows its
// row, a branch or blocker that overflows the detail column, or an estimate
// line that outgrows the adaptive card turns red here instead of in review.

// ── the panel's geometry, mirrored ──────────────────────────────────────────
// QuestPanelScene exports these, but that module imports Phaser at value
// level and cannot be loaded under Node (the same reason render/panels.ts
// keeps its Phaser import type-only). They live here too, with the same
// "if the scene's table changes, these change with it" contract
// uiLayout.test.ts already uses for the tower scene's TYPE_* table.
const QUEST_PANEL_W = 940;
const QUEST_PANEL_H = 480;
const QUEST_PAD = 16;
const QUEST_LIST_W = 340;
const QUEST_LIST_TOP = 44;
const QUEST_ROW_PITCH = 30;
const QUEST_DETAIL_X = QUEST_PAD + QUEST_LIST_W + QUEST_PAD;
const QUEST_DETAIL_W = QUEST_PANEL_W - QUEST_DETAIL_X - QUEST_PAD;
const QUEST_BRANCH_INSET = 18;
const QUEST_BRANCH_W = QUEST_DETAIL_W - QUEST_BRANCH_INSET;
/** Branch content may not cross this line: the footer hint's reserved band. */
const QUEST_DETAIL_FOOT_H = 34;

// The detail column's type scale (QuestPanelScene's F_* table).
const F_TITLE = 26;
const F_META = 20;
const F_SUMMARY = 20;
const F_BRANCH = 22;
const F_BLOCKER = 18;

// Vertical flow anchors, measured from the panel top (refreshDetail).
const DETAIL_TITLE_TOP = 40;
const DETAIL_META_TOP = 72;
const DETAIL_SUMMARY_TOP = 98;
const SUMMARY_BRANCH_GAP = 16;
const BRANCH_GAP = 10;
const BLOCKER_GAP = 2;

// The status words the list rows and the detail meta line print.
const STATUS_LABEL: Record<QuestStatus, string> = {
  locked: '未解锁',
  available: '可接取',
  active: '进行中',
  done: '已完成',
};

const QUEST_ORDER = QUESTS.map((q) => q.id);

// ── representative states ───────────────────────────────────────────────────
// Six points along the chain, from a fresh run to the finale. These are the
// states the panel actually renders; the status table below pins what it says.

/** A fresh run at the config's starting floor, nothing done, nothing held. */
function freshRun(seed = 42): GameState {
  return createNewGame(seed);
}

/** Every main quest done, the slum knows the schedule, floor 110, the
 *  short-circuit materials in the bag — quests.test.ts's scripted state. */
function scriptedMidGame(): GameState {
  const state = freshRun();
  setFlag(state, QUEST_FLAG.done('blackout-schedule'));
  setFlag(state, QUEST_FLAG.done('work-badge'));
  setFlag(state, QUEST_FLAG.done('pass-sticker'));
  setFlag(state, QUEST_FLAG.done('permit'));
  setFlag(state, QUEST_FLAG.done('vip-card'));
  setFlag(state, STORY_FLAGS.slumKnowsSchedule);
  state.currentFloor = 110;
  state.player.inventory.slots.push({ itemId: 'wire', quantity: 2 });
  state.player.inventory.slots.push({ itemId: 'tape', quantity: 1 });
  state.player.inventory.slots.push({ itemId: 'battery', quantity: 1 });
  return state;
}

/** The whole chain done through the side quest, standing on the summit. */
function scriptedFinale(): GameState {
  const state = scriptedMidGame();
  setFlag(state, QUEST_FLAG.done('tap-water'));
  setFlag(state, QUEST_FLAG.done('feast-ledger'));
  state.currentFloor = 100000;
  return state;
}

interface Representative {
  readonly name: string;
  readonly state: GameState;
  /** Status per quest, aligned with QUEST_ORDER. */
  readonly statuses: readonly QuestStatus[];
}

const REPRESENTATIVES: readonly Representative[] = [
  {
    name: 'a fresh run: every quest still locked behind its trigger',
    state: freshRun(),
    statuses: ['locked', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked'],
  },
  {
    name: 'floor 2: the first main quest can be taken',
    state: Object.assign(freshRun(), { currentFloor: 2 }),
    statuses: ['available', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked'],
  },
  {
    name: 'floor 10 with the first quest accepted: it is active, the side quest is available',
    state: (() => {
      const s = Object.assign(freshRun(), { currentFloor: 10 });
      setFlag(s, QUEST_FLAG.accepted('blackout-schedule'));
      return s;
    })(),
    statuses: ['active', 'available', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked'],
  },
  {
    name: 'floor 110 with two mains done: the segment-3 main is active',
    state: (() => {
      const s = freshRun();
      setFlag(s, QUEST_FLAG.done('blackout-schedule'));
      setFlag(s, QUEST_FLAG.done('work-badge'));
      setFlag(s, QUEST_FLAG.accepted('pass-sticker'));
      s.currentFloor = 110;
      return s;
    })(),
    statuses: ['done', 'available', 'done', 'active', 'locked', 'locked', 'locked', 'locked'],
  },
  {
    name: 'the scripted mid-game run: five mains done, the finale still two segments away',
    state: scriptedMidGame(),
    statuses: ['done', 'available', 'done', 'done', 'done', 'done', 'locked', 'locked'],
  },
  {
    name: 'the scripted finale: the chain is complete, the last quest is offered',
    state: scriptedFinale(),
    statuses: ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'available'],
  },
];

// ── the panel's own flow, modelled ──────────────────────────────────────────

function listRowFits(ev: QuestEvaluation): void {
  // buildListRow prints the label at x+8 and the value right-aligned at
  // x+w-8: the two must not meet. 24 = both paddings plus a minimum gap.
  const labelW = estimateTextWidth(ev.quest.title, TYPE.body);
  const valueW = estimateTextWidth(`阶层${ev.quest.segment} · ${STATUS_LABEL[ev.status]}`, TYPE.body);
  expect(labelW + valueW + 24, `${ev.quest.id}: list row`).toBeLessThanOrEqual(QUEST_LIST_W);
}

/** The detail column's bottom edge for one quest, as refreshDetail flows it. */
function detailBottom(ev: QuestEvaluation, state: GameState): number {
  const summaryLines = wrapText(ev.quest.summary, QUEST_DETAIL_W, F_SUMMARY).length;
  let y = DETAIL_SUMMARY_TOP + summaryLines * estimateLineHeight(F_SUMMARY) + SUMMARY_BRANCH_GAP;
  ev.quest.branches.forEach((branch, b) => {
    const chosen = hasFlag(state, QUEST_FLAG.branch(ev.quest.id, branch.id));
    // The 已选 suffix is part of the printed text, so the wrap must budget it.
    const label = chosen ? `${branch.text}（已选）` : branch.text;
    let blockH = wrapText(label, QUEST_BRANCH_W, F_BRANCH).length * estimateLineHeight(F_BRANCH);
    const evaluation = ev.branches[b];
    if (!evaluation.available && evaluation.blockers.length > 0) {
      const reason = evaluation.blockers.join(' · ');
      blockH += BLOCKER_GAP + wrapText(reason, QUEST_BRANCH_W, F_BLOCKER).length * estimateLineHeight(F_BLOCKER);
    }
    y += blockH + BRANCH_GAP;
  });
  return y - BRANCH_GAP; // the last block's bottom, not the trailing gap
}

describe('quest panel layout', () => {
  it('pins the quest order the status tables are aligned against', () => {
    expect(QUEST_ORDER).toEqual([
      'blackout-schedule',
      'tap-water',
      'work-badge',
      'pass-sticker',
      'permit',
      'vip-card',
      'feast-ledger',
      'same-pen',
    ]);
  });

  it('fits every list row: title + 阶层/status inside the list column', () => {
    for (const rep of REPRESENTATIVES) {
      for (const ev of evaluateAllQuests(rep.state)) listRowFits(ev);
    }
  });

  it('keeps the whole list on the card', () => {
    const lastRowBottom = QUEST_LIST_TOP + (QUESTS.length - 1) * QUEST_ROW_PITCH + ROW_H;
    expect(lastRowBottom).toBeLessThanOrEqual(QUEST_PANEL_H - QUEST_DETAIL_FOOT_H);
  });

  it('orders the detail column anchors: the title clears the meta line, the meta clears the summary', () => {
    expect(DETAIL_TITLE_TOP + estimateLineHeight(F_TITLE)).toBeLessThanOrEqual(DETAIL_META_TOP);
    expect(DETAIL_META_TOP + estimateLineHeight(F_META)).toBeLessThanOrEqual(DETAIL_SUMMARY_TOP);
  });

  it('prints the detail title and meta line on one line each', () => {
    for (const rep of REPRESENTATIVES) {
      for (const ev of evaluateAllQuests(rep.state)) {
        const title = estimateTextWidth(ev.quest.title, F_TITLE);
        expect(title, `${ev.quest.id}: title`).toBeLessThanOrEqual(QUEST_DETAIL_W);
        const meta = estimateTextWidth(
          `阶层 ${ev.quest.segment} · ${'阶层名'.repeat(0)}${STATUS_LABEL[ev.status]}`,
          F_META,
        );
        // The tier name is at most six Han glyphs (工业与交易区); budget it.
        const metaWorst = estimateTextWidth(`阶层 6 · 工业与交易区 · ${STATUS_LABEL[ev.status]}`, F_META);
        expect(Math.max(meta, metaWorst), `${ev.quest.id}: meta`).toBeLessThanOrEqual(QUEST_DETAIL_W);
      }
    }
  });

  it('flows every quest\'s branches and blockers inside the detail column', () => {
    for (const rep of REPRESENTATIVES) {
      for (const ev of evaluateAllQuests(rep.state)) {
        const bottom = detailBottom(ev, rep.state);
        expect(bottom, `${ev.quest.id} @ ${rep.name}`).toBeLessThanOrEqual(QUEST_PANEL_H - QUEST_DETAIL_FOOT_H);
      }
    }
  });

  it('wraps branch text and blocker reasons at the column width, never past it', () => {
    for (const rep of REPRESENTATIVES) {
      for (const ev of evaluateAllQuests(rep.state)) {
        for (const [b, branch] of ev.quest.branches.entries()) {
          const evaluation = ev.branches[b];
          for (const line of wrapText(branch.text, QUEST_BRANCH_W, F_BRANCH)) {
            expect(estimateTextWidth(line, F_BRANCH), `${ev.quest.id}/${branch.id}: branch line`).toBeLessThanOrEqual(
              QUEST_BRANCH_W,
            );
          }
          if (evaluation.available) continue;
          for (const line of wrapText(evaluation.blockers.join(' · '), QUEST_BRANCH_W, F_BLOCKER)) {
            expect(estimateTextWidth(line, F_BLOCKER), `${ev.quest.id}/${branch.id}: blocker line`).toBeLessThanOrEqual(
              QUEST_BRANCH_W,
            );
          }
        }
      }
    }
  });

  it('grows the branch pool from the data: the widest quest has four branches', () => {
    // The scene sizes its pool with Math.max(...branches.length); this pins the
    // number the layout budget above is exercised against.
    expect(Math.max(...QUESTS.map((q) => q.branches.length))).toBe(4);
  });
});

describe('evaluateAllQuests output is stable across representative states', () => {
  it('repeats byte-for-byte on one state', () => {
    for (const rep of REPRESENTATIVES) {
      expect(evaluateAllQuests(rep.state)).toEqual(evaluateAllQuests(rep.state));
    }
  });

  it('pins the status vector of every representative state', () => {
    for (const rep of REPRESENTATIVES) {
      const got = evaluateAllQuests(rep.state).map((e) => e.status);
      expect(got, rep.name).toEqual([...rep.statuses]);
    }
  });

  it('reads the scripted mid-game state: materials open one branch, the missing ones are named', () => {
    const byId = new Map(evaluateAllQuests(scriptedMidGame()).map((e) => [e.quest.id, e]));
    const sticker = byId.get('pass-sticker');
    expect(sticker?.status).toBe('done');
    const branches = new Map(sticker?.branches.map((b) => [b.branch.id, b]));
    // 电线 2 + 胶带 1 + 电池 1 are in the bag: the short-circuit is open.
    expect(branches.get('short-circuit')?.available).toBe(true);
    expect(branches.get('short-circuit')?.blockers).toEqual([]);
    // One battery is in the bag (the short-circuit's own requirement), two
    // are not: the bribe names the shortfall against what is held.
    expect(branches.get('bribe-guard')?.available).toBe(false);
    expect(branches.get('bribe-guard')?.blockers).toEqual(['电池 1/2']);
    // The schedule flag from Q1 was set: the third way is open too.
    expect(branches.get('slipped-shift')?.available).toBe(true);
    // The evidence flag was NOT set: the trade names what is missing.
    const badge = new Map(byId.get('work-badge')?.branches.map((b) => [b.branch.id, b]));
    expect(badge.get('trade-evidence')?.available).toBe(false);
    expect(badge.get('trade-evidence')?.blockers).toEqual(['尚不知道「story:slum.holds-evidence」']);
    // The bag holds tape (the short-circuit's own material), so only the
    // other two forgery materials are named.
    expect(badge.get('forge')?.blockers).toEqual(['废金属 0/1', '布料 0/1']);
  });

  it('reads the scripted finale: the last quest opens, its gated branches stay named', () => {
    const byId = new Map(evaluateAllQuests(scriptedFinale()).map((e) => [e.quest.id, e]));
    const finale = byId.get('same-pen');
    expect(finale?.status).toBe('available');
    const branches = new Map(finale?.branches.map((b) => [b.branch.id, b]));
    expect(branches.get('shutdown')?.available).toBe(true);
    expect(branches.get('walk-away')?.available).toBe(true);
    // No evidence recorded, nobody volunteered: the two gated endings explain.
    expect(branches.get('hand-over')?.available).toBe(false);
    expect(branches.get('hand-over')?.blockers).toEqual(['尚不知道「story:feast.has-evidence」']);
    expect(branches.get('throne')?.available).toBe(false);
    expect(branches.get('throne')?.blockers.length).toBe(1);
  });

  it('marks a chosen branch for the panel without changing the evaluation', () => {
    const state = scriptedFinale();
    setFlag(state, QUEST_FLAG.branch('same-pen', 'shutdown'));
    const before = evaluateAllQuests(state);
    const finale = before.find((e) => e.quest.id === 'same-pen');
    expect(hasFlag(state, QUEST_FLAG.branch('same-pen', 'shutdown'))).toBe(true);
    // Choosing a branch is an integration-layer write; the pure evaluation of
    // the branch itself does not move because of it.
    expect(finale?.branches.find((b) => b.branch.id === 'shutdown')?.available).toBe(true);
    expect(evaluateAllQuests(state)).toEqual(before);
  });
});

// ── the tower overview detail card's second data source ─────────────────────
// TowerOverviewScene.refreshDetail switches the content row on
// hasFloorContent(floor): authored floors keep LootSystem's resolved view,
// unexplored ones read worldgen.summarizeFloor. The estimate string lives in
// the scene (which imports Phaser), so it is mirrored here exactly as
// uiLayout.test.ts mirrors the tower scene's type table — if the card's
// wording changes, this changes with it.

/** One unexplored floor per tier, all far from any authored segment. */
const UNEXPLORED_PER_TIER: readonly number[] = [50, 500, 5000, 20000, 60000, 95000];

/** The worst container count worldgen can roll (planUnexploredFloor: 2..5). */
const WORST_CONTAINERS = 5;

/** Mirrors TowerOverviewScene.describeUnexploredFloor. */
function estimateLine(seed: number, floor: number, containerCount: number): string {
  const summary = summarizeFloor(seed, floor);
  const loot = summary.lootPool.map((id) => getItem(id).displayName);
  return `未探索·预估：${summary.tier.name} · 容器 ${containerCount} 个 · 物资 ${summary.supplyGrade} 档 · 威胁「${summary.threatLabel}」 · 或可找到 ${loot.join('·')}`;
}

describe('tower overview detail card: the unexplored-floor estimate', () => {
  it('switches on authored-ness, not on the dev alias', () => {
    // The switch must be hasFloorContent: floor 100000 borrows floor 1's
    // template through DEV_FLOOR_ALIAS for entry purposes, but it is not
    // authored, so it takes the estimate path like every other unexplored
    // floor — and an authored floor keeps the resolved-contents path.
    expect(hasFloorContent(5)).toBe(true);
    expect(summarizeFloor(42, 5).authored).toBe(true);
    expect(hasFloorContent(100000)).toBe(false);
    expect(summarizeFloor(42, 100000).authored).toBe(false);
    for (const floor of UNEXPLORED_PER_TIER) {
      expect(hasFloorContent(floor), `floor ${floor}`).toBe(false);
      expect(summarizeFloor(42, floor).authored, `floor ${floor}`).toBe(false);
    }
  });

  it('carries the four facts the card promises: tier, containers, supply grade, threat', () => {
    for (const floor of UNEXPLORED_PER_TIER) {
      const line = estimateLine(42, floor, 3);
      expect(line.startsWith('未探索·预估：'), line).toBe(true);
      expect(line).toContain('容器 3 个');
      expect(line).toMatch(/物资 [1-5] 档/);
      expect(line).toMatch(/威胁「[^」]+」/);
      expect(line).toContain('或可找到');
      // The tier named in the estimate is the tower's own structural answer.
      expect(line).toContain(summarizeFloor(42, floor).tier.name);
    }
  });

  it('wraps the worst estimate inside the content row and keeps the adaptive card on canvas', () => {
    const lineH = estimateLineHeight(TYPE.body);
    for (const floor of UNEXPLORED_PER_TIER) {
      const line = estimateLine(42, floor, WORST_CONTAINERS);
      const lines = wrapText(line, DETAIL_CONTENT_W, TYPE.body).length;
      // The authored worst case (floor 50008's 1113px contents) is three
      // lines; the estimate may take one more, and the card grows for it.
      expect(lines, `${floor}: ${line}`).toBeLessThanOrEqual(4);
      for (const l of wrapText(line, DETAIL_CONTENT_W, TYPE.body)) {
        expect(estimateTextWidth(l, TYPE.body)).toBeLessThanOrEqual(DETAIL_CONTENT_W);
      }
      const contentTop = DETAIL_ROWS_TOP + DETAIL_ROW_PITCH * (DETAIL_ROW_COUNT - 1);
      const actionTop = contentTop + lines * lineH + DETAIL_CONTENT_ACTION_GAP;
      const panelH = Math.max(DETAIL_PANEL_H, actionTop + lineH + DETAIL_FOOT_PAD);
      expect(panelH, `${floor}: card height`).toBeLessThanOrEqual(DESIGN_HEIGHT - CONTENT_TOP - HUD_BOTTOM);
      // The scene sizes the card from the Text's own measured height, which can
      // run one line past the estimator's count (the tier-1 pool's seven items
      // wrap to five real lines where wrapText predicts four) — budget the
      // drift, because the card absorbs it.
      const drifted = Math.max(
        DETAIL_PANEL_H,
        contentTop + (lines + 1) * lineH + DETAIL_CONTENT_ACTION_GAP + lineH + DETAIL_FOOT_PAD,
      );
      expect(drifted, `${floor}: drifted card height`).toBeLessThanOrEqual(DESIGN_HEIGHT - CONTENT_TOP - HUD_BOTTOM);
    }
  });

  it('is stable across seeds in shape: the container count stays inside 2..5', () => {
    for (const seed of [42, 7, 2026]) {
      for (const floor of UNEXPLORED_PER_TIER) {
        const n = summarizeFloor(seed, floor).containerCount;
        expect(n, `seed ${seed} floor ${floor}`).toBeGreaterThanOrEqual(2);
        expect(n, `seed ${seed} floor ${floor}`).toBeLessThanOrEqual(WORST_CONTAINERS);
      }
    }
  });
});
