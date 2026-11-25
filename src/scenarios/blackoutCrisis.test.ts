import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { GameState, ItemId } from '../core/gameTypes';
import { getNpc, NPC_FLOOR } from '../data/npcs';
import { createNpcStateFor } from '../data/npcPersonalities';
import {
  BLACKOUT_AZHEN_STOCK,
  BLACKOUT_DEADLINE_DAYS,
  BLACKOUT_FLAG,
  BLACKOUT_PARTIES,
  BLACKOUT_PROMISE_DAYS,
  BLACKOUT_REPAIR_MATERIALS,
  BLACKOUT_SPOIL_WITH_WATER,
  BLACKOUT_SPOIL_WITHOUT_WATER,
  BLACKOUT_POWER_GATE_ID,
  BLACKOUT_STAGE_INDEX,
  BLACKOUT_SUPPORTED_ACTIONS,
  BLACKOUT_TRUST_FOR_STANCE,
  BLACKOUT_XIAOZHOU_OFFERS,
  BLACKOUT_XIAOZHOU_STOCK,
  blackoutStageOf,
} from '../data/blackoutCrisis';
import { CONTRACT_INTENTS } from '../ai/actionContract';
import { COMPETITION_TRUST_BASE } from '../ai/competitionRules';
import { ALIN_REPAIR_GATE_FLAG, isAlinRepairGateOpen } from '../data/floorGates';
import { countItem } from '../systems/InventorySystem';
import { loadNpcInventory, saveNpcInventory } from '../systems/NpcInventory';
import { loadCompetitionNpcMemory } from '../systems/CompetitionNpcMemoryStore';
import { loadNpcState, saveNpcState } from '../systems/NpcMemory';
import { flagCount, setFlag } from '../systems/WorldFlags';
import { runAlinGiftScenario } from './alinGiftDemo';
import { runAlinRepairScenario } from './alinRepairDemo';
import {
  acceptAzhenThanks,
  alinStanceOf,
  blackoutRepairNarration,
  blackoutSupplyHint,
  ensureBlackoutHelpRequested,
  giveWaterToAzhen,
  observeBlackout,
  requestBlackoutHelp,
  runAzhenExchange,
  runBlackoutRepair,
  runXiaozhouTrade,
  syncBlackoutCrisis,
  tradeWithXiaozhou,
  verifyBlackoutMaterials,
} from './blackoutCrisis';

// ── 夹具 ────────────────────────────────────────────────────────────────────

/** 门已开、人站在阿林旁边的一天。危机尚未开始。 */
function gateOpenGame(seed = 2026): GameState {
  const game = createNewGame(seed);
  game.currentFloor = NPC_FLOOR;
  game.player.x = getNpc('alin').x;
  // 用真实 flag 表达「维修门已开」：Blackout 的触发条件读的就是它。
  setFlag(game, ALIN_REPAIR_GATE_FLAG, 1);
  return game;
}

function setAlinTrust(game: GameState, value: number): void {
  const npc = loadNpcState(game, 'alin') ?? createNpcStateFor('alin');
  npc.relationship.player = value;
  saveNpcState(game, 'alin', npc);
}

/** 已开始、已推进到缺料阶段的游戏（大多数人测从这一步开始）。 */
function crisisGame(seed = 2026): GameState {
  const game = gateOpenGame(seed);
  const sync = syncBlackoutCrisis(game);
  expect(sync.stage).toBe('investigating');
  return game;
}

function givePart(game: GameState, itemId: ItemId, quantity: number): void {
  game.player.inventory.slots.push({ itemId, quantity });
}

function goTo(game: GameState, npcId: 'alin' | 'xiaozhou' | 'azhen'): void {
  const def = getNpc(npcId);
  game.currentFloor = def.floor;
  game.player.x = def.x;
}

function giveAllRepairParts(game: GameState): void {
  for (const material of BLACKOUT_REPAIR_MATERIALS) givePart(game, material.itemId, material.quantity);
}

// ── A2-01 状态机 ─────────────────────────────────────────────────────────────

describe('A2-01 停电危机：状态机与两种结局', () => {
  it('维修门未开时不触发危机，避免要求玩家去拿物理上取不到的零件', () => {
    const game = createNewGame(2027);
    game.currentFloor = NPC_FLOOR;
    game.player.x = getNpc('alin').x;

    const sync = syncBlackoutCrisis(game);

    expect(sync.ok).toBe(false);
    expect(sync.detail).toBe('crisis_not_started');
    expect(blackoutStageOf(game)).toBe('initial');
    expect(flagCount(game, BLACKOUT_FLAG.stocked)).toBe(0);
    expect(loadNpcInventory(game, 'xiaozhou')).toEqual([]);
  });

  it('维修门已开才推进 initial → investigating，并按库存只铺一次货', () => {
    const game = gateOpenGame();

    const first = syncBlackoutCrisis(game);
    expect(first.ok).toBe(true);
    expect(first.stage).toBe('investigating');
    expect(blackoutStageOf(game)).toBe('investigating');
    expect(flagCount(game, BLACKOUT_FLAG.startedDay)).toBe(1);

    const stockAfterFirst = loadNpcInventory(game, 'xiaozhou');
    expect(stockAfterFirst.map((stack) => stack.itemId).sort()).toEqual(
      BLACKOUT_XIAOZHOU_STOCK.map((stack) => stack.itemId).sort(),
    );

    // 第二次 sync 已经不在 initial，库存不会被再铺一遍（防刷取）。
    syncBlackoutCrisis(game);
    expect(loadNpcInventory(game, 'xiaozhou')).toEqual(stockAfterFirst);
    expect(loadNpcInventory(game, 'azhen').reduce((n, s) => n + s.quantity, 0)).toBe(
      BLACKOUT_AZHEN_STOCK.reduce((n, s) => n + s.quantity, 0),
    );
  });

  it('request_help 推进到 materials_needed 且只记一次承诺', () => {
    const game = crisisGame();

    const accepted = requestBlackoutHelp(game, 'alin');
    expect(accepted.ok).toBe(true);
    expect(blackoutStageOf(game)).toBe('materials_needed');
    expect(flagCount(game, BLACKOUT_FLAG.promiseDay)).toBe(game.day);
    const memories = loadCompetitionNpcMemory(game, 'alin');
    expect(memories.filter((entry) => entry.kind === 'promise')).toHaveLength(1);
    expect(memories.at(-1)).toMatchObject({ kind: 'promise', status: 'open' });

    // 重复接单被拒，不会刷出第二条承诺（防重复触发）。
    const again = requestBlackoutHelp(game, 'alin');
    expect(again.ok).toBe(false);
    expect(again.detail).toBe('already_requested');
    expect(loadCompetitionNpcMemory(game, 'alin').filter((entry) => entry.kind === 'promise')).toHaveLength(1);
  });

  it('状态只增不减：已经修复的危机不会被重新推进回 investigating', () => {
    const game = crisisGame();
    giveAllRepairParts(game);
    setAlinTrust(game, 60);

    return runBlackoutRepair(game).then(async (repaired) => {
      expect(repaired.status).toBe('executed');
      expect(blackoutStageOf(game)).toBe('resolved_repair');

      // 再 sync、再接单、再修，都不能把状态拉回去。
      const resync = syncBlackoutCrisis(game);
      expect(resync.detail).toBe('crisis_resolved');
      expect(blackoutStageOf(game)).toBe('resolved_repair');
      expect(flagCount(game, BLACKOUT_FLAG.stage)).toBe(BLACKOUT_STAGE_INDEX.resolved_repair);

      const request = requestBlackoutHelp(game, 'alin');
      expect(request.detail).toBe('crisis_resolved');

      const second = await runBlackoutRepair(game);
      expect(second.status).toBe('already_resolved');
      expect(second.attempts).toBe(0);
    });
  });

  it('结局 A（修复成功）：零件被消耗、供电恢复、门禁打开、居民信任提升', async () => {
    const game = crisisGame();
    shouldIgnoreGateForPowerAssertion(game);
    giveAllRepairParts(game);
    setAlinTrust(game, 60);
    requestBlackoutHelp(game, 'alin');

    const result = await runBlackoutRepair(game);

    expect(result.status).toBe('executed');
    expect(result.detail).toBe('ok');
    expect(result.beforeHash).not.toBe(result.afterHash);
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBeGreaterThan(0);
    expect(countItem(game.player.inventory, 'fuse')).toBe(0);
    expect(countItem(game.player.inventory, 'wire')).toBe(0);
    expect(result.after.gates[0]).toMatchObject({ status: 'open' });
    expect(loadNpcState(game, 'alin')?.relationship.player).toBeGreaterThan(60);
    // 承诺兑现要落进记忆，且状态是 kept（续约判断靠它）。
    expect(loadCompetitionNpcMemory(game, 'alin').some((entry) => entry.kind === 'promise' && entry.status === 'kept')).toBe(true);
    expect(observeBlackout(game).stage).toBe('resolved_repair');
    expect(observeBlackout(game).availableActions).toEqual(['observe']);
  });

  it('结局 B（长期停电）：过了死线 → 食堂存货坏掉、阿珍拒绝合作、明确失败出口', () => {
    const game = crisisGame();
    expect(blackoutStageOf(game)).toBe('investigating');

    const spoiledBefore = loadNpcInventory(game, 'azhen').reduce((n, s) => n + s.quantity, 0);
    game.day = 1 + BLACKOUT_DEADLINE_DAYS;

    const sync = syncBlackoutCrisis(game);

    expect(sync.stage).toBe('resolved_fail');
    expect(blackoutStageOf(game)).toBe('resolved_fail');
    expect(flagCount(game, BLACKOUT_FLAG.foodSpoiled)).toBe(BLACKOUT_SPOIL_WITHOUT_WATER);
    const spoiledAfter = loadNpcInventory(game, 'azhen').reduce((n, s) => n + s.quantity, 0);
    expect(spoiledAfter).toBe(spoiledBefore - BLACKOUT_SPOIL_WITHOUT_WATER);

    const observation = observeBlackout(game);
    expect(observation.resolved).toBe(true);
    expect(observation.powerRestored).toBe(false);
    expect(observation.parties.find((party) => party.npcId === 'azhen')?.status).toBe('refuse');
    expect(observation.parties.find((party) => party.npcId === 'alin')?.status).toBe('refuse');
    // 失败之后不再提供任何写操作入口。
    expect(observation.availableActions).toEqual(['observe']);
  });

  it('结局 B 变体：给过阿珍净水，同样过期只坏 1 份而不是 3 份', () => {
    const game = crisisGame();
    givePart(game, 'clean_water', 2);
    goTo(game, 'azhen');
    const watered = giveWaterToAzhen(game);
    expect(watered.ok).toBe(true);
    expect(flagCount(game, BLACKOUT_FLAG.azhenWater)).toBe(1);

    const spoiledBefore = loadNpcInventory(game, 'azhen').reduce((n, s) => n + s.quantity, 0);
    game.day = 1 + BLACKOUT_DEADLINE_DAYS;
    syncBlackoutCrisis(game);

    expect(blackoutStageOf(game)).toBe('resolved_fail');
    expect(flagCount(game, BLACKOUT_FLAG.foodSpoiled)).toBe(BLACKOUT_SPOIL_WITH_WATER);
    const spoiledAfter = loadNpcInventory(game, 'azhen').reduce((n, s) => n + s.quantity, 0);
    expect(spoiledAfter).toBe(spoiledBefore - BLACKOUT_SPOIL_WITH_WATER);
  });

  it('防软锁：零件在 4 层用光时，能从小周手里买回同一条主线', async () => {
    const game = crisisGame();
    // 玩家在 4 层把电线用去装灯了（游戏里真实存在的消耗口），手上没有零件。
    expect(countItem(game.player.inventory, 'wire')).toBe(0);
    expect(countItem(game.player.inventory, 'fuse')).toBe(0);

    // 备用路径：小周手上有货。
    const stock = loadNpcInventory(game, 'xiaozhou');
    expect(stock.some((stack) => stack.itemId === 'fuse')).toBe(true);
    expect(stock.some((stack) => stack.itemId === 'wire')).toBe(true);

    // 报价要求口粮/净水，玩家初始就有，所以这条路径一定走得通。
    const price = BLACKOUT_XIAOZHOU_OFFERS.find((offer) => offer.partId === 'wire')!;
    expect(countItem(game.player.inventory, price.price.itemId)).toBeGreaterThanOrEqual(price.price.quantity);

    goTo(game, 'xiaozhou');
    const fuseTrade = tradeWithXiaozhou(game, BLACKOUT_XIAOZHOU_OFFERS.find((offer) => offer.partId === 'fuse')!.id);
    expect(fuseTrade.ok).toBe(true);
    const wireTrade = tradeWithXiaozhou(game, price.id);
    expect(wireTrade.ok).toBe(true);

    goTo(game, 'alin');
    setAlinTrust(game, 60);
    const repaired = await runBlackoutRepair(game);
    expect(repaired.status).toBe('executed');
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBeGreaterThan(0);
  });

  it('同一份报价不能买两次：小周的库存是有限且会扣的', () => {
    const game = crisisGame();
    goTo(game, 'xiaozhou');
    const fuseOffer = BLACKOUT_XIAOZHOU_OFFERS.find((offer) => offer.partId === 'fuse')!;
    givePart(game, fuseOffer.price.itemId, fuseOffer.price.quantity * 2);

    expect(tradeWithXiaozhou(game, fuseOffer.id).ok).toBe(true);
    // 第二次：货已经没了，不能再刷出第二份零件。
    const second = tradeWithXiaozhou(game, fuseOffer.id);
    expect(second.ok).toBe(false);
    expect(second.detail).toBe('out_of_stock');
    expect(countItem(game.player.inventory, fuseOffer.partId)).toBe(1);
  });
});

