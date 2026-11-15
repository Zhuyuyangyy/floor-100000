import type { Item, ItemId } from '../core/gameTypes';

// ── 契约第四节：物品的心情字段（AG-29，2026-11-16）───────────────────────
//
// Item 接口本体在 core/gameTypes.ts（AG-25 属主，本工单不碰 core）。契约
// 第四节把这两个字段的属主写在 src/data/items.ts，所以用 TypeScript 的
// 模块增强落地：两个可选字段对全部 Item 生效，既有 15 件一件不改也合法
// （缺省即"无心情效果"），存档因此零迁移。
//
// 消费侧不读这两个字段的原始值——统一走 systems/moraleItems.ts 的
// moraleEffectOf()（概率掷与 seeded RNG 的唯一入口）。
declare module '../core/gameTypes' {
  interface Item {
    /** 使用后对 morale 点数的影响，对应 TWOM 的 GetDepressionChangeOnCheer。 */
    moraleDelta?: number;
    /** 概率生效的权重，0..1；1 = 必然生效。对应 EffectMoraleProbabilities。 */
    moraleChance?: number;
  }
}

// The 15 v0.1 items (docs/01_GDD.md §8). Every material referenced by a recipe
// or floor must exist here, and every item must have a concrete source.
//
// AG-29：给四件"能被使用"的消耗品配了心情字段（见下方 MORALE 注释）。
// ITEMS 本身一件不减一件不加——items.test.ts 钉死 15 件，survivalBalance
// 的"每件物品都有世界来源"与 economyLoop 的"无死物品"也都按这 15 件裁决。
export const ITEMS: Record<ItemId, Item> = {
  // MORALE 字段（契约第四节）。数值标尺：生存刚需（水/食）2~3 点，疗伤 4 点，
  // 精神向专物 6~12 点（见 MORALE_ITEMS）。morale 点数池归 AG-25（契约第一节），
  // 基线定后若要整体缩放，只改这两列数据，消费函数不动。
  //
  // 为什么只有这四件：moraleDelta 的消费点是 useConsumable（AG-25 接入），
  // 而它对 category !== 'consumable' 或无 effect 的物品直接拒绝。脏水设计内
  // 的出口是净水器/小周 1:1（不直饮）；8 件材料与撬棍/手电两件工具都不进
  // useConsumable——配了就是没人读的死数据。"手电不怕黑"若想要，消费点在
  // AG-25 的黑暗/照明路径，不在物品表（报告已给建议）。
  //
  // 净水：解渴舒坦。水是本章节最硬的稀缺品（survivalBalance 的水边际只有
  // 0.7 天），喝上一口是小事但确定的安慰，2 点。
  clean_water: { id: 'clean_water', displayName: '净水', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'thirst', amount: 30 }, moraleDelta: 2, moraleChance: 1 },
  dirty_water: { id: 'dirty_water', displayName: '脏水', category: 'consumable', stackable: true, maxStack: 99 },
  // 压缩口粮：顶饱一顿，实在的高兴。+30 饱食是全表单次最大，比面包高 1 点。
  ration_pack: { id: 'ration_pack', displayName: '压缩口粮', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'hunger', amount: 30 }, moraleDelta: 3, moraleChance: 1 },
  // 面包：吃得舒服但不如口粮实在（+20 饱食），与净水同档 2 点。
  bread: { id: 'bread', displayName: '面包', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'hunger', amount: 20 }, moraleDelta: 2, moraleChance: 1 },
  // 医疗包：疗伤安心。+40 hp 且清病症（applyCure），身体上的确定性是全表
  // 最高，心情回报也最高——比一顿饭更值钱的那种安心。
  medkit: { id: 'medkit', displayName: '医疗包', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'hp', amount: 40 }, moraleDelta: 4, moraleChance: 1 },
  battery: { id: 'battery', displayName: '电池', category: 'material', stackable: true, maxStack: 99 },
  scrap_metal: { id: 'scrap_metal', displayName: '废金属', category: 'material', stackable: true, maxStack: 99 },
  wood: { id: 'wood', displayName: '木材', category: 'material', stackable: true, maxStack: 99 },
  cloth: { id: 'cloth', displayName: '布料', category: 'material', stackable: true, maxStack: 99 },
  tape: { id: 'tape', displayName: '胶带', category: 'material', stackable: true, maxStack: 99 },
  filter: { id: 'filter', displayName: '滤芯', category: 'material', stackable: true, maxStack: 99 },
  wire: { id: 'wire', displayName: '电线', category: 'material', stackable: true, maxStack: 99 },
  fuse: { id: 'fuse', displayName: '保险丝', category: 'material', stackable: true, maxStack: 99 },
  crowbar: { id: 'crowbar', displayName: '撬棍', category: 'tool', stackable: false, maxStack: 1 },
  flashlight: { id: 'flashlight', displayName: '低电量手电', category: 'tool', stackable: false, maxStack: 1 },
};

