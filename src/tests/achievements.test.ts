import { describe, expect, it } from 'vitest';

import { ACHIEVEMENTS, TALKABLE_NPC_IDS, WEAPON_RECIPE_IDS, achievementById, type AchievementDef } from '../data/achievements';
import {
  ACHIEVEMENTS_STORAGE_KEY,
  achievementProgress,
  applyEvent,
  clearAchievements,
  evaluateAchievements,
  freshAchievements,
  isUnlocked,
  loadAchievements,
  saveAchievements,
  type AchievementSave,
  type AchievementStats,
} from '../systems/AchievementSystem';

// AG-77 成就系统单测（纯逻辑层：事件驱动求值 + 持久化修复）。
// 运行：VITE_NPC_MODEL= vitest run src/tests/achievements.test.ts

/** 一个假的 Storage，让持久化测试不碰真实 localStorage（node 环境也没有）。 */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const statsOf = (save: AchievementSave): AchievementStats => save.stats;

describe('AG-77 成就表', () => {
  it('十四条、id 唯一、steamApiName 唯一且非空', () => {
    expect(ACHIEVEMENTS).toHaveLength(14);
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(14);
    const apiNames = ACHIEVEMENTS.map((a) => a.steamApiName);
    expect(new Set(apiNames).size).toBe(14);
    for (const a of ACHIEVEMENTS) {
      expect(a.steamApiName.length).toBeGreaterThan(0);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
      expect(['bronze', 'silver', 'gold']).toContain(a.tier);
    }
  });

  it('覆盖任务点名的全部十四项', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const id of [
      'depth_10', 'depth_110', 'depth_1010', 'depth_10010', 'depth_50010', 'depth_100000',
      'first_craft', 'all_weapons', 'thirst_streak_3', 'night_watch_5', 'bunks_10',
      'talk_all_npcs', 'boss_no_damage', 'loot_single_3',
    ]) {
      expect(ids.has(id), `missing ${id}`).toBe(true);
    }
  });

  it('depth_10 的门槛正好是 10（差一层不亮）', () => {
    const save = evaluateAchievements(freshAchievements(), { type: 'floor_reached', floor: 9 }).save;
    expect(save.unlocked).not.toContain('depth_10');
    const save2 = evaluateAchievements(save, { type: 'floor_reached', floor: 10 }).save;
    expect(save2.unlocked).toContain('depth_10');
  });

  it('achievementById 认得每一条', () => {
    for (const a of ACHIEVEMENTS) expect(achievementById(a.id)?.name).toBe(a.name);
    expect(achievementById('nope')).toBeUndefined();
  });
});