/** 结局 A 的断言只用供电 flag，别让修门 gate 的语义混进来。 */
function shouldIgnoreGateForPowerAssertion(game: GameState): void {
  expect(flagCount(game, ALIN_REPAIR_GATE_FLAG)).toBeGreaterThan(0);
}

// ── A2-02 三人闭环 ───────────────────────────────────────────────────────────

describe('A2-02 三位核心 NPC 的行为闭环', () => {
  it('三人各自有需求、可发起委托（带 itemId + quantity）、有可见状态', () => {
    const game = crisisGame();
    const observation = observeBlackout(game);

    const byId = new Map(observation.parties.map((party) => [party.npcId, party]));
    // 只有这三个是核心闭环，其他人是环境叙事，不出现在这里。
    expect([...byId.keys()].sort()).toEqual(['alin', 'azhen', 'xiaozhou']);

    for (const npcId of ['alin', 'xiaozhou', 'azhen'] as const) {
      const party = byId.get(npcId)!;
      expect(party.requests.length).toBeGreaterThan(0);
      for (const request of party.requests) {
        expect(typeof request.itemId).toBe('string');
        expect(request.quantity).toBeGreaterThan(0);
        expect(request.itemName.length).toBeGreaterThan(0);
      }
      // 数据层与观察层必须同源：委托内容不能两处各写一份。
      expect(BLACKOUT_PARTIES[npcId].request.length).toBeGreaterThan(0);
      expect(['waiting', 'missing_materials', 'ready', 'trading', 'done', 'refuse']).toContain(party.status);
    }
  });

  it('三人的需求各不相同：阿林要零件、小周要口粮、阿珍要水', () => {
    expect(BLACKOUT_PARTIES.alin.request.map((request) => request.itemId).sort()).toEqual(['fuse', 'wire']);
    expect(BLACKOUT_PARTIES.xiaozhou.request.map((request) => request.itemId)).toEqual(['ration_pack']);
    expect(BLACKOUT_PARTIES.azhen.request.map((request) => request.itemId)).toEqual(['clean_water']);
  });

  it('每位核心 NPC 的可见状态都会随玩家动作变化，而不是永远一个样', () => {
    const game = crisisGame();

    // 阿林：还没接单时是「在等消息」→ 接单后缺料 → 齐料后 ready
    expect(observeBlackout(game).parties.find((party) => party.npcId === 'alin')?.status).toBe('waiting');
    requestBlackoutHelp(game, 'alin');
    expect(observeBlackout(game).parties.find((party) => party.npcId === 'alin')?.status).toBe('missing_materials');
    giveAllRepairParts(game);
    expect(observeBlackout(game).parties.find((party) => party.npcId === 'alin')?.status).toBe('ready');

    // 阿珍：初始净水 3 瓶够 2 瓶，所以是 ready；把水花掉就回到 waiting
    expect(observeBlackout(game).parties.find((party) => party.npcId === 'azhen')?.status).toBe('ready');
    const water = countItem(game.player.inventory, 'clean_water');
    game.player.inventory.slots = game.player.inventory.slots.filter((stack) => stack.itemId !== 'clean_water');
    expect(observeBlackout(game).parties.find((party) => party.npcId === 'azhen')?.status).toBe('waiting');
    givePart(game, 'clean_water', water);

    // 小周：始终可交易，直到库存清空
    expect(observeBlackout(game).parties.find((party) => party.npcId === 'xiaozhou')?.status).toBe('trading');
  });

  it('三人各写入一条自己的记忆，且互不串台', () => {
    const game = crisisGame();
    // sync 只给阿林写了「停电开始」。
    expect(loadCompetitionNpcMemory(game, 'alin').length).toBeGreaterThan(0);
    expect(loadCompetitionNpcMemory(game, 'xiaozhou')).toEqual([]);
    expect(loadCompetitionNpcMemory(game, 'azhen')).toEqual([]);

    goTo(game, 'xiaozhou');
    const offer = BLACKOUT_XIAOZHOU_OFFERS.find((entry) => entry.partId === 'fuse')!;
    givePart(game, offer.price.itemId, offer.price.quantity);
    expect(tradeWithXiaozhou(game, offer.id).ok).toBe(true);
    expect(loadCompetitionNpcMemory(game, 'xiaozhou').length).toBe(1);
    // 给小周的交易绝不能顺手改到阿林的记忆。
    expect(loadCompetitionNpcMemory(game, 'alin').length).toBe(1);

    goTo(game, 'azhen');
    givePart(game, 'clean_water', 2);
    expect(giveWaterToAzhen(game).ok).toBe(true);
    expect(loadCompetitionNpcMemory(game, 'azhen').length).toBe(1);
    expect(loadCompetitionNpcMemory(game, 'xiaozhou').length).toBe(1);
  });

  it('距离与楼层是真实约束：不在同一层时不能接单或交易', () => {
    const game = crisisGame();
    game.currentFloor = 1;
    game.player.x = getNpc('xiaozhou').x;

    const request = requestBlackoutHelp(game, 'alin');
    expect(request.ok).toBe(false);
    expect(request.detail).toBe('wrong_floor');

    const trade = tradeWithXiaozhou(game, BLACKOUT_XIAOZHOU_OFFERS[0]!.id);
    expect(trade.detail).toBe('wrong_floor');

    // 同层但站得很远，也不能隔空交易。
    game.currentFloor = NPC_FLOOR;
    game.player.x = getNpc('xiaozhou').x;
    const far = requestBlackoutHelp(game, 'alin');
    expect(far.detail).toBe('too_far');
  });

  it('阿珍的水只能给一次，且回礼来自她自己的有限存货', () => {
    const game = crisisGame();
    goTo(game, 'azhen');
    const waterBefore = countItem(game.player.inventory, 'clean_water');
    givePart(game, 'clean_water', 4);
    const breadBefore = loadNpcInventory(game, 'azhen').filter((stack) => stack.itemId === 'bread').reduce((n, s) => n + s.quantity, 0);

    const first = giveWaterToAzhen(game);
    expect(first.ok).toBe(true);
    expect(countItem(game.player.inventory, 'clean_water')).toBe(waterBefore + 2);
    const breadAfter = loadNpcInventory(game, 'azhen').filter((stack) => stack.itemId === 'bread').reduce((n, s) => n + s.quantity, 0);
    expect(breadAfter).toBeLessThan(breadBefore);

    const second = giveWaterToAzhen(game);
    expect(second.ok).toBe(false);
    expect(second.detail).toBe('already_requested');
    // 第二次没有扣水，也没有再发面包（防重复领取）。
    expect(countItem(game.player.inventory, 'clean_water')).toBe(waterBefore + 2);
  });
});

