// 楼层遭遇系统（OVERHAUL M1）：问号点触发的一次性事件。
// 所有随机必须走 seeded RNG（docs/02_TECH_SPEC.md §3，禁止 Math.random），
// 保证同 seed 同 spotId 的遭遇完全可复现；所有物品变动必须真实作用于
// state.player.inventory（经 InventorySystem），HP 变动只以 hpChange 返回，
// 由调用方（GameScene）落地，避免本模块偷偷改状态。
import { deriveSeed, makeRng } from '../core/rng';
import type { Rng } from '../core/rng';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import type { GameState, ItemId } from '../core/gameTypes';
import { addItem, countItem, removeItem } from './InventorySystem';

export type EncounterKind = 'loot' | 'ambush' | 'trader' | 'note' | 'cache' | 'boss';

export type EncounterChoice = 'take' | 'fight' | 'flee' | 'trade' | 'leave' | 'read';

export interface Encounter {
  kind: EncounterKind;
  floor: number;
  message: string;
}

export interface EncounterResult {
  hpChange: number;
  // 本次真实入包/出包的物品流水（供 UI 飘字与日志）；包内变动已由本模块
  // 通过 addItem/removeItem 完成，这里只是汇报，调用方不应再次应用。
  items: Array<{ itemId: ItemId; quantity: number }>;
  message: string;
  // 该遭遇是否已被消耗（解决后不再触发）；false 表示条件不满足、可再次交互。
  consumed: boolean;
}

// ---------------------------------------------------------------------------
// 权重表：按 1..5 层配置（PLAYABLE_FLOORS_V01 即 1-5）。
// 设计意图：
//  - 1-2 层 loot 主导：新手期鼓励搜刮、建立资源缓冲，战斗压力低；
//  - 3-4 层 ambush 权重上升、cache 权重上升：越深越危险，同时需要更好的
//    补给（cache 比 loot 肥）来支撑继续上行；
//  - 5 层必须含 boss 且权重为当层最高（守楼关底，见面概率最大），loot 的
//    「肥」体现在内容质量（见 FLOOR_LOOT_POOLS 与 cache 的 5 层保底），
//    而非权重——否则关底层会被普通搜刮稀释。
//  - 总体趋势：层数越高，ambush+cache 合计占比越大、普通 loot 占比越小。
// ---------------------------------------------------------------------------
const FLOOR_WEIGHT_PROFILE: Record<number, Partial<Record<EncounterKind, number>>> = {
  1: { loot: 60, note: 14, trader: 12, cache: 10, ambush: 4 },
  2: { loot: 50, note: 10, trader: 13, cache: 12, ambush: 15 },
  3: { loot: 34, note: 6, trader: 12, cache: 18, ambush: 30 },
  4: { loot: 24, note: 5, trader: 10, cache: 22, ambush: 39 },
  // boss 24 是当层最高权重；ambush 仍保持高位（22），loot 降权但内容最肥。
  5: { loot: 20, note: 4, trader: 6, cache: 24, ambush: 22, boss: 24 },
};

// 固定枚举顺序，保证 ENCOUNTER_TABLE 的行顺序与加权 roll 的遍历顺序确定。
const ENCOUNTER_KINDS: readonly EncounterKind[] = ['loot', 'ambush', 'trader', 'note', 'cache', 'boss'];

// 表外楼层（理论上 v0.1 不可达）回落到最深楼层配置，绝不抛错。
const DEEPEST_FLOOR = PLAYABLE_FLOORS_V01.length > 0 ? PLAYABLE_FLOORS_V01[PLAYABLE_FLOORS_V01.length - 1] : 1;

