// Wave A1 —— 回合制战斗引擎（docs/OVERNIGHT_PLAN.md，ALTACIMA 攻/挡/逃）。
// 设计约束：
//  - 纯函数 + seeded RNG：本模块不 import Phaser、不碰 Math.random，同一 seed
//    的同一场战斗必须逐帧可复现（docs/02_TECH_SPEC.md §3）；
//  - 只读不改：传入的 Combatant 不会被写，伤害以 CombatRound 的字段交还调用方，
//    由 GameScene 决定何时扣血/结算死亡，避免本模块偷偷改状态（与 encounters.ts
//    只回 hpChange 的做法一致）；
//  - 所有随机走 makeRng(deriveSeed(...))，测试可用固定 seed 钉住每个分支。
import { GAME_CONFIG } from '../core/config';
import type { GameState } from '../core/gameTypes';
import type { Rng } from '../core/rng';

// 战斗中任意一方的数值快照（玩家或怪物）。由调用方在开打前构造，
// 例如 A2 的 rollMonster 把 MonsterDef 映射成 Combatant。
export interface Combatant {
  hp: number;
  maxHp: number;
  damage: number;
  accuracy: number;
  defense: number;
  evasion: number;
  // 可选展示名，只用于 messages 文案；缺省显示「敌人」。
  // 设为可选字段是为了不改动工单规定的六个必填数值，同时让 A2 的怪物名册
  // 能把「拾荒者」这类名字带进战斗日志。
  name?: string;
}

export type CombatAction = 'attack' | 'guard' | 'flee';

export interface CombatRound {
  // 字段语义注意：playerDamage = 玩家造成的伤害，monsterDamage = 怪物造成的伤害。
  playerDamage: number;
  monsterDamage: number;
  fled: boolean;
  monsterDead: boolean;
  playerDead: boolean;
  // 中文短句数组，按发生顺序排列，供 UI 战斗日志直接展示。
  messages: string[];
}

// 玩家裸装基础数值。出处：docs/OVERNIGHT_PLAN.md A1 工单；
// 先集中成常量，等 Wave B 的角色系统上线后按角色覆写即可，不用改公式。
const PLAYER_BASE_DAMAGE = 2;
const CROWBAR_DAMAGE_BONUS = 3;
const PLAYER_ACCURACY = 5;
const PLAYER_DEFENSE = 2;
const PLAYER_EVASION = 3;

// guard 额外返还的精力点。数值只在这里声明一次：GameScene 在回合结束后应用，
// 测试直接钉这个常量，避免两边各写一个 3 慢慢走偏。
export const GUARD_ENERGY_RESTORE = 3;

// 怪物未提供 name 时的兜底文案。
const DEFAULT_MONSTER_NAME = '敌人';

function monsterNameOf(monster: Combatant): string {
  return monster.name ?? DEFAULT_MONSTER_NAME;
}

// 命中判定：rng.nextInt(0,20) + attacker.accuracy > 10 + defender.defense + defender.evasion。
// 抽成独立函数（而不是内联进 resolveRound）是为了让测试能直接钉边界：
// roll=0 / roll=20、accuracy/defense/evasion 极端值各意味着什么。
// 注意是严格大于：roll+accuracy 恰好等于阈值时算未命中。
function rollHit(attacker: Combatant, defender: Combatant, rng: Rng): boolean {
  const roll = rng.nextInt(0, 20);
  return roll + attacker.accuracy > 10 + defender.defense + defender.evasion;
}

// 伤害公式：max(1, damage - floor(defense/2))。
// 防御按一半折算（向下取整），且任何命中至少 1 点——高防角色只会被打得轻，
// 不会出现「永远无法破防」的僵局，保证战斗一定收敛。
function rawDamage(damage: number, defense: number): number {
  return Math.max(1, damage - Math.floor(defense / 2));
}

// 把伤害夹到「刚好打死」：不过杀。否则日志会出现「造成 99 点伤害」而对方只剩
// 3 点血的错觉，玩家也无法从日志反推剩余血量。hp 已 <=0 时夹到 0（调用方
// 不应传入尸体，这里只是防御性兜底）。
function clampToRemainingHp(damage: number, hp: number): number {
  return Math.min(damage, Math.max(hp, 0));
}