describe('AG-77 evaluateAchievements', () => {
  it('深跳越过中间里程碑时一并解锁（乘电梯 1→110 得两条）', () => {
    const { save, unlocked } = evaluateAchievements(freshAchievements(), { type: 'floor_reached', floor: 110 });
    expect(unlocked.map((d) => d.id)).toEqual(['depth_10', 'depth_110']);
    expect(save.unlocked).toEqual(['depth_10', 'depth_110']);
    expect(statsOf(save).deepestFloor).toBe(110);
  });

  it('已解锁不重发（幂等）', () => {
    let save = freshAchievements();
    const first = evaluateAchievements(save, { type: 'floor_reached', floor: 10 });
    save = first.save;
    const again = evaluateAchievements(save, { type: 'floor_reached', floor: 10 });
    expect(again.unlocked).toEqual([]);
    expect(again.save.unlocked).toEqual(['depth_10']);
  });

  it('楼层只深不浅：回到 1 层不动纪录', () => {
    let save = evaluateAchievements(freshAchievements(), { type: 'floor_reached', floor: 10 }).save;
    save = evaluateAchievements(save, { type: 'floor_reached', floor: 1 }).save;
    expect(statsOf(save).deepestFloor).toBe(10);
  });

  it('首次制作：一次配方即亮；武器计数只认四件武器配方', () => {
    let save = freshAchievements();
    let out = evaluateAchievements(save, { type: 'item_crafted', recipeId: 'lamp' });
    expect(out.unlocked.map((d) => d.id)).toEqual(['first_craft']);
    save = out.save;
    expect(statsOf(save).crafts).toBe(1);
    expect(statsOf(save).weaponsCrafted).toEqual([]);
    // 铲子不是武器：不应计入四件套
    save = evaluateAchievements(save, { type: 'item_crafted', recipeId: 'craft_shovel' }).save;
    expect(statsOf(save).weaponsCrafted).toEqual([]);
    expect(isUnlocked(save, 'all_weapons')).toBe(false);
    // 四件武器全做（顺序无关、重复做不重复计数）
    for (const id of WEAPON_RECIPE_IDS) {
      out = evaluateAchievements(save, { type: 'item_crafted', recipeId: id });
      save = out.save;
    }
    expect([...statsOf(save).weaponsCrafted].sort()).toEqual([...WEAPON_RECIPE_IDS].sort());
    expect(out.unlocked.map((d) => d.id)).toEqual(['all_weapons']);
    save = evaluateAchievements(save, { type: 'item_crafted', recipeId: 'craft_dagger' }).save;
    expect([...statsOf(save).weaponsCrafted].sort()).toEqual([...WEAPON_RECIPE_IDS].sort());
  });

  it('连续 3 天不缺水：断签归零、满三天亮', () => {
    let save = freshAchievements();
    const day = (dehydrated: boolean): void => {
      save = evaluateAchievements(save, { type: 'day_end', dehydrated }).save;
    };
    day(false);
    day(true); // 第二天见底：连签清零
    expect(statsOf(save).thirstStreak).toBe(0);
    day(false);
    day(false);
    expect(statsOf(save).thirstStreak).toBe(2);
    expect(isUnlocked(save, 'thirst_streak_3')).toBe(false);
    day(false);
    expect(statsOf(save).thirstStreak).toBe(3);
    expect(isUnlocked(save, 'thirst_streak_3')).toBe(true);
  });

  it('守夜 5 次：差一次不亮', () => {
    let save = freshAchievements();
    let last = { save, unlocked: [] as AchievementDef[] };
    for (let i = 0; i < 4; i++) {
      last = evaluateAchievements(last.save, { type: 'night_watch_prevented' });
    }
    expect(last.unlocked).toEqual([]);
    expect(statsOf(last.save).nightWatches).toBe(4);
    last = evaluateAchievements(last.save, { type: 'night_watch_prevented' });
    expect(last.unlocked.map((d) => d.id)).toEqual(['night_watch_5']);
    expect(statsOf(last.save).nightWatches).toBe(5);
  });

  it('拆床 10 张：逐张计数到量', () => {
    let save = freshAchievements();
    let last = { save, unlocked: [] as string[] };
    for (let i = 0; i < 10; i++) {
      const out = evaluateAchievements(last.save, { type: 'bunk_dismantled' });
      last = { save: out.save, unlocked: out.unlocked.map((d) => d.id) };
    }
    expect(last.unlocked).toEqual(['bunks_10']);
    expect(statsOf(last.save).bunksDismantled).toBe(10);
  });

  it('全 NPC 对话：六位集齐才亮、重复对话不重复计', () => {
    let save = freshAchievements();
    let out = evaluateAchievements(save, { type: 'npc_talked', npcId: 'alin' });
    save = out.save;
    out = evaluateAchievements(save, { type: 'npc_talked', npcId: 'alin' });
    save = out.save;
    expect(statsOf(save).npcsTalked).toEqual(['alin']);
    for (const id of TALKABLE_NPC_IDS.slice(1)) {
      out = evaluateAchievements(save, { type: 'npc_talked', npcId: id });
      save = out.save;
    }
    expect(out.unlocked.map((d) => d.id)).toEqual(['talk_all_npcs']);
    expect(statsOf(save).npcsTalked).toEqual([...TALKABLE_NPC_IDS]);
  });

  it('零伤害击败守门人：掉过血的不亮', () => {
    const hurt = evaluateAchievements(freshAchievements(), { type: 'boss_won', damageTaken: 12 });
    expect(hurt.unlocked).toEqual([]);
    expect(statsOf(hurt.save).bossNoDamage).toBe(false);
    const clean = evaluateAchievements(freshAchievements(), { type: 'boss_won', damageTaken: 0 });
    expect(clean.unlocked.map((d) => d.id)).toEqual(['boss_no_damage']);
    // 已得真后一次掉血胜局不会抹掉
    const after = evaluateAchievements(clean.save, { type: 'boss_won', damageTaken: 5 }).save;
    expect(isUnlocked(after, 'boss_no_damage')).toBe(true);
  });

  it('单次搜刮 3 件+：取历史最大值', () => {
    let save = freshAchievements();
    save = evaluateAchievements(save, { type: 'loot_taken', count: 2 }).save;
    expect(isUnlocked(save, 'loot_single_3')).toBe(false);
    const out = evaluateAchievements(save, { type: 'loot_taken', count: 3 });
    expect(out.unlocked.map((d) => d.id)).toEqual(['loot_single_3']);
    save = out.save;
    save = evaluateAchievements(save, { type: 'loot_taken', count: 1 }).save;
    expect(statsOf(save).bestSingleLoot).toBe(3);
  });

  it('纯函数：输入 save 不被就地修改', () => {
    const before = freshAchievements();
    const snapshot = JSON.stringify(before);
    evaluateAchievements(before, { type: 'floor_reached', floor: 110 });
    evaluateAchievements(before, { type: 'item_crafted', recipeId: 'craft_dagger' });
    evaluateAchievements(before, { type: 'npc_talked', npcId: 'alin' });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('一条事件可同时点亮多条（深跳 100000 得全部六条深度成就）', () => {
    const { save, unlocked } = evaluateAchievements(freshAchievements(), { type: 'floor_reached', floor: 100000 });
    expect(unlocked.map((d) => d.id)).toEqual([
      'depth_10', 'depth_110', 'depth_1010', 'depth_10010', 'depth_50010', 'depth_100000',
    ]);
    expect(save.unlocked).toHaveLength(6);
  });

  it('applyEvent 逐类型并入计数', () => {
    let s = freshAchievements().stats;
    s = applyEvent(s, { type: 'floor_reached', floor: 5 });
    s = applyEvent(s, { type: 'item_crafted', recipeId: 'craft_fire_axe' });
    s = applyEvent(s, { type: 'bunk_dismantled' });
    s = applyEvent(s, { type: 'night_watch_prevented' });
    s = applyEvent(s, { type: 'npc_talked', npcId: 'xiaozhou' });
    s = applyEvent(s, { type: 'loot_taken', count: 4 });
    s = applyEvent(s, { type: 'boss_won', damageTaken: 0 });
    s = applyEvent(s, { type: 'day_end', dehydrated: false });
    expect(s.deepestFloor).toBe(5);
    expect(s.crafts).toBe(1);
    expect(s.weaponsCrafted).toEqual(['craft_fire_axe']);
    expect(s.bunksDismantled).toBe(1);
    expect(s.nightWatches).toBe(1);
    expect(s.npcsTalked).toEqual(['xiaozhou']);
    expect(s.bestSingleLoot).toBe(4);
    expect(s.bossNoDamage).toBe(true);
    expect(s.thirstStreak).toBe(1);
  });
});

describe('AG-77 持久化', () => {
  it('写-读往返一致', () => {
    const storage = memoryStorage();
    let save = freshAchievements();
    save = evaluateAchievements(save, { type: 'floor_reached', floor: 110 }).save;
    save = evaluateAchievements(save, { type: 'item_crafted', recipeId: 'craft_dagger' }).save;
    save = evaluateAchievements(save, { type: 'loot_taken', count: 3 }).save;
    expect(saveAchievements(save, storage)).toBe(true);
    const back = loadAchievements(storage);
    expect(back).toEqual(save);
  });

  it('键独立且稳定（跨重开/重置游戏不清空由「不与存档同键」保证）', () => {
    expect(ACHIEVEMENTS_STORAGE_KEY).toBe('floor100000.achievements.v1');
  });

  it('空存储返回新档', () => {
    expect(loadAchievements(memoryStorage())).toEqual(freshAchievements());
  });

  it('坏 JSON 修复为新档而不是抛', () => {
    const storage = memoryStorage({ [ACHIEVEMENTS_STORAGE_KEY]: '{oops' });
    expect(loadAchievements(storage)).toEqual(freshAchievements());
  });

  it('脏字段逐项修复：类型错按缺省、认不出的 id 丢弃', () => {
    const dirty = {
      unlocked: ['depth_10', 'not_a_real_achievement', 42],
      stats: {
        deepestFloor: '110',
        crafts: -3,
        weaponsCrafted: ['craft_dagger', 'craft_nope', 7],
        bunksDismantled: 2.7,
        nightWatches: null,
        npcsTalked: ['alin', 9],
        bestSingleLoot: Number.NaN,
        bossNoDamage: 'yes',
        thirstStreak: 1.9,
      },
    };
    const storage = memoryStorage({ [ACHIEVEMENTS_STORAGE_KEY]: JSON.stringify(dirty) });
    const save = loadAchievements(storage);
    expect(save.unlocked).toEqual(['depth_10']);
    expect(save.stats).toEqual({
      deepestFloor: 0, // 字符串 → 缺省
      crafts: 0, // 负数 → 缺省
      weaponsCrafted: ['craft_dagger'],
      bunksDismantled: 2, // 小数 → 取整
      nightWatches: 0,
      npcsTalked: ['alin'],
      bestSingleLoot: 0,
      bossNoDamage: false, // 非 true → false
      thirstStreak: 1,
    });
  });

  it('写档被拒（配额满）时返回 false 不抛', () => {
    const hostile = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    expect(saveAchievements(freshAchievements(), hostile)).toBe(false);
    // 读也不抛
    expect(loadAchievements(hostile)).toEqual(freshAchievements());
  });

  it('clearAchievements 清掉键', () => {
    const storage = memoryStorage();
    saveAchievements(evaluateAchievements(freshAchievements(), { type: 'floor_reached', floor: 10 }).save, storage);
    expect(loadAchievements(storage).unlocked).toEqual(['depth_10']);
    clearAchievements(storage);
    expect(loadAchievements(storage).unlocked).toEqual([]);
  });

  it('存下的旧档在新版表下仍可读（缺 stats 整块）', () => {
    const storage = memoryStorage({ [ACHIEVEMENTS_STORAGE_KEY]: JSON.stringify({ unlocked: ['first_craft'] }) });
    const save = loadAchievements(storage);
    expect(save.unlocked).toEqual(['first_craft']);
    expect(save.stats).toEqual(freshAchievements().stats);
  });
});

describe('AG-77 查看面板进度文案', () => {
  it('每条成就都给得出非空进度串', () => {
    let save = freshAchievements();
    save = evaluateAchievements(save, { type: 'floor_reached', floor: 110 }).save;
    save = evaluateAchievements(save, { type: 'item_crafted', recipeId: 'lamp' }).save;
    for (const a of ACHIEVEMENTS) {
      const line = achievementProgress(save, a.id);
      expect(line.length, `${a.id} progress`).toBeGreaterThan(0);
    }
  });

  it('深度类显示最深楼层、集合类显示分子分母', () => {
    let save = freshAchievements();
    save = evaluateAchievements(save, { type: 'floor_reached', floor: 1010 }).save;
    expect(achievementProgress(save, 'depth_10')).toContain('1010');
    expect(achievementProgress(save, 'all_weapons')).toBe(`武器 0/${WEAPON_RECIPE_IDS.length}`);
    expect(achievementProgress(save, 'talk_all_npcs')).toBe(`对话 0/${TALKABLE_NPC_IDS.length}`);
  });

  it('已解锁由调用方决定文案（本函数只给事实）', () => {
    const save = evaluateAchievements(freshAchievements(), { type: 'boss_won', damageTaken: 0 }).save;
    expect(achievementProgress(save, 'boss_no_damage')).toBe('已达成');
  });
});