function buildEncounterTable(): Record<number, Array<{ kind: EncounterKind; weight: number }>> {
  const table: Record<number, Array<{ kind: EncounterKind; weight: number }>> = {};
  const floors = PLAYABLE_FLOORS_V01.includes(DEEPEST_FLOOR) ? PLAYABLE_FLOORS_V01 : [...PLAYABLE_FLOORS_V01, DEEPEST_FLOOR];
  for (const floor of floors) {
    const profile = FLOOR_WEIGHT_PROFILE[floor] ?? FLOOR_WEIGHT_PROFILE[DEEPEST_FLOOR];
    table[floor] = ENCOUNTER_KINDS.filter((k) => (profile[k] ?? 0) > 0).map((k) => ({ kind: k, weight: profile[k] ?? 0 }));
  }
  return table;
}

export const ENCOUNTER_TABLE: Record<number, Array<{ kind: EncounterKind; weight: number }>> = buildEncounterTable();

function tableForFloor(floor: number): Array<{ kind: EncounterKind; weight: number }> {
  return ENCOUNTER_TABLE[floor] ?? ENCOUNTER_TABLE[DEEPEST_FLOOR];
}

// 加权 roll：用 [1, total] 的整数滚动逐项扣减，完全由 rng 决定，可复现。
function rollWeighted(rng: Rng, entries: Array<{ kind: EncounterKind; weight: number }>): EncounterKind {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng.nextInt(1, total);
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.kind;
  }
  return entries[entries.length - 1].kind;
}

// ---------------------------------------------------------------------------
// 各楼层 loot 物资池：全部取自既定 15 件物品。
// 1 层偏 bread/cloth（食物与基础材料），5 层偏 filter/fuse/battery（高级零件），
// 中间层渐进过渡，保证「层数越高 loot 越肥」的梯度。
// ---------------------------------------------------------------------------
const FLOOR_LOOT_POOLS: Record<number, ItemId[]> = {
  1: ['bread', 'cloth', 'scrap_metal', 'tape'],
  2: ['bread', 'cloth', 'tape', 'scrap_metal', 'battery'],
  3: ['cloth', 'tape', 'scrap_metal', 'battery', 'wire'],
  4: ['scrap_metal', 'wire', 'battery', 'fuse', 'filter'],
  5: ['filter', 'fuse', 'battery', 'wire', 'scrap_metal'],
};

function lootPoolForFloor(floor: number): ItemId[] {
  return FLOOR_LOOT_POOLS[floor] ?? FLOOR_LOOT_POOLS[DEEPEST_FLOOR];
}

// 遭遇出现时的氛围短句（seeded 选取，同 spotId 恒定）。
const ENCOUNTER_MESSAGES: Record<EncounterKind, string[]> = {
  loot: ['货架后面闪着光', '半开的柜子里似乎有东西', '废墟下压着一只背包'],
  ambush: ['黑暗里有人喘气', '拐角处闪过一道影子', '楼板吱呀一响，有东西在靠近'],
  trader: ['披着斗篷的人向你招手', '「换点东西吗？」阴影里有人问'],
  note: ['墙上刻着一行小字', '抽屉里有一张泛黄的纸条', '有人把留言钉在了门板上'],
  cache: ['墙缝里藏着一只密封箱', '地板下的暗格透着寒气'],
  boss: ['楼梯间的铁门后传来沉重的呼吸', '整层楼回荡着不属于人的脚步声'],
};

// note 'read' 轮换的纸条文案（3-4 条，seeded 选一条）。
const NOTE_TEXTS: string[] = [
  '「别喝没过滤的水。第七批人走了一半。」——字迹被水泡开了',
  '「楼上那东西怕光。电池还够，撑到五楼。」',
  '「我把药箱留在墙缝里。后来的人，替我用好它。」',
  '「门后不是出口。是它睡觉的地方。」',
];

function pickFrom<T>(rng: Rng, list: readonly T[]): T {
  return list[rng.nextInt(0, list.length - 1)];
}

// ---------------------------------------------------------------------------
// rollEncounter：按 seed(runSeed, day, floor, spotId, 'encounter') 确定性 roll。
// ---------------------------------------------------------------------------
export function rollEncounter(state: GameState, floor: number, spotId: string): Encounter {
  const rng = makeRng(deriveSeed(state.runSeed, state.day, floor, spotId, 'encounter'));
  const kind = rollWeighted(rng, tableForFloor(floor));
  const message = pickFrom(rng, ENCOUNTER_MESSAGES[kind]);
  return { kind, floor, message };
}

