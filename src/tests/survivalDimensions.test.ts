import { beforeEach, describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';
import {
  PLAYABLE_FLOORS_V01,
  SCHEMA_VERSION,
  SURVIVAL_BALANCE,
  WARMTH_SOURCES,
  environmentFor,
  warmthOf,
} from '../core/constants';
import { getItem } from '../data/items';
import { deserialize, serialize, validateGameState } from '../systems/SaveSystem';
import { BODY_TEMP_MAX, warmthAt } from '../systems/EnvironmentSystem';
import { hasAilment, inflict, severityOf } from '../systems/SicknessSystem';
import {
  backFromScavenge,
  beginDayMorale,
  cheerFromItem,
  moraleBandOf,
  moraleBaselineOf,
  moraleLabel,
  moraleOf,
  tickMorale,
  witnessTrauma,
} from '../systems/MoraleSystem';
import {
  bodyHeatOf,
  deathCause,
  resetSicknessTimers,
  setBodyHeat,
  sicknessOf,
  sleep,
  spendTime,
  tickSicknessTier,
} from '../systems/SurvivalSystem';
import type { GameState } from '../core/gameTypes';

// AG-25（TWOM 对齐 §2/§3）：四条生存维度 + 五个 tick 的机制单测。
// 数值全部来自 config/game-balance.json 的 warmthSources / floorWarmth /
// morale / sickness 块——这里断言行为，不把节奏数字抄成字面量（除少数由数据
// 直接决定的，如楼层 cold/humidity 与恢复公式）。

function on(floor: number, x = 640): GameState {
  const s = createNewGame(1);
  s.currentFloor = floor;
  s.player.x = x;
  return s;
}

// A save written before any of the four AG-25 dimensions — and before the
// 2026-11-07 bodyTemp/ailments systems too. The validator must accept it and
// the game must run it.
function legacySave(): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    runSeed: 42,
    day: 3,
    gameMinuteOfDay: 900,
    currentFloor: 3,
    status: 'playing',
    player: {
      x: 640,
      hp: 70,
      hunger: 40,
      thirst: 40,
      energy: 60,
      equipped: null,
      homeUpgrades: [],
      inventory: { slotCount: 12, slots: [] },
    },
    npcStates: {},
    visitedFloors: {},
    worldEvents: { history: [], activeEvent: null },
  };
}

beforeEach(() => {
  resetSicknessTimers();
});

describe('契约字段：缺字段补默认（不升 schemaVersion）', () => {
  it('a new run carries none of the dimensions until first read', () => {
    // createNewGame 在 core/gameState.ts（不属 AG-25），所以默认值靠访问器懒创建
    // ——与 growth 的 ensureGrowth 同一模式。
    const s = createNewGame(1);
    expect(s.player.bodyHeat).toBeUndefined();
    expect(s.player.morale).toBeUndefined();
    expect(s.player.moraleBaseline).toBeUndefined();
    expect(s.player.sickness).toBeUndefined();
    expect(s.player.sicknessDay).toBeUndefined();
  });

  it('bodyHeatOf defaults to full and inherits a legacy bodyTemp reading', () => {
    const fresh = createNewGame(1);
    expect(bodyHeatOf(fresh)).toBe(BODY_TEMP_MAX);
    expect(fresh.player.bodyHeat).toBe(BODY_TEMP_MAX);

    const legacy = createNewGame(1);
    legacy.player.bodyTemp = 42; // 体温系统写的旧档：有 bodyTemp，没有 bodyHeat
    expect(bodyHeatOf(legacy)).toBe(42);
  });

  it('morale defaults to the configured pool and baseline', () => {
    const s = createNewGame(1);
    expect(moraleOf(s)).toBe(SURVIVAL_BALANCE.morale.defaultMorale);
    expect(moraleBaselineOf(s)).toBe(SURVIVAL_BALANCE.morale.defaultMorale);
  });

  it('self-heals out-of-range hand-edited save values', () => {
    const s = createNewGame(1);
    s.player.morale = 999;
    expect(moraleOf(s)).toBe(SURVIVAL_BALANCE.morale.moraleMax);
    s.player.morale = -999;
    expect(moraleOf(s)).toBe(SURVIVAL_BALANCE.morale.moraleMin);
    s.player.bodyHeat = 500;
    expect(bodyHeatOf(s)).toBe(BODY_TEMP_MAX);
  });

  it('sickness starts healthy', () => {
    expect(sicknessOf(createNewGame(1))).toBe('healthy');
  });
});