// ── A2-03 失败 → 重规划 → 成功 ───────────────────────────────────────────────

describe('A2-03 失败后的替代行动（反馈修正）', () => {
  it('维修被拒（缺料）→ 第二步改走 observe 而不是原样重试 → 明确给出 request_help 与缺什么', async () => {
    const game = crisisGame();
    setAlinTrust(game, 60);
    requestBlackoutHelp(game, 'alin');

    const blocked = await runBlackoutRepair(game);

    // 被拒绝，世界完全没变。
    expect(blocked.status).toBe('blocked');
    expect(blocked.detail).toBe('missing_item');
    expect(blocked.beforeHash).toBe(blocked.afterHash);
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBe(0);

    // 关键：第二步不是又提一次 repair_gate，而是 observe（重新观察世界）。
    expect(blocked.steps).toHaveLength(2);
    expect(blocked.steps[0]).toMatchObject({ attempt: 1, outcome: 'validation_rejected', detailCode: 'missing_item' });
    expect(blocked.steps[1]).toMatchObject({ attempt: 2, outcome: 'no_proposal' });

    // 机器可读的下一步：去请求帮助，并明确指出缺哪两样。
    expect(blocked.nextStep).not.toBeNull();
    expect(blocked.nextStep!.action).toBe('request_help');
    expect(blocked.nextStep!.npcId).toBe('alin');
    expect([...blocked.nextStep!.missing].sort()).toEqual(['fuse', 'wire']);
  });

  it('失败 → 观察 → 补齐 → 维修成功：完整链路每一步都可断言', async () => {
    const game = crisisGame();
    setAlinTrust(game, 60);

    // 第 1 步 request_help：他列清单。
    const promised = requestBlackoutHelp(game, 'alin');
    expect(promised.ok).toBe(true);
    expect(blackoutStageOf(game)).toBe('materials_needed');

    // 第 2 步 维修失败：明确告知缺料。
    const first = await runBlackoutRepair(game);
    expect(first.status).toBe('blocked');
    expect([...(first.nextStep?.missing ?? [])].sort()).toEqual(['fuse', 'wire']);

    // 第 3 步 observe：玩家去看清自己到底缺什么（observation 会随库存变）。
    expect(observeBlackout(game).missingMaterials.map((item) => item.itemId).sort()).toEqual(['fuse', 'wire']);

    // 第 4 步 补齐：只补一半，仍然不能修——证明不是「有任意料就行」。
    givePart(game, 'fuse', 1);
    const half = await runBlackoutRepair(game);
    expect(half.status).toBe('blocked');
    expect(half.detail).toBe('missing_item');
    expect(half.nextStep?.missing).toEqual(['wire']);
    expect(observeBlackout(game).missingMaterials.map((item) => item.itemId)).toEqual(['wire']);

    // 第 5 步 补全 → 成功。
    givePart(game, 'wire', 1);
    const done = await runBlackoutRepair(game);
    expect(done.status).toBe('executed');
    expect(done.detail).toBe('ok');
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBeGreaterThan(0);
    expect(blackoutStageOf(game)).toBe('resolved_repair');
  });

  it('信任不足也是一种失败：不消耗材料、不改状态，并给出可读原因', async () => {
    const game = crisisGame();
    setAlinTrust(game, 10);
    giveAllRepairParts(game);

    const blocked = await runBlackoutRepair(game);

    expect(blocked.status).toBe('blocked');
    expect(blocked.detail).toBe('low_trust');
    expect(countItem(game.player.inventory, 'fuse')).toBe(1);
    expect(countItem(game.player.inventory, 'wire')).toBe(1);
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBe(0);
    expect(blocked.message).toContain('不信');
  });

  it('三种态度的信任门槛真的不同，不是同一个数字换了文案', async () => {
    expect(BLACKOUT_TRUST_FOR_STANCE.cooperative).toBeLessThan(BLACKOUT_TRUST_FOR_STANCE.neutral);
    expect(BLACKOUT_TRUST_FOR_STANCE.neutral).toBeLessThan(BLACKOUT_TRUST_FOR_STANCE.guarded);

    // 信任 50：无交情 → 拒绝；受过恩（合作态）→ 通过。同一个人、同一背包。
    const neutralGame = crisisGame(31);
    setAlinTrust(neutralGame, 50);
    giveAllRepairParts(neutralGame);
    const neutralBlocked = await runBlackoutRepair(neutralGame);
    expect(neutralBlocked.detail).toBe('low_trust');

    const cooperativeGame = crisisGame(31);
    // 合作态的门槛来自「结构化记忆」，所以这里写的是 competition 事实，
    // 不是普通记忆——态度推导只认前者。
    cooperativeGame.day = 2;
    seedCompetitionFact(cooperativeGame, 'alin', 'player_gift', 'clean_water:1', 1);
    setAlinTrust(cooperativeGame, 50);
    giveAllRepairParts(cooperativeGame);
    expect(alinStanceOf(cooperativeGame)).toBe('cooperative');
    const cooperativeDone = await runBlackoutRepair(cooperativeGame);
    expect(cooperativeDone.status).toBe('executed');
  });
});

// ── A2-04 跨天记忆 ───────────────────────────────────────────────────────────

/**
 * 把一条结构化 fact 写进 NPC 的 competition 记忆，模拟「昨天发生的事」。
 *
 * 为什么不直接用 runAlinGiftScenario 跑一遍赠礼：那会连信任一起改掉，
 * 测出来的差异就说不清是记忆造成的还是信任造成的。这里只放记忆、信任另设，
 * 保证「同一个玩家行为、不同记忆状态」里只有记忆是变量。
 */
function seedCompetitionFact(game: GameState, npcId: 'alin', subject: string, value: string, day: number): void {
  const store = (game.npcStates[npcId] ? JSON.parse(game.npcStates[npcId]!) : {}) as Record<string, unknown>;
  const memories = Array.isArray(store.competitionMemory) ? store.competitionMemory : [];
  memories.push({ kind: 'fact', memoryId: `seed:${npcId}:${subject}:${day}`, day, subject, value });
  store.competitionMemory = memories;
  game.npcStates[npcId] = JSON.stringify(store);
}