// 该 spotId 是否已解决（encounters 由 Lead 预置，旧存档可能缺字段）。
export function shouldSkip(state: GameState, spotId: string): boolean {
  return state.encounters?.[spotId] !== undefined;
}

// 写入解决结果；state.encounters 可能 undefined，先懒初始化。
export function markResolved(state: GameState, spotId: string, resultKey: string): void {
  if (!state.encounters) state.encounters = {};
  state.encounters[spotId] = resultKey;
}

const INVALID_RESULT: EncounterResult = {
  hpChange: 0,
  items: [],
  message: '（无效选择）',
  consumed: false,
};

// 从池中抽 count 件不重复物资并真实入包；返回实际入包流水与是否溢出。
function grantLoot(
  state: GameState,
  rng: Rng,
  pool: ItemId[],
  count: number,
): { grants: Array<{ itemId: ItemId; quantity: number }>; overflowed: boolean } {
  const grants: Array<{ itemId: ItemId; quantity: number }> = [];
  const used = new Set<number>();
  let overflowed = false;
  for (let i = 0; i < count; i++) {
    let idx = rng.nextInt(0, pool.length - 1);
    let guard = 0;
    while (used.has(idx) && guard <= pool.length) {
      idx = rng.nextInt(0, pool.length - 1);
      guard++;
    }
    if (used.has(idx)) break; // 池子抽干，提前结束
    used.add(idx);
    const itemId = pool[idx];
    const res = addItem(state.player.inventory, itemId, 1);
    if (res.overflow > 0) {
      overflowed = true; // 背包满：该件掉落在地，不算入流水
    } else {
      grants.push({ itemId, quantity: 1 });
    }
  }
  return { grants, overflowed };
}

// 固定数量入包；成功才计入流水。
function grantFixed(state: GameState, itemId: ItemId, quantity: number): boolean {
  const res = addItem(state.player.inventory, itemId, quantity);
  return res.overflow === 0;
}

