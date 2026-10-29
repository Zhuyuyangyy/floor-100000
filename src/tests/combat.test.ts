import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../core/config';
import { createNewGame } from '../core/gameState';
import { deriveSeed, makeRng } from '../core/rng';
import type { Rng } from '../core/rng';
import { addItem } from '../systems/InventorySystem';
import type { CombatAction, Combatant } from '../systems/combat';
import { GUARD_ENERGY_RESTORE, playerCombatant, resolveRound } from '../systems/combat';

// 通用测试体：默认取「中间态」数值，再用 Partial 覆盖成各分支需要的边界态。
// name 给「拾荒者」，让日志文案断言贴近工单示例。
function fixture(overrides: Partial<Combatant> = {}): Combatant {
  return {
    hp: 30,
    maxHp: 30,
    damage: 6,
    accuracy: 5,
    defense: 2,
    evasion: 3,
    name: '拾荒者',
    ...overrides,
  };
}

// 从第 1 组起找第一个满足条件的派生 seed。命中边界、逃跑成败这类场景靠运气
// 构造既慢又脆；扫固定区间把场景变成确定性输入（全程无 Math.random）。
// 必须经过 deriveSeed 打散：xorshift32 的首帧输出被 s<<13 主导，直接拿
// 1..1000 这类小整数当 seed，首抽会聚集在极低值区（nextFloat ≈ seed/2^19），
// 永远构造不出「roll 偏大」的场景。派生 seed 的首帧分布均匀，边界一把一个。
function findSeed(predicate: (rng: Rng) => boolean): number {
  for (let i = 1; i <= 1000; i++) {
    const seed = deriveSeed('combat-test', i);
    if (predicate(makeRng(seed))) return seed;
  }
  throw new Error('1000 个派生 seed 内未找到满足条件的场景');
}

// 「沙包怪物」：必定命中玩家（accuracy 100），玩家打不动它（evasion 11），
// 用于隔离玩家侧分支；血量给足，避免玩家抢先把它打死导致怪物不还手。
function punchingBag(overrides: Partial<Combatant> = {}): Combatant {
  return fixture({ hp: 100, damage: 6, accuracy: 100, defense: 0, evasion: 11, ...overrides });
}

// 「木桩玩家」：打不中怪物（accuracy 0），也几乎闪不掉（evasion 0 / defense 0），
// 用于隔离怪物侧分支，让怪物伤害成为可精确预期的定值。
function practiceDummy(overrides: Partial<Combatant> = {}): Combatant {
  return fixture({ hp: 100, accuracy: 0, defense: 0, evasion: 0, name: '你', ...overrides });
}

describe('resolveRound：确定性（同 seed 同结果）', () => {
  it('同 seed 两次调用结果完全一致，且不写传入对象', () => {
    const player = practiceDummy();
    const monster = fixture();
    const hpBefore = { player: player.hp, monster: monster.hp };

    const r1 = resolveRound(player, monster, 'attack', makeRng(7));
    const r2 = resolveRound(player, monster, 'attack', makeRng(7));

    expect(r1).toEqual(r2);
    // 纯函数验证：伤害只从返回值给出，血量由调用方落地，本函数不得偷偷扣血。
    expect(player.hp).toBe(hpBefore.player);
    expect(monster.hp).toBe(hpBefore.monster);
  });

  it('不同 seed 会分出命中/未命中两种结果（非恒定输出）', () => {
    // accuracy 0 vs defense 2 / evasion 0：roll > 12 才命中（约四成），
    // 50 个派生 seed 足以同时覆盖两种结果，证明随机源真的接进了公式。
    const outcomes = new Set<boolean>();
    for (let i = 1; i <= 50; i++) {
      const r = resolveRound(
        practiceDummy(),
        fixture({ defense: 2, evasion: 0 }),
        'attack',
        makeRng(deriveSeed('spread', i)),
      );
      outcomes.add(r.playerDamage > 0);
    }
    expect(outcomes.size).toBe(2);
  });
});

