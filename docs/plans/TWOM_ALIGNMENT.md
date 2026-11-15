# TWOM 对齐 · 接口契约（总控定死，2026-11-16）

来源：`twom-reverse/docs/TWOM_MECHANICS.md`（This War of Mine mobile 1.0.7 反编译，
14,930 个 Kosovo* 符号）。本文件是 8 个 Agent 的共同契约，**任何一方不得单方面改 schema**。

## 一、新增玩家维度（AG-25 属主，写在 `src/core/gameTypes.ts` 的 PlayerState）

```ts
/** 体温 0..100。cold 按游戏小时消耗，热源附近恢复。0 = 失温失败。 */
bodyHeat: number;
/** 心情点数，TWOM 的 Depression 模型：点数池 + 衰减 + 概率生效，不是 0-100 槽。 */
morale: number;          // 当前点数，可为负
moraleBaseline: number;  // 每日复归的基线（DepressionChangeOnDayBegin）
/** 疾病中间态：healthy < sick < critical。hp 归零前多一档"病了但还能动"。 */
sickness: 'healthy' | 'sick' | 'critical';
sicknessDay: number;     // 染上疾病的那一天，用于"病了 N 天"
```

三条都是**必填字段**，但存档兼容走 `SaveSystem` 的"缺字段补默认"既有机制
（AG-06 的 ensureGrowth 是同一模式），**不升 schemaVersion**。

## 二、环境参数扩展（AG-25 属主，`src/core/constants.ts` 的 FloorEnvironment）

```ts
/** 0..1，这一层自身热源能补回的体温比例（床/蜡烛/火把/火盆）。 */
warmth?: number;
```

`environmentFor(floor)` 的解析顺序（AG-25 实现）：
1. `FLOOR_ENVIRONMENT[floor]`（逐层覆盖，AG-30 填数据）
2. `SEGMENT_ENVIRONMENT[segmentOf(floor).from]`
3. 阶梯向下回落
**并且**：第 1 步要先看 `FLOOR_TEMPLATES[floor]?.environment`（AG-30 填的逐层微调），
与 FLOOR_ENVIRONMENT 合并（template 的字段优先）。

## 三、楼层模板的环境微调字段（AG-30 属主，`src/data/floorTemplates.ts`）

```ts
/** 逐层环境微调，只写想覆盖的字段；未写的走 constants 的阶梯。 */
environment?: Partial<FloorEnvironment>;
```

## 四、物品的心情字段（AG-29 属主，`src/data/items.ts`）

```ts
/** 使用后对 morale 点数的影响，对应 TWOM 的 GetDepressionChangeOnCheer。 */
moraleDelta?: number;
/** 概率生效的权重，0..1；1 = 必然生效。对应 EffectMoraleProbabilities。 */
moraleChance?: number;
```

## 五、日记事件（AG-27 属主，新 `src/systems/DiarySystem.ts`）

```ts
type DiaryKind =
  | 'dwellerHungry' | 'groupHungry'
  | 'dwellerMorale'
  | 'dwellerWounded'
  | 'dwellerSick' | 'dwellerSickNoEffect'
  | 'lateFromScavenge'
  | 'shelterAttacked'
  | 'visitor' | 'requestFulfilled';

interface DiaryEntry {
  kind: DiaryKind;
  day: number;
  minute: number;   // **必须 Math.floor**——AG-06 的小数分钟 bug 就是这么来的
  text: string;
  /** 个体条目带 npcId；群体条目为 null（个体/群体双轨）。 */
  actorId: string | null;
}
```

写入走 `recordDiary(state, entry)`，读走 `diaryOf(state)`。**不替代 flash()**——
flash 是即时反馈，diary 是"什么值得记住"的结构化记录，两者并存。

## 六、Flag/Trigger（AG-26 属主，`src/systems/WorldFlags.ts`）

既有 `flagKey/hasFlag/setFlag` 保留。新增：
```ts
/** 触发器：条件满足时置旗。任务/对话/遭遇都按这个查询，不再各管各的布尔字段。 */
interface Trigger { id: string; when: (s: GameState) => boolean; sets: string; }
export function registerTrigger(t: Trigger): void;
export function evaluateTriggers(s: GameState): string[]; // 返回本次新置的旗
```
收敛目标：`worldEvents.activeEvent`、`dailyGoal`、`combat` 里散落的布尔字段。
**不迁移存量数据**，只让新逻辑走 trigger；存量字段标注 deprecated 注释。