// ---------------------------------------------------------------------------
// resolveEncounter：执行玩家选择。
// HP 只以 hpChange 返回，由调用方应用（建议：state.player.hp = clamp(
// state.player.hp + hpChange, 0, STAT_MAX.hp)，并在 <=0 时置 status='lost'）。
// 物品变动已通过 addItem/removeItem 真实作用于 state.player.inventory。
// ---------------------------------------------------------------------------
export function resolveEncounter(state: GameState, encounter: Encounter, choice: EncounterChoice): EncounterResult {
  const inv = state.player.inventory;
  const rng = makeRng(deriveSeed(state.runSeed, state.day, encounter.floor, encounter.kind, choice));

  switch (encounter.kind) {
    case 'loot': {
      if (choice !== 'take') return INVALID_RESULT;
      const { grants, overflowed } = grantLoot(state, rng, lootPoolForFloor(encounter.floor), rng.nextInt(1, 2));
      return {
        hpChange: 0,
        items: grants,
        message: overflowed ? '你搜到了一些东西，但背包塞不下了。' : '你搜刮了一番，收获不少。',
        consumed: true,
      };
    }

    case 'cache': {
      if (choice !== 'take') return INVALID_RESULT;
      const items: Array<{ itemId: ItemId; quantity: number }> = [];
      let overflowed = false;
      if (encounter.floor >= DEEPEST_FLOOR) {
        // 5 层保底：净水×2 + 医疗包×1，全游戏最肥的补给点。
        if (grantFixed(state, 'clean_water', 2)) items.push({ itemId: 'clean_water', quantity: 2 });
        else overflowed = true;
        if (grantFixed(state, 'medkit', 1)) items.push({ itemId: 'medkit', quantity: 1 });
        else overflowed = true;
      } else if (encounter.floor >= 3) {
        if (grantFixed(state, 'medkit', 1)) items.push({ itemId: 'medkit', quantity: 1 });
        else overflowed = true;
        if (grantFixed(state, 'clean_water', 1)) items.push({ itemId: 'clean_water', quantity: 1 });
        else overflowed = true;
      } else {
        // 1-2 层：净水或医疗包二选一（seeded），仍比普通 loot 稳。
        const pick = rng.chance(0.5) ? 'clean_water' : 'medkit';
        if (grantFixed(state, pick, 1)) items.push({ itemId: pick, quantity: 1 });
        else overflowed = true;
      }
      return {
        hpChange: 0,
        items,
        message: overflowed ? '暗格里有存货，但你的背包不够装了。' : '暗格里的存货够你撑上好几天。',
        consumed: true,
      };
    }

    case 'ambush': {
      if (choice === 'fight') {
        const armed = countItem(inv, 'crowbar') > 0;
        if (armed) {
          const { grants } = grantLoot(state, rng, lootPoolForFloor(encounter.floor), rng.nextInt(1, 2));
          return {
            hpChange: -rng.nextInt(8, 15),
            items: grants,
            message: '你抡起撬棍逼退了袭击者，顺手缴了它的物资。',
            consumed: true,
          };
        }
        return {
          hpChange: -rng.nextInt(20, 35),
          items: [],
          message: '赤手空拳你被狠狠揍了一顿，物资散落一地。',
          consumed: true,
        };
      }
      if (choice === 'flee') {
        return { hpChange: 0, items: [], message: '你屏住呼吸，原路撤回了安全处。', consumed: true };
      }
      return INVALID_RESULT;
    }

    case 'trader': {
      if (choice === 'trade') {
        if (countItem(inv, 'dirty_water') >= 2) {
          // 原子交换：先收款再发货；万一净水塞不下（理论边界），退还脏水、
          // 交易作废，保证不出现「钱货两空」的半笔状态。
          removeItem(inv, 'dirty_water', 2);
          const res = addItem(inv, 'clean_water', 1);
          if (res.overflow > 0) {
            addItem(inv, 'dirty_water', 2);
            return { hpChange: 0, items: [], message: '背包塞不下这笔交易，只好作罢。', consumed: false };
          }
          return {
            hpChange: 0,
            items: [{ itemId: 'clean_water', quantity: 1 }],
            message: '两瓶脏水换了一瓶净水，各取所需。',
            consumed: true,
          };
        }
        return { hpChange: 0, items: [], message: '材料不足：对方要两瓶脏水，你拿不出来。', consumed: false };
      }
      if (choice === 'leave') {
        return { hpChange: 0, items: [], message: '你摆摆手，转身走开了。', consumed: true };
      }
      return INVALID_RESULT;
    }

    case 'note': {
      if (choice !== 'read') return INVALID_RESULT;
      return { hpChange: 0, items: [], message: pickFrom(rng, NOTE_TEXTS), consumed: true };
    }

    case 'boss': {
      if (choice === 'fight') {
        const armed = countItem(inv, 'crowbar') > 0 || countItem(inv, 'medkit') > 0;
        if (armed) {
          const items: Array<{ itemId: ItemId; quantity: number }> = [];
          if (grantFixed(state, 'medkit', 1)) items.push({ itemId: 'medkit', quantity: 1 });
          const { grants } = grantLoot(state, rng, lootPoolForFloor(encounter.floor), 2);
          items.push(...grants);
          return {
            hpChange: -rng.nextInt(25, 40),
            items,
            message: '你带着家伙摸掉了守门的东西，从它窝边拿到一批补给。',
            consumed: true,
          };
        }
        return {
          hpChange: -rng.nextInt(45, 60),
          items: [],
          message: '你空着手冲上去，被它撕碎了希望，侥幸爬了回来。',
          consumed: true,
        };
      }
      if (choice === 'flee') {
        return { hpChange: -10, items: [], message: '你转身就逃，后背还是被它挠了一下。', consumed: true };
      }
      return INVALID_RESULT;
    }
  }
}