describe('A2-04 跨天记忆影响决策', () => {
  it('昨天给过净水 → 今天阿林主动交底（给出小周的情报），这是决策差异不是台词差异', () => {
    const game = crisisGame();
    expect(observeBlackout(game).intel).toEqual([]);

    // 危机第 1 天开始；跨到第 2 天，把「第 1 天给过水」写进结构化记忆。
    // 这是唯一变量：信任不在这条测试里动。
    const remembered = crisisGame(2028);
    remembered.day = 2;
    seedCompetitionFact(remembered, 'alin', 'player_gift', 'clean_water:1', 1);

    expect(alinStanceOf(remembered)).toBe('cooperative');
    const observation = observeBlackout(remembered);
    expect(observation.alinStance).toBe('cooperative');
    expect(observation.intel.length).toBeGreaterThan(0);
    expect(observation.intel.join('')).toContain('小周');
    // 他连价格都说了，玩家不用试错。
    expect(observation.intel.join('')).toContain('保险丝');
  });

  it('同样的玩家行为在「合作 / 无交情 / 失信」三种记忆下走不同分支', async () => {
    // 完全相同的世界状态：同样的信任、同样的零件、同样的天。
    const build = (seed: number): GameState => {
      const game = crisisGame(seed);
      setAlinTrust(game, 50);
      giveAllRepairParts(game);
      return game;
    };

    // 分支 1：无交情 → 信任 50 < 55，拒绝。
    const neutral = build(41);
    expect(alinStanceOf(neutral)).toBe('neutral');
    const neutralResult = await runBlackoutRepair(neutral);
    expect(neutralResult.status).toBe('blocked');
    expect(neutralResult.detail).toBe('low_trust');

    // 分支 2：合作（昨天给过水）→ 门槛降到 40，信任 50 够用，直接修。
    const cooperative = build(41);
    cooperative.day = 2;
    seedCompetitionFact(cooperative, 'alin', 'player_gift', 'clean_water:1', 1);
    expect(alinStanceOf(cooperative)).toBe('cooperative');
    const cooperativeResult = await runBlackoutRepair(cooperative);
    expect(cooperativeResult.status).toBe('executed');

    // 分支 3：失信 → 门槛抬到 65，且要求先核料；信任 50 完全不够。
    const guarded = build(41);
    guarded.day = 2;
    setFlag(guarded, BLACKOUT_FLAG.promiseBroken, 1);
    expect(alinStanceOf(guarded)).toBe('guarded');
    const guardedResult = await runBlackoutRepair(guarded);
    expect(guardedResult.status).toBe('blocked');
    expect(guardedResult.detail).toBe('low_trust');

    // 三个分支的世界结果不同：只有合作态真的通了电。
    expect(flagCount(neutral, BLACKOUT_FLAG.power)).toBe(0);
    expect(flagCount(cooperative, BLACKOUT_FLAG.power)).toBeGreaterThan(0);
    expect(flagCount(guarded, BLACKOUT_FLAG.power)).toBe(0);
  });

  it('承诺未履约 → 第二天转谨慎：即使信任够，也必须先当面核料才能修', async () => {
    const game = crisisGame(42);
    setAlinTrust(game, 80);
    giveAllRepairParts(game);
    requestBlackoutHelp(game, 'alin');

    // 第 1 天答应，第 2 天没交货：sync 记一笔失信。
    game.day = 1 + BLACKOUT_PROMISE_DAYS + 1;
    syncBlackoutCrisis(game);
    expect(flagCount(game, BLACKOUT_FLAG.promiseBroken)).toBe(1);
    expect(alinStanceOf(game)).toBe('guarded');
    // 失信要真的写进记忆，而不是只留个 flag。
    expect(loadCompetitionNpcMemory(game, 'alin').some((entry) => entry.kind === 'promise' && entry.status === 'broken')).toBe(true);

    // 信任 80 > 65，但谨慎态的额外前置没做，仍然被拒。
    const withoutVerify = await runBlackoutRepair(game);
    expect(withoutVerify.status).toBe('blocked');
    expect(withoutVerify.detail).toBe('materials_unverified');
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBe(0);

    // 补上核料这一步，才真的能修。
    const verified = verifyBlackoutMaterials(game);
    expect(verified.ok).toBe(true);
    expect(flagCount(game, BLACKOUT_FLAG.verifiedDay)).toBe(game.day);

    const repaired = await runBlackoutRepair(game);
    expect(repaired.status).toBe('executed');
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBeGreaterThan(0);
  });

  it('核料只当天有效：隔天再修要重新核，不能一次核料永久通行', async () => {
    const game = crisisGame(43);
    setAlinTrust(game, 80);
    giveAllRepairParts(game);
    requestBlackoutHelp(game, 'alin');
    game.day = 1 + BLACKOUT_PROMISE_DAYS + 1;
    syncBlackoutCrisis(game);
    expect(alinStanceOf(game)).toBe('guarded');

    expect(verifyBlackoutMaterials(game).ok).toBe(true);
    // 隔一天：昨天的核料记录不算数。
    game.day = 3;
    const stale = await runBlackoutRepair(game);
    expect(stale.status).toBe('blocked');
    expect(stale.detail).toBe('materials_unverified');
  });

  it('合作态修好之后阿珍额外给谢礼；没交情的人拿不到（同一动作，不同结果）', async () => {
    const cooperative = crisisGame(44);
    cooperative.day = 2;
    seedCompetitionFact(cooperative, 'alin', 'player_gift', 'clean_water:1', 1);
    setAlinTrust(cooperative, 50);
    giveAllRepairParts(cooperative);
    expect((await runBlackoutRepair(cooperative)).status).toBe('executed');

    goTo(cooperative, 'azhen');
    givePart(cooperative, 'clean_water', 2);
    expect(giveWaterToAzhen(cooperative).ok).toBe(true);
    const thanks = acceptAzhenThanks(cooperative);
    expect(thanks.ok).toBe(true);

    // 已收过一次不能重复领。
    const again = acceptAzhenThanks(cooperative);
    expect(again.ok).toBe(false);
    expect(again.detail).toBe('already_requested');
  });
});

// ── 玩家真实路径（P0-a / P0-b）──────────────────────────────────────────────
//
// 上面所有用例都在夹具里手工 setAlinTrust 或 seedCompetitionFact，绕过了
// 「第一次写存档记忆」那一步。真实玩家不会绕——他从 createNewGame 开始，
// 一张白纸走到底。下面这组用**完全真实的起点**，不手工设信任、不手工塞记忆，
// 只允许玩家在游戏里做得到的事：送礼、修门、跨天、拿零件、找阿林。
//
// 为什么必须单开一组：这正是当初首章「代码跑得通但玩家走不通」的漏网之处。
// 夹具把信任钉死之后，`appendMemory` 首写把基准抹成 0 这件事永远暴露不出来。

describe('P0-a 首次落盘记忆不得抹掉既有信任', () => {
  it('危机启动后 effective 信任仍是 35，不是 0', () => {
    // 完全真实起点：不设信任，只把门打开（玩家修好门后的状态）。
    const game = gateOpenGame();
    // 危机前：raw 是 undefined，靠 `?? COMPETITION_TRUST_BASE` 兜底成 35。
    expect(loadNpcState(game, 'alin')?.relationship.player).toBeUndefined();
    expect(observeBlackout(game).alinTrust).toBe(COMPETITION_TRUST_BASE);

    const sync = syncBlackoutCrisis(game);
    expect(sync.stage).toBe('investigating');

    // 这是 bug 的核心断言：启动危机要写两条记忆（observed + 库存标记），
    // 首写时 baseline 来自 createNpcStateFor，relationship 是 {}。
    // 如果不在 appendMemory 里补基准，这里会变成 0，玩家的 35 分交情凭空消失。
    expect(loadNpcState(game, 'alin')?.relationship.player).toBe(COMPETITION_TRUST_BASE);
    expect(observeBlackout(game).alinTrust).toBe(COMPETITION_TRUST_BASE);
  });

  it('已有信任时不会被基准覆盖（补默认值只补 undefined，不覆盖真值）', () => {
    const game = gateOpenGame();
    // 玩家已经攒到 78.2（比如先送了礼）。
    setAlinTrust(game, 78.2);
    syncBlackoutCrisis(game);
    // 补默认值必须严格是「缺了才补」，不能把 78.2 打回 35。
    expect(observeBlackout(game).alinTrust).toBe(78.2);
  });

  it('接单（request_help）在 35 之上累加，而不是从 0 起算', () => {
    const game = gateOpenGame();
    syncBlackoutCrisis(game);
    expect(requestBlackoutHelp(game, 'alin').ok).toBe(true);
    // help 权重 0.5 → 0.5 × 20 × (0.5 + loyalty 0.7) = 12。
    // 基准 35 + 12 = 47。若基准被抹成 0，这里会是 12。
    expect(observeBlackout(game).alinTrust).toBeCloseTo(47, 5);
  });

  it('先启动危机、后送礼（B 顺序）：基准没丢，三件礼物仍能过 55', async () => {
    // 这条补的是「真实玩家路径」那条测试的盲区：那条先送礼，first-write 时
    // baseline 已经是真实存档，走不到「首写抹零」的分支。玩家完全可能反过来
    // ——先跨天触发危机，再回头攒交情。如果首写把 35 抹成 0，这条路线会崩，
    // 而另一条路线看不出问题。
    const game = gateOpenGame();
    expect(syncBlackoutCrisis(game).stage).toBe('investigating');
    // P0-a 的核心：启动危机后仍是 35，不是 0。
    expect(observeBlackout(game).alinTrust).toBe(COMPETITION_TRUST_BASE);

    // 35 起送 3 件 → 78.2，能过中立门槛 55。
    for (const itemId of ['clean_water', 'clean_water', 'clean_water'] as const) {
      expect((await runAlinGiftScenario(game, itemId, 1)).status).toBe('executed');
    }
    expect(observeBlackout(game).alinTrust).toBeCloseTo(78.2, 5);

    giveAllRepairParts(game);
    const repair = await runBlackoutRepair(game);
    expect(repair.status).toBe('executed');
  });
});