// 结算一个回合。调用顺序固定为「玩家先手、怪物后手」，保证：
//  - 玩家打死怪物时怪物不会还手（死人不反击）；
//  - 逃跑成功时完全无伤（不存在「白打一击」）；
//  - 逃跑失败时怪物正常结算一击（= 白挨一下）。
export function resolveRound(
  player: Combatant,
  monster: Combatant,
  action: CombatAction,
  rng: Rng,
): CombatRound {
  const messages: string[] = [];
  const monsterName = monsterNameOf(monster);
  let playerDamage = 0;
  let monsterDamage = 0;
  let fled = false;
  let monsterDead = false;
  let playerDead = false;

  // ── 玩家阶段 ──
  if (action === 'flee') {
    // 逃跑成功率 0.45 + 0.01 * evasion：身法越高越容易脱战，但永远到不了
    // 100%，高闪避也不能把战斗变成可无限跳过的按钮。
    if (rng.nextFloat() < 0.45 + 0.01 * player.evasion) {
      fled = true;
      messages.push('你成功逃走了');
    } else {
      messages.push(`逃跑失败！${monsterName} 趁机扑上`);
    }
  } else if (action === 'guard') {
    // 本回合不出手，只减伤；精力返还由调用方按 GUARD_ENERGY_RESTORE 结算，
    // 本函数不碰 state，保持纯函数可单测。
    messages.push('你架起姿态格挡，本回合不出手');
  } else {
    if (rollHit(player, monster, rng)) {
      const dmg = clampToRemainingHp(rawDamage(player.damage, monster.defense), monster.hp);
      playerDamage = dmg;
      monsterDead = monster.hp - dmg <= 0;
      messages.push(`你击中${monsterName}，造成 ${dmg} 点伤害`);
      if (monsterDead) messages.push(`${monsterName} 倒下了`);
    } else {
      // 工单要求未命中在 messages 里明确记为「未命中」。
      messages.push('你的攻击未命中');
    }
  }

  // ── 怪物阶段 ──
  // 已逃掉或怪物已倒都不再结算：否则会出现「逃走了还被摸一把」的悖论。
  if (!fled && !monsterDead) {
    if (rollHit(monster, player, rng)) {
      const guarded = action === 'guard';
      // guard：受伤减半（向下取整）但至少 1 点——格挡很强但不是无敌盾。
      const dmg = guarded ? Math.max(1, Math.floor(rawDamage(monster.damage, player.defense) / 2)) : rawDamage(monster.damage, player.defense);
      monsterDamage = clampToRemainingHp(dmg, player.hp);
      playerDead = player.hp - monsterDamage <= 0;
      messages.push(
        guarded
          ? `${monsterName} 击中你，造成 ${monsterDamage} 点伤害（格挡减半）`
          : `${monsterName} 击中你，造成 ${monsterDamage} 点伤害`,
      );
      if (playerDead) messages.push('你倒下了……');
    } else {
      messages.push(`${monsterName} 扑空了`);
    }
  }

  return { playerDamage, monsterDamage, fled, monsterDead, playerDead, messages };
}

// 从 GameState 推导玩家战斗数值。所有装备判断都从 state.player.inventory 读，
// 不写死（工单要求「从 inventory 读，不写死」）：
//  - hp / maxHp：当前血量与配置上限（config/game-balance.json → player.hpMax）。
//    医疗包不在本函数里加血——它经 InventorySystem 抬高 state.player.hp，
//    这里读到的 hp 天然已包含医疗包的效果；
//  - damage：赤手 2 点；包里任一格 itemId==='crowbar'（撬棍）则 +3。
//    撬棍是不可堆叠工具（maxStack 1），用 some() 扫一遍槽位即可，
//    数量堆叠不影响判定——有就生效；
//  - accuracy 5 / defense 2 / evasion 3：生存者基础体能，写死成常量，
//    Wave B 角色系统上线后再按角色覆写。
export function playerCombatant(state: GameState): Combatant {
  const hasCrowbar = state.player.inventory.slots.some((slot) => slot.itemId === 'crowbar');
  return {
    hp: state.player.hp,
    maxHp: GAME_CONFIG.player.hpMax,
    damage: PLAYER_BASE_DAMAGE + (hasCrowbar ? CROWBAR_DAMAGE_BONUS : 0),
    accuracy: PLAYER_ACCURACY,
    defense: PLAYER_DEFENSE,
    evasion: PLAYER_EVASION,
    name: '你',
  };
}
