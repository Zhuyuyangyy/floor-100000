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


## 九、AG-26 实现说明（Flag/Trigger，2026-11-16）

契约第六节的接口**未动**，原样落在属主文件 `src/systems/WorldFlags.ts`：
`Trigger` / `registerTrigger` / `evaluateTriggers`，另加
`registeredTriggers()`（清单自省，测试用）。`registerTrigger` 幂等（同 id
先注册者赢）；`evaluateTriggers` 只返回**本次新置**的旗，已置过不重复
返回；`when` 全部纯判定，禁 Math.random，同 state 必然同结果。

触发器清单在新文件 `src/systems/triggers.ts`（**导入即启动注册**，
re-export `evaluateTriggers`，场景只需 import 这一个模块）。共 22 个：

| 旗 | 触发条件 | 解散的散落判断 |
|---|---|---|
| `ev:active` / `ev:blackout` / `ev:wanderer` / `ev:leak` | `worldEvents.activeEvent` 存在性/类型 | GameScene :3691/:3718/:5855/:6241/:6274、LootSystem:31、CraftingSystem:139、NpcAutonomy:236 各自 re-read |
| `st:night-exposed` | `isNight && environmentFor(floor).hostile` | 夜事件目标楼层表、dwell 的 isDwellExempt、NpcAutonomy 撤退步进三处各算 |
| `st:bag-overflowing` | `isBagFull(inventory)` | HUD 预警、搜刮溢出、战斗掉落、商人拒售四处各问 |
| `goal:met` | `isDailyGoalDone(state)` | HUD（:3383）与结算路径（:6019）各算一次；progress.ts 却读存量 done |
| `combat:active` | `state.combat !== undefined` | GameScene 四个存在性读点（:1761/:1912/:1990/:4736） |
| `stat:thirst-critical` / `stat:hunger-critical` | 对应条归零 | SurvivalSystem 的掉血闸门 ×2 + deathCause |
| `tier:<2..6>:arrived` | `currentFloor >= 段起点`（按 PLAYABLE_SEGMENTS 展开） | deepestFloor/bestDepth 数值比较在 shop 货带、电梯文案、深度记录各处各自回答 |
| `npc:<id>:regular` | 与该 NPC 的 trade 记忆 ≥3（按 NPCS 展开） | 「老主顾」原来只有 relationship 一个 proxy |

**语义（对全团队有效）**：旗是「本 run 曾经如此」的一次性事实，
`evaluateTriggers` 只置不清；每帧的实时判定（熄灯、流浪者在场、HUD 的
✓、战斗在场）继续直读 state。两类问题是不同的，不要用旗做实时查询。

存量字段已加 deprecated 注释指向 flag 路径（**不迁移存量数据、不改存量
行为**）：`EventSystem.ts`（activeEvent 读点）、`dailyGoals.ts`
（dailyGoal/done 读点）。

**需要 GameScene 落的接线（AG-26 不动场景，清单交总控）**：
1. 每帧求值一处：`GameScene.ts` update 内 `:6046`
   （`const event = state.worldEvents.activeEvent;`）附近加
   `evaluateTriggers(state)`（22 个纯判定，每帧一次成本可忽略）；
   import 走 `../systems/triggers`。
2. 一次性反应接旗的返回（日记/flash）：如首次 `ev:blackout`、
   首次 `st:night-exposed`、首次 `combat:active`。
3. `combat` 置位/清除处（:1723 置、:1748/:2066 清）无需改——旗由第 1
   条的每帧求值自动跟上；实时在场判定保留直读 `state.combat`。
4. `dailyGoal` HUD（:3383）保留 `isDailyGoalDone` 实时判定；旗只服务
   「第一次完成每日目标」类一次性反应。`progress.ts:82` 读存量
   `dailyGoal.done` 的 deprecated 迁移归 progress 属主，本单只加了注释。


## 十、AG-28 实现说明（2026-11-16，NPC 三原子落地）

实现文件：`src/ai/npcAtoms.ts`（新建）、测试 `src/tests/npcAtoms.test.ts`
（新建，31 个断言）。`src/ai/npcSchedule.ts`、`src/data/npcs.ts` 未改
（升级走复用，不重写）；`src/systems/NpcAutonomy.ts` 属 AG-25/26/27 领地，
本模块只读 import 其计划函数。

### 1. 三原子 API（契约 §7 schema 原样落地）