describe('P0-b 中立态必须能在开局资源内走通', () => {
  it('真实玩家路径：送礼攒信任 → 修门 → 跨天 → 修主线，全程用开局资源', async () => {
    // 这里刻意不用 gateOpenGame()：那条夹具把门预设成已开，会跳过玩家真正
    // 要做的第一步。真实起点是 createNewGame —— 门关着，阿林不信你。
    const game = createNewGame(2026);
    game.currentFloor = NPC_FLOOR;
    game.player.x = getNpc('alin').x;
    expect(isAlinRepairGateOpen(game)).toBe(false);

    // 开局信任 35，修门门槛 70，差 35 —— 需要 3 件礼物（每件 +14.4）。
    for (const itemId of ['ration_pack', 'ration_pack', 'clean_water'] as const) {
      expect(game.player.inventory.slots.some((s) => s.itemId === itemId)).toBe(true);
      const gift = await runAlinGiftScenario(game, itemId, 1);
      expect(gift.status).toBe('executed');
    }
    // 35 + 3×14.4 = 78.2，够得着修门的 70。
    expect(loadNpcState(game, 'alin')?.relationship.player).toBeCloseTo(78.2, 5);

    // 2 层维修材料箱必出木材×2 + 胶带×1，玩家捡得到。
    givePart(game, 'wood', 2);
    givePart(game, 'tape', 1);
    const door = await runAlinRepairScenario(game);
    expect(door.status).toBe('executed');
    expect(isAlinRepairGateOpen(game)).toBe(true);

    // 只送了 1 瓶水，还剩 2 瓶可喝——这是「口渴陷阱」必须留出的余量。
    const waterLeft = game.player.inventory.slots
      .filter((s) => s.itemId === 'clean_water')
      .reduce((total, s) => total + s.quantity, 0);
    expect(waterLeft).toBe(2);

    // 跨天，危机启动。信任必须完整带过来（P0-a），而不是归零。
    game.day = 2;
    expect(syncBlackoutCrisis(game).stage).toBe('investigating');
    expect(observeBlackout(game).alinTrust).toBeCloseTo(78.2, 5);
    // 攒到这份交情后阿林是「合作态」，门槛 40，比中立态宽松。
    expect(alinStanceOf(game)).toBe('cooperative');

    // 4 层电箱必出保险丝×1 + 电线×2，搬回来就能修。
    giveAllRepairParts(game);
    const repair = await runBlackoutRepair(game);
    expect(repair.status).toBe('executed');
    expect(repair.detail).toBe('ok');
  });

  it('开局资源足够：3 瓶水 + 2 份口粮里，凑 3 件就够门槛且至少留 2 瓶水', () => {
    // 这条守的是「数值有余量」，不是「刚好卡线」。修门 70、每件 14.4：
    // 15 + 4×14.4 = 92.6 太宽，35 + 2×14.4 = 63.8 又不够。
    // 真正的可行解是 3 件（78.2），且其中最多含 1 瓶水 —— 于是至少剩 2 瓶。
    const startTrust = COMPETITION_TRUST_BASE;
    const perGift = 14.4;
    const gateThreshold = 70;
    const giftsNeeded = Math.ceil((gateThreshold - startTrust) / perGift);
    expect(giftsNeeded).toBe(3);
    // 开局 3 水 + 2 粮 = 5 件，送 3 件绰绰有余；只要其中水 ≤ 1 瓶就能留 2 瓶。
    expect(startTrust + giftsNeeded * perGift).toBeGreaterThanOrEqual(gateThreshold);
    // 少于 3 件一定不够 —— 若有人把 TRUST_BASE 调低或单件价值调高，这条会红，
    // 提醒回去重算「要不要留水」而不是悄悄变得更容易。
    expect(startTrust + (giftsNeeded - 1) * perGift).toBeLessThan(gateThreshold);
  });
});

// ── 数据层不变量 ─────────────────────────────────────────────────────────────

describe('停电危机数据不变量', () => {
  it('本场景的玩家动作是 A1 统一契约的子集，没有自创同义动作', () => {
    // A1 的契约是权威。这里做的是「取子集」，不是「重新定义」——
    // 一旦有人在这边手滑加了个 ask/give，这条测试会立刻红。
    for (const action of BLACKOUT_SUPPORTED_ACTIONS) {
      expect(CONTRACT_INTENTS).toContain(action);
    }
    // refuse 刻意不在玩家侧：本章 NPC 的拒绝由 party.status 表达。
    expect(BLACKOUT_SUPPORTED_ACTIONS).not.toContain('refuse');
    // 旧名（inspect / give）不许回流到新代码里。
    expect(BLACKOUT_SUPPORTED_ACTIONS as readonly string[]).not.toContain('inspect');
    expect(BLACKOUT_SUPPORTED_ACTIONS as readonly string[]).not.toContain('give');
  });

  it('观察结果里对外暴露的动作，也必须是同一份子集', () => {
    const game = crisisGame();
    const observation = observeBlackout(game);
    for (const action of observation.availableActions) {
      expect(BLACKOUT_SUPPORTED_ACTIONS).toContain(action);
    }
  });

  it('维修配方只含真实存在的物品，且与阿林的委托一致', () => {
    const requestIds = BLACKOUT_PARTIES.alin.request.map((request) => request.itemId).sort();
    const materialIds = BLACKOUT_REPAIR_MATERIALS.map((material) => material.itemId).sort();
    expect(materialIds).toEqual(requestIds);
    for (const material of BLACKOUT_REPAIR_MATERIALS) {
      expect(material.quantity).toBeGreaterThan(0);
    }
  });

  it('小周报价的零件正是维修需要的两样，价格不为空', () => {
    const offerParts = BLACKOUT_XIAOZHOU_OFFERS.map((offer) => offer.partId).sort();
    const needed = BLACKOUT_REPAIR_MATERIALS.map((material) => material.itemId).sort();
    expect(offerParts).toEqual(needed);
    for (const offer of BLACKOUT_XIAOZHOU_OFFERS) {
      expect(offer.price.quantity).toBeGreaterThan(0);
      // 不能用心愿价格换零件：报价物品必须是玩家初始或世界稳定能拿到的。
      expect(['ration_pack', 'clean_water']).toContain(offer.price.itemId);
    }
  });

  it('阶段序号单调，且 resolved_repair 与 resolved_fail 互斥地排在最后', () => {
    expect(BLACKOUT_STAGE_INDEX.initial).toBeLessThan(BLACKOUT_STAGE_INDEX.investigating);
    expect(BLACKOUT_STAGE_INDEX.investigating).toBeLessThan(BLACKOUT_STAGE_INDEX.materials_needed);
    expect(BLACKOUT_STAGE_INDEX.materials_needed).toBeLessThan(BLACKOUT_STAGE_INDEX.resolved_repair);
    expect(BLACKOUT_STAGE_INDEX.materials_needed).toBeLessThan(BLACKOUT_STAGE_INDEX.resolved_fail);
  });

  it('失败惩罚是有限的：给水只坏 1 份，不给水最多坏 3 份，不会把食堂清空', () => {
    expect(BLACKOUT_SPOIL_WITH_WATER).toBeLessThan(BLACKOUT_SPOIL_WITHOUT_WATER);
    const totalStock = BLACKOUT_AZHEN_STOCK.reduce((n, s) => n + s.quantity, 0);
    expect(BLACKOUT_SPOIL_WITHOUT_WATER).toBeLessThan(totalStock);
  });
});
// ── 模型端口（P1）────────────────────────────────────────────────────────────

/**
 * 模型端口的测试全部把信任钉在 70。
 *
 * 为什么：这些用例测的是「端口接线对不对」——4 键形状、null 语义、
 * fallback 判别、decisionSource 标注——与本章那三档门槛无关。门槛由
 * A2-03/A2-04 的用例单独盯。钉 70 让本组在任何门槛策略下都只验接线，
 * 不会因为规则层数字变化而假红。
 */
describe('模型端口：接线正确性（与门槛无关）', () => {
  /** 阿林在场、材料齐、信任钉 70：无论门槛怎么配，executor 都该放行。 */
  async function modelReadyGame(seed = 9001): Promise<GameState> {
    const game = crisisGame(seed);
    requestBlackoutHelp(game, 'alin');
    giveAllRepairParts(game);
    setAlinTrust(game, 70);
    return game;
  }

  it('注入参数严格只有 4 个键，且不含 GameState 句柄', async () => {
    const game = await modelReadyGame();
    let captured: Record<string, unknown> | null = null;

    await runBlackoutRepair(game, {
      proposeWithModel: async (input) => {
        captured = input as unknown as Record<string, unknown>;
        return null;
      },
    });

    const input = captured as Record<string, unknown> | null;
    expect(input).toBeTruthy();
    // 与 alinRepairModelPort.test.ts:155 的同一条硬断言。
    expect(Object.keys(input!).sort()).toEqual(['gateId', 'materials', 'observation', 'previousFeedback']);
    for (const value of Object.values(input!)) expect(value).not.toBe(game);
  });

  it('模型给出合法提案 → 真的提交，且 decisionSource 标 model', async () => {
    const game = await modelReadyGame(9002);
    let called = 0;

    const result = await runBlackoutRepair(game, {
      proposeWithModel: async () => {
        called += 1;
        return { kind: 'repair_gate', gateId: BLACKOUT_POWER_GATE_ID, materials: BLACKOUT_REPAIR_MATERIALS };
      },
    });

    expect(called).toBeGreaterThan(0);
    expect(result.status).toBe('executed');
    expect(result.decisionSource).toBe('model');
    // 材料真的被扣了，闸门真的开了——不是只写了个状态字段。
    expect(countItem(game.player.inventory, 'fuse')).toBe(0);
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBe(1);
  });

  it('模型明确拒绝（返回 null）→ 不提交、不降级、decisionSource 不是 model', async () => {
    const game = await modelReadyGame(9003);
    const fuseBefore = countItem(game.player.inventory, 'fuse');

    const result = await runBlackoutRepair(game, {
      proposeWithModel: async () => null,
    });

    expect(result.status).not.toBe('executed');
    // 模型说了「不修」，fallback 不许替它修。
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBe(0);
    expect(countItem(game.player.inventory, 'fuse')).toBe(fuseBefore);
    expect(result.decisionSource).toBe('offline-fallback');
  });

  it('模型抛异常 → 规则兜底接手，玩家仍能玩完', async () => {
    const game = await modelReadyGame(9004);

    const result = await runBlackoutRepair(game, {
      proposeWithModel: async () => {
        throw new Error('spark_unreachable');
      },
    });

    // Spark 不可达时必须降级而不是崩掉——这是可玩性的底线。
    expect(result.status).toBe('executed');
    expect(result.decisionSource).toBe('offline-fallback');
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBe(1);
  });

  it('模型不能改配方：只申请一块木头也修不动', async () => {
    const game = await modelReadyGame(9005);
    const fuseBefore = countItem(game.player.inventory, 'fuse');

    const result = await runBlackoutRepair(game, {
      proposeWithModel: async () => ({
        kind: 'repair_gate',
        gateId: BLACKOUT_POWER_GATE_ID,
        materials: [{ itemId: 'scrap_metal', quantity: 1 }],
      }),
    });

    expect(result.status).not.toBe('executed');
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBe(0);
    // 恶意提案没有造成任何扣料。
    expect(countItem(game.player.inventory, 'fuse')).toBe(fuseBefore);
  });

  it('没有注入模型时走规则脑，decisionSource 是 offline-fallback', async () => {
    const game = await modelReadyGame(9006);
    const result = await runBlackoutRepair(game);
    expect(result.status).toBe('executed');
    expect(result.decisionSource).toBe('offline-fallback');
  });
});