## 七、NPC 三原子（AG-28 属主，`src/ai/**`）

```ts
type NpcAtom =
  | { kind: 'goTo'; x: number; speed?: number }
  | { kind: 'speak'; text: string }
  | { kind: 'playAnimation'; clip: string };
```
- `npcAtomsFor(npc, state): NpcAtom[]` —— 由 `npcSchedule`/`npcAutonomy` 驱动
- `Sensor` 抽象：AI 不直接问世界，经 `sense(npc, state)` 拿感知结果
- `Forced` 打断：玩家指令 > AI 自主（`forcedTarget` 非空时忽略自主原子）

## 八、行为树组件（AG-31 属主，新 `src/ai/behaviour.ts`）

实体模板三型：`BEHAVIOUR_TREE` / `TRIGGER` / `FLAG`。**只做设计与新文件**，
不改现有 NPC；文档写清"现在规模不需要完整行为树，但组件要能挂"。

## AG-29 实现说明（2026-11-16 追加，物品与经济工程师）

契约第四节两个字段的落地方式与既有约定不同，说明如下——**schema 本身未动**，
`moraleDelta?: number` / `moraleChance?: number` 逐字落在物品表上。

### 落地方式（为什么不直接改 core）

`Item` 接口与 `ItemId` 联合都在 `src/core/gameTypes.ts`（AG-25 属主）。两条
TypeScript 限制决定了对策：

1. **字段用模块增强**：`src/data/items.ts` 里 `declare module
   '../core/gameTypes' { interface Item { moraleDelta?; moraleChance? } }`。
   接口可跨模块合并，两个可选字段因此对全部 Item 生效，既有 15 件零改动
   合法，存档零迁移。
2. **新 id 不能进核心联合**：type alias 无法模块增强，且 `ITEMS` 的 15 件被
   items.test.ts / survivalBalance / economyLoop 三方钉死（它们按 `ITEM_IDS`
   裁决"每件物品都有来源、无死物品"）。新物品单独成表 `MORALE_ITEMS`
   （`Record<MoraleItemId, Item>`），与原表在 `ALL_ITEMS` 合并；`getItem` 的
   参数放宽为 `KnownItemId = ItemId | MoraleItemId`，`isItemId` 的运行时改查
   合并表（**谓词签名不变**）——SaveSystem 的存档校验、NpcMemory、quests、
   rulesExecutor 都走这道门，新物品必须过得了，否则"买了香烟存档被拒"。
   边界处进入 core 类型化 API 时统一走 `asItemId()`（items.ts 里唯一的铸入
   helper，散落 `as ItemId` 一律收在那里）；运行时所有消费侧按 id 字符串
   查表，行为与既有物品完全一致。

### 新物品表（4 件，全部走行商货架真实可买）

获取路径只动了 `shop.ts` 的 `SHOP_STOCK`（按 band 上架）；收购价由
`sellPrice` 既有逻辑（band 标价折半）自动获得，不新开表。每 band 库存行数
≤5——行商面板排版预算（5 行库存 + 8 行材料正好落在面板高度内），
moraleItems.test.ts 钉死。

| id | 名称 | band / 价 | effect | moraleDelta | moraleChance | 依据与副作用 |
|---|---|---|---|---|---|---|
| `cigarette` | 香烟 | 3 / 10 金 | energy +5 | +6 | 1 | TWOM 最便宜可靠的一档；"点一根就完事"的确定性安慰。+5 精力对应 TWOM 主循环的 TickStimulants（刺激品 tick）。四件里唯一天然后果为零 |
| `coffee` | 咖啡 | 4 / 18 金 | energy +20 | +6 | 0.8 | 全表最强刺激品，定价与一份口粮对齐（精力道具，非生存刚需）。chance 0.8 是 EffectMoraleProbabilities 在真实物品上的主要落点："冲坏了/凉了"的两成落空 |
| `old_book` | 旧书 | 5 / 20 金 | energy +8 | +8 | 0.85 | 一成五"看不进去"的落空；看进去了比一顿饭强。本作无"放松"槽，翻书定神折算成最弱精力回复。一次性消耗（读一遍收一遍） |
| `moonshine` | 私酒 | 5 / 25 金 | energy **-12** | +12 | 1 | 四件最强单次提振（TWOM 里酒是心情大按钮）。副作用是机械的即刻代价"喝完好困"——负效果在现有 schema 内表达，不新增字段；任务示例的"下个游戏日 hunger 消耗加快"见下方延伸建议 |

