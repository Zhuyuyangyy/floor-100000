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

## 九、AG-28 实现说明（2026-11-16，NPC 三原子落地）

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
