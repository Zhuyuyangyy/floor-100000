import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { STARTING_FLOOR } from '../core/constants';
import type { DiaryEntry, DiaryKind } from '../systems/DiarySystem';
import {
  DIARY_ENTRY_LIMIT,
  appendDiaryEvent,
  checkLateReturnDiary,
  checkSurvivalDiary,
  diaryFlagKey,
  diaryKindCount,
  diaryOf,
  hasDiaryKind,
  makeDiaryEvent,
  recordDiary,
  recordMoraleDiary,
  recordRequestFulfilledDiary,
  recordShelterAttackedDiary,
  recordSicknessDiary,
  recordVisitorDiary,
  recordWoundedDiary,
  recentDiary,
} from '../systems/DiarySystem';
import { deserialize, serialize, validateGameState } from '../systems/SaveSystem';
import { STAT_MAX } from '../systems/InventorySystem';
import type { SicknessTick } from '../systems/SicknessSystem';

// 契约 §5 定死的 11 种 kind。每条测试都会遍历它，漏一种就红。
const ALL_KINDS: DiaryKind[] = [
  'dwellerHungry', 'groupHungry',
  'dwellerMorale',
  'dwellerWounded',
  'dwellerSick', 'dwellerSickNoEffect',
  'lateFromScavenge',
  'shelterAttacked',
  'visitor', 'requestFulfilled',
];

function entry(kind: DiaryKind, overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return { kind, day: 2, minute: 725, text: `条目-${kind}`, actorId: 'player', ...overrides };
}

