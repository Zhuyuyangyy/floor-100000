# 行为树组件（BEHAVIOUR）

**日期**：2026-11-16
**范围**：`src/ai/behaviour.ts` 的组件骨架与设计论证；`src/tests/behaviour.test.ts`
**状态**：骨架已实现并单测通过；**未接线、不迁移任何现有 NPC**
**分支**：`agent/2026-11-16/ag-31-behaviour`
**契约**：`docs/plans/TWOM_ALIGNMENT.md` 第八节（AG-31 属主）。本文件不改 schema；要改先改契约。

---

## 1. 三句话结论

1. **现在不上完整行为树。** TWOM 自己的优先级表把"完整行为树"排在 8/8：工作量大、价值低、"现在规模不需要"。本文只做"组件能挂"的地基。
2. **地基 = 四种节点 + 一个纯函数求值器。** Sequence / Selector / Condition / Action，共约 200 行；TWOM 那 625 个 `BTTask*` 类本质是这四种节点 + 数据，我们不复制任务类，只收敛控制流。
3. **状态全部外移。** 树不存任何状态：旗标归 AG-26（`WorldFlags`），感知归 AG-28（`sense()`），随机归调用方（`deriveSeed` 算好后进上下文）。求值 `evaluateTree(node, ctx): NpcAtom[]` 是纯函数，禁 `Math.random`。

---

## 2. 为什么现在不上完整行为树

论证来源全部可查：`twom-reverse` 反编译 + `TWOM_MECHANICS.md` §4/§6。

**① TWOM 优先级表的判决（§6 表格第 8 行）。**

| # | 机制 | 工作量 | 价值 | 说明 |
|---|---|---|---|---|
| 7 | NPC 三原子 | 大 | 中 | GoTo/Speak/PlayAnimation |
| 8 | 完整行为树 | 大 | 低 | **现在规模不需要** |

同表第 1 名 Flag/Trigger 是"小/高"，第 7 名三原子是完整行为树的前置——**没有原子层，树没有叶子可挂**。AG-28 正在建原子层（契约第七节）；在原子层落地之前把树做全，是无叶之木。

**② 625 个任务类的真相：是数据，不是代码。** §4 从符号表读出的规律只有三条：GoTo / Speak / PlayAnimation 三个原子任务撑起全部表现；`Sensor*Decorator` 是感知条件装饰器；`Forced*Decorator` 是强制打断。625 个类 = 少量控制流 × 大量每实体配置。我们要抄的是"三原子 + 编排"这个结构，不是类表。TWOM 文档原话：**"不必上完整行为树。先抽 GoTo / Speak / PlayAnimation 三个原子。"**

**③ 我们的 NPC 没有"行为组合爆炸"。** §4 对我们的现状判断：脚本化位置 + 固定对话，流浪者是 `stepWandererAI`/`stepWandererRoam` 状态机。当前没有任何实体需要"多个行为按优先级动态编排"——完整行为树解决的是我们还没有的问题。

**④ 资产路线不跟进。** TWOM 的行为树存在 `assets/*.dat` 的 VFS 里（§5 明确"这条暂时不用管"，我们的美术是程序化生成 + 手绘）。没有数据驱动需求，树定义在 TS 代码里就是终态——不需要序列化、不需要运行时加载器、不需要节点编辑器。

**⑤ 成本核算。** 完整行为树 = 625 任务类 + 装饰器体系 + 序列化 + 调试视图，工作量大；而它的三个典型收益（行为组合复用、多实体共享子行为、策划不碰代码调优先级）在我们现在的实体数量（1 只流浪者 + 6 个站桩对话 NPC）下一个都不成立。价值低。**结论：组件先备着，实体不上树。**

---

## 3. 组件模型与求值语义（`src/ai/behaviour.ts`）

### 3.1 实体模板三型

TWOM 实体模板里有 `BEHAVIOUR_TREE` / `TRIGGER` / `FLAG` 三种组件（20 种 `ENTITY_*` 之一），**行为树因此是可挂在任意实体上的组件，不是 NPC 专属**：