```ts
type NpcAtom =
  | { kind: 'goTo'; x: number; speed?: number }
  | { kind: 'speak'; text: string }
  | { kind: 'playAnimation'; clip: string };

npcAtomsFor(npc, state, opts?): NpcAtom[]   // 原子序列：goTo → playAnimation → (speak)
sense(npc, state): NpcSense                // Sensor 感知快照（纯函数）
wandererAtomsFor(state): NpcAtom[]         // 流浪者登场原子（第二个实体，证明原子不是 NPC 专属）
```

- `goTo`：x 来自 `npcAutonomyFor` 的运行时坐标（**同一纯函数，无第二套位置
  逻辑**），`speed` 是 `NPC_WALK_SPEED`（像素/游戏分钟，信息性字段）。
- `speak`：仅当玩家在交互距离内（Sensor 门控）时发射；文本 =
  `npcEconomy.attitudeLine(npc, 信誉分级)`——信誉分层确定性台词，
  关系/记忆真的改变 NPC 嘴里的话。每帧发射，场景侧按"进入范围"去重。
- `playAnimation`：clip 与 `render/walkcycle.ts` 的 anim key 逐字同构
  （`walk-{who}` / `idle-{who}`，由 npcAtoms.test.ts 钉死映射）；攻击/受击/
  搜刮/倒地/拾取五个一次性 clip 归战斗与搜刮接线，本模块不产生。

### 2. Sensor 感知面（`sense()` 输出）

`{ npcId, floor, x, player: { floor, x, sameFloor, distance, withinInteract },
time: { day, minuteOfDay, night }, self: { slotLabel, goal, moving, scarcity,
reputation } }`。跨层时 `distance = Infinity`（看不见就不谈距离）；
`night` 走 `SurvivalSystem.isNight`（1080–360）；`scarcity` 走
`npcSchedule.scarcityOf` + `syncNpcInventory` 的既有惰性结算通路；
`reputation` 走 `npcEconomy.reputationOf`。**该改走 sense 的既有直读点**：
`GameScene.nearestNpc`（GameScene.ts:4175）与 `hasInteractableNear`
（:4901）——两者已经用自主视图的运行时坐标（AG-11 修过），差的只是把
"同层/距离/交互距离"三个结论统一收到 `sense()` 出，场景不再各自
`Math.abs(view.x - player.x) <= INTERACT_DISTANCE`。

### 3. Forced 打断怎么统一

`npcAtomsFor(npc, state, { forcedTarget })`：`forcedTarget` 非空（有限数）
时只回 `[goTo(钳制后的 forcedTarget), playAnimation(walk clip)]`，自主原子
（含 speak）整棵丢弃——TWOM 的 `Forced*Decorator`：玩家指令 > AI 自主。
它是**调用参数，不进 GameState**（不动 schema）。统一原则：场景里凡要回答
"这个 NPC 现在在哪、听谁的"，都走 `npcAtomsFor` / `sense` 这条纯函数链，
不再有第二套读数。AG-11/AG-24 修过的"点击走路交互判定用运行时坐标而非
npc.spec 静态锚点"（GameScene.ts:4896-4901 注释：阿林站在 241 而数据说
480）是同一原则的既有落地——runtime > 静态数据；forcedTarget 把这条原则
从"位置"延伸到"指令"。

### 4. 场景侧需接的精确位置（总控派活，本 Agent 未动 GameScene）

| 位置 | 现状 | 接法 |
|---|---|---|
| `GameScene.ts:4142` `npcView()` | 调 `npcAutonomyFor` 拿 view | 可保留（内部就是 atoms 的 goTo 数据源）；若要统一入口改调 `npcAtomsFor(...)[0]` 取 x |
| `GameScene.ts:4156-4173` `syncNpcs()` | `setPosition(view.x)` + `view.moving ? walkAnimKey : idleAnimKey`（:4164） | 按原子序应用：`goTo` → setPosition，`playAnimation` → play(clip)；本模块的 clip 与 :4164 现有选择逐字一致，可平滑替换 |
| `GameScene.ts:4175` `nearestNpc()` | 自己算 `Math.abs(view.x - player.x) <= INTERACT_DISTANCE` | 改 `sense(npc, state).player.withinInteract` |
| `GameScene.ts:4901` `hasInteractableNear()` | 同款距离判定（near 半径 36） | 同上走 sense；注意此处 36 ≠ INTERACT_DISTANCE(44)，是点击武装阈值，接入时保留各自常量 |
| `GameScene.ts:4460` `openDialogue` | 开场白固定 `greetings[0]` | 对话面板开场句仍用 greetings（两行版面约束未变）；若要"信誉影响第一句话"，在 enhanceOpeningLine 前插 `npcAtomsFor` 的 speak 原子 |
| `GameScene.ts:5936` `syncNpcs(state)` | 每帧调用 | 不变；新增 forcedTarget 生产者（玩家指令 NPC 移动）后，在此处把指令传进 `npcAtomsFor` |