describe('命中公式边界：roll + accuracy > 10 + defense + evasion', () => {
  it('roll=0、accuracy=10 打 defense0/evasion0：10 > 10 不成立 → 未命中', () => {
    const seed = findSeed((rng) => rng.nextInt(0, 20) === 0);
    const r = resolveRound(
      practiceDummy({ accuracy: 10 }),
      fixture({ defense: 0, evasion: 0 }),
      'attack',
      makeRng(seed),
    );
    expect(r.playerDamage).toBe(0);
    expect(r.monsterDead).toBe(false);
    expect(r.messages.some((m) => m.includes('未命中'))).toBe(true);
  });

  it('roll=1、同样配置：11 > 10 成立 → 命中', () => {
    const seed = findSeed((rng) => rng.nextInt(0, 20) === 1);
    const r = resolveRound(
      practiceDummy({ accuracy: 10 }),
      fixture({ defense: 0, evasion: 0 }),
      'attack',
      makeRng(seed),
    );
    expect(r.playerDamage).toBeGreaterThan(0);
    expect(r.messages.some((m) => m.includes('未命中'))).toBe(false);
  });

  it('accuracy=11 对 defense0/evasion0：roll 取最小 0 也必中', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const r = resolveRound(
        practiceDummy({ accuracy: 11 }),
        fixture({ defense: 0, evasion: 0 }),
        'attack',
        makeRng(seed),
      );
      expect(r.playerDamage).toBeGreaterThan(0);
    }
  });

  it('evasion=11 对 accuracy=0：roll 取最大 20 也必不中', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const r = resolveRound(
        practiceDummy({ accuracy: 0 }),
        fixture({ evasion: 11 }),
        'attack',
        makeRng(seed),
      );
      expect(r.playerDamage).toBe(0);
      expect(r.monsterDead).toBe(false);
    }
  });
});

describe('伤害公式：max(1, damage - floor(defense/2))', () => {
  it('高防御也无法完全免伤：下限夹到 1 点', () => {
    // accuracy 200 保证必中（否则 defense 100 会让命中公式直接不成立）。
    const r = resolveRound(
      practiceDummy({ damage: 2, accuracy: 200 }),
      fixture({ hp: 50, defense: 100, evasion: 0 }),
      'attack',
      makeRng(1),
    );
    // 2 - floor(100/2) = -48 → max(1, -48) = 1
    expect(r.playerDamage).toBe(1);
    expect(r.messages.some((m) => m.includes('1 点伤害'))).toBe(true);
  });

  it('防御按一半折算：damage 6 打 defense 3 → 6-1=5', () => {
    const r = resolveRound(
      practiceDummy({ damage: 6, accuracy: 200 }),
      fixture({ hp: 50, defense: 3, evasion: 0 }),
      'attack',
      makeRng(1),
    );
    expect(r.playerDamage).toBe(5);
  });
});

describe('guard：本回合不出手且受伤减半', () => {
  it('同一怪物连续两回合对比：attack 挨 6 点，guard 只挨 3 点', () => {
    const player = practiceDummy();
    const monster = punchingBag(); // 同一对象复用，顺带验证 resolveRound 不写它
    const hpBefore = monster.hp;

    const attackRound = resolveRound(player, monster, 'attack', makeRng(1));
    const guardRound = resolveRound(player, monster, 'guard', makeRng(1));

    expect(attackRound.playerDamage).toBe(0); // accuracy 0 打 evasion 11，玩家必空
    expect(attackRound.monsterDamage).toBe(6); // 怪物必中，6 - floor(0/2) = 6
    expect(guardRound.playerDamage).toBe(0); // guard 本回合不攻击
    expect(guardRound.monsterDamage).toBe(3); // floor(6/2) = 3
    expect(guardRound.messages.some((m) => m.includes('格挡'))).toBe(true);
    expect(monster.hp).toBe(hpBefore); // 纯函数：两回合之间怪物血量未被改写
  });

  it('guard 至少保留 1 点伤害：怪物 1 点攻也压不到 0', () => {
    const r = resolveRound(practiceDummy(), punchingBag({ damage: 1 }), 'guard', makeRng(1));
    // floor(1/2) = 0 → max(1, 0) = 1，格挡不是无敌盾
    expect(r.monsterDamage).toBe(1);
  });

  it('GUARD_ENERGY_RESTORE 为 3（精力返还数值由调用方应用）', () => {
    expect(GUARD_ENERGY_RESTORE).toBe(3);
  });
});