```ts
export type EntityComponent =
  | { type: 'behaviourTree'; tree: BehaviourNode }
  | { type: 'trigger'; triggerId: string }   // 引用 AG-26 登记的触发器
  | { type: 'flag'; flagKey: string };       // 引用 AG-26 的旗标
```

trigger/flag 组件只存**引用**，逻辑与状态都在 AG-26 的 `WorldFlags`——组件表回答"谁挂了什么"，旗标表回答"世界记得什么"，两层不混。

### 3.2 四种节点

```ts
export type BehaviourNode =
  | { kind: 'sequence'; children: BehaviourNode[] }
  | { kind: 'selector'; children: BehaviourNode[] }
  | { kind: 'condition'; test: (ctx: BehaviourContext) => boolean }
  | { kind: 'action'; action: BehaviourAction };
```

| 节点 | 语义 | 类比 |
| --- | --- | --- |
| `sequence` | 依次求值，任一失败即整体失败，成功则拼接全部原子 | 与门 |
| `selector` | 依次尝试，第一个成功的整体成功，不再看后续 | 或门（优先级队列） |
| `condition` | 纯谓词，不产原子；成败交给上层编排 | if |
| `action` | 叶子，产出一个 `NpcAtom` | 任务类 |

边角语义：空 `sequence` 空成功（返回 `[]`）；空 `selector` 失败（返回 `[]`）。

### 3.3 求值器

```ts
export function evaluateTree(node: BehaviourNode, ctx: BehaviourContext): NpcAtom[]
```

- **纯函数**：同 `(node, ctx)` → 同输出；不写状态、不读全局、无随机（测试用冻结 ctx 验证）。
- **空数组 = 本 tick 什么都不做**（某处条件失败），不是错误。
- **深度闸门** `MAX_TREE_DEPTH = 32`：树是代码里的静态数据，正常到不了这个深度；这道闸防的是"有人用 mutation 把树接成了环"——超深一律按失败处理，表现为空序列，不会把游戏循环拖死。
- **唯一一处"发明"**：`BehaviourAction = NpcAtom | ((ctx) => NpcAtom)`。契约第七节的 `NpcAtom` 是静态值，而"逼近玩家"这类行为的 targets 是动态的；动态 payload 用闭包按 ctx 解析，**解析结果仍是 NpcAtom，不动其 schema**。已在给总控的报告中单列，可否决。

### 3.4 上下文：树能看到的一切

```ts
export interface BehaviourContext {
  hasFlag: (key: string) => boolean;   // 直通 AG-26 WorldFlags.hasFlag
  sense: BehaviourSense;               // AG-28 sense() 的产物，求值前算好传入
}
```

`BehaviourSense` 字段与现有系统一一对应（AI 不直接问世界，经 sense 拿感知结果）：

| 字段 | 来源 |
| --- | --- |
| `night` | `SurvivalSystem.isNight` |
| `selfX` / `playerX` / `playerDistance` | 场景坐标 |
| `aggroRange` | `NpcAutonomy.wandererAggroRange` |
| `patrolX` | 调用方 `deriveSeed` + `makeRng` 确定性路径点（禁 `Math.random`） |

扩展 `BehaviourSense` 属于契约变更，要走 `TWOM_ALIGNMENT.md`，不允许在代码里私加。

---

## 4. 怎么挂到实体：独立表，不给 NpcDef 加字段

**决策：新建独立组件表（`src/data/entityComponents.ts` 形态），不在 `NpcDef` 加 `components` 字段。** 本任务只做设计，该文件不建；下面是给总控的落地方案。

```ts
// src/data/entityComponents.ts（新建；本次不落地，等派单）
import { WANDERER_PATROL_TREE, type EntityComponent } from '../ai/behaviour';
export const ENTITY_COMPONENTS: Record<string, EntityComponent[]> = {
  wanderer: [
    { type: 'flag', flagKey: 'wanderer.grudge' },
    { type: 'behaviourTree', tree: WANDERER_PATROL_TREE },
  ],
};
```

