// A2（docs/OVERNIGHT_PLAN.md Wave A）：怪物名册 + 行为修饰表。
//
// 出处：docs/RE_COMPETITIVE.md 一、CENTUM 怪物表——「37 种怪，
// difficulty 1–9 阶梯 + 5 个特殊，行为标签：normal 23 / fast 5 /
// slow 4 / ranged 4 / nomove 2 / dig / greedy / charge / ignorewall
// 各 1」。那款游戏的战斗深度不来自怪多，而来自「同一层里的怪打法
// 不一样」——看见一只怪就知道这回合该怎么打。我们 v0.1 只有 5 层
// （PLAYABLE_FLOORS_V01=[1..5]），照搬 37 只没有意义，这里收敛成
// 「4 个楼层带 × 3–4 只 + 1 只守门人」共 15 条，但 7 种行为标签全部
// 保留，且每层至少 2 只，保证 2–5 层的每一次遭遇在打法上都有区分。
//
// 纯逻辑模块：不 import Phaser、不读全局、不碰 GameState。随机一律走
// core/rng 的 seeded rng（作战书硬规则：世界生成与事件判定禁用全局
// 随机函数）——同 seed 同层必抽同一只，测试可复现，存档可回放。

// Combatant 直接复用 A1 战斗引擎的类型（本工单落盘初期 combat.ts
// 尚未就绪，曾用本地结构副本占位；A1 交付后已核对字段逐字一致并切回
// import type）。只 import 类型、不 import 任何运行时值——本模块保持
// 零 Phaser、零战斗引擎依赖的纯数据/纯函数形态。
import type { Combatant } from './combat';
import type { Rng } from '../core/rng';

// 对外保持 Combatant 可见：applyBehavior 的签名里要用它，调用方
// （战斗面板、测试）从本模块一次拿全，不必知道类型定义搬去了哪里。
export type { Combatant };

// 七种行为标签。与 CENTUM 的标签集对齐后按我们自己的战斗模型裁剪：
// CENTUM 的 nomove/dig/greedy/charge/ignorewall 依赖格子地图，我们是
// 横版即时转回合制，落不到棋盘上的标签全部砍掉，只留能在
// accuracy/defense/evasion/damage 四个属性上做文章的七种。
export type MonsterBehavior =
  | 'normal' // 白板怪：数值就是全部，用来当权重填充物
  | 'fast' // 先手多变：准且难抓
  | 'slow' // 笨重坦克：打不中但硬
  | 'ranged' // 放冷枪：格挡只能挡一半
  | 'ambusher' // 蹲人：遭遇战第一下特别疼
  | 'coward' // 欺软怕硬：残血自己跑，追不上也打不死
  | 'brute'; // 蛮力：刀刀见骨但容易落空

export interface MonsterDef {
  id: number;
  /** 中文显示名（战斗日志、图鉴、 UI 直接用这个字段） */
  name: string;
  hp: number;
  damage: number;
  accuracy: number;
  defense: number;
  evasion: number;
  behavior: MonsterBehavior;
  /** 最早出现在第几层；低层怪会随权重继续在高层出现（见权重设计） */
  minFloor: number;
  /** 随机池权重；0 = 不进随机池，只由 boss 遭遇显式召唤 */
  weight: number;
}