// ── 精神向物品（AG-29 新增）────────────────────────────────────────────
//
// TWOM 的五类精神物品（烟/酒/咖啡/书/收音机）里挑四件合末日塔楼设定的做。
// 收音机缺席是有意的：TWOM 把音乐单独开了一条通道
// （AvgDepressionChangeForCheerfulMusic），那是设施级的持续效果，归 AG-25
// 的 SurvivalSystem，不该塞进消耗品表。
//
// id 为什么不进 ITEMS/ItemId：core 的 ItemId 联合在 gameTypes.ts（AG-25
// 属主），type alias 不能被模块增强合并；而 ITEMS 的 15 件被
// items.test.ts / survivalBalance / economyLoop 三方钉死（它们按 ITEM_IDS
// 裁决"每件物品都有来源、无死物品"）。所以新物品单独成表，两表在
// ALL_ITEMS 合并后由 getItem/isItemId 统一发号——所有按 id 字符串查表的
// 消费侧（堆叠、存读、商店、使用）无需任何改动就认识它们。
export type MoraleItemId = 'cigarette' | 'coffee' | 'moonshine' | 'old_book';

/** 物品表认得的全部 id（原 15 件 + 精神向新物品）。 */
export type KnownItemId = ItemId | MoraleItemId;

// 新物品的 morale 数值标尺与既有四件同源：精神向专物 6~12 点（约当半日到
// 一日的衰减量级，AG-25 定基线后如需整体缩放只改数据）。chance 的语义是
// EffectMoraleProbabilities：效果不是确定的，按概率掷；1 = 必然生效。
//
// 获取路径（真实可走，moraleItems.test.ts 逐件钉死）：全部走行商货架
// （systems/shop.ts 的 SHOP_STOCK，按楼层 band 上架），收购价由 sellPrice
// 的既有逻辑自动获得。制作与搜刮路径不归本工单——工作台面板渲染归场景层
// （AG-11），楼层战利品池归 AG-30，报告里有具体建议。
//
// 副作用只允许动 energy：契约第四节只定了 moraleDelta/moraleChance 两个
// 字段，且新物品一律不碰 hunger/thirst——精神物不能成为水食的替代品
// （survivalBalance 的水食边际是钉死的，economyLoop 也钉了"consumable
// 有效果"）。私酒的 -12 精力是"喝完好困"的机械代价，在现有 schema 内
// 表达，不需要新字段。
export const MORALE_ITEMS: Record<MoraleItemId, Item> = {
  // 香烟：TWOM 精神物品里最便宜、最可靠的一档。moraleDelta +6 / chance 1
  // ——点一根就完事的确定性安慰。effect energy +5：TWOM 主循环有
  // TickStimulants（刺激品 tick），一口尼古丁吊着精神，折算成最低限度精力。
  // 四件里唯一天然后果为零的（对比私酒）。band 3 起 10 金。
  cigarette: { id: asItemId('cigarette'), displayName: '香烟', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'energy', amount: 5 }, moraleDelta: 6, moraleChance: 1 },
  // 咖啡：全表最强刺激品（energy +20），定价与一份口粮（18 金）对齐——
  // 它是精力道具，不是生存刚需。moraleDelta +6 / chance 0.8：
  // EffectMoraleProbabilities 在真实物品上的主要落点，"冲坏了/凉了"的两成
  // 落空，让概率模型不只活在测试里。band 4 起 18 金。
  coffee: { id: asItemId('coffee'), displayName: '咖啡', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'energy', amount: 20 }, moraleDelta: 6, moraleChance: 0.8 },
  // 私酒：四件里最强的单次提振（moraleDelta +12 / chance 1），对应 TWOM
  // 里"酒是心情大按钮"的地位。代价是机械的：effect energy -12——一口闷
  // 下去肯定高兴，然后是好困。任务示例的"下个游戏日 hunger 消耗加快"归
  // AG-25 的 SurvivalSystem（报告给了延伸建议），本工单用即刻代价落地。
  // band 5 起 25 金：越往上走，塔里才拿得出让人醉一夜的东西。
  moonshine: { id: asItemId('moonshine'), displayName: '私酒', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'energy', amount: -12 }, moraleDelta: 12, moraleChance: 1 },
  // 旧书：moraleDelta +8 / chance 0.85——一本旧书不一定每本都看得进去
  // （一成五的落空），但看进去了比一顿饭强。effect energy +8：本作没有
  // "放松/压力"数值槽，翻书定神折算成最低限度的精力回复，四件里最弱，
  // 配合中档价格。一次性消耗（读一遍收一遍，useConsumable 的既有语义），
  // 所以它不是可复读的快乐。band 5 起 20 金。
  old_book: { id: asItemId('old_book'), displayName: '旧书', category: 'consumable', stackable: true, maxStack: 99, effect: { stat: 'energy', amount: 8 }, moraleDelta: 8, moraleChance: 0.85 },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export const MORALE_ITEM_IDS = Object.keys(MORALE_ITEMS) as MoraleItemId[];