四条理由：

1. **分层**：`npcs.ts` 是实体**实例数据**（id、位置、台词、交易、日程），行为树是**模板级行为配置**。TWOM 自己也是把 `BEHAVIOUR_TREE` 放在实体模板的组件槽里，不是 NPC 数据表的字段。
2. **闭包问题**：条件与动态 action 是函数。挂进 `NPCS` 会把函数带进这张目前保持纯数据的表（可 JSON 化、被测试与 e2e 直接读取的领地）。若总控倾向内联，则需接受 `NpcDef.components?: EntityComponent[]`——diff 如下，**不推荐**：
   ```ts
   // src/data/npcs.ts（AG-13 属主；不推荐，仅备选）
   components?: EntityComponent[];
   ```
3. **跨实体**：三型组件天然不限 NPC——家具、遭遇点、楼层模板（AG-30）都可能挂。一张组件表对所有实体开放；每类实体各加一个字段则要改多张表、多一次合并冲突。
4. **零风险**：不动 `npcs.ts` = 与 AG-13/AG-30 零冲突，1252 测试基线零影响，也符合本次"只做设计与新文件"的授权边界。

消费侧用法就一行：`const tree = behaviourTreeOf(ENTITY_COMPONENTS['wanderer'])`，然后按 tick `evaluateTree(tree, ctx)`。有树走树，没树走 AG-28 的 `npcAtomsFor`——分流在消费侧，不属于本模块。

---

## 5. 与 AG-28 三原子的关系：树是编排，原子是执行

- `evaluateTree` 的产出与 `npcAtomsFor` 的产出**同构**（都是 `NpcAtom[]`），场景执行层不变：goTo 由场景做逐帧移动积分，speak 进对话气泡，playAnimation 播片。
- Action 节点的 payload 就是契约第七节的 `NpcAtom`（`goTo`/`speak`/`playAnimation`），本模块不发明新原子——TWOM §4 的"三个原子撑起全部表现"在代码里就是 `behaviour.ts` 顶部的契约镜像类型（AG-28 的 `npcAtoms.ts` 是权威定义；按总控的集成策略，本分支用结构化镜像、不跨分支 import、不创建 `npcAtoms.ts`，集成时统一验证两边形状）。
- 感知入口同源：`ctx.sense` 与 AG-28 的 `sense(npc, state)` 是同一抽象（AI 不直接问世界）的两个面向——`sense()` 绑定 `NpcDef` 居民，而行为树的组件要挂**任意实体**（流浪者没有 `NpcDef`，`wandererAtomsFor` 就是先例），故 `ctx.sense` 由调用方从既有产物派生：`night` ← `isNight` / `sense().time.night`，`playerDistance` ← `sense().player.distance` 的同层语义，`aggroRange` ← `wandererAggroRange`，`patrolX` ← 调用方 `deriveSeed`。语义逐名同源，不搞第二套距离公式。
- TWOM 的 `Sensor*Decorator` 在我们的最小集里退化为"条件节点读 sense"，不单设装饰器类型。
- Forced 打断**不在树里**：契约第七节的 `forcedTarget` 优先于自主，这在消费侧生效（与 `npcAtomsFor` 同一层），树只负责产出自主原子。TWOM 的 `Forced*Decorator` 因此没有对应节点——这是有意的裁剪，见 §8。

---

## 6. 与 AG-26 Flag/Trigger 的关系：树读旗子，不存状态

行为树最常见的腐化是"节点里长出新布尔字段"。本组件把这扇门焊死：

- 条件节点读 flag：`ctx.hasFlag` 直通 `WorldFlags.hasFlag`。树的每一个"开关"都是世界可查询的状态，不是 AI 模块私产。
- 树不存任何跨 tick 状态。用例树里三处原本该存在状态机字段里的东西，全部外移：
  - **撤退粘滞** → flag `wanderer.withdrawing`（场景在"天亮/事件结束"时置位，`wandererRoamGone` 时清除）；
  - **结仇** → flag `wanderer.grudge`（由 AG-26 的触发器从 relationship ≤ -30 推导置位，树不直接读 relationship）；
  - **放话只说一次** → flag `wanderer.taunted`（消费侧执行 speak 原子后置位；置位后该分支条件失败，selector 自然落到普通逼近分支）。