// 数值梯度按工单分层带：
//   2 层 hp 5–8  / dmg 2–3
//   3 层 hp 9–14 / dmg 3–4
//   4 层 hp 15–22/ dmg 4–6
//   5 层 hp 20–30/ dmg 5–7
//   boss hp 45   / dmg 8
// 英文名写在上方注释里：name 字段只放中文显示名，接口不扩字段。
export const MONSTERS: readonly MonsterDef[] = [
  // ── 2 层带：刚离开宿舍层的第一批威胁，血薄恨但量大 ──
  // 拾荒者 / Scavenger：翻垃圾堆的活人，最底层的威胁，weight 给最高。
  { id: 101, name: '拾荒者', hp: 6, damage: 2, accuracy: 74, defense: 1, evasion: 2, behavior: 'normal', minFloor: 2, weight: 10 },
  // 楼道野猫 / Corridor Stray：末世里野猫比人难缠，快且闪。
  { id: 102, name: '楼道野猫', hp: 5, damage: 2, accuracy: 76, defense: 0, evasion: 7, behavior: 'fast', minFloor: 2, weight: 9 },
  // 瞌睡宿管 / Dozing Warden： former 宿舍管理员，迟钝但皮实。
  { id: 103, name: '瞌睡宿管', hp: 8, damage: 2, accuracy: 68, defense: 5, evasion: 0, behavior: 'slow', minFloor: 2, weight: 9 },
  // 偷食贼 / Food Thief：抢一口吃的就跑，残血直接跑路。
  { id: 104, name: '偷食贼', hp: 5, damage: 3, accuracy: 72, defense: 0, evasion: 5, behavior: 'coward', minFloor: 2, weight: 9 },

  // ── 3 层带：开始出现「不讲道理」的个体 ──
  // 变异住客 / Mutated Tenant：饿到极点的住客，力大无穷但挥空率高。
  { id: 201, name: '变异住客', hp: 14, damage: 4, accuracy: 70, defense: 2, evasion: 1, behavior: 'brute', minFloor: 3, weight: 8 },
  // 楼道潜行者 / Corridor Stalker：藏在楼梯口给你第一刀的家伙。
  { id: 202, name: '楼道潜行者', hp: 9, damage: 3, accuracy: 78, defense: 1, evasion: 4, behavior: 'ambusher', minFloor: 3, weight: 7 },
  // 弹弓顽童 / Slingshot Brat：隔着一个房间放冷枪。
  { id: 203, name: '弹弓顽童', hp: 10, damage: 3, accuracy: 80, defense: 0, evasion: 3, behavior: 'ranged', minFloor: 3, weight: 8 },

  // ── 4 层带：宿舍楼的「基础设施」开始吃人 ──
  // 断电守卫 / Blackout Guard：穿着旧制服的守卫，铁门一样难啃。
  { id: 301, name: '断电守卫', hp: 20, damage: 4, accuracy: 76, defense: 6, evasion: 0, behavior: 'normal', minFloor: 4, weight: 6 },
  // 巢穴母体 / Nest Matriarch：在通风井里做窝的东西，一巴掌一管血。
  { id: 302, name: '巢穴母体', hp: 22, damage: 6, accuracy: 72, defense: 3, evasion: 0, behavior: 'brute', minFloor: 4, weight: 6 },
  // 通风管蛛 / Vent Spider：天花板上来去自如，快得看不清。
  { id: 303, name: '通风管蛛', hp: 15, damage: 5, accuracy: 80, defense: 1, evasion: 8, behavior: 'fast', minFloor: 4, weight: 5 },

  // ── 5 层带：顶层前最后一道绞肉机 ──
  // 焚书者 / Book Burner：烧了整层教材的人，火机当远程武器甩。
  { id: 401, name: '焚书者', hp: 24, damage: 7, accuracy: 82, defense: 2, evasion: 2, behavior: 'ranged', minFloor: 5, weight: 5 },
  // 负重尸 / Burdened Carcass：背着冰箱上楼的尸体，慢，但扛打。
  { id: 402, name: '负重尸', hp: 30, damage: 5, accuracy: 68, defense: 6, evasion: 0, behavior: 'slow', minFloor: 5, weight: 4 },
  // 顶楼疯裔 / Loft Heir：在顶层圈地的疯子，专蹲上楼口。
  { id: 403, name: '顶楼疯裔', hp: 20, damage: 6, accuracy: 80, defense: 2, evasion: 5, behavior: 'ambusher', minFloor: 5, weight: 4 },
  // 畏光者 / Light-Shunner：见光就躲的住户，残血必定逃走。
  { id: 404, name: '畏光者', hp: 26, damage: 5, accuracy: 74, defense: 2, evasion: 6, behavior: 'coward', minFloor: 5, weight: 4 },

  // ── Boss：守门人 / Gatekeeper ──
  // 只由 boss 遭遇显式召唤（ALTACIMA 每 10 层一个 Boss 的对应物；我们
  // v0.1 顶层第 5 层的守门人就是终点闸）。weight = 0 表示它永远不进
  // rollMonster 的随机池——否则第 5 层走着路就能撞见最终 Boss，
  // 遭遇的仪式感和难度曲线一起没了。
  { id: 900, name: '守门人', hp: 45, damage: 8, accuracy: 82, defense: 4, evasion: 0, behavior: 'normal', minFloor: 5, weight: 0 },
];

