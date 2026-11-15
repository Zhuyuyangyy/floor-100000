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

## AG-27 实现说明（2026-11-16，日记系统）

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

## 十一、AG-32 进度（对齐 e2e，2026-11-16）

AG-32（对齐验证工程师）给 TWOM 对齐这一轮的新机制写 Playwright e2e。
工作区 `agent-worktrees/ag-32-align-e2e`，分支 `agent/2026-11-16/ag-32-align-e2e`，
基线 = `origin/integrate/sprint-01`（含 AG-26/27/28 三个系统）。

### spec 清单与状态

| spec | 覆盖 | 状态 |
| --- | --- | --- |
| `e2e/triggers.spec.ts` | §6 Flag/Trigger：注册表 22 个、5 组正反例（ev:blackout / st:night-exposed / st:bag-overflowing / combat:active / goal:met）、只报新旗、存量 deprecated 行为不变（黑局势景真灭灯、HUD 真出 ✓）、evaluateTriggers 只写 flags | **已启用实跑** |
| `e2e/diary.spec.ts` | §5 日记 11 类：个体/群体双轨、minute 整数防线、两处「没有效果」语义、个体→群体连续链、真存档往返（autosave→刷新→继续游戏）、新旧两套并存（宿舍面板真渲染旧条目）、旗不被 64 条裁剪影响 | **已启用实跑** |
| `e2e/npc-atoms.spec.ts` | §7 三原子：goTo/playAnimation 与场景精灵实况交叉比对、clip 与 walkcycle 同构、speak 的 Sensor 门控（真 E 开对话）、sense() 三态、Forced 打断、确定性、流浪者原子 | **已启用实跑** |
| `e2e/survival-dimensions.spec.ts` | §1 体温/心情/疾病三档 | **待启用**（AG-25 合入后取消 skip） |
| `e2e/morale-items.spec.ts` | §4 心情物品（moraleDelta/moraleChance、seeded RNG） | **待启用**（AG-29 合入后取消 skip；点数变化另依赖 AG-25） |
| `e2e/floor-environment.spec.ts` | §2/§3 楼层环境（warmth 字段、environmentFor 解析顺序、template 合并） | **待启用**（AG-25 + AG-30 合入后取消 skip） |

三个待启用 spec 的每个 test 里都有 `test.skip(true, '…取消条件…')`，
取消条件写明「对应 Agent 合入 integrate/sprint-01 后删除本行并实跑」。
合入后若机制没按契约实现，定性为产品缺陷写进报告，不放宽期望值。

### e2e 方法上的一件事（给后续 Agent）

三个系统的**场景接线都还没落**（AG-26 的实现说明留了 GameScene 每帧
求值的接线清单；AG-27 的写入入口没有调用方；AG-28 的 forcedTarget 没有
生产者）。e2e 因此用「页面内 import 产品自己的模块、对真实运行中的
GameState 调用」的方式测：Vite dev server 的模块图与应用同源，import 到
的是同一个模块实例（WorldFlags 注册表、 DiarySystem 存储都是共享的），
产品源码零改动。这比 mock 强（测的是产品代码对真实状态的行为），比
"等接线"强（不阻塞验证）；缺的接线本身作为已知缺口记录在
`docs/qa/E2E_INTEGRATED.md` 的 AG-32 节。

### AG-32 发现的缺口（需总控知悉）

1. **派工单提到的两个 dev 句柄不存在**：`__PHASER_DIARY__` 与
   `__PHASER_NPC_ATOMS__` 在 `src/main.ts` 里没有挂（只有
   `__PHASER_GAME__` / `__PHASER_SESSION__`）。e2e 已用页面内 import
   覆盖，但如果后续想要稳定的句柄面，需要在 main.ts 补挂（属 src 持有方）。
2. **三个系统均无场景消费方**（见上）：日记没有 UI 呈现、触发器没有
   每帧求值、三原子没有场景生产者。契约与单测（vitest）都已就绪，
   e2e 已验证函数面对真实状态的行为；"游戏里真的会发生"要等接线。