describe('TickTemperature：cold 消耗 bodyHeat，热源附近恢复', () => {
  it('drains bodyHeat on a cold floor through the shared clock', () => {
    const s = on(4, 640);
    spendTime(s, 60); // one game hour
    // floor 4: cold 3.2 × (1 + humidity 0.7) = 5.44 per hour
    expect(bodyHeatOf(s)).toBeCloseTo(BODY_TEMP_MAX - 5.44, 5);
    // 契约字段与 EnvironmentSystem 的工作字段永远同一个数
    expect(s.player.bodyHeat).toBe(s.player.bodyTemp);
  });

  it('recovers inside a warmth source and stops outside it', () => {
    const src = WARMTH_SOURCES[5]![0]!;
    const warm = on(5, src.x);
    const away = on(5, src.x + src.radius + 40);
    warm.player.bodyTemp = 40;
    away.player.bodyTemp = 40;
    spendTime(warm, 60);
    spendTime(away, 60);
    expect(bodyHeatOf(warm)).toBeGreaterThan(40);
    expect(bodyHeatOf(away)).toBeLessThan(40);
  });

  it('humidity makes the drain faster', () => {
    // 2F 干：1.6 × 1.2 = 1.92；3F 潮：2.4 × 1.6 = 3.84。没有湿度系数比值只有
    // 1.5，有它恰好 2。
    const dry = on(2, 640);
    const wet = on(3, 640);
    spendTime(dry, 60);
    spendTime(wet, 60);
    const dryLoss = BODY_TEMP_MAX - bodyHeatOf(dry);
    const wetLoss = BODY_TEMP_MAX - bodyHeatOf(wet);
    expect(wetLoss / dryLoss).toBeCloseTo(2, 5);
  });

  it('bodyHeat 0 is hypothermia: HP drains at the configured rate on top of the freeze', () => {
    const s = on(4, 640);
    setBodyHeat(s, 0);
    const hp = s.player.hp;
    spendTime(s, 60);
    // EnvironmentSystem 在 FREEZING_THRESHOLD(10) 以下已有 2/小时；归零后再叠
    // 配置的那一档（契约「0 = 失温失败」）。
    expect(s.player.hp).toBeCloseTo(hp - (2 + SURVIVAL_BALANCE.sickness.hypothermiaHpPerGameHour), 5);
    expect(deathCause(s)).toBe('失温');
  });

  it('deathCause still names dehydration and hunger before the cold', () => {
    const s = on(1);
    s.player.thirst = 0;
    expect(deathCause(s)).toBe('严重脱水');
    s.player.thirst = 50;
    s.player.hunger = 0;
    expect(deathCause(s)).toBe('饥饿');
    s.player.hunger = 50;
    expect(deathCause(s)).toBe('伤势过重');
  });
});

describe('TickHeaters：热源几何读配置，走近回温走开降回去', () => {
  it('reads its geometry from the balance JSON, not from hardcoded tables', () => {
    expect(WARMTH_SOURCES[1]).toHaveLength(3); // dorm: three candles
    expect(WARMTH_SOURCES[5]![0]!.radius).toBeGreaterThan(WARMTH_SOURCES[1]![0]!.radius); // brazier
    expect(WARMTH_SOURCES[4]).toBeUndefined(); // maintenance has no heater
    expect(WARMTH_SOURCES).toBe(SURVIVAL_BALANCE.warmthSources); // 同一个表，家在 JSON
  });

  it('gives full power at the centre and nothing past the radius', () => {
    const src = WARMTH_SOURCES[5]![0]!;
    expect(warmthAt(5, src.x)).toBeCloseTo(src.power, 5);
    expect(warmthAt(5, src.x + src.radius)).toBe(0);
    expect(warmthAt(5, src.x + src.radius / 2)).toBeCloseTo(src.power / 2, 5);
  });

  it('an hour in the brazier recovers the damp-adjusted power minus the floor drain', () => {
    const src = WARMTH_SOURCES[5]![0]!;
    const s = on(5, src.x);
    setBodyHeat(s, 50);
    spendTime(s, 60);
    // 14 × (1 − 0.5×0.5) − 2.0 × (1 + 0.5) = 10.5 − 3.0 = +7.5
    expect(bodyHeatOf(s)).toBeCloseTo(57.5, 5);
  });
});