### 5. 验证与遗留

- `npx tsc --noEmit` 干净；`VITE_NPC_MODEL= npx vitest run`：74 文件 /
  1283 测试全绿（基线 1252 + 本 Agent 新增 31），AG-13 的 npcBehavior
  断言未动、未红。
- 遗留（没处理干净的地方）：
  1. 五位新发布者没有 baked sheet（walkcycle 的 WALK_CHARACTERS 只有
     alin/xiaozhou/wanderer/player/zhouhe），其 playAnimation clip 按命名
     规则给出（`walk-recruiter` 等），场景侧消费时需按 sheet 存在性跳过
     （与 drawNpcs 只画 NPC_FLOOR 的现状一致）；
  2. speak 原子每帧发射同一句，需要场景侧"进入范围才播一次"的去重；
  3. forcedTarget 目前没有生产者（等玩家指令 NPC 的功能），契约侧已就绪；
  4. 流浪者的帧级游荡/扑击（stepWandererRoam / wandererAI 状态机）需要 dt
     与帧间状态，未原子化——`wandererAtomsFor` 只覆盖"登场点"纯计划。


## 十一、AG-27 实现说明（2026-11-16，日记系统）

第五节类型按契约原样落在 `src/systems/DiarySystem.ts`（`DiaryKind` 11 种、
`DiaryEntry` 五字段），未动 schema。旧 `DiaryEvent` API 全部保留，
ShelterSystem / NpcMemory / 旧测试不受影响。

### API

- `recordDiary(state, entry): DiaryEntry` —— 写入。minute 在写入口
  `Math.floor` 并夹回 0..1439（AG-06 小数分钟 bug 的防线）；同时给
  `diary:<kind>` 计数旗 +1。
- `diaryOf(state, limit?): DiaryEntry[]` —— 读，**day 倒序（新的在前）**。
  理由：日记的读取场景几乎总是「最近发生了什么」，倒序让 UI 按数组顺序直接
  渲染；同日內后写的也先，「先饿昏后被袭」里后一件更值得先看到。
- `hasDiaryKind(state, kind)` / `diaryKindCount(state, kind)` —— 走
  WorldFlags 查询「这局发生过吗」。条目有 64 条上限会被裁剪，旗不会，
  「被袭击过吗」不因裁剪改变答案。
- 升级入口（纯函数、确定性、可被调用方接进 tick）：`checkSurvivalDiary`、
  `recordShelterAttackedDiary`、`recordVisitorDiary`、
  `recordRequestFulfilledDiary`、`recordSicknessDiary`、
  `recordWoundedDiary`、`recordMoraleDiary`、`checkLateReturnDiary`。

### 升级了哪三类逻辑（原来只知道什么 → 现在多知道什么）

1. **饥饿/口渴**（`checkSurvivalDiary`，建议调用点：
   SurvivalSystem.advanceGameMinutes 的 applyDecay/applyRestDecay 之后）
   —— 原来只有 HUD 数字，归零时无任何告知，HP 静默流血至死因文案才曝光；
   「连续多日归零」完全不可见。现在：归零一条 `dwellerHungry`
   （个体态 actorId='player'），连续第二天起 `groupHungry`
   （群体态 actorId=null，「连续第 N 天……不再是私事」），以及 25%
   预警档一条「这次没事」。streak 与「今天写过了吗」走 WorldFlags，
   不依赖模块级变量，读档续算不丢。
2. **夜间袭击**（`recordShelterAttackedDiary`，建议调用点：
   ShelterSystem.finishNight 的 attacked 分支，紧挨现有旧格式
   appendDiaryEvent）—— 原来只有 flash 和一行动效；旧 diary 条目无 UI
   呈现、一闪即散。现在：结构化 `shelterAttacked`（群体态），可回放、
   可按旗查询、进存档。
3. **流浪者/邻居**（`recordVisitorDiary` / `recordRequestFulfilledDiary`，
   建议调用点：GameScene 打开居民对话处 / dailyGoals.grantDailyGoalReward
   发放处）—— 原来对话是纯演出、委托完成只有一行 flash。现在：
   `visitor` 个体态来访记录（actorId=npcId）+ `requestFulfilled` 事务态
   办结记录（actorId=null）。

### 两处「没有效果」语义（系统看在眼里，只是这次没事）