describe('flee：成功率 0.45 + 0.01 * evasion', () => {
  it('evasion=100 时阈值 1.45：任何 roll 都逃得掉，且零伤害', () => {
    const r = resolveRound(practiceDummy({ evasion: 100 }), punchingBag(), 'flee', makeRng(1));
    expect(r.fled).toBe(true);
    expect(r.playerDamage).toBe(0);
    expect(r.monsterDamage).toBe(0); // 逃掉即无伤，不存在白打一击
    expect(r.monsterDead).toBe(false);
    expect(r.playerDead).toBe(false);
    expect(r.messages.some((m) => m.includes('逃'))).toBe(true);
  });

  it('evasion=0 且首帧 nextFloat() < 0.45：阈值边界内成功', () => {
    const seed = findSeed((rng) => rng.nextFloat() < 0.45);
    const r = resolveRound(practiceDummy({ evasion: 0 }), punchingBag(), 'flee', makeRng(seed));
    expect(r.fled).toBe(true);
  });

  it('evasion=0 且首帧 nextFloat() ≥ 0.45：逃不掉，白挨一击', () => {
    const seed = findSeed((rng) => rng.nextFloat() >= 0.45);
    const r = resolveRound(practiceDummy({ evasion: 0 }), punchingBag(), 'flee', makeRng(seed));
    expect(r.fled).toBe(false);
    expect(r.playerDamage).toBe(0);
    expect(r.monsterDamage).toBe(6); // 失败即怪物正常结算一击，不享受格挡减半
    expect(r.messages.some((m) => m.includes('逃跑失败'))).toBe(true);
  });

  it('evasion 越高阈值越高：100 比 0 在「差一点」的 seed 上也能逃掉', () => {
    // 取一个 nextFloat 落在 [0.45, 1.45) 内的 seed：对 evasion=0 是失败，
    // 对 evasion=100 是成功，用同一个 roll 证明公式里确实含 evasion 项。
    const seed = findSeed((rng) => {
      const v = rng.nextFloat();
      return v >= 0.45 && v < 1.45;
    });
    const low = resolveRound(practiceDummy({ evasion: 0 }), punchingBag(), 'flee', makeRng(seed));
    const high = resolveRound(practiceDummy({ evasion: 100 }), punchingBag(), 'flee', makeRng(seed));
    expect(low.fled).toBe(false);
    expect(high.fled).toBe(true);
  });
});

describe('死亡判定与不过杀', () => {
  it('monsterDead：伤害夹到刚好打死，日志不出现过杀数字', () => {
    const r = resolveRound(
      practiceDummy({ damage: 10, accuracy: 200 }),
      fixture({ hp: 3, defense: 0, evasion: 0 }),
      'attack',
      makeRng(1),
    );
    // 10 点夹到剩余 3 点：3 - 3 = 0 刚好致死
    expect(r.playerDamage).toBe(3);
    expect(r.monsterDead).toBe(true);
    expect(r.monsterDamage).toBe(0); // 死人不会还手
    expect(r.messages.some((m) => m.includes('3 点伤害'))).toBe(true);
    expect(r.messages.some((m) => m.includes('10 点伤害'))).toBe(false);
  });

  it('playerDead：怪物伤害夹到剩余血量并标记死亡', () => {
    const r = resolveRound(
      practiceDummy({ hp: 4 }),
      punchingBag({ damage: 9 }),
      'attack',
      makeRng(1),
    );
    expect(r.playerDamage).toBe(0);
    // 9 点夹到剩余 4 点：4 - 4 = 0
    expect(r.monsterDamage).toBe(4);
    expect(r.playerDead).toBe(true);
    expect(r.monsterDead).toBe(false);
  });

  it('双方都还剩血时谁也不会被误判死亡', () => {
    const r = resolveRound(practiceDummy({ hp: 4 }), punchingBag({ damage: 2 }), 'attack', makeRng(1));
    expect(r.monsterDamage).toBe(2);
    expect(r.playerDead).toBe(false);
    expect(r.monsterDead).toBe(false);
  });
});