describe('环境参数接通（契约第二节：environmentFor 解析顺序）', () => {
  it('keeps the authored ladder unchanged for floors without a template tweak', () => {
    expect(environmentFor(6).label).toBe('底层贫民区');
    expect(environmentFor(99).label).toBe(environmentFor(5).label);
    expect(environmentFor(10005).label).toBe('中产与商业区');
  });

  it('merges FloorTemplate.environment over the ladder, template first', () => {
    // AG-30 的数据还没落地（floorTemplates.ts 没有 environment 字段），用打补丁的
    // 方式验证合并语义；AG-30 落地后这里读到的就是真数据。
    const carrier = FLOOR_TEMPLATES[3] as unknown as { environment?: Record<string, number> };
    carrier.environment = { cold: 9.9, warmth: 0.4 };
    try {
      const env = environmentFor(3);
      expect(env.cold).toBe(9.9); // template 优先
      expect(env.humidity).toBe(0.6); // 未写的字段继承阶梯
      expect(env.label).toBe('储物层');
      expect(warmthOf(3)).toBe(0.4); // warmth 走同一条合并
    } finally {
      delete carrier.environment;
    }
    expect(environmentFor(3).cold).toBe(2.4); // 补丁已撤，阶梯复位
  });

  it('warmthOf: the floor template wins, the JSON ladder is only the fallback', () => {
    // 契约第二节：FLOOR_TEMPLATES[floor].environment.warmth（AG-30 的逐层数据）
    // 优先于 SURVIVAL_BALANCE.floorWarmth（AG-25 的默认梯）。第 1 层两个源都有
    // 值——template 0.35（床+三支蜡烛）盖住梯的 0.5，这正是契约要的"逐层微调
    // 优先"。
    expect(environmentFor(1).warmth).toBe(0.35);
    expect(warmthOf(1)).toBe(0.35);
    // 没有 template 条目的层才落到 JSON 梯：3 层储物层无热源 = 0，
    // 100 层以上未列出 = 0。
    expect(environmentFor(3).warmth).toBeUndefined();
    expect(warmthOf(3)).toBe(0);
    expect(warmthOf(100)).toBe(0);
    // 兜底梯本身仍在：给一个没有 template 的层打补丁，验证它真的会被读到。
    const patched = { ...FLOOR_TEMPLATES };
    delete patched[1];
    const before = FLOOR_TEMPLATES[1];
    FLOOR_TEMPLATES[1] = undefined as unknown as typeof before;
    expect(warmthOf(1)).toBe(SURVIVAL_BALANCE.floorWarmth[1]);
    FLOOR_TEMPLATES[1] = before;
    expect(Object.keys(patched).length).toBeGreaterThan(0);
  });
});