describe('DiarySystem · 契约 §5 读写面', () => {
  it('11 个 kind 各自可写可读', () => {
    const state = createNewGame(42);
    for (const kind of ALL_KINDS) recordDiary(state, entry(kind));

    const read = diaryOf(state);
    expect(read).toHaveLength(ALL_KINDS.length);
    // 倒序返回：最后写的在最前
    expect(read.map((e) => e.kind)).toEqual([...ALL_KINDS].reverse());
    for (const kind of ALL_KINDS) {
      expect(read.some((e) => e.kind === kind && e.text === `条目-${kind}`)).toBe(true);
    }
  });

  it('minute 必须为整数——小数分钟在写入口被 floor 并夹回一天内', () => {
    const state = createNewGame(42);
    // AG-06 的小数分钟 bug：gameMinuteOfDay 是帧推进的小数，直接写进存档
    // 会让任何整数假设的读者失配。
    state.gameMinuteOfDay = 480.34;
    const stored = recordDiary(state, entry('dwellerHungry', { minute: state.gameMinuteOfDay }));
    expect(stored.minute).toBe(480);
    expect(Number.isInteger(stored.minute)).toBe(true);

    const tooBig = recordDiary(state, entry('dwellerHungry', { minute: 1500.9 }));
    expect(tooBig.minute).toBe(1439);
    const negative = recordDiary(state, entry('dwellerHungry', { minute: -3.2 }));
    expect(negative.minute).toBe(0);

    for (const e of diaryOf(state)) expect(Number.isInteger(e.minute)).toBe(true);
  });

  it('diaryOf 按 day 倒序（新的在前），同日内后写的先', () => {
    const state = createNewGame(42);
    recordDiary(state, entry('dwellerHungry', { day: 1, minute: 100 }));
    recordDiary(state, entry('dwellerSick', { day: 2, minute: 200 }));
    recordDiary(state, entry('dwellerWounded', { day: 2, minute: 300 }));

    expect(diaryOf(state).map((e) => e.minute)).toEqual([300, 200, 100]);
    expect(diaryOf(state, 2).map((e) => e.minute)).toEqual([300, 200]);
    expect(diaryOf(state, 0)).toEqual([]);
    expect(diaryOf(state, -1)).toEqual([]);
  });

  it('条目进存档：serialize → deserialize 往返无损', () => {
    const state = createNewGame(42);
    recordDiary(state, entry('shelterAttacked', { day: 3, minute: 60, actorId: null }));
    recordDiary(state, entry('visitor', { day: 3, minute: 61, actorId: 'xiaozhou' }));

    const json = serialize(state);
    // 多出来的 diaryEntries 字段不会让存档校验变红
    expect(validateGameState(JSON.parse(json))).toEqual([]);

    const loaded = deserialize(json);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(diaryOf(loaded.state)).toEqual(diaryOf(state));
  });

  it('老存档没有日记字段也能加载，读出来是空', () => {
    // createNewGame 不写 diaryEntries——这就是老存档的形状
    const legacy = createNewGame(7);
    const loaded = deserialize(serialize(legacy));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(diaryOf(loaded.state)).toEqual([]);

    // 带旧 DiaryEvent、但没有新日记的存档同样加载，且两套互不干扰
    appendDiaryEvent(legacy, makeDiaryEvent(legacy, {
      floor: 1,
      kind: 'shelter_rested',
      actorIds: ['player'],
      itemChanges: [],
      stressDelta: -6,
      message: '旧格式的一条。',
    }));
    const loaded2 = deserialize(serialize(legacy));
    expect(loaded2.ok).toBe(true);
    if (!loaded2.ok) return;
    expect(diaryOf(loaded2.state)).toEqual([]);
    expect(recentDiary(loaded2.state)).toHaveLength(1);
  });

  it('flash 与 diary 并存不互相影响：新旧两套日记是独立存储', () => {
    const state = createNewGame(42);
    recordDiary(state, entry('dwellerHungry'));
    appendDiaryEvent(state, makeDiaryEvent(state, {
      floor: 1,
      kind: 'shelter_attacked',
      actorIds: ['player'],
      itemChanges: [],
      stressDelta: 10,
      message: '旧格式的袭击。',
    }));

    // 新日记看不见旧的
    expect(diaryOf(state)).toHaveLength(1);
    expect(diaryOf(state)[0].kind).toBe('dwellerHungry');
    // 旧日记的读者也看不见新的
    expect(state.diary).toHaveLength(1);
    expect(recentDiary(state, 5)).toHaveLength(1);

    // 再写一条新的，旧的仍然只有一条
    recordDiary(state, entry('visitor'));
    expect(state.diary).toHaveLength(1);
    expect(diaryOf(state)).toHaveLength(2);
  });

  it('同 seed 同 state 同结果：全流程无 Math.random', () => {
    const runOnce = (): DiaryEntry[] => {
      const s = createNewGame(2026);
      s.day = 2;
      s.player.hunger = 0;
      checkSurvivalDiary(s);
      s.day = 3;
      checkSurvivalDiary(s);
      recordShelterAttackedDiary(s, 12);
      recordVisitorDiary(s, 'xiaozhou', '小周');
      return diaryOf(s);
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('容量上限 64：超出裁掉最旧的', () => {
    const state = createNewGame(42);
    for (let i = 0; i < DIARY_ENTRY_LIMIT + 6; i++) {
      recordDiary(state, entry('dwellerHungry', { text: `第 ${i} 条` }));
    }
    const read = diaryOf(state);
    expect(read).toHaveLength(DIARY_ENTRY_LIMIT);
    expect(read[0].text).toBe(`第 ${DIARY_ENTRY_LIMIT + 5} 条`);
    expect(read[read.length - 1].text).toBe('第 6 条');
  });

  it('日记可按 flag 查询，且旗不被条目裁剪影响', () => {
    const state = createNewGame(42);
    expect(hasDiaryKind(state, 'shelterAttacked')).toBe(false);
    recordDiary(state, entry('shelterAttacked', { actorId: null }));
    expect(hasDiaryKind(state, 'shelterAttacked')).toBe(true);
    expect(diaryKindCount(state, 'shelterAttacked')).toBe(1);
    recordDiary(state, entry('shelterAttacked', { actorId: null }));
    expect(diaryKindCount(state, 'shelterAttacked')).toBe(2);
    expect(state.flags?.[diaryFlagKey('shelterAttacked')]).toBe(2);
  });
});

describe('DiarySystem · 个体/群体双轨', () => {
  it('个体条目带 actorId，群体条目为 null', () => {
    const state = createNewGame(42);
    const hungry = recordDiary(state, entry('dwellerHungry'));
    const group = recordDiary(state, entry('groupHungry', { actorId: null }));
    const visitor = recordDiary(state, entry('visitor', { actorId: 'xiaozhou' }));
    const fulfilled = recordDiary(state, entry('requestFulfilled', { actorId: null }));

    expect(hungry.actorId).toBe('player');
    expect(group.actorId).toBeNull();
    expect(visitor.actorId).toBe('xiaozhou');
    expect(fulfilled.actorId).toBeNull();

    // 「一个人饿是私事，一群人饿是事件」——同一天两档可以同时存在
    const kinds = diaryOf(state).map((e) => e.kind);
    expect(kinds).toContain('dwellerHungry');
    expect(kinds).toContain('groupHungry');
  });
});

describe('DiarySystem · 升级一：饥饿/口渴', () => {
  it('归零写 dwellerHungry（个体），连续第二天写 groupHungry（群体）', () => {
    const state = createNewGame(42);
    state.player.hunger = 0;
    state.day = 2;

    const first = checkSurvivalDiary(state);
    expect(first.map((e) => e.kind)).toEqual(['dwellerHungry']);
    expect(first[0].actorId).toBe('player');
    expect(first[0].text).toContain('饿倒');

    // 同一天重复调用不刷屏
    expect(checkSurvivalDiary(state)).toEqual([]);

    state.day = 3;
    state.player.hunger = 0;
    const second = checkSurvivalDiary(state);
    expect(second.map((e) => e.kind)).toEqual(['groupHungry']);
    expect(second[0].actorId).toBeNull();
    expect(second[0].text).toContain('连续第 2 天');

    state.day = 4;
    state.player.hunger = 0;
    const third = checkSurvivalDiary(state);
    expect(third[0].text).toContain('连续第 3 天');
  });

  it('中途恢复再归零，重新按个体记（链条断开）', () => {
    const state = createNewGame(42);
    state.day = 2;
    state.player.hunger = 0;
    checkSurvivalDiary(state);
    state.day = 3;
    state.player.hunger = 0;
    expect(checkSurvivalDiary(state)[0].kind).toBe('groupHungry');

    // 第 4 天恢复进食，第 5 天又归零——不是连续，回到个体态
    state.day = 4;
    state.player.hunger = 50;
    expect(checkSurvivalDiary(state)).toEqual([]);
    state.day = 5;
    state.player.hunger = 0;
    const again = checkSurvivalDiary(state);
    expect(again[0].kind).toBe('dwellerHungry');
    expect(again[0].actorId).toBe('player');
  });

  it('预警档（>0 但 ≤25%）写「这次没事」，每天一条', () => {
    const state = createNewGame(42);
    state.day = 2;
    state.player.hunger = STAT_MAX.hunger * 0.2;

    const warn = checkSurvivalDiary(state);
    expect(warn).toHaveLength(1);
    expect(warn[0].kind).toBe('dwellerHungry');
    expect(warn[0].text).toContain('这次没事');

    // 同一天不重复
    expect(checkSurvivalDiary(state)).toEqual([]);
    // 第二天还在预警档——日记每天一条，允许再记
    state.day = 3;
    expect(checkSurvivalDiary(state)).toHaveLength(1);
  });

  it('刚归零过不写预警（归零条目已经讲了那个故事）', () => {
    const state = createNewGame(42);
    state.day = 2;
    state.player.hunger = 0;
    checkSurvivalDiary(state);
    // 第二天恢复到预警档
    state.day = 3;
    state.player.hunger = STAT_MAX.hunger * 0.2;
    expect(checkSurvivalDiary(state)).toEqual([]);
  });

  it('口渴与饥饿同构', () => {
    const state = createNewGame(42);
    state.day = 2;
    state.player.thirst = 0;
    const first = checkSurvivalDiary(state);
    expect(first.map((e) => e.kind)).toEqual(['dwellerHungry']);
    expect(first[0].text).toContain('渴倒');
    state.day = 3;
    state.player.thirst = 0;
    const second = checkSurvivalDiary(state);
    expect(second[0].kind).toBe('groupHungry');
    expect(second[0].text).toContain('没水喝');
  });

  it('状态健康时什么也不写', () => {
    const state = createNewGame(42);
    state.player.hunger = STAT_MAX.hunger;
    state.player.thirst = STAT_MAX.thirst;
    expect(checkSurvivalDiary(state)).toEqual([]);
    expect(diaryOf(state)).toEqual([]);
  });
});

describe('DiarySystem · 升级二：夜间袭击', () => {
  it('宿舍被攻破写 shelterAttacked（群体态，伤害进文案）', () => {
    const state = createNewGame(42);
    state.day = 3;
    const stored = recordShelterAttackedDiary(state, 12);
    expect(stored.kind).toBe('shelterAttacked');
    expect(stored.actorId).toBeNull();
    expect(stored.day).toBe(3);
    expect(stored.text).toContain('攻破');
    expect(stored.text).toContain('12');
    expect(hasDiaryKind(state, 'shelterAttacked')).toBe(true);
  });
});

describe('DiarySystem · 升级三：流浪者/邻居', () => {
  it('NPC 来访写 visitor（个体态，actorId=npcId）', () => {
    const state = createNewGame(42);
    const stored = recordVisitorDiary(state, 'xiaozhou', '小周');
    expect(stored.kind).toBe('visitor');
    expect(stored.actorId).toBe('xiaozhou');
    expect(stored.text).toContain('小周');
    // 不传名字时退回 id
    const anon = recordVisitorDiary(state, 'alin');
    expect(anon.text).toContain('alin');
  });

  it('委托完成写 requestFulfilled（事务态，actorId=null）', () => {
    const state = createNewGame(42);
    const stored = recordRequestFulfilledDiary(state, '净水×3');
    expect(stored.kind).toBe('requestFulfilled');
    expect(stored.actorId).toBeNull();
    expect(stored.text).toContain('净水×3');
    // 没有摘要也能写
    expect(recordRequestFulfilledDiary(state).text).toContain('委托');
  });
});

describe('DiarySystem · 「没有效果」语义', () => {
  const quiet: SicknessTick = { worsened: [], recovered: [], critical: [] };

  it('语义一：病了但没恶化——dwellerSickNoEffect，每天一条', () => {
    const state = createNewGame(42);
    state.day = 2;
    state.player.ailments = [{ id: 'wound', severity: 30, sinceMinute: 0 }];

    const first = recordSicknessDiary(state, quiet);
    expect(first.map((e) => e.kind)).toEqual(['dwellerSickNoEffect']);
    expect(first[0].text).toContain('这次没事');
    // 同一天不再重复
    expect(recordSicknessDiary(state, quiet)).toEqual([]);
    // 第二天还在病着——日记每天一条
    state.day = 3;
    expect(recordSicknessDiary(state, quiet)).toHaveLength(1);
  });

  it('语义一：有转化时不写「无恙」；病好了也不再写', () => {
    const state = createNewGame(42);
    state.day = 2;
    state.player.ailments = [{ id: 'fever', severity: 30, sinceMinute: 0 }];
    const worsened = recordSicknessDiary(state, { ...quiet, worsened: ['fever'] });
    expect(worsened.map((e) => e.kind)).toEqual(['dwellerSick']);
    expect(recordSicknessDiary(state, quiet)).toHaveLength(1); // 只写无恙，当天首条
    expect(diaryKindCount(state, 'dwellerSickNoEffect')).toBe(1);

    // 没病就没话
    state.player.ailments = [];
    expect(recordSicknessDiary(state, quiet)).toEqual([]);
  });

  it('语义一：危急也是 dwellerSick，文案不同', () => {
    const state = createNewGame(42);
    state.player.ailments = [{ id: 'cold', severity: 99, sinceMinute: 0 }];
    const critical = recordSicknessDiary(state, { ...quiet, critical: ['cold'] });
    expect(critical[0].kind).toBe('dwellerSick');
    expect(critical[0].text).toContain('恶化');
  });

  it('语义二：饿了但没归零——预警档的 dwellerHungry 文案变体', () => {
    const state = createNewGame(42);
    state.day = 2;
    state.player.hunger = STAT_MAX.hunger * 0.25; // 恰好压在 25% 线上
    const warn = checkSurvivalDiary(state);
    expect(warn).toHaveLength(1);
    expect(warn[0].kind).toBe('dwellerHungry');
    expect(warn[0].text).toContain('这次没事');
  });
});

describe('DiarySystem · 其余 kind 与迟归', () => {
  it('迟归：入夜后还在宿舍外，每晚一条', () => {
    const state = createNewGame(42);
    state.currentFloor = STARTING_FLOOR + 1;
    state.day = 2;
    state.gameMinuteOfDay = 1080; // 18:00，入夜

    const first = checkLateReturnDiary(state);
    expect(first?.kind).toBe('lateFromScavenge');
    expect(first?.text).toContain('该回宿舍');
    // 同一天第二 tick 不重复
    expect(checkLateReturnDiary(state)).toBeNull();
    // 第二天入夜还在外面——新的一条
    state.day = 3;
    expect(checkLateReturnDiary(state)?.kind).toBe('lateFromScavenge');
  });

  it('迟归：天黑前或已回宿舍时不写', () => {
    const state = createNewGame(42);
    state.currentFloor = STARTING_FLOOR + 1;
    state.gameMinuteOfDay = 600; // 16:00，还没入夜
    expect(checkLateReturnDiary(state)).toBeNull();

    state.gameMinuteOfDay = 1200; // 入夜，但人在宿舍
    state.currentFloor = STARTING_FLOOR;
    expect(checkLateReturnDiary(state)).toBeNull();
  });

  it('受伤与心情各有写入入口', () => {
    const state = createNewGame(42);
    const wounded = recordWoundedDiary(state, '巡游体');
    expect(wounded.kind).toBe('dwellerWounded');
    expect(wounded.actorId).toBe('player');
    expect(wounded.text).toContain('巡游体');

    const morale = recordMoraleDiary(state, { delta: -3, reason: '抽了根烟' });
    expect(morale.kind).toBe('dwellerMorale');
    expect(morale.text).toContain('-3');

    const good = recordMoraleDiary(state, { delta: 5.4, reason: '听了收音机' });
    expect(good.text).toContain('+5');
  });

  it('helper 写入的条目走同一条 normalize：minute 小数被 floor', () => {
    const state = createNewGame(42);
    state.gameMinuteOfDay = 725.9;
    const stored = recordWoundedDiary(state);
    expect(stored.minute).toBe(725);
    expect(Number.isInteger(stored.minute)).toBe(true);
  });
});