// ── 小周 / 阿珍 的模型端口（P1 三人全覆盖）────────────────────────────────────

describe('小周的模型端口：模型选价，规则结算', () => {
  /** 站在小周面前、危机已开始、手上有口粮和净水的游戏。 */
  function tradeReadyGame(seed = 9100): GameState {
    const game = crisisGame(seed);
    goTo(game, 'xiaozhou');
    givePart(game, 'ration_pack', 2);
    givePart(game, 'clean_water', 4);
    return game;
  }

  it('注入参数严格 4 键，且不含 GameState', async () => {
    const game = tradeReadyGame(9101);
    let captured: Record<string, unknown> | null = null;

    await runXiaozhouTrade(game, {
      proposeWithModel: async (input) => {
        captured = input as unknown as Record<string, unknown>;
        return null;
      },
    });

    const input = captured as Record<string, unknown> | null;
    expect(input).toBeTruthy();
    expect(Object.keys(input!).sort()).toEqual(['npcId', 'observation', 'offers', 'previousFeedback']);
    for (const value of Object.values(input!)) expect(value).not.toBe(game);
  });

  it('模型选中保险丝那笔 → 真的成交、decisionSource 标 model', async () => {
    const game = tradeReadyGame(9102);
    const fuseBefore = countItem(game.player.inventory, 'fuse');
    const rationBefore = countItem(game.player.inventory, 'ration_pack');

    const result = await runXiaozhouTrade(game, {
      proposeWithModel: async () => ({
        kind: 'trade',
        npcId: 'xiaozhou',
        playerGives: { from: 'player', to: { kind: 'npc', npcId: 'xiaozhou' }, itemId: 'ration_pack', quantity: 1 },
        playerReceives: { from: { kind: 'npc', npcId: 'xiaozhou' }, to: 'player', itemId: 'fuse', quantity: 1 },
      }),
    });

    expect(result.status).toBe('executed');
    expect(result.decisionSource).toBe('model');
    expect(result.offerId).toBe('zhou-fuse');
    expect(countItem(game.player.inventory, 'fuse')).toBe(fuseBefore + 1);
    expect(countItem(game.player.inventory, 'ration_pack')).toBe(rationBefore - 1);
    // 他的库存真的少了，不是凭空生成。
    expect(loadNpcInventory(game, 'xiaozhou').reduce((n, s) => n + (s.itemId === 'fuse' ? s.quantity : 0), 0)).toBe(0);
  });

  it('模型拒谈（返回 null）→ 不成交，也不兜底', async () => {
    const game = tradeReadyGame(9103);
    const rationBefore = countItem(game.player.inventory, 'ration_pack');

    const result = await runXiaozhouTrade(game, { proposeWithModel: async () => null });

    expect(result.status).not.toBe('executed');
    expect(result.decisionSource).toBe('offline-fallback');
    expect(countItem(game.player.inventory, 'ration_pack')).toBe(rationBefore);
  });

  it('模型抛异常 → 规则兜底成交（可玩性底线）', async () => {
    const game = tradeReadyGame(9104);

    const result = await runXiaozhouTrade(game, {
      proposeWithModel: async () => { throw new Error('spark_unreachable'); },
    });

    expect(result.status).toBe('executed');
    expect(result.decisionSource).toBe('offline-fallback');
  });

  it('模型编一个不存在的报价 → 拒绝，不产生任何物品转移', async () => {
    const game = tradeReadyGame(9105);
    const fuseBefore = countItem(game.player.inventory, 'fuse');
    const rationBefore = countItem(game.player.inventory, 'ration_pack');

    const result = await runXiaozhouTrade(game, {
      proposeWithModel: async () => ({
        kind: 'trade',
        npcId: 'xiaozhou',
        // 一块破布换保险丝：不在价目表里。
        playerGives: { from: 'player', to: { kind: 'npc', npcId: 'xiaozhou' }, itemId: 'scrap_metal', quantity: 1 },
        playerReceives: { from: { kind: 'npc', npcId: 'xiaozhou' }, to: 'player', itemId: 'fuse', quantity: 1 },
      }),
    });

    expect(result.status).not.toBe('executed');
    expect(countItem(game.player.inventory, 'fuse')).toBe(fuseBefore);
    expect(countItem(game.player.inventory, 'ration_pack')).toBe(rationBefore);
  });
});

describe('阿珍的模型端口：模型决定给水，回礼按她存货封顶', () => {
  function azhenReadyGame(seed = 9200): GameState {
    const game = crisisGame(seed);
    goTo(game, 'azhen');
    givePart(game, 'clean_water', 4);
    return game;
  }

  it('模型同意给水 → 成交，拿到的是她真实能给的份数', async () => {
    const game = azhenReadyGame(9201);
    const waterBefore = countItem(game.player.inventory, 'clean_water');
    const breadBefore = countItem(game.player.inventory, 'bread');

    const result = await runAzhenExchange(game, {
      proposeWithModel: async () => ({
        kind: 'trade',
        npcId: 'azhen',
        playerGives: { from: 'player', to: { kind: 'npc', npcId: 'azhen' }, itemId: 'clean_water', quantity: 2 },
        playerReceives: { from: { kind: 'npc', npcId: 'azhen' }, to: 'player', itemId: 'bread', quantity: 2 },
      }),
    });

    expect(result.status).toBe('executed');
    expect(result.decisionSource).toBe('model');
    expect(countItem(game.player.inventory, 'clean_water')).toBe(waterBefore - 2);
    expect(countItem(game.player.inventory, 'bread')).toBeGreaterThan(breadBefore);
  });

  it('模型拒给（返回 null）→ 水不扣、面包不到手', async () => {
    const game = azhenReadyGame(9202);
    const waterBefore = countItem(game.player.inventory, 'clean_water');
    const breadBefore = countItem(game.player.inventory, 'bread');

    const result = await runAzhenExchange(game, { proposeWithModel: async () => null });

    expect(result.status).not.toBe('executed');
    expect(countItem(game.player.inventory, 'clean_water')).toBe(waterBefore);
    expect(countItem(game.player.inventory, 'bread')).toBe(breadBefore);
  });

  it('同一笔只结算一次：第二次调用被拒绝，水不再扣', async () => {
    const game = azhenReadyGame(9203);
    const give = async () => ({
      kind: 'trade' as const,
      npcId: 'azhen',
      playerGives: { from: 'player' as const, to: { kind: 'npc' as const, npcId: 'azhen' }, itemId: 'clean_water' as const, quantity: 2 },
      playerReceives: { from: { kind: 'npc' as const, npcId: 'azhen' }, to: 'player' as const, itemId: 'bread' as const, quantity: 2 },
    });

    const first = await runAzhenExchange(game, { proposeWithModel: give });
    expect(first.status).toBe('executed');
    const waterAfterFirst = countItem(game.player.inventory, 'clean_water');

    const second = await runAzhenExchange(game, { proposeWithModel: give });
    expect(second.status).not.toBe('executed');
    expect(countItem(game.player.inventory, 'clean_water')).toBe(waterAfterFirst);
  });
});

// ── P0-c：被拒之后玩家知道下一站在哪 ────────────────────────────────────────
//
// 这一组盯的是「反馈有没有落到动作上」。`repairMessage` 说到「还缺保险丝、
// 电线」为止，玩家知道缺什么，但首章的地理是 2 层住人 / 4 层维修 / 5 层食堂，
// 新玩家没有任何线索能把「保险丝」和「4 层」连起来。缺料提示如果不指向具体
// 地点，探索成本就变成了在楼里上下盲试。

