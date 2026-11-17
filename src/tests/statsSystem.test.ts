import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { runScore } from '../systems/progress';
import {
  RECORDS_KEY,
  STAT_KEYS,
  STAT_LABELS,
  bumpStat,
  createRunRecords,
  createRunStats,
  ensureStats,
  formatRunDuration,
  loadRunRecords,
  mergeRunRecords,
  noteFloorReached,
  noteGoldEarned,
  recordRows,
  runStatRows,
  saveRunRecords,
  settleRun,
  statsOf,
} from '../systems/StatsSystem';

// AG-81：StatsSystem 最小单测（纯逻辑，无 Phaser/localStorage 依赖——
// Node 环境下 store 一律显式传 mock storage，同 save.test.ts 的约定）。

function mockStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('StatsSystem：本局统计', () => {
  it('累积后读数正确（成功路径：bumpStat/noteFloorReached/noteGoldEarned → statsOf）', () => {
    const s = createNewGame(42);
    bumpStat(s, 'floorsClimbed', 3);
    bumpStat(s, 'monstersKilled', 2);
    bumpStat(s, 'damageDealt', 57);
    bumpStat(s, 'deaths');
    s.currentFloor = 7;
    noteFloorReached(s);
    s.player.gold += 50;
    noteGoldEarned(s, s.player.gold - 50);

    const stats = statsOf(s);
    expect(stats.floorsClimbed).toBe(3);
    expect(stats.monstersKilled).toBe(2);
    expect(stats.damageDealt).toBe(57);
    expect(stats.deaths).toBe(1);
    expect(stats.maxFloor).toBe(7);
    expect(stats.goldEarned).toBe(50);
    // 没碰过的键仍是零，且块已随 ensureStats 落进 state（读档继续接着计）
    expect(stats.bedsSearched).toBe(0);
    expect(s.stats).toBeDefined();
  });

  it('noteFloorReached 取历址最大：下楼不走低', () => {
    const s = createNewGame(42);
    s.currentFloor = 9;
    noteFloorReached(s);
    s.currentFloor = 3;
    noteFloorReached(s);
    expect(statsOf(s).maxFloor).toBe(9);
  });

  it('noteGoldEarned 只计正差：花费不进「金币收入」', () => {
    const s = createNewGame(42);
    const before = s.player.gold;
    s.player.gold = before + 30;
    noteGoldEarned(s, before);
    expect(statsOf(s).goldEarned).toBe(30);
    s.player.gold = before; // 花回去了
    noteGoldEarned(s, before + 30);
    expect(statsOf(s).goldEarned).toBe(30); // 不动
  });

  it('runStatRows：13 项计数 + 存活天数 + 游戏时长 + 本局得分，行序即 STAT_KEYS 行序', () => {
    const s = createNewGame(42);
    bumpStat(s, 'floorsClimbed', 2);
    const rows = runStatRows(s);
    expect(rows).toHaveLength(STAT_KEYS.length + 3);
    rows.slice(0, STAT_KEYS.length).forEach((row, i) => {
      const key = STAT_KEYS[i];
      expect(row.label).toBe(STAT_LABELS[key]);
      expect(row.value).toBe(`${statsOf(s)[key]}`);
    });
    expect(rows[rows.length - 3].label).toBe('存活天数');
    expect(rows[rows.length - 2].label).toBe('游戏时长');
    expect(rows[rows.length - 1].label).toBe('本局得分');
    // 与 progress.runScore 同源；公式本身的钉死在 progress.test.ts
    expect(rows[rows.length - 1].value).toBe(`${runScore(s)}`);
  });

  it('formatRunDuration：跨午夜的存档（minute < dayStart）不算负', () => {
    const s = createNewGame(42);
    s.day = 2;
    s.gameMinuteOfDay = 30; // 睡到 00:30
    expect(formatRunDuration(s)).toBe('18 小时 30 分'); // 1440 + 30 - 360 = 1110
    s.day = 1;
    s.gameMinuteOfDay = 360; // 开局时刻
    expect(formatRunDuration(s)).toBe('0 分');
  });

  it('旧存档 stats 缺失：statsOf 全零、runStatRows 不崩', () => {
    const s = createNewGame(42);
    delete s.stats; // createNewGame 不预置 stats；delete 模拟统计系统到来前的存档
    expect(statsOf(s)).toEqual(createRunStats());
    expect(runStatRows(s)).toHaveLength(STAT_KEYS.length + 3);
  });

  it('坏档 stats：NaN/Infinity/负数/小数/字符串一律按零读，ensureStats 顺手洗干净', () => {
    const s = createNewGame(42);
    s.stats = {
      ...createRunStats(),
      floorsClimbed: Number.NaN,
      maxFloor: Number.POSITIVE_INFINITY,
      containersLooted: -5,
      itemsCrafted: 2.7,
      monstersKilled: '3' as unknown as number,
      bedsSearched: Number.NEGATIVE_INFINITY,
    };
    const stats = statsOf(s);
    expect(stats.floorsClimbed).toBe(0);
    expect(stats.maxFloor).toBe(0);
    expect(stats.containersLooted).toBe(0);
    expect(stats.itemsCrafted).toBe(0);
    expect(stats.monstersKilled).toBe(0);
    expect(stats.bedsSearched).toBe(0);
    // 写路径过一次 ensureStats：坏值被清掉而不是写进存档
    ensureStats(s);
    expect(s.stats!.monstersKilled).toBe(0);
  });

  it('bumpStat 负 delta 被钳到 0（计数器只增不减）', () => {
    const s = createNewGame(42);
    bumpStat(s, 'damageTaken', 10);
    bumpStat(s, 'damageTaken', -99);
    expect(statsOf(s).damageTaken).toBe(0);
  });
});