describe('ProcessSickness：healthy < sick < critical 三档', () => {
  it('starts healthy', () => {
    const s = on(1);
    const t = tickSicknessTier(s);
    expect(t.tier).toBe('healthy');
    expect(t.becameSick).toBe(false);
    expect(t.recovered).toBe(false);
    expect(s.player.sickness).toBe('healthy');
  });

  it('crosses to sick at the biting band and records the day', () => {
    const s = on(1);
    s.day = 4;
    inflict(s, 'fever', 30, 0);
    const t = tickSicknessTier(s);
    expect(t.tier).toBe('sick');
    expect(t.becameSick).toBe(true);
    expect(t.day).toBe(4);
    expect(s.player.sicknessDay).toBe(4);
  });

  it('migrates sick -> critical and back to healthy', () => {
    const s = on(1);
    inflict(s, 'fever', 30, 0);
    expect(tickSicknessTier(s).tier).toBe('sick');

    inflict(s, 'fever', 100, 0); // 恶化到满
    const crit = tickSicknessTier(s);
    expect(crit.tier).toBe('critical');
    expect(crit.becameCritical).toBe(true);
    expect(crit.becameSick).toBe(false);

    s.player.ailments = []; // 治好
    const healed = tickSicknessTier(s);
    expect(healed.tier).toBe('healthy');
    expect(healed.recovered).toBe(true);
  });

  it('reports sick-but-unchanged once per day (DwellerSicknessNoEffect)', () => {
    const s = on(1);
    inflict(s, 'fever', 40, 0);
    tickSicknessTier(s); // healthy -> sick
    expect(tickSicknessTier(s).sickNoEffect).toBe(true); // 病了但没恶化，仍然告知
    expect(tickSicknessTier(s).sickNoEffect).toBe(false); // 同一天不重复告知
    s.day = 2;
    expect(tickSicknessTier(s).sickNoEffect).toBe(true); // 新的一天再告知一次
  });

  it('a sick player burns bars faster than a healthy one', () => {
    const healthy = on(1);
    const ill = on(1);
    inflict(ill, 'food_poisoning', 50, 0);
    const beforeIll = ill.player.hunger;
    const beforeHealthy = healthy.player.hunger;
    spendTime(ill, 60);
    spendTime(healthy, 60);
    expect(beforeIll - ill.player.hunger).toBeGreaterThan(beforeHealthy - healthy.player.hunger);
  });
});

describe('染病条件（ProcessSickness 的入口侧）', () => {
  it('starving for N game hours contracts a fever, and reports it on the tick', () => {
    const s = on(1);
    s.player.hunger = 0;
    let tick;
    for (let i = 0; i < 4; i++) tick = spendTime(s, 60); // 4 小时 > 3 小时阈值
    expect(hasAilment(s, 'fever')).toBe(true);
    expect(severityOf(s, 'fever')).toBe(SURVIVAL_BALANCE.sickness.exposureSeverity);
    expect(tick?.contracted).toContain('fever');
  });

  it('does not contract before the threshold', () => {
    const s = on(1);
    s.player.hunger = 0;
    for (let i = 0; i < 3; i++) spendTime(s, 60); // 3 小时整，未过线
    expect(hasAilment(s, 'fever')).toBe(false);
  });

  it('rearms the clock when the player eats', () => {
    const s = on(1);
    s.player.hunger = 0;
    spendTime(s, 120); // 饿 2 小时
    s.player.hunger = 50; // 吃到东西
    spendTime(s, 1);
    s.player.hunger = 0; // 再开始饿
    for (let i = 0; i < 3; i++) spendTime(s, 60); // 重新计满 3 小时，仍未过线
    expect(hasAilment(s, 'fever')).toBe(false);
    spendTime(s, 60); // 第 4 小时，过线
    expect(hasAilment(s, 'fever')).toBe(true);
  });

  it('contracts on a damp, dangerous floor at night', () => {
    const s = on(4, 640); // humidity 0.7 ≥ 0.5, danger 0.8 ≥ 0.6
    s.gameMinuteOfDay = 1260; // 21:00
    for (let i = 0; i < 3; i++) spendTime(s, 30); // 90 分钟 > 60
    expect(hasAilment(s, 'fever')).toBe(true);
  });

  it('does not contract by day, nor on a damp-but-safe floor', () => {
    const day = on(4, 640);
    day.gameMinuteOfDay = 720; // 正午
    for (let i = 0; i < 6; i++) spendTime(day, 30);
    expect(hasAilment(day, 'fever')).toBe(false);

    const safe = on(3, 640); // 潮（0.6）但 danger 0.5 < 0.6
    safe.gameMinuteOfDay = 1260;
    for (let i = 0; i < 6; i++) spendTime(safe, 30);
    expect(hasAilment(safe, 'fever')).toBe(false);
  });

  it('keeps the existing freeze -> cold rule working through the shared clock', () => {
    // 体温过低持续染病是 SicknessSystem 既有的第三条（FREEZE_TO_COLD_MINUTES），
    // AG-25 不重复造，只验证它在新编排下仍然生效。
    const s = on(4, 640);
    setBodyHeat(s, 5); // below FREEZING_THRESHOLD
    for (let i = 0; i < 6; i++) spendTime(s, 20); // 120 分钟 > 90
    expect(hasAilment(s, 'cold')).toBe(true);
    // 收尾：回暖，清掉 SicknessSystem 模块级的 freezeSince，不污染后续测试
    setBodyHeat(s, 60);
    spendTime(s, 1);
  });
});