// 权重设计：低层怪 weight 高（8–10），高层怪 weight 低（4–5）。这样
// 第 5 层的池子里仍然会刷出拾荒者之流（垃圾怪不能绝迹，否则玩家没有
// 「稳一刀」的喘息），但统计上越高层越容易撞见硬怪——测试里的
// 「权重趋势」断言就是钉这条设计：高层平均 hp/damage 必须高于低层。

// 回退池：weight > 0 的怪里 minFloor 最低的一批（2 层带）。
// rollMonster 对宿舍层（floor 1，PLAYABLE_FLOORS_V01 的第 1 个）本
// 不该被调用；但引擎侧忘记判层时，返回最弱的 2 层候选远好过抛异常
// 把整个遭遇流程炸掉。
function lowestFloorPool(): MonsterDef[] {
  const weighted = MONSTERS.filter((m) => m.weight > 0);
  const lowest = Math.min(...weighted.map((m) => m.minFloor));
  return weighted.filter((m) => m.minFloor === lowest);
}

// 按层抽一只遭遇怪：minFloor <= floor 且 weight > 0 进池，按 weight
// 加权。无候选（floor < 2）时回退到最低层候选，见 lowestFloorPool
// 注释。只消耗 rng 一次 nextFloat()，同 seed 同 floor 结果必然一致。
//
// 返回的是名册条目本身（只读数据，不复制）——调用方按 Combatant 模板
// 读字段即可，不要改写它。
export function rollMonster(floor: number, rng: Rng): MonsterDef {
  const inRange = MONSTERS.filter((m) => m.minFloor <= floor && m.weight > 0);
  const pool = inRange.length > 0 ? inRange : lowestFloorPool();
  const total = pool.reduce((sum, m) => sum + m.weight, 0);
  let roll = rng.nextFloat() * total;
  for (const m of pool) {
    roll -= m.weight;
    if (roll < 0) return m;
  }
  // nextFloat() ∈ [0,1) 保证第一只必然可达；走到这里只剩浮点尾差，
  // 返回池末只是兜底，正常不可达。
  return pool[pool.length - 1];
}

// 行为修饰符：把「这只怪怎么打」翻译成 A1 战斗公式能吃的属性增量。
// 全中性地基是 normal——七种里六种都要在某个维度上打破 (1,0,0,0,0,1,0)。
export interface BehaviorMods {
  /** 伤害倍率（作用于 Combatant.damage，取整） */
  damageMult: number;
  /** 命中加成（直接加到 accuracy） */
  accuracyBonus: number;
  /** 防御加成（直接加到 defense） */
  defenseBonus: number;
  /** 闪避加成（直接加到 evasion） */
  evasionBonus: number;
  /** 格挡穿透 0–1：1 = 完全无视本回合格挡减伤（A1 的 guard 半伤对它打折） */
  guardPierce: number;
  /** 首轮伤害倍率：遭遇战第一下吃这个倍率，之后回到 1 */
  firstStrikeMult: number;
  /** 战退血线：hp frac 低于该值怪物逃走；0 = 不战退 */
  fleeAtHpFrac: number;
}