1. `dwellerSickNoEffect`（`recordSicknessDiary`）：带着病过了一 tick 而
   没有任何转化（没恶化/没危急/没痊愈）→ 每天一条。病好了就不再写。
2. 饥饿/口渴预警档（`checkSurvivalDiary`）：bar ≤25% 但没归零 →
   `dwellerHungry` 文案变体「你开始饿了，但还撑得住——这次没事」。
   契约 11 kind 里没有 dwellerHungryNoEffect，饥饿态最诚实的 kind 就是
   dwellerHungry；若要对称的 NoEffect kind，这是第一候选。

### 存储与存档（需要总控知悉的一处妥协）

新条目存在 `state.diaryEntries`（运行期字段，非 GameState 声明字段）。
原因：GameState 在 src/core（AG-25 属主）；既有 `state.diary` 是旧
`DiaryEvent[]`，SaveSystem 的 validateDiary 用 8 种旧 kind 白名单严格
校验，新条目放进去会被判「存档损坏」。运行期字段的可行性：
serialize 是全量 JSON.stringify 随之进存档；validateGameState 不拒绝
未知字段；diaryOf 缺字段按 [] 处理，**老存档没有它照样加载**；
**不升 schemaVersion**。
干净结局：请 AG-25 在 gameTypes 补 `diaryEntries?: DiaryEntry[]`
（类型从 DiarySystem re-export）——纯类型改动，无行为差异。

### UI 呈现建议（未实现，GameScene 归接线方）

推荐在 Esc 暂停面板加「日记」项（PAUSE_OPTIONS 旁），开一页用现成 uiKit
构件搭：`buildPanelHeader(scene, left, top, w, '日记', UI.accent, depth)`
+ `buildPanelWell` 作列表井 + 每条一个 `buildListRow`，
label 用 `entry.text`、value 用 `第${day}天 ${formatClock(minute)}`
（formatClock 在 SurvivalSystem 导出），kind 中文名取
`DIARY_KIND_LABELS`。`diaryOf()` 倒序返回，行按数组顺序渲染即是新的在
上。ROW_H=26，一条一行；日记文案已按 ≤30 字控制，24px 字下不溢出。

## 十二、AG-31 实现说明（2026-11-16，行为树组件骨架）

**本节内容在 AG-31 重做提交时丢失**（它先前的 13de4e2/2c2a04b 里那一节，在
干净的 2b3efee 里没有；三个历史 hash 均已核查）。据实记此占位，不冒充内容。

实际交付以它的分支与文档为准：
- `src/ai/behaviour.ts`（新建，纯函数、零 Phaser import、MAX_TREE_DEPTH=32）
- `docs/plans/BEHAVIOUR.md`（新建，含 WANDERER_PATROL_TREE 真实用例与
  "为什么现在不做完整行为树"的论证）
- `src/tests/behaviour.test.ts`（新建）
- 分支 `agent/2026-11-16/ag-31-behaviour` @ `2b3efee`


## 十三、AG-29 实现说明（2026-11-16 追加，物品与经济工程师）

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


## 十四、AG-30 实现说明（楼层环境数据，2026-11-16）

本节只记录 AG-30（楼层处境数据工程师）按 §2/§3 填的数据与对 AG-25 的合并要求，
不改上文任何契约。

### 填了什么

`src/data/floorTemplates.ts` 的 `FloorTemplate` 新增 `environment?`，类型为
`FloorEnvironmentOverride = Partial<FloorEnvironment> & { warmth?: number }`。
warmth 的交集是**前置声明**：§2 定死它进 `FloorEnvironment`，但本分支的
constants.ts 快照里它还不存在；AG-25 落地后 `Partial<FloorEnvironment>` 自动
覆盖这个交集，别名可原样收回，数据不动。type-only import，无运行时环。

16 层有数据（`src/tests/floorEnvironment.test.ts` 钉住集合封闭）：