- 这正是 TWOM_MECHANICS §4 的建议原文：**"TRIGGER 和 FLAG 立刻可抄：任务/对话/遭遇都按这个查询，不再各管各的布尔字段。"**

---

## 7. 真实用例：流浪者夜间巡逻

### 7.1 树（`WANDERER_PATROL_TREE`，`src/ai/behaviour.ts` 末尾）

```ts
export const WANDERER_PATROL_TREE: BehaviourNode = {
  kind: 'selector',
  children: [
    // P1 撤退：flag 粘滞；出口按 selfX 选近端（与 stepWandererRoam 同规则）
    { kind: 'sequence', children: [
      { kind: 'condition', test: (ctx) => ctx.hasFlag('wanderer.withdrawing') },
      { kind: 'action', action: (ctx) => ({ kind: 'goTo', x: ctx.sense.selfX < FLOOR_WIDTH / 2 ? 0 : FLOOR_WIDTH }) },
      { kind: 'action', action: { kind: 'playAnimation', clip: 'withdraw' } },
    ]},
    // P2 结仇放话：首次贴脸先说话；taunted 旗置位后本分支失败，落到 P3
    { kind: 'sequence', children: [
      { kind: 'condition', test: (ctx) => ctx.hasFlag('wanderer.grudge') },
      { kind: 'condition', test: (ctx) => !ctx.hasFlag('wanderer.taunted') },
      { kind: 'condition', test: (ctx) => playerInAggroRange(ctx) },
      { kind: 'action', action: { kind: 'speak', text: WANDERER_TAUNT_LINE } },
      { kind: 'action', action: (ctx) => ({ kind: 'goTo', x: ctx.sense.playerX ?? ctx.sense.selfX }) },
      { kind: 'action', action: { kind: 'playAnimation', clip: 'stalk' } },
    ]},
    // P3 逼近：玩家在仇恨范围内
    { kind: 'sequence', children: [
      { kind: 'condition', test: (ctx) => playerInAggroRange(ctx) },
      { kind: 'action', action: (ctx) => ({ kind: 'goTo', x: ctx.sense.playerX ?? ctx.sense.selfX }) },
      { kind: 'action', action: { kind: 'playAnimation', clip: 'stalk' } },
    ]},
    // P4 巡逻：仅夜间；路径点由调用方用 deriveSeed 算好后放进 sense
    { kind: 'sequence', children: [
      { kind: 'condition', test: (ctx) => ctx.sense.night },
      { kind: 'action', action: (ctx) => ({ kind: 'goTo', x: ctx.sense.patrolX }) },
      { kind: 'action', action: { kind: 'playAnimation', clip: 'patrol' } },
    ]},
  ],
};
```

求值结果矩阵（`behaviour.test.ts` 逐条断言）：

| 情境 | 原子序列 |
| --- | --- |
| `withdrawing` 旗，selfX 偏左 | `goTo(0)` → `playAnimation('withdraw')` |
| `withdrawing` 旗，selfX 偏右 | `goTo(FLOOR_WIDTH)` → `playAnimation('withdraw')` |
| `grudge` 旗 + 玩家在范围 + 未放话 | `speak('……找到你了。')` → `goTo(playerX)` → `stalk` |
| `grudge` + `taunted` + 玩家在范围 | `goTo(playerX)` → `stalk`（落到 P3） |
| 玩家在范围（无结仇） | `goTo(playerX)` → `stalk` |
| 夜间 + 玩家远离 | `goTo(patrolX)` → `patrol` |
| 白天 + 无旗标 | `[]`（什么都不做） |

### 7.2 与 `stepWandererRoam` 状态机的诚实对比