describe('messages', () => {
  it('三种行动都产出非空中文短句', () => {
    const actions: CombatAction[] = ['attack', 'guard', 'flee'];
    for (const action of actions) {
      const r = resolveRound(practiceDummy(), punchingBag(), action, makeRng(3));
      expect(r.messages.length).toBeGreaterThan(0);
      for (const m of r.messages) {
        expect(typeof m).toBe('string');
        expect(m.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('怪物未命中时日志为「扑空了」，玩家未命中时为「未命中」', () => {
    // 玩家闪避拉满 → 怪物必空；玩家命中拉满 → 玩家必中，两条分支都走到。
    const missMonster = resolveRound(
      practiceDummy({ evasion: 200, accuracy: 200 }),
      punchingBag(),
      'attack',
      makeRng(1),
    );
    expect(missMonster.messages.some((m) => m.includes('扑空了'))).toBe(true);

    const missPlayer = resolveRound(
      practiceDummy({ accuracy: 0 }),
      fixture({ evasion: 11 }),
      'attack',
      makeRng(1),
    );
    expect(missPlayer.messages.some((m) => m.includes('未命中'))).toBe(true);
  });
});

describe('playerCombatant：从 GameState 推导', () => {
  it('无撬棍：damage=2 / accuracy=5 / defense=2 / evasion=3，hp 读当前值', () => {
    const s = createNewGame(1);
    const c = playerCombatant(s);
    expect(c.damage).toBe(2);
    expect(c.accuracy).toBe(5);
    expect(c.defense).toBe(2);
    expect(c.evasion).toBe(3);
    expect(c.hp).toBe(s.player.hp);
    expect(c.maxHp).toBe(GAME_CONFIG.player.hpMax);
  });

  it('包里有撬棍：damage +3（与裸装差 3 点）', () => {
    const bare = playerCombatant(createNewGame(1));
    const s = createNewGame(1);
    addItem(s.player.inventory, 'crowbar', 1);
    const armed = playerCombatant(s);
    expect(armed.damage).toBe(5);
    expect(armed.damage - bare.damage).toBe(3);
    // 其余数值不受装备影响。
    expect(armed.accuracy).toBe(bare.accuracy);
    expect(armed.defense).toBe(bare.defense);
    expect(armed.evasion).toBe(bare.evasion);
  });

  it('初始包自带手电/净水/口粮，不触发撬棍加成', () => {
    // createNewGame(1) 的 startingItems 里有 flashlight 等工具，但没有 crowbar。
    const s = createNewGame(1);
    expect(s.player.inventory.slots.some((slot) => slot.itemId === 'crowbar')).toBe(false);
    expect(playerCombatant(s).damage).toBe(2);
  });

  it('hp 读当前状态、maxHp 恒为配置上限（医疗包效果体现在 hp 上）', () => {
    const s = createNewGame(1);
    s.player.hp = 42;
    const c = playerCombatant(s);
    expect(c.hp).toBe(42);
    expect(c.maxHp).toBe(GAME_CONFIG.player.hpMax);
  });
});

describe('集成冒烟：playerCombatant + resolveRound 打完整一场', () => {
  it('带撬棍打弱怪：怪物先倒、玩家存活，战斗在有限回合内收敛', () => {
    const state = createNewGame(1);
    addItem(state.player.inventory, 'crowbar', 1);
    const player = playerCombatant(state);
    const monster = fixture({ hp: 12, damage: 2, accuracy: 5, defense: 1, evasion: 1, name: '拾荒者' });

    // 战斗 seed 由 runSeed + 场景键派生：换 seed 换一场，同 seed 完全复现。
    const rng = makeRng(deriveSeed(state.runSeed, 'combat:floor1:spot0'));
    let rounds = 0;
    while (rounds < 50) {
      const r = resolveRound(player, monster, 'attack', rng);
      monster.hp -= r.playerDamage;
      player.hp -= r.monsterDamage;
      rounds += 1;
      if (r.monsterDead || r.playerDead) break;
    }

    expect(monster.hp).toBeLessThanOrEqual(0);
    expect(player.hp).toBeGreaterThan(0);
    expect(rounds).toBeLessThan(50);
  });
});