describe('P0-c 缺料提示：把「缺什么」接成「去哪拿」', () => {
  it('缺两样零件时，提示点名 4 层电箱与小周，且价格来自数据而不是硬编码', () => {
    const game = crisisGame();
    const hint = blackoutSupplyHint(game, ['fuse', 'wire']);

    // 地点来自 FLOOR_TEMPLATES：写死会在楼层表一改时变成假话。
    expect(hint).toContain('4 层电箱');
    // 小周的报价来自 BLACKOUT_XIAOZHOU_OFFERS：改价时提示必须跟着变。
    expect(hint).toContain('压缩口粮×1 换保险丝');
    expect(hint).toContain('净水×2 换电线');
  });

  it('小周把货卖光之后，提示不再把玩家支去空跑一趟', () => {
    const game = crisisGame();
    // 他的库存是开危机时铺的，这里直接清空来模拟「两样都被换走了」。
    saveNpcInventory(game, 'xiaozhou', []);

    const hint = blackoutSupplyHint(game, ['fuse', 'wire']);

    // 4 层电箱这条永远成立：它是保底来源，不依赖任何人。
    expect(hint).toContain('4 层电箱');
    // 但小周那条必须消失——他已经没货了，让他出现就是骗玩家跑一趟。
    expect(hint).not.toContain('小周');
  });

  it('只缺一样时，提示只报那一样，不把两样都念一遍', () => {
    const game = crisisGame();
    const hint = blackoutSupplyHint(game, ['fuse']);

    expect(hint).toContain('保险丝');
    expect(hint).not.toContain('电线');
  });

  it('不缺料时返回空串，调用方只显示原句（不硬凑一句废话）', () => {
    const game = crisisGame();
    expect(blackoutSupplyHint(game, [])).toBe('');
  });

  it('low_trust 分支：原句只提信任，必须补「还缺什么」再接地点，否则读起来断档', async () => {
    const game = crisisGame();
    // 40 + 接单的 help(+12) = 52，仍差 neutral 门槛 55 三分 → 走 low_trust，
    // 而不是缺料。这一步必须踩准：给 45 的话 57 就过线了，会变成 missing_item。
    setAlinTrust(game, 40);
    requestBlackoutHelp(game, 'alin');

    const result = await runBlackoutRepair(game);
    expect(result.detail).toBe('low_trust');
    // 原句一个字没改：它是 A2-03 的断言对象。
    expect(result.message).toBe('他还不信你（52/55）。');

    const narration = blackoutRepairNarration(game, result);
    // 顺序必须是 原句 → 缺什么 → 去哪拿。少中间那一句就是
    // 「他还不信你。4 层电箱能凑齐」，主语和宾语接不上。
    expect(narration.startsWith('他还不信你（52/55）。')).toBe(true);
    expect(narration).toContain('还缺保险丝、电线');
    expect(narration).toContain('4 层电箱');
    expect(narration.indexOf('还缺保险丝、电线')).toBeLessThan(narration.indexOf('4 层电箱'));
  });

  it('missing_item 分支：原句已经点过名，不再重复一遍「还缺」', async () => {
    const game = crisisGame();
    // 60 过得了 neutral 门槛，但手上没零件 → 走到 missing_item 而不是 low_trust。
    setAlinTrust(game, 60);
    requestBlackoutHelp(game, 'alin');

    const result = await runBlackoutRepair(game);
    expect(result.detail).toBe('missing_item');
    expect(result.message).toContain('还缺保险丝、电线');

    const narration = blackoutRepairNarration(game, result);
    // 「还缺」只出现一次：原文一次，不能再补一次。
    expect(narration.match(/还缺/g)).toHaveLength(1);
    expect(narration).toContain('4 层电箱');
  });

  it('维修成功时不追加任何指路：事情已经做完了', async () => {
    const game = crisisGame();
    setAlinTrust(game, 60);
    requestBlackoutHelp(game, 'alin');
    giveAllRepairParts(game);

    const result = await runBlackoutRepair(game);
    expect(result.status).toBe('executed');
    expect(result.nextStep).toBeNull();
    expect(blackoutRepairNarration(game, result)).toBe(result.message);
  });
});

// ── P0-c：点维修即接单 ──────────────────────────────────────────────────────
//
// 补这条的由来：`requestBlackoutHelp` 在 GameScene 里零引用，`materials_needed`
// 阶段除了 `syncBlackoutCrisis` 之外没有任何入口能到。连带后果是
// `syncBlackoutCrisis` 里那段「承诺过期记一笔失信」永远没有作用对象——
// `promiseDay` 恒为 0，`promiseBroken` 永远写不上，`guarded` 态永远进不去，
// `verifyBlackoutMaterials`（只在 guarded 下需要）也因此成了死代码。
//
// 接法选的是「点维修 = 应承」而不是新增菜单项：菜单四项位置被 E2E 依赖，
// 而玩家按下这个动作的语义本来就包含了答应。

describe('P0-c 点维修即接单：materials_needed 有入口，失信逻辑有对象', () => {
  it('investigating 时接单：stage 推进到 materials_needed，写一条承诺，信任 +12', () => {
    const game = crisisGame();
    expect(blackoutStageOf(game)).toBe('investigating');
    const trustBefore = observeBlackout(game).alinTrust;

    const accepted = ensureBlackoutHelpRequested(game);

    expect(accepted?.ok).toBe(true);
    expect(blackoutStageOf(game)).toBe('materials_needed');
    // 单条承诺，且是 open 状态——后面的「过期记失信」要靠它。
    const promises = loadCompetitionNpcMemory(game, 'alin').filter((entry) => entry.kind === 'promise');
    expect(promises).toHaveLength(1);
    expect(promises[0]).toMatchObject({ status: 'open' });
    // help 权重 0.5 → 20 × (0.5 + 0.7) = +12。
    expect(observeBlackout(game).alinTrust).toBeCloseTo(trustBefore + 12, 5);
    // promiseDay 必须真的落在存档里，否则过期判定永假。
    expect(flagCount(game, BLACKOUT_FLAG.promiseDay)).toBe(game.day);
  });

  it('连点两次维修：承诺只有一条，promiseDay 不被写第二遍，promiseBroken 不误触发', () => {
    const game = crisisGame();
    const trustAfterFirst = (() => {
      ensureBlackoutHelpRequested(game);
      return observeBlackout(game).alinTrust;
    })();
    const firstPromiseDay = flagCount(game, BLACKOUT_FLAG.promiseDay);

    // 玩家因为「点了没反应」又点了一次——这是最常见的重复点击。
    // 第二次已经不在 investigating，`ensureBlackoutHelpRequested` 直接返回 null，
    // 连 `requestBlackoutHelp` 都不会进。
    const second = ensureBlackoutHelpRequested(game);
    expect(second).toBeNull();

    // 就算绕过 stage 判断直接调 requestBlackoutHelp，它自己也幂等。
    const direct = requestBlackoutHelp(game, 'alin');
    expect(direct.ok).toBe(false);
    expect(direct.detail).toBe('already_requested');

    expect(loadCompetitionNpcMemory(game, 'alin').filter((entry) => entry.kind === 'promise')).toHaveLength(1);
    expect(flagCount(game, BLACKOUT_FLAG.promiseDay)).toBe(firstPromiseDay);
    // 多记一条 help 就会多 +12，信任被点两下刷上去——这条防的就是它。
    expect(observeBlackout(game).alinTrust).toBeCloseTo(trustAfterFirst, 5);
    // 承诺还没到期，失信不该被写。
    expect(flagCount(game, BLACKOUT_FLAG.promiseBroken)).toBe(0);
  });

  it('只有 investigating 才自动接单：initial（门没开）与两个结局都不动手', () => {
    // initial：门没开，危机没开始，点维修走的是另一条路（通用维修门演示），
    // 这里不该悄悄把 stage 推进。
    const notStarted = createNewGame(2028);
    expect(blackoutStageOf(notStarted)).toBe('initial');
    expect(ensureBlackoutHelpRequested(notStarted)).toBeNull();
    expect(blackoutStageOf(notStarted)).toBe('initial');

    // resolved_repair：事情做完了，不该再记一条承诺。
    const repaired = crisisGame();
    setAlinTrust(repaired, 60);
    giveAllRepairParts(repaired);
    return runBlackoutRepair(repaired).then(() => {
      expect(blackoutStageOf(repaired)).toBe('resolved_repair');
      expect(ensureBlackoutHelpRequested(repaired)).toBeNull();
      expect(blackoutStageOf(repaired)).toBe('resolved_repair');

      // resolved_fail 同理。
      const failed = crisisGame(2029);
      failed.day = 1 + BLACKOUT_DEADLINE_DAYS;
      expect(syncBlackoutCrisis(failed).stage).toBe('resolved_fail');
      expect(ensureBlackoutHelpRequested(failed)).toBeNull();
      expect(blackoutStageOf(failed)).toBe('resolved_fail');
    });
  });

  it('接单带来的 +12 真的让低信任玩家过线：40 差 15 → 接单后 52 再送一件就够 55', () => {
    // 这条不是数字游戏：它说明「点维修」这个动作本身应该被算进信任，
    // 否则玩家做对了事却看不到任何变化，只能在楼里到处送礼试门槛。
    const game = crisisGame();
    setAlinTrust(game, 40);
    expect(alinStanceOf(game)).toBe('neutral');

    ensureBlackoutHelpRequested(game);
    const afterHelp = observeBlackout(game).alinTrust;
    expect(afterHelp).toBeCloseTo(52, 5);

    // 52 < 55，还差 3 分。看一眼门槛提示：他此刻说的是 52/55，
    // 玩家据此知道「再攒一点就行」，而不是不知道怎么算。
    const observation = observeBlackout(game);
    expect(observation.alinTrust).toBeCloseTo(52, 5);
    expect(BLACKOUT_TRUST_FOR_STANCE.neutral).toBe(55);
  });

  it('承诺过期记失信：接单后拖着不办，跨天就进 guarded，verifyBlackoutMaterials 才有意义', () => {
    const game = crisisGame();
    ensureBlackoutHelpRequested(game);
    expect(alinStanceOf(game)).toBe('neutral');

    // 接单当天 + BLACKOUT_PROMISE_DAYS 之后再跨一天 → 过期。
    game.day = 1 + BLACKOUT_PROMISE_DAYS + 1;
    syncBlackoutCrisis(game);

    expect(flagCount(game, BLACKOUT_FLAG.promiseBroken)).toBeGreaterThan(0);
    expect(alinStanceOf(game)).toBe('guarded');
    // 这条记忆必须落库：阿林的失信判断读的就是它，不是临时变量。
    expect(
      loadCompetitionNpcMemory(game, 'alin').some((entry) => entry.kind === 'promise' && entry.status === 'broken'),
    ).toBe(true);
  });
});