// 全表：原 15 件 + 精神向新物品。getItem/isItemId 只认这一张表。
export const ALL_ITEMS: Record<KnownItemId, Item> = { ...ITEMS, ...MORALE_ITEMS };

export const ALL_ITEM_IDS = Object.keys(ALL_ITEMS) as KnownItemId[];

export function getItem(id: KnownItemId): Item {
  return ALL_ITEMS[id];
}

// 新物品 id 进 core 类型化 API（addItem/countItem/ShopEntry/SaveSystem 校验）
// 时的唯一铸入口。core 的 ItemId 联合不可模块增强（type alias 不能合并），
// 而所有消费侧都按 id 字符串查表——getItem/isItemId 已认识这些 id，堆叠、
// 存读、商店买卖走的是同一条字符串路径——所以这个铸只在类型层面宽限，
// 运行时行为与既有物品完全一致。散落的 `as ItemId` 一律收在这里。
export function asItemId(id: MoraleItemId): ItemId {
  return id as ItemId;
}

// 谓词签名不变（value is ItemId），运行时改查 ALL_ITEMS。这是有意的：
// SaveSystem 的存档校验、NpcMemory 的日记过滤、quests/rulesExecutor 的
// 引用校验都用这道门把"存档/配置里的字符串"裁决成"已知物品"——新物品必须
// 过同一道门，否则玩家买了香烟之后存档会因"未知物品 itemId=cigarette"
// 被整档拒收。窄化后的类型在下游被当作 ItemId 使用，与运行时一致（所有
// 消费侧按字符串查表，不依赖联合成员）；类型层面的真正宽化要等 core 的
// ItemId 联合（AG-25）。
export function isItemId(value: string): value is ItemId {
  return Object.prototype.hasOwnProperty.call(ALL_ITEMS, value);
}