| 层 | 字段 | 发生了什么 |
|---|---|---|
| 1 | warmth 0.35 | 三面墙蜡烛（WARMTH_SOURCES[1]）+ 床；全塔最弱热源，家是活得下去的地方 |
| 5 | warmth 0.85 | 火盆（WARMTH_SOURCES[5]，power 14，热浪环画得出）；TWOM 5F「火盆（强）」 |
| 9 | humidity 0.55 | 贫民区屋顶漏在这一层正上方，踩过 HUD 潮湿线 |
| 10 | cold 1.35 / danger 0.55 | 段顶贴屋顶；楼梯断开无处可退（ambush 44 段内最高） |
| 102 | humidity 0.6 | 长排水槽持续出水，工人宿舍区唯一湿处 |
| 110 | danger 0.65 | 守段者岗亭（BOSS_FLOORS），段里唯一有人值守的层 |
| 1002 | humidity 0.75 / danger 0.9 | 管道裂缝缠胶带；纸条 T3-3「管道里有声音」 |
| 1010 | danger 0.9 | 军队防线最后一环；无守段者，只抬一档 |
| 10005 | humidity 0.65 / cold 2.6 | 商业区唯一渗水层；管线井机器余热回落到工业区读数 |
| 10008 | humidity 0.55 / danger 0.97 | 节点 4 真相层，笼架空着不是搬走了 |
| 10010 | danger 0.97 | 私人武装最后一环；把着门的是许可证不是怪物 |
| 50005 | humidity 0.65 / danger 0.99 | TWOM 5F「漏水中/高危险」的落点；喂生物兵器的水是脏的 |
| 50007 | cold 3.4 | 冷藏库冷气外冒，和统治核心同读数 |
| 50008 | humidity 0.55 / danger 0.99 | 10008 的上一手，成品搬去了核心 |
| 50010 | danger 0.99 | 守段者段顶；封顶 1.0 留给终端 |
| 100000 | humidity 0.3 | 服务器循环风，全塔最干；cold/danger 不碰（会师与封顶） |

连贯规则（测试逐条钉住）：1-5 层只许写 warmth（层性格归 FLOOR_ENVIRONMENT）；
段间 cold 严格单调（1.2/1.4/2.6/2.8/3.0/3.4）；段内 cold 偏差不许跨过相邻段
基线；humidity > 0.5 的层集合封闭（3/4/9/102/1002/10005/10008/50005/50008）
且每层都高于自己的段基线；warmth 只在 WARMTH_SOURCES 画得出火焰的层出现。

### 需要 AG-25 在 environmentFor 里怎么合并

1. **模板叠加必须落在解析的末端，不是只叠在第 1 步**。契约原文写「第 1 步先看
   template 与 FLOOR_ENVIRONMENT 合并」，但 16 层里只有 1/5 两层有
   FLOOR_ENVIRONMENT 条目；其余 14 层（9/10/102/110/1002/1010/10005/10008/
   10010/50005/50007/50008/50010/100000）的底表是 SEGMENT_ENVIRONMENT，
   只叠在第 1 步的话这些微调永远不生效。正确形状：

   ```ts
   export function environmentFor(floor: number): FloorEnvironment {
     let base = FLOOR_ENVIRONMENT[floor];
     if (!base) {
       const seg = segmentOf(floor);
       if (seg && SEGMENT_ENVIRONMENT[seg.from]) base = SEGMENT_ENVIRONMENT[seg.from];
     }
     if (!base) { /* 阶梯向下回落，原样 */ }
     const tpl = FLOOR_TEMPLATES[floor]?.environment;
     return tpl ? { ...base, ...tpl } : base;
   }
   ```

2. `warmth` 随 spread 进入返回值（§2 已把它加进 FloorEnvironment，消费方按
   0..1 比例读）。
3. `constants.ts` import `FLOOR_TEMPLATES` 无循环：floorTemplates 对 constants
   只有 type-only import（已写）。
4. 合并后 `environmentFor` 会对 16 层返回与阶梯不同的值——`worldgen.test.ts`
   的 `environmentProfile(f) toEqual environmentFor(f)` 只断言段首
   100/1000/10000/50000，本数据不碰这四层，该测试不受影响；但 100000 层的
   humidity 会与曲线差 0.05（0.3 vs 0.35），这是有意为之（服务器循环风），
   与 floor 1 是既有例外同一个性质。
5. `src/tests/floorEnvironment.test.ts` 已本地复刻上述合并（幂等），AG-25 落地
   后它继续全绿，无需修改。

### 遗留

- **2 层没有 warmth**：TWOM 表里 2F 有蜡烛，但我们的 2 层只画电灯
  （drawWorkerDorms 的 lamp()，无火焰）。等 AG-07 给 2 层画了火焰再由 AG-25
  补 WARMTH_SOURCES[2]，本文件同步补 warmth。
- **106 汤桶 / 10002·50002 保温台**：画得出暖具但不是契约 §2 列名的热源
  （床/蜡烛/火把/火盆），未给 warmth；若要给，先让 EnvironmentSystem 的
  warmthAt 认这些坐标。
- danger 0.99 有三层（50005/50008/50010），与 encounters.ts 的 ambush 梯度
  （99/102/104）方向一致但不是逐值对应——ambush 是遭遇表权重，danger 是环境
  读数，两条线在合入后由 AG-25 决定是否对齐。