既有 15 件只配了 4 件：净水 +2 / 面包 +2 / 口粮 +3 / 医疗包 +4（均 chance
1）。依据：生存刚需 2~3 点、疗伤 4 点、精神向专物 6~12 点。**其余 11 件一律
不配**——moraleDelta 的消费点是 useConsumable，工具/材料/脏水进不去，配了
就是死数据（economyLoop 的"无死物品"同款哲学）。新物品一律不碰
hunger/thirst：精神物不能成为水食替代品。

### moraleEffectOf 的签名与语义

`src/systems/moraleItems.ts`（AG-29 新建，纯函数，禁 Math.random）：

```ts
function moraleEffectOf(item: Item, seed: number, day: number): { delta: number; applied: boolean }
```

- `moraleDelta` 缺省或 0 → `{ 0, false }`；`moraleChance` 缺省视为 1，越界
  夹取到 [0,1]（0 必不生效 / 1 必生效）。
- 生效判定 = `makeRng(deriveSeed(seed, day, 'morale-cheer', item.id)).chance(moraleChance)`；
  同 (seed, day, item) 必同结果，跨天真不同（可复现、可存档）。
- 未生效时 `delta` 恒 0，调用方无条件 `morale += delta` 即可。

### 建议 AG-25 的调用点

`useConsumable()` 返回 ok 之后（`grantGrowthXp` 附近，InventorySystem.ts:143
一带）：

```ts
const fx = moraleEffectOf(item, state.runSeed, state.day);
if (fx.applied) state.morale += fx.delta; // 或经 AG-25 的 applyMoraleDelta
```

想让同一物品同一天多次使用各有一次独立判定，把 seed 换成
`deriveSeed(runSeed, day, 'cheer', minute)` 复合值即可。另两处建议：

1. **私酒类负 effect 物品的"已满则拒绝"门**：useConsumable 现在对
   `before >= max` 一律拒绝，精力已满时喝不到私酒——心情道具不该被精力槽
   挡住，建议 AG-25 对 `moraleDelta` 生效类物品放宽该门。
2. **跨日副作用（任务示例的酒→次日 hunger 消耗加快）**：需要 SurvivalSystem
   的饥饿速率读一个旗标（如 `setFlag(state, 'morale:hangover', 1)`），消费方
   归 AG-25；本工单只用即刻精力代价落地，未写跨日逻辑。

### 已知缺口（没处理干净的地方）

1. **图标**：新物品没有 artpack 图标。`ITEM_ICON_FILES` 是
   `Record<ItemId, string>`（render/ 属主，扩容会连锁 assetManifest /
   itemIcons 两个测试与 BootScene 加载表）。运行时 GameScene 的
   `icon.setTexture(itemIconKey(id))` 落到 Phaser 的 `__MISSING` 绿框 +
   面板文字行，系统逻辑不受影响。正式图标需 AG-07/AG-09 补 artpack 后由
   `ITEM_ICON_FILES` 收录，id 已预留。
2. **制作路径**：recipes 的产出是 homeUpgrades（设施/凭证），不是物品；
   工作台面板渲染归场景层（AG-11）。要"煮咖啡"需要场景侧接线，本工单只
   保证商店路径真实可走（买/卖/使用三向测过）。
3. **搜刮路径**：楼层战利品池归 AG-30。若要把香烟塞进搜刮表，建议概率
   条目（`probability: 0.15~0.25`，非 guaranteed，不碰保底水位）。
4. **收音机/音乐通道**：TWOM 的 `AvgDepressionChangeForCheerfulMusic` 是
   设施级持续效果，归 AG-25 的 SurvivalSystem，未进消耗品表。
5. **morale 消费本身**：PlayerState.morale 字段与使用点的接线归 AG-25
   （契约第一节）；本工单交付的是数据 + 纯函数 + 测试，不写消费逻辑。
