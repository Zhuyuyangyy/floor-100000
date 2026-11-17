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
// Every item referenced by a recipe, floor or encounter must exist here.
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
  // AG-武器分支：四件可制作武器。直接进 ITEMS 而不是独立表——ItemId 联合
  // （gameTypes.ts）已含它们，InventoryStack/GroundItem/lootPool 因此天然
  // 收得下，不用把整条物品链放宽到 KnownItemId。撬棍保持 v0.1 原状：
  // 它是置物架配方的成本，也是最初的战斗工具。
  fire_axe: { id: 'fire_axe', displayName: '消防斧', category: 'tool', stackable: false, maxStack: 1 },
  cleaver: { id: 'cleaver', displayName: '砍刀', category: 'tool', stackable: false, maxStack: 1 },
  short_sword: { id: 'short_sword', displayName: '短剑', category: 'tool', stackable: false, maxStack: 1 },
  dagger: { id: 'dagger', displayName: '匕首', category: 'tool', stackable: false, maxStack: 1 },
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

// 全表：ITEMS（v0.1 的 15 件 + AG-武器分支的四件武器）+ 精神向新物品。
// getItem/isItemId 只认这一张表。MORALE_ITEMS 仍然独立成表——"v0.1 的 15 件
// 一件不动"这类断言按 ITEMS 裁决（见 moraleItems.test.ts 的断言语义）。
export const ALL_ITEMS: Record<KnownItemId, Item> = { ...ITEMS, ...MORALE_ITEMS };

export const ALL_ITEM_IDS = Object.keys(ALL_ITEMS) as KnownItemId[];



// 新物品 id 进 core 类型化 API（addItem/countItem/ShopEntry/SaveSystem 校验）
// 时的唯一铸入口。core 的 ItemId 联合不可模块增强（type alias 不能合并），
// 而所有消费侧都按 id 字符串查表——getItem/isItemId 已认识这些 id，堆叠、
// 存读、商店买卖走的是同一条字符串路径——所以这个铸只在类型层面宽限，
// 运行时行为与既有物品完全一致。散落的 `as ItemId` 一律收在这里。
export function asItemId(id: MoraleItemId | DigToolId | MusicItemId): ItemId {
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
  return Object.prototype.hasOwnProperty.call(ALL_ITEMS, value) || Object.prototype.hasOwnProperty.call(DIG_TOOL_ITEMS, value) || Object.prototype.hasOwnProperty.call(MUSIC_ITEMS, value);
}

// ── AG-66：过道工具（铲子）──────────────────────────────────────────────
//
// 与 MORALE_ITEMS 完全同构的第三条路：ITEMS 的 19 件被 items.test.ts /
// survivalBalance / economyLoop 钉死（"每件物品都有世界来源、无死物品"），
// ALL_ITEMS 的 23 件被 moraleItems.test.ts 钉死，render/artpack.ts 的
// ITEM_ICON_FILES 又必须与 ITEMS 一件不差（itemIcons.test.ts）——铲子因此
// 单独成表，不进那两张表的身份空间，只由 getItem/isItemId 统一发号：背包
// （堆叠/存读/面板）、制作（craft_shovel 的 outputItemId）、存档校验全部
// 按 id 字符串查表，无需任何改动就认得它。
//
// 为什么必须是一件"真物品"而不是指定既有物品顶替：阻碍物的清理是常驻玩法，
// 撬棍同时是置物架配方的成本与拆床白名单（bunkDismantleTool），拿它兼职
// 铲子等于把"任何武器都是万能工具"的口子再开一次；且撬棍要 3 层铁箱才
// guaranteed，早期楼层可能整层摸不到。铲子只能做出来（recipes 的
// craft_shovel），**不进任何 loot 池**——survivalBalance 的"每层恰好一瓶
// guaranteed 水 + 一份食物"是钉死的，战利品里加一件工具会改写掉落曲线。
export type DigToolId = 'shovel';

/** AG-66 新增的过道清理工具。获取路径唯一：craft_shovel 配方。 */
export const DIG_TOOL_ITEMS: Record<DigToolId, Item> = {
  shovel: { id: asItemId('shovel'), displayName: '铲子', category: 'tool', stackable: false, maxStack: 1 },
};

export const DIG_TOOL_IDS = Object.keys(DIG_TOOL_ITEMS) as DigToolId[];

// 新定义：先查既有的 23 件（一件不改），再落铲子。签名不变
// （KnownItemId = ItemId | MoraleItemId）——背包里的铲子经 asItemId 铸成
// ItemId 进来，运行时两条查表路径都走得通；未知 id 的语义与旧版一致。
export function getItem(id: KnownItemId): Item {
  return (ALL_ITEMS as Record<string, Item | undefined>)[id] ?? DIG_TOOL_ITEMS[id as DigToolId] ?? MUSIC_ITEMS[id as MusicItemId];
}

// ── AG-74：收音机（TWOM 的音乐通道）────────────────────────────────────────
//
// 与 MORALE_ITEMS / DIG_TOOL_ITEMS 同构的第四条路：收音机不是消耗品（"使用"
// 是打开而不是吃掉，用了不消失），因此不进 ITEMS（19 件被 items.test.ts /
// survivalBalance / economyLoop 钉死）也不进 MORALE_ITEMS（ALL_ITEMS 的 23 件
// 被 moraleItems.test.ts 钉死），单独成表、只由 getItem/isItemId 统一发号——
// 背包堆叠、存档校验（SaveSystem 的 isItemId 门）、商摊收购全部按 id 字符串
// 查表，无需任何改动就认得它。
//
// TWOM 的五类精神物品里收音机原本缺席是有意的（见上方 MORALE_ITEMS 注释）：
// TWOM 把音乐单开一条通道（AvgDepressionChangeForCheerfulMusic），那是设施级
// 的持续效果，不该塞进消耗品表。AG-74 把这条通道落地为 systems/AudioSystem.ts
// 的音乐层：从背包"使用"收音机 → 当前楼层 BGM 切成「电台音乐」，持续
// RADIO_MINUTES 个游戏分钟后让位回场景氛围。没有收音机，废土只剩环境声。
//
// 获取路径：只能搜刮/交易获得，**不进任何制作配方**（survivalBalance 与
// craftLoop 钉着配方数量，加配方会红）。loot 池/商摊的具体接线归楼层数据与
// shop 属主（与铲子的分工同款，见 AG-66 注释）——本工单只发号。
export type MusicItemId = 'radio';

/** AG-74 的收音机：打开它 = 打开电台（AudioSystem.useRadioFromSlot）。 */
export const MUSIC_ITEMS: Record<MusicItemId, Item> = {
  radio: { id: asItemId('radio'), displayName: '收音机', category: 'tool', stackable: false, maxStack: 1 },
};

export const MUSIC_ITEM_IDS = Object.keys(MUSIC_ITEMS) as MusicItemId[];