现状（`src/systems/NpcAutonomy.ts:395`）：三态（patrol / approach / withdraw）每帧纯函数推进一步；withdraw 的粘滞存在 `phase` 字段里随状态进出；优先级是 if/else 的书写顺序；路径点由调用方传种子化 `rng`。

**树确实更好的三点（结构性，非性能）：**

1. **优先级从"代码顺序"变成"数据顺序"。** selector 的孩子排列就是优先级表，可逐条断言、可整体审阅；状态机里它是三个分支的 if/else 次序，改优先级要读代码。
2. **粘滞状态从"AI 模块私产"变成"世界可查询"。** `wanderer.withdrawing` 旗置位后，EventSystem、遭遇表、测试都能查到"流浪者正在撤离"；状态机里这个事实只存在于 `WandererRoam.phase`，出了 NpcAutonomy 谁也看不见。
3. **加行为不动求值器。** 结仇放话（P2）在状态机里要新增 phase 或嵌套分支；在树里是 selector 的一个孩子，且"放话一次"靠 flag 落空自然落到 P3，不需要新的状态转换。

**以及诚实的那半句：对当前这一只流浪者，状态机更简单，不迁移。** 70 行三态函数 vs 树 + 上下文 + 消费侧三处旗子记账，代码量与心智成本都更高；树的三个收益（优先级显式化、状态可查询、组合扩展）目前只有一个半用得上。`stepWandererRoam` 继续服役，本组件**备而不用**。

这个判断有独立的第二意见：AG-28 在 `npcAtoms.ts` 的 `wandererAtomsFor` 注释里写明了同款结论——"帧级游荡/扑击（`stepWandererRoam` / `wandererAI` 状态机）不在此列——那需要 dt 与帧间状态，属于场景状态机，不是每帧可重算的纯计划"。树的求值单位是 tick（无 dt、无帧间状态），与帧级物理本来就是两层；把物理层塞进树才是过度设计。

另注：本用例树的 clip 名（`withdraw` / `stalk` / `patrol`）是示例名；正式接线时对齐 AG-28 `npcClipKey` 的 `walk-{who}` / `idle-{who}` 约定（`render/walkcycle.ts` 的 anim key 同构命名）。

**什么时候该把某个实体迁到树上**（迁移判据，避免"先备着"变成永久备用）：

- 实体出现 ≥ 3 个互斥优先级，且条件开始散落成布尔字段（AG-26 要治的正是这个）；
- 多个实体共享同一段行为编排（抽公共子树）；
- 行为的开合需要被其它系统查询或触发（旗标门控 + 树）。

---

## 8. 明确不做的事

- **不迁移现有 NPC 到行为树**：流浪者继续用 `stepWandererRoam`；六个对话 NPC 继续用日程 + 选项树。
- **不做 Sensor 装饰器的完整实现**：AG-28 的 `sense()` 已覆盖感知；树里"条件读 sense"就是 `Sensor*Decorator` 的最小等价物。
- **不做 625 个任务类**：四种节点 + 数据，实例留给实体配置。
- **不做 Forced 装饰器**：`forcedTarget` 打断在消费侧生效（契约第七节），树只产自主原子。
- **不改 `src/data/npcs.ts` 现有字段**：挂载方案见 §4，内联 diff 已给总控，是否落地由总控定。
- **不做序列化 / 资产加载 / 节点编辑器**：不走 TWOM 的 `.dat` VFS，树定义在 TS 里就是终态。
- **不建 `src/data/entityComponents.ts`**：等总控按 §4 方案派单。

---

## 9. 验证

- `npx tsc --noEmit`：干净。`NpcAtom` 按契约第七节在 `behaviour.ts` 内以镜像类型本地定义（AG-28 的 `npcAtoms.ts` 是权威定义，集成时由总控验证两边形状一致）。
- `VITE_NPC_MODEL= npx vitest run`：74 文件 / 1273 测试全绿。数字链：任务起点基线 1252 → 加 `behaviour.test.ts` 21 个断言 = 1273，零变红（本分支不合入 AG-28，见上）。
- 新增测试零改动现有文件；本次提交仅四个文件（三个新建 + 契约追加一节）。
