import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import {
  diaryFlagKey,
  diaryKindCount,
  diaryOf,
  isLegacyDiaryKind,
  migrateLegacyDiary,
  stressAfterEvent,
} from '../systems/DiarySystem';
import type { GameState } from '../core/gameTypes';

// RC-01 日记统一后，本文件只剩两件事：
//   1. stressAfterEvent——压力变化的唯一入口（ShelterSystem 显式调用，
//      旧路径寄生在 appendDiaryEvent 的 stressDelta 里）；
//   2. migrateLegacyDiary——旧档 DiaryEvent[] → 结构化日记的迁移。
// 结构化日记的读写面在 src/tests/diary.test.ts。

describe('DiarySystem · stressAfterEvent（压力变化）', () => {
  it('夹在 0..100 并应用增量', () => {
    const state = createNewGame(42);
    state.player.stress = 99;
    expect(stressAfterEvent(state, 10)).toBe(100);
    expect(stressAfterEvent(state, -200)).toBe(0);

    state.player.stress = 20;
    expect(stressAfterEvent(state, -6)).toBe(14); // 宿舍休息的降压值
    expect(stressAfterEvent(state, 10)).toBe(30); // 夜袭的增压值
  });

  it('缺 stress 字段按 20 起算（与 SaveSystem 的旧档修补同源）', () => {
    const state = createNewGame(42);
    state.player.stress = undefined as unknown as number;
    expect(stressAfterEvent(state, 0)).toBe(20);
    expect(stressAfterEvent(state, -5)).toBe(15);
  });
});

describe('DiarySystem · 旧档迁移（RC-01）', () => {
  /** 造一条旧 DiaryEvent（JSON 形状，未校验）。 */
  function legacyEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'day-1-minute-600-shelter_rested-0',
      day: 1,
      minute: 600,
      floor: 1,
      kind: 'shelter_rested',
      actorIds: ['player'],
      itemChanges: [],
      stressDelta: -6,
      message: '你把门关好，先让身体恢复一点。',
      ...overrides,
    };
  }

  function withLegacyDiary(events: unknown[]): GameState {
    const state = createNewGame(42);
    (state as GameState & { diary?: unknown }).diary = events;
    return state;
  }

  it('8 种旧 kind 全部认识，且映射到语义最相近的新 kind', () => {
    for (const kind of [
      'returned_from_scavenge',
      'late_return',
      'combat_wounded',
      'shelter_rested',
      'shelter_treated',
      'shelter_repaired',
      'neighbor_cared',
      'shelter_attacked',
    ]) {
      expect(isLegacyDiaryKind(kind), kind).toBe(true);
    }
    expect(isLegacyDiaryKind('not_a_kind')).toBe(false);
    expect(isLegacyDiaryKind(42)).toBe(false);

    const state = withLegacyDiary([
      legacyEvent({ kind: 'shelter_rested' }),
      legacyEvent({ kind: 'shelter_treated', message: '你用医疗包处理了伤口。' }),
      legacyEvent({ kind: 'shelter_repaired' }),
      legacyEvent({ kind: 'neighbor_cared', actorIds: ['player', 'xiaozhou'] }),
      legacyEvent({ kind: 'shelter_attacked', message: '夜里有人撞门。' }),
      legacyEvent({ kind: 'combat_wounded', actorIds: ['player', 'wanderer'] }),
      legacyEvent({ kind: 'late_return' }),
      legacyEvent({ kind: 'returned_from_scavenge' }),
    ]);
    migrateLegacyDiary(state);
    // diaryOf 是 day 倒序；同一天内后写的先。按写入逆序断言 kind。
    expect(diaryOf(state).map((e) => e.kind)).toEqual([
      'dwellerMorale', // returned_from_scavenge
      'lateFromScavenge',
      'dwellerWounded', // combat_wounded
      'shelterAttacked',
      'visitor', // neighbor_cared
      'dwellerMorale', // shelter_repaired
      'dwellerWounded', // shelter_treated
      'dwellerMorale', // shelter_rested
    ]);
  });

  it('迁移只搬事实：text 原样，minute/day 原样，压力不重放', () => {
    const state = withLegacyDiary([legacyEvent({ stressDelta: 10 })]);
    state.player.stress = 55;
    migrateLegacyDiary(state);
    expect(diaryOf(state)[0]).toEqual({
      kind: 'dwellerMorale',
      day: 1,
      minute: 600,
      text: '你把门关好，先让身体恢复一点。',
      actorId: 'player',
    });
    // stressDelta 在旧档运行时就已经 applied 过——再 apply 一次就是双扣。
    expect(state.player.stress).toBe(55);
  });

  it('个体态取第一个非玩家 actor（照顾邻居 → 小周亲历）；宿舍袭击是群体态', () => {
    const state = withLegacyDiary([
      legacyEvent({ kind: 'neighbor_cared', actorIds: ['player', 'xiaozhou'] }),
      legacyEvent({ kind: 'shelter_attacked', actorIds: ['player'] }),
      legacyEvent({ kind: 'combat_wounded', actorIds: ['player', 'wanderer'] }),
      legacyEvent({ kind: 'shelter_rested', actorIds: [] }),
    ]);
    migrateLegacyDiary(state);
    const byKey = new Map(diaryOf(state).map((e) => [`${e.kind}|${e.actorId ?? ''}`, e.actorId]));
    expect(byKey.get('visitor|xiaozhou')).toBe('xiaozhou');
    expect(byKey.get('shelterAttacked|')).toBeNull();
    expect(byKey.get('dwellerWounded|wanderer')).toBe('wanderer');
    // 没有任何 actor（旧数据不该出现，但别猜）→ 群体态 null
    expect(byKey.get('dwellerMorale|')).toBeNull();
  });

  it('迁移条目走 recordDiary：diary:<kind> 计数旗随之置起', () => {
    const state = withLegacyDiary([
      legacyEvent({ kind: 'shelter_attacked' }),
      legacyEvent({ kind: 'shelter_rested' }),
      legacyEvent({ kind: 'shelter_rested' }),
    ]);
    migrateLegacyDiary(state);
    expect(diaryKindCount(state, 'shelterAttacked')).toBe(1);
    expect(diaryKindCount(state, 'dwellerMorale')).toBe(2);
    expect(state.flags?.[diaryFlagKey('shelterAttacked')]).toBe(1);
  });

  it('幂等：第二次调用时旧字段已删，直接返回', () => {
    const state = withLegacyDiary([legacyEvent()]);
    migrateLegacyDiary(state);
    const after = diaryOf(state);
    migrateLegacyDiary(state);
    expect(diaryOf(state)).toEqual(after);
    expect((state as GameState & { diary?: unknown }).diary).toBeUndefined();
  });

  it('没有 diary 字段（新档）= no-op；坏形状条目跳过不抛', () => {
    const fresh = createNewGame(42);
    migrateLegacyDiary(fresh);
    expect(diaryOf(fresh)).toEqual([]);

    const messy = withLegacyDiary([
      null,
      'garbage',
      legacyEvent({ kind: 'not_a_kind' }),
      legacyEvent({ day: 'x' }),
      legacyEvent(), // 唯一一条好的
    ]);
    expect(() => migrateLegacyDiary(messy)).not.toThrow();
    expect(diaryOf(messy)).toHaveLength(1);
    expect(diaryOf(messy)[0].text).toBe('你把门关好，先让身体恢复一点。');
  });
});
