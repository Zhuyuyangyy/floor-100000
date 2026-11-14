import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { PLAYABLE_SEGMENTS } from '../core/segments';
import { NOTE_TEXTS_BY_TIER } from '../systems/encounters';
import { FLAG_PREFIX, setFlag } from '../systems/WorldFlags';
import type { GameState } from '../core/gameTypes';
import {
  QUESTS,
  QUEST_FLAG,
  STORY_FLAGS,
  conditionsMet,
  evaluateAllQuests,
  evaluateBranch,
  getQuest,
  questStatus,
  questsOfSegment,
  validateQuests,
} from '../data/quests';

// 首章任务链的验收（AG-10，docs/plans/STORY.md）。五条硬断言对应任务书的五项：
// 链无环、前置存在、后果 flag 合法、同 seed 求值可复现、覆盖全部可玩段；
// 另加纸条咬合（encounters.ts 的 18 条全被任务链引用）与状态机/分支门控抽查。

const QUEST_IDS = QUESTS.map((q) => q.id);

function scriptedState(seed: number): GameState {
  // 一条确定性的「打到 110 层」剧本：同 seed 必然同状态，用于复现性断言。
  const state = createNewGame(seed);
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

describe('quest chain integrity', () => {
  it('has unique ids', () => {
    expect(new Set(QUEST_IDS).size).toBe(QUEST_IDS.length);
  });

  it('is acyclic: no quest chain loops back through requires', () => {
    // 独立于 validateQuests 的三色 DFS——这条断言写的是「链」这个性质本身。
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    const visit = (id: string, trail: readonly string[]): void => {
      const c = color.get(id) ?? WHITE;
      if (c === GRAY) throw new Error(`cycle: ${[...trail, id].join(' -> ')}`);
      if (c === BLACK) return;
      color.set(id, GRAY);
      for (const req of getQuest(id).requires ?? []) visit(req, [...trail, id]);
      color.set(id, BLACK);
    };
    for (const id of QUEST_IDS) visit(id, []);
    expect(color.size).toBe(QUEST_IDS.length);
  });

  it('every prerequisite quest exists (no dangling requires)', () => {
    for (const quest of QUESTS) {
      for (const req of quest.requires ?? []) {
        expect(QUEST_IDS, `${quest.id} requires ${req}`).toContain(req);
      }
    }
  });

  it('every objective doneFlag follows the quest/objective convention', () => {
    for (const quest of QUESTS) {
      for (const objective of quest.objectives) {
        expect(objective.doneFlag).toBe(QUEST_FLAG.objective(quest.id, objective.id));
      }
    }
  });

  it('the main quests form one unbroken chain across the six story nodes', () => {
    // Q1 → Q2 → … → Q6：每段一条主线，前置是上一段的真相（docs/18 §3）。
    const mains = QUESTS.filter((q) => q.kind !== 'side').map((q) => q.id);
    expect(mains).toEqual([
      'blackout-schedule',
      'work-badge',
      'pass-sticker',
      'permit',
      'vip-card',
      'same-pen',
    ]);
    for (let i = 1; i < mains.length; i++) {
      expect(getQuest(mains[i]).requires).toContain(mains[i - 1]);
    }
  });

  it('validateQuests reports no errors', () => {
    expect(validateQuests().errors).toEqual([]);
  });
});

describe('branch consequences are legal', () => {
  it('every flag written by a branch lives in an existing WorldFlags namespace', () => {
    const prefixes = Object.values(FLAG_PREFIX);
    for (const quest of QUESTS) {
      for (const branch of quest.branches) {
        for (const c of branch.consequences) {
          if (c.kind !== 'setFlag' && c.kind !== 'clearFlag') continue;
          const sep = c.flag.indexOf(':');
          expect(sep, `${quest.id}/${branch.id}: "${c.flag}"`).toBeGreaterThan(0);
          expect(prefixes, `${quest.id}/${branch.id}: "${c.flag}"`).toContain(c.flag.slice(0, sep));
          expect(c.flag.length).toBeGreaterThan(sep + 1);
        }
      }
    }
  });

  it('every trigger and branch condition only reads well-formed flags', () => {
    const prefixes = Object.values(FLAG_PREFIX);
    const flagsOf = (cond: { flagsAll?: readonly string[]; flagsNone?: readonly string[]; flagsAny?: readonly string[] } | undefined): string[] =>
      cond ? [...(cond.flagsAll ?? []), ...(cond.flagsNone ?? []), ...(cond.flagsAny ?? [])] : [];
    for (const quest of QUESTS) {
      for (const flag of [...flagsOf(quest.trigger), ...quest.branches.flatMap((b) => flagsOf(b.requires))]) {
        expect(prefixes, `${quest.id}: "${flag}"`).toContain(flag.slice(0, flag.indexOf(':')));
      }
    }
  });

  it('every branch has at least one consequence', () => {
    for (const quest of QUESTS) {
      for (const branch of quest.branches) {
        expect(branch.consequences.length, `${quest.id}/${branch.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('segment-entry main quests grant their segment pass on every branch (no soft lock)', () => {
    // 段 2..5 的准入凭证必须每条分支都发得到：否则选错一个选项就永远上不去。
    for (const quest of QUESTS.filter((q) => q.kind === 'main' && q.segment >= 2 && q.segment <= 5)) {
      const pass = PLAYABLE_SEGMENTS.find((s) => s.id === quest.segment)?.requiresPass;
      expect(pass).toBeTruthy();
      for (const branch of quest.branches) {
        expect(
          branch.consequences.some((c) => c.kind === 'grantPass' && c.pass === pass),
          `${quest.id}/${branch.id} must grant ${pass}`,
        ).toBe(true);
      }
    }
  });

  it('side quests and the finale never hand out passes', () => {
    for (const quest of QUESTS.filter((q) => q.kind !== 'main' || q.segment === 1 || q.segment === 6)) {
      for (const branch of quest.branches) {
        expect(branch.consequences.some((c) => c.kind === 'grantPass')).toBe(false);
      }
    }
  });
});

describe('segments coverage', () => {
  it('covers every playable segment (the five stretches plus the 100000 finale)', () => {
    for (const segment of PLAYABLE_SEGMENTS) {
      expect(questsOfSegment(segment.id).length, `segment ${segment.id} (${segment.name})`).toBeGreaterThan(0);
    }
  });

  it('anchors each quest at its lift boundary or inside the segment it guards', () => {
    // 段际主线任务站在前一段顶层的货梯口被触发（work-badge 锚在 10 层，守 100 层）；
    // 段内任务与终局锚在自己段里。
    for (const quest of QUESTS) {
      const segment = PLAYABLE_SEGMENTS.find((s) => s.id === quest.segment);
      expect(segment).toBeDefined();
      const prev = PLAYABLE_SEGMENTS.filter((s) => s.id < quest.segment).pop();
      const inside = quest.anchorFloor >= segment!.from && quest.anchorFloor <= segment!.to;
      const atBoundary = prev !== undefined && quest.anchorFloor === prev.to;
      expect(inside || atBoundary, `${quest.id} anchors at ${quest.anchorFloor}`).toBe(true);
    }
  });
});

describe('notes engagement (NOTE_TEXTS_BY_TIER x quests)', () => {
  it('references all 18 tier notes from docs/18 §4 somewhere in the chain', () => {
    const referenced = new Set(
      QUESTS.flatMap((q) => q.objectives.flatMap((o) => (o.note ? [`${o.note.tier}:${o.note.index}`] : []))),
    );
    for (let tier = 1; tier <= 6; tier++) {
      const texts = NOTE_TEXTS_BY_TIER[tier as keyof typeof NOTE_TEXTS_BY_TIER];
      expect(texts.length).toBe(3);
      for (let index = 0; index < texts.length; index++) {
        expect(referenced.has(`${tier}:${index}`), `tier ${tier} note ${index} is orphaned: ${texts[index]}`).toBe(true);
      }
    }
  });

  it('only references note slots that exist', () => {
    for (const quest of QUESTS) {
      for (const objective of quest.objectives) {
        if (!objective.note) continue;
        const texts = NOTE_TEXTS_BY_TIER[objective.note.tier];
        expect(texts).toBeDefined();
        expect(objective.note.index).toBeLessThan(texts.length);
      }
    }
  });
});

describe('evaluation is deterministic and pure', () => {
  it('same seed yields byte-identical evaluations', () => {
    const a = evaluateAllQuests(scriptedState(20261115));
    const b = evaluateAllQuests(scriptedState(20261115));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('evaluating twice on one state changes nothing', () => {
    const state = scriptedState(7);
    const before = JSON.stringify(state);
    const first = evaluateAllQuests(state);
    const second = evaluateAllQuests(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('a different playthrough script yields different availability (the evaluation reads state)', () => {
    const withSchedule = scriptedState(1);
    const withoutSchedule = scriptedState(1);
    // 同 seed，只差一个 flag：Q1 选了 expose 还是 keep，直接决定 Q3 少一条路。
    delete withoutSchedule.flags?.[STORY_FLAGS.slumKnowsSchedule];
    const slippedWith = evaluateBranch(withSchedule, getQuest('pass-sticker').branches.find((b) => b.id === 'slipped-shift')!);
    const slippedWithout = evaluateBranch(withoutSchedule, getQuest('pass-sticker').branches.find((b) => b.id === 'slipped-shift')!);
    expect(slippedWith.available).toBe(true);
    expect(slippedWithout.available).toBe(false);
    expect(slippedWithout.blockers.length).toBeGreaterThan(0);
  });
});

describe('quest status machine', () => {
  it('walks locked -> available -> active -> done', () => {
    const state = createNewGame(42);
    const quest = getQuest('blackout-schedule');
    // 第 1 层还没见到阿林：锁着。
    state.currentFloor = 1;
    expect(questStatus(state, quest)).toBe('locked');
    // 上了 2 层：可接。
    state.currentFloor = 2;
    expect(questStatus(state, quest)).toBe('available');
    setFlag(state, QUEST_FLAG.accepted(quest.id));
    expect(questStatus(state, quest)).toBe('active');
    setFlag(state, QUEST_FLAG.done(quest.id));
    expect(questStatus(state, quest)).toBe('done');
    // done 优先于触发条件：下了楼、材料花了，任务也不会变回锁定。
    state.currentFloor = 1;
    expect(questStatus(state, quest)).toBe('done');
  });

  it('keeps a chained main quest locked until the previous one is done', () => {
    const state = createNewGame(42);
    state.currentFloor = 10;
    const quest = getQuest('work-badge');
    expect(questStatus(state, quest)).toBe('locked');
    setFlag(state, QUEST_FLAG.done('blackout-schedule'));
    expect(questStatus(state, quest)).toBe('available');
  });

  it('gates branch availability on flags, items and floor', () => {
    const state = createNewGame(42);
    state.currentFloor = 10;
    setFlag(state, QUEST_FLAG.done('blackout-schedule'));
    setFlag(state, QUEST_FLAG.accepted('work-badge'));
    const badge = getQuest('work-badge');

    // 材料不够：仿制与撬墙都点不动，交易签字页也缺 flag。
    for (const id of ['forge', 'pry-wall']) {
      expect(evaluateBranch(state, badge.branches.find((b) => b.id === id)!).available).toBe(false);
    }
    expect(evaluateBranch(state, badge.branches.find((b) => b.id === 'trade-evidence')!).available).toBe(false);

    // 补上 Q1「留着签字页」的后果 flag：交易路开了，其余依旧。
    setFlag(state, STORY_FLAGS.slumHoldsEvidence);
    expect(evaluateBranch(state, badge.branches.find((b) => b.id === 'trade-evidence')!).available).toBe(true);
    expect(evaluateBranch(state, badge.branches.find((b) => b.id === 'forge')!).available).toBe(false);
  });

  it('the finale branches read the whole chain: evidence opens hand-over, volunteering opens the seat', () => {
    const state = createNewGame(42);
    state.currentFloor = 100000;
    for (const id of ['blackout-schedule', 'work-badge', 'pass-sticker', 'permit', 'vip-card']) {
      setFlag(state, QUEST_FLAG.done(id));
    }
    setFlag(state, QUEST_FLAG.accepted('same-pen'));
    const finale = getQuest('same-pen');
    const branchOf = (id: string) => finale.branches.find((b) => b.id === id)!;

    // 什么都没有：只有关掉它或离开。
    expect(evaluateBranch(state, branchOf('shutdown')).available).toBe(true);
    expect(evaluateBranch(state, branchOf('walk-away')).available).toBe(true);
    expect(evaluateBranch(state, branchOf('hand-over')).available).toBe(false);
    expect(evaluateBranch(state, branchOf('throne')).available).toBe(false);

    // 盛宴录了账，但 SQ1 选过「掺着卖脏水」：底层不信你，hand-over 依旧锁着。
    setFlag(state, STORY_FLAGS.feastHasEvidence);
    setFlag(state, STORY_FLAGS.tapExploited);
    expect(evaluateBranch(state, branchOf('hand-over')).available).toBe(false);
    expect(evaluateBranch(state, branchOf('hand-over')).blockers.length).toBeGreaterThan(0);

    // 洗干净名声（重开一档的镜像：没有 tapExploited）：证据路开。
    const clean = createNewGame(42);
    clean.currentFloor = 100000;
    for (const id of ['blackout-schedule', 'work-badge', 'pass-sticker', 'permit', 'vip-card']) {
      setFlag(clean, QUEST_FLAG.done(id));
    }
    setFlag(clean, QUEST_FLAG.accepted('same-pen'));
    setFlag(clean, STORY_FLAGS.feastHasEvidence);
    expect(evaluateBranch(clean, branchOf('hand-over')).available).toBe(true);

    // 签过字的人才有椅子坐。
    setFlag(state, STORY_FLAGS.permitVolunteered);
    expect(evaluateBranch(state, branchOf('throne')).available).toBe(true);
  });

  it('conditionsMet answers floor and item gates directly', () => {
    const state = createNewGame(42);
    expect(conditionsMet(state, { minFloor: 5 })).toBe(false);
    state.currentFloor = 5;
    expect(conditionsMet(state, { minFloor: 5 })).toBe(true);
    expect(conditionsMet(state, { items: [{ itemId: 'fuse', count: 1 }] })).toBe(false);
    state.player.inventory.slots.push({ itemId: 'fuse', quantity: 1 });
    expect(conditionsMet(state, { items: [{ itemId: 'fuse', count: 1 }] })).toBe(true);
    expect(conditionsMet(state, undefined)).toBe(true);
  });
});