describe('StatsSystem：跨局纪录', () => {
  it('mergeRunRecords：严格大于才破纪录，打平是追平不是新纪录', () => {
    const s = createNewGame(42);
    s.currentFloor = 5;
    s.day = 3;
    bumpStat(s, 'monstersKilled', 2);
    bumpStat(s, 'goldEarned', 100);

    const first = mergeRunRecords(createRunRecords(), s);
    expect(first.records).toEqual({ maxFloor: 5, maxDays: 3, maxKills: 2, maxGold: 100 });
    expect(first.beaten).toEqual(['maxFloor', 'maxDays', 'maxKills', 'maxGold']);

    const tie = mergeRunRecords(first.records, s);
    expect(tie.records).toEqual(first.records);
    expect(tie.beaten).toEqual([]); // 全部打平，一项都不算破

    const worse = mergeRunRecords(
      { maxFloor: 9, maxDays: 9, maxKills: 9, maxGold: 999 },
      s,
    );
    expect(worse.records).toEqual({ maxFloor: 9, maxDays: 9, maxKills: 9, maxGold: 999 });
    expect(worse.beaten).toEqual([]); // 浅的一局不抹掉别人的纪录
  });

  it('settleRun：读旧纪录 → 合并 → 落盘，读回一致', () => {
    const storage = mockStorage();
    const s = createNewGame(42);
    s.currentFloor = 4;
    s.day = 2;
    bumpStat(s, 'monstersKilled', 3);

    const settled = settleRun(s, storage);
    expect(settled.records).toEqual({ maxFloor: 4, maxDays: 2, maxKills: 3, maxGold: 0 });
    expect(storage.getItem(RECORDS_KEY)).not.toBeNull();
    expect(loadRunRecords(storage)).toEqual(settled.records);

    // 第二局更浅：纪录不掉，beaten 空
    const s2 = createNewGame(7);
    const settled2 = settleRun(s2, storage);
    expect(settled2.records).toEqual(settled.records);
    expect(settled2.beaten).toEqual([]);
  });

  it('recordRows：本局值 vs 历史纪录，破了的行带 record 标志', () => {
    const s = createNewGame(42);
    s.currentFloor = 6;
    s.day = 2;
    const settled = { records: { maxFloor: 5, maxDays: 2, maxKills: 0, maxGold: 0 }, beaten: ['maxFloor' as const] };
    const rows = recordRows(s, settled);
    expect(rows).toHaveLength(4);
    expect(rows[0].value).toBe('6（纪录 5）');
    expect(rows[0].record).toBe(true);
    expect(rows[1].record).toBe(false); // maxDays 打平
  });

  it('loadRunRecords 坏键不崩：坏 JSON/非对象/坏字段都按全零读', () => {
    expect(loadRunRecords(mockStorage({ [RECORDS_KEY]: '{oops' }))).toEqual(createRunRecords());
    expect(loadRunRecords(mockStorage({ [RECORDS_KEY]: '"nope"' }))).toEqual(createRunRecords());
    expect(loadRunRecords(mockStorage({ [RECORDS_KEY]: '{"maxFloor": "3"}' }))).toEqual(createRunRecords());
    expect(loadRunRecords(mockStorage({ [RECORDS_KEY]: '{"maxFloor": 12}' }))).toEqual({
      ...createRunRecords(),
      maxFloor: 12,
    });
  });

  it('saveRunRecords 被拒（配额/隐私模式）时返回 false 而不抛', () => {
    const storage = mockStorage();
    (storage as { setItem: (k: string, v: string) => void }).setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(saveRunRecords(createRunRecords(), storage)).toBe(false);
  });
});