describe('morale：点数池 + 衰减 + 概率生效（TWOM §2 五机制）', () => {
  it('mechanism 1 — baseline drifts each day, the pool fades toward it', () => {
    const s = createNewGame(1);
    expect(moraleOf(s)).toBe(0);
    beginDayMorale(s);
    expect(moraleBaselineOf(s)).toBe(SURVIVAL_BALANCE.morale.dayBeginChange);

    s.player.morale = 10; // 高于基线：每小时最多降 decayPerGameHour
    const t = tickMorale(s, 60);
    expect(moraleOf(s)).toBeCloseTo(10 - SURVIVAL_BALANCE.morale.decayPerGameHour, 5);
    expect(t.cheered).toBe(false);

    s.player.morale = -10; // 低于基线：向上回归
    tickMorale(s, 60);
    expect(moraleOf(s)).toBeCloseTo(-10 + SURVIVAL_BALANCE.morale.decayPerGameHour, 5);
  });

  it('mechanism 1 — day begin runs on midnight crossings and on sleep alike', () => {
    const rolled = on(1);
    rolled.gameMinuteOfDay = 1430;
    spendTime(rolled, 30); // crosses midnight
    expect(rolled.day).toBe(2);
    expect(moraleBaselineOf(rolled)).toBe(SURVIVAL_BALANCE.morale.dayBeginChange);

    const slept = on(1);
    slept.gameMinuteOfDay = 1200;
    sleep(slept);
    expect(slept.day).toBe(2);
    expect(moraleBaselineOf(slept)).toBe(SURVIVAL_BALANCE.morale.dayBeginChange);
  });

  it('mechanism 2 — a cheer item moves the pool by its delta', () => {
    const s = createNewGame(1);
    const r = cheerFromItem(s, { moraleDelta: 12, moraleChance: 1 }, 'coffee');
    expect(r.applied).toBe(true);
    expect(r.delta).toBe(12);
    expect(moraleOf(s)).toBe(12);
  });

  it('mechanism 2 — an item without morale fields is not a cheer item', () => {
    const s = createNewGame(1);
    expect(cheerFromItem(s, {}, 'ration_pack').applied).toBe(false);
    expect(cheerFromItem(s, { moraleDelta: 0 }, 'x').applied).toBe(false);
    expect(moraleOf(s)).toBe(0);
  });

  it('mechanism 3 — the roll is seeded: same seed same outcome, and it really varies', () => {
    // 同 seed 同日同时刻：两次调用同一结果——禁 Math.random 的钉子。
    const a = createNewGame(7);
    const b = createNewGame(7);
    a.gameMinuteOfDay = 400;
    b.gameMinuteOfDay = 400;
    const item = { moraleDelta: 10, moraleChance: 0.5 };
    expect(cheerFromItem(a, item, 'coffee').applied).toBe(cheerFromItem(b, item, 'coffee').applied);

    // 概率是真的：固定输入扫一圈分钟，命中与未命中都出现。
    const outcomes = new Set<boolean>();
    for (let m = 360; m <= 380; m++) {
      const s = createNewGame(1);
      s.gameMinuteOfDay = m;
      outcomes.add(cheerFromItem(s, item, 'coffee').applied);
    }
    expect(outcomes.size).toBe(2);
  });

  it('mechanism 3 — chance 0 never fires, chance 1 always does', () => {
    const never = createNewGame(1);
    expect(cheerFromItem(never, { moraleDelta: 10, moraleChance: 0 }, 'x').applied).toBe(false);
    expect(moraleOf(never)).toBe(0);
    const always = createNewGame(1);
    expect(cheerFromItem(always, { moraleDelta: 10, moraleChance: 1 }, 'x').applied).toBe(true);
  });

  it('mechanism 4 — trauma is a probability roll that applies the trauma delta', () => {
    const hits: number[] = [];
    const misses: number[] = [];
    for (let m = 360; m <= 400; m++) {
      const probe = createNewGame(1);
      probe.gameMinuteOfDay = m;
      (witnessTrauma(probe).traumatised ? hits : misses).push(m);
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(misses.length).toBeGreaterThan(0);

    const scarred = createNewGame(1);
    scarred.gameMinuteOfDay = hits[0]!;
    scarred.player.morale = 20;
    expect(witnessTrauma(scarred).traumatised).toBe(true);
    expect(moraleOf(scarred)).toBe(20 + SURVIVAL_BALANCE.morale.traumaDelta);

    const steadied = createNewGame(1);
    steadied.gameMinuteOfDay = misses[0]!;
    steadied.player.morale = 20;
    expect(witnessTrauma(steadied).traumatised).toBe(false);
    expect(moraleOf(steadied)).toBe(20); // 未命中不动池子
  });

  it('mechanism 5 — home from a full bag lifts, empty hands drop, ordinary nothing', () => {
    const full = createNewGame(1);
    expect(backFromScavenge(full, 3)).toBe(SURVIVAL_BALANCE.morale.backHigherMorale);
    expect(moraleOf(full)).toBe(SURVIVAL_BALANCE.morale.backHigherMorale);

    const empty = createNewGame(1);
    expect(backFromScavenge(empty, 0)).toBe(SURVIVAL_BALANCE.morale.backLowerMorale);
    expect(moraleOf(empty)).toBe(SURVIVAL_BALANCE.morale.backLowerMorale);

    const ordinary = createNewGame(1);
    expect(backFromScavenge(ordinary, 2)).toBe(0);
    expect(moraleOf(ordinary)).toBe(0);
  });

  it('bands and labels follow the config thresholds', () => {
    const s = createNewGame(1);
    s.player.morale = SURVIVAL_BALANCE.morale.goodMorale;
    expect(moraleBandOf(s)).toBe('high');
    expect(moraleLabel(s)).toBe('士气高涨');
    s.player.morale = SURVIVAL_BALANCE.morale.badMorale;
    expect(moraleBandOf(s)).toBe('low');
    expect(moraleLabel(s)).toBe('情绪低落');
    s.player.morale = 0;
    expect(moraleBandOf(s)).toBe('steady');
    expect(moraleLabel(s)).toBe('情绪平稳');
  });

  it('the pool rides the shared clock: spendTime fades it like the frame loop', () => {
    const s = on(1);
    s.player.morale = 6;
    const tick = spendTime(s, 120);
    expect(tick.morale?.morale).toBeCloseTo(6 - SURVIVAL_BALANCE.morale.decayPerGameHour * 2, 5);
  });
});

describe('睡眠夜间结算（TWOM：ProcessSleep 与其它 Tick 并列）', () => {
  it('the bed warms by the floor warmth: dorm yes, storage floor no', () => {
    const dorm = on(1);
    dorm.gameMinuteOfDay = 1200;
    setBodyHeat(dorm, 30);
    const r = sleep(dorm);
    expect(r.ok).toBe(true);
    // 期望值从 warmthOf(1) 现算，不写死：warmth 的权威来源是楼层 template
    // （契约第二节），它的值归 AG-30 调；写死 0.5 会在下次调 warmth 时假红。
    // sleepBodyHeatPerHour × warmth × 睡眠小时数 = 回温量。
    expect(bodyHeatOf(dorm)).toBeCloseTo(30 + SURVIVAL_BALANCE.sickness.sleepBodyHeatPerHour * warmthOf(1) * 10, 5);

    const cold = on(3); // warmth 0——这层没有热源，睡了也冷
    cold.gameMinuteOfDay = 1200;
    setBodyHeat(cold, 30);
    sleep(cold);
    expect(bodyHeatOf(cold)).toBe(30);
  });

  it('a starving sleeper can contract a fever during the night', () => {
    const s = on(1);
    s.player.hunger = 0;
    spendTime(s, 60); // 睡前已饿 1 小时——计时器起跑
    s.gameMinuteOfDay = 1200;
    const r = sleep(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contracted).toContain('fever');
    expect(hasAilment(s, 'fever')).toBe(true);
  });

  it('wakes with the tier re-read: a pre-existing sickness is still there', () => {
    const s = on(1);
    s.gameMinuteOfDay = 1200;
    inflict(s, 'fever', 40, 0);
    const r = sleep(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sicknessTier?.tier).toBe('sick');
    expect(s.player.sickness).toBe('sick');
    expect(s.player.sicknessDay).toBe(2); // 睡醒即第 2 天
  });
});

describe('老存档加载（缺字段补默认，不升 schemaVersion）', () => {
  it('accepts a save written before any of the four dimensions', () => {
    const raw = legacySave();
    expect(validateGameState(raw)).toEqual([]);
    const r = deserialize(serialize(raw as unknown as GameState));
    expect(r.ok).toBe(true);
  });

  it('a legacy save runs the survival clock without crashing and gains defaults', () => {
    const r = deserialize(serialize(legacySave() as unknown as GameState));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.state;
    expect(s.player.bodyHeat).toBeUndefined();
    expect(bodyHeatOf(s)).toBe(BODY_TEMP_MAX); // 读取即补默认：老存档没有 bodyTemp，按满温重建
    expect(() => spendTime(s, 60)).not.toThrow();
    // 之后照常被楼层消耗：floor 3 = 2.4 × (1 + 0.6) = 3.84/小时
    expect(bodyHeatOf(s)).toBeCloseTo(BODY_TEMP_MAX - 3.84, 5);
    expect(moraleOf(s)).toBe(SURVIVAL_BALANCE.morale.defaultMorale);
    expect(sicknessOf(s)).toBe('healthy');
  });

  it('round-trips the new dimensions through a save', () => {
    const s = createNewGame(99);
    setBodyHeat(s, 33);
    s.player.morale = -25;
    s.player.moraleBaseline = -5;
    inflict(s, 'fever', 60, 0);
    spendTime(s, 30); // 让 tick 把 sickness / sicknessDay 写进去
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.state.player.bodyHeat).toBeCloseTo(back.state.player.bodyTemp!, 5);
    expect(back.state.player.morale).toBeCloseTo(-25 + SURVIVAL_BALANCE.morale.decayPerGameHour * 0.5, 5);
    expect(back.state.player.moraleBaseline).toBe(-5);
    expect(back.state.player.sickness).toBe('sick');
    expect(back.state.player.sicknessDay).toBe(1);
  });
});

// AG-25 的硬边界：新增维度不许动「每层至多一瓶 guaranteed 水」。survivalBalance
// .test.ts 钉的是全塔余量上限；这里钉每条楼层自身的保证量不越一瓶。
describe('survivalBalance 硬边界：没有第二瓶 guaranteed 水', () => {
  it('no playable floor carries more than one guaranteed bottle', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const t = FLOOR_TEMPLATES[floor]!;
      let thirst = 0;
      for (const c of t.containers) {
        for (const l of c.loot) {
          if (!l.guaranteed) continue;
          const e = getItem(l.itemId).effect;
          if (e?.stat === 'thirst') thirst += e.amount * l.min;
        }
      }
      for (const g of t.ground) {
        const e = getItem(g.itemId).effect;
        if (e?.stat === 'thirst') thirst += e.amount * g.quantity;
      }
      expect(thirst, `floor ${floor} carries a second guaranteed bottle`).toBeLessThanOrEqual(30);
    }
  });
});