// ── 失信路径：从玩家入口走一遍失败后替代行动 ────────────────────────────────
//
// 上面那条（`承诺过期记失信`）验证的是「跨天之后确实进了 guarded」，但它从
// `crisisGame()` 夹具进——信任是干净的、门是 setFlag 打开的、许诺是直接调的。
// 那段代码在真实世界里长什么样，取决于**玩家真的按下那个按钮**。
//
// 这一组从 `createNewGame` 起步，只允许玩家做游戏里做得到的事：送礼、修门、
// 跨天、搬零件、当面核料。它守的是评分点 A2-03 的另一半——
// 「失败之后换个办法继续」：接单 → 失信 → 门槛抬高 + 程序性前置 → 核料 → 还是修成了。
//
// 数字链（阿林 loyalty 0.7 → 放大系数 0.5 + 0.7 = 1.2）：
//   开局 35 → 3 件礼物 3×(0.6×20×1.2=14.4) = 78.2
//   接单 help  0.5×20×1.2 = +12  → 90.2
//   失信 refusal -0.2×20×1.2 = -4.8 → 85.4

describe('失信路径：接单不交货 → 门槛抬高 → 核料后才能修（玩家入口全链路）', () => {
  /** 真实起点走到「危机已启动、阿林已接单、正等人交货」这一步。 */
  async function promisedAndWaiting(seed = 2026): Promise<GameState> {
    const game = createNewGame(seed);
    game.currentFloor = NPC_FLOOR;
    game.player.x = getNpc('alin').x;

    // 3 件礼物把信任从 35 抬到 78.2（修门门槛 70）。
    for (const itemId of ['ration_pack', 'ration_pack', 'clean_water'] as const) {
      expect((await runAlinGiftScenario(game, itemId, 1)).status).toBe('executed');
    }
    expect((await runAlinRepairScenario(game)).status).not.toBe('executed'); // 没材料，先失败
    givePart(game, 'wood', 2);
    givePart(game, 'tape', 1);
    expect((await runAlinRepairScenario(game)).status).toBe('executed');
    expect(isAlinRepairGateOpen(game)).toBe(true);

    // 门开了，危机才敢启动（否则要求玩家去拿物理上取不到的零件）。
    expect(syncBlackoutCrisis(game).stage).toBe('investigating');
    expect(observeBlackout(game).alinTrust).toBeCloseTo(78.2, 5);

    // 玩家按下「接回主线」——这一步在场景层被 `ensureBlackoutHelpRequested` 接住。
    expect(ensureBlackoutHelpRequested(game)?.ok).toBe(true);
    expect(blackoutStageOf(game)).toBe('materials_needed');
    expect(observeBlackout(game).alinTrust).toBeCloseTo(90.2, 5);
    return game;
  }

  it('接单后拖着不交货：跨天记失信、态度转谨慎、门槛从 55 抬到 65', async () => {
    const game = await promisedAndWaiting();
    expect(alinStanceOf(game)).toBe('neutral');

    // 第 1 天答应，第 2 天还没交货。这是玩家最常犯的错：以为「答应了」就算完事。
    game.day = 1 + BLACKOUT_PROMISE_DAYS + 1;
    syncBlackoutCrisis(game);

    expect(flagCount(game, BLACKOUT_FLAG.promiseBroken)).toBe(1);
    expect(alinStanceOf(game)).toBe('guarded');
    // 门槛真的抬了：这正是「失败会改变计划」在数值上的表现。
    expect(BLACKOUT_TRUST_FOR_STANCE.neutral).toBe(55);
    expect(BLACKOUT_TRUST_FOR_STANCE.guarded).toBe(65);
    // 失信要落成记忆，不是只留个 flag——跨天之后读的还是它。
    const broken = loadCompetitionNpcMemory(game, 'alin').filter((entry) => entry.kind === 'promise' && entry.status === 'broken');
    expect(broken).toHaveLength(1);
    // 失信本身也要扣信任：refusal 权重 -0.2 → -0.2×20×1.2 = -4.8。
    expect(observeBlackout(game).alinTrust).toBeCloseTo(85.4, 5);
  });

  it('信任仍然够（85.4 > 65），所以拦下玩家的不是分数，是「先当面看见零件」这道程序', async () => {
    const game = await promisedAndWaiting();
    game.day = 1 + BLACKOUT_PROMISE_DAYS + 1;
    syncBlackoutCrisis(game);
    expect(alinStanceOf(game)).toBe('guarded');

    // 材料齐了——从分数上看他该答应，但谨慎的人不听口头保证。
    giveAllRepairParts(game);
    const refused = await runBlackoutRepair(game);

    expect(refused.status).toBe('blocked');
    expect(refused.detail).toBe('materials_unverified');
    expect(refused.message).toBe('他上次等了你一场空，这次要先当面看见零件。');
    // 被拒时什么都没发生：没通电、没扣料。
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBe(0);
    expect(countItem(game.player.inventory, 'fuse')).toBe(1);

    // 这就是「失败后替代行动」：不是原样再点一次，而是换一个动作（当面核料）。
    const verified = verifyBlackoutMaterials(game);
    expect(verified.ok).toBe(true);
    expect(verified.detail).toBe('ok');
    // 核料落在当天，跨天要重做——这个日期就是判据。
    expect(flagCount(game, BLACKOUT_FLAG.verifiedDay)).toBe(game.day);

    const repaired = await runBlackoutRepair(game);
    expect(repaired.status).toBe('executed');
    expect(repaired.detail).toBe('ok');
    expect(flagCount(game, BLACKOUT_FLAG.power)).toBeGreaterThan(0);
    expect(blackoutStageOf(game)).toBe('resolved_repair');
    // 谨慎档的谢意是克制的：+2，不是中立 +4、合作 +8。
    expect(repaired.message).toBe('主线接回去了，整栋楼恢复供电。阿林信任 +2。');
    expect(observeBlackout(game).alinTrust).toBeCloseTo(87.4, 5);
    // 承诺最终被记成 kept，不是继续挂着 broken。
    expect(
      loadCompetitionNpcMemory(game, 'alin').some((entry) => entry.kind === 'promise' && entry.status === 'kept'),
    ).toBe(true);
  });

  it('接单当天不误判失信：还没到期限就 sync，promiseBroken 不该被写', async () => {
    const game = await promisedAndWaiting();
    // 同一天里反复 sync（换层、开关面板都会触发）：不该把「刚答应」当成「已失信」。
    syncBlackoutCrisis(game);
    syncBlackoutCrisis(game);

    expect(flagCount(game, BLACKOUT_FLAG.promiseBroken)).toBe(0);
    expect(alinStanceOf(game)).toBe('neutral');
    expect(observeBlackout(game).alinTrust).toBeCloseTo(90.2, 5);

    // 期限是「接单当天 + BLACKOUT_PROMISE_DAYS」，差一天都不能算过期。
    game.day = 1 + BLACKOUT_PROMISE_DAYS;
    syncBlackoutCrisis(game);
    expect(flagCount(game, BLACKOUT_FLAG.promiseBroken)).toBe(0);
  });

  it('失信不是死局：修好之后隔天再点，是「已经有结果了」而不是重复扣料', async () => {
    const game = await promisedAndWaiting();
    game.day = 1 + BLACKOUT_PROMISE_DAYS + 1;
    syncBlackoutCrisis(game);
    giveAllRepairParts(game);
    verifyBlackoutMaterials(game);
    expect((await runBlackoutRepair(game)).status).toBe('executed');

    game.day += 1;
    const again = await runBlackoutRepair(game);
    expect(again.status).toBe('already_resolved');
    expect(again.detail).toBe('crisis_resolved');
    // 已经修好了，不会再扣一次料。
    expect(countItem(game.player.inventory, 'fuse')).toBe(0);
  });
});