// 七种行为逐个给值。返回全新对象（非共享常量），调用方改写不会污染
// 查表；switch 穷尽七种，TS 严格模式下无需 default 兜底。
export function behaviorModifiers(b: MonsterBehavior): BehaviorMods {
  switch (b) {
    case 'normal':
      return { damageMult: 1, accuracyBonus: 0, defenseBonus: 0, evasionBonus: 0, guardPierce: 0, firstStrikeMult: 1, fleeAtHpFrac: 0 };
    case 'fast':
      // 快 = 抓不住也打得准：准 +3、闪 +2，其他不动。数值克制在
      // 「不改变一击生死」的幅度——A1 命中公式是
      // accuracy + rng(0..20) > defense + 10 + evasion，±3 大约换
      // 15% 命中率，够读出差异，不够翻盘。
      return { damageMult: 1, accuracyBonus: 3, defenseBonus: 0, evasionBonus: 2, guardPierce: 0, firstStrikeMult: 1, fleeAtHpFrac: 0 };
    case 'slow':
      // 笨重坦克：笨手笨脚打不中（准 -2），但皮糙肉厚（防 +2）。
      return { damageMult: 1, accuracyBonus: -2, defenseBonus: 2, evasionBonus: 0, guardPierce: 0, firstStrikeMult: 1, fleeAtHpFrac: 0 };
    case 'ranged':
      // 放冷枪：伤害不变，但无视一半格挡减伤——guard 挡普通怪，
      // 挡不了隔房间甩过来的火机。
      return { damageMult: 1, accuracyBonus: 0, defenseBonus: 0, evasionBonus: 0, guardPierce: 0.5, firstStrikeMult: 1, fleeAtHpFrac: 0 };
    case 'ambusher':
      // 蹲人的：第一下特别疼（×1.5），之后回归普通——治「见面
      // 就被削掉半管血然后索然无味」的遭遇节奏。
      return { damageMult: 1, accuracyBonus: 0, defenseBonus: 0, evasionBonus: 0, guardPierce: 0, firstStrikeMult: 1.5, fleeAtHpFrac: 0 };
    case 'coward':
      // 欺软怕硬：血量掉到 40% 以下自己跑（战退由 A1 在回合末
      // 判定，本模块只给阈值）；跑掉的那只按半分赃物处理，A1/场景
      // 侧实现，这里不掺和奖励逻辑。
      return { damageMult: 1, accuracyBonus: 0, defenseBonus: 0, evasionBonus: 0, guardPierce: 0, firstStrikeMult: 1, fleeAtHpFrac: 0.4 };
    case 'brute':
      // 蛮力：刀刀见骨（×1.4）但挥空率高（准 -2）。1.4 倍取整后
      // 在 A1 的小数级伤害上仍读得出差别，又不会一换一击杀。
      return { damageMult: 1.4, accuracyBonus: -2, defenseBonus: 0, evasionBonus: 0, guardPierce: 0, firstStrikeMult: 1, fleeAtHpFrac: 0 };
  }
}

// 把行为修饰符应用到一个 Combatant，返回新对象（纯函数，不改入参）。
// accuracy/defense/evasion 加成直接加；damage 乘 damageMult 后四舍
// 五入（Math.round，防 1.4 倍造出 4.2 这种小数血），并夹到 ≥0 防止
// 极客把 base.damage 传成负数把治疗打成伤害。
// hp/maxHp 原样透传——血量缩放不属于行为修饰；coward 的战退血线是
// 运行时判定值，不烘焙进 Combatant。
export function applyBehavior(mods: BehaviorMods, base: Combatant): Combatant {
  return {
    hp: base.hp,
    maxHp: base.maxHp,
    damage: Math.max(0, Math.round(base.damage * mods.damageMult)),
    accuracy: base.accuracy + mods.accuracyBonus,
    defense: base.defense + mods.defenseBonus,
    evasion: base.evasion + mods.evasionBonus,
  };
}
