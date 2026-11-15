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

### AG-31 实现说明（2026-11-16）

设计论证全文见 `docs/plans/BEHAVIOUR.md`，此处只记 schema 事实：

```ts
/** 实体模板三型：行为树可挂任意实体，不是 NPC 专属。trigger/flag 只存引用，
 *  逻辑与状态在 AG-26 的 WorldFlags。 */
export type EntityComponent =
  | { type: 'behaviourTree'; tree: BehaviourNode }
  | { type: 'trigger'; triggerId: string }
  | { type: 'flag'; flagKey: string };

/** 最小节点集：四种控制流节点。TWOM 625 个 BTTask* 类 = 四种节点 + 数据，
 *  不复制任务类。 */
export type BehaviourNode =
  | { kind: 'sequence'; children: BehaviourNode[] }
  | { kind: 'selector'; children: BehaviourNode[] }
  | { kind: 'condition'; test: (ctx: BehaviourContext) => boolean }
  | { kind: 'action'; action: BehaviourAction };

/** Action payload 即第七节的 NpcAtom；动态目标（playerX 等）用
 *  `(ctx) => NpcAtom` 闭包解析，不改 NpcAtom schema。 */
export type BehaviourAction = NpcAtom | ((ctx: BehaviourContext) => NpcAtom);

/** 树能看到的一切：旗标走 AG-26，感知走 AG-28，随机走调用方 deriveSeed。 */
export interface BehaviourContext {
  hasFlag: (key: string) => boolean;
  sense: BehaviourSense; // night/selfX/playerX/playerDistance/aggroRange/patrolX
}

export function evaluateTree(node: BehaviourNode, ctx: BehaviourContext): NpcAtom[];
export const MAX_TREE_DEPTH = 32; // 防 mutation 成环；超深按失败处理
```

- 求值是纯函数：同 `(node, ctx)` → 同输出，不写状态、禁 `Math.random`。
- `NpcAtom` 在本文件内按第七节形状**镜像定义**（AG-28 的 `src/ai/npcAtoms.ts`
  是权威定义；按集成策略不跨分支 import、不创建该文件，两边形状由总控在
  集成时统一验证，集成后本分支改为 import 并删除镜像）。
- **挂载决策：独立表**（`ENTITY_COMPONENTS: Record<string, EntityComponent[]>`，
  待总控派单新建），不给 `NpcDef` 加 `components` 字段——理由与备选 diff 见
  BEHAVIOUR.md §4。
- 与第七节的接口：`evaluateTree` 产出与 `npcAtomsFor` 同构（`NpcAtom[]`），
  场景按实体有无 behaviourTree 组件二选一；Forced 打断不在树里，仍在消费侧。
  感知同源不同形：`sense()` 绑定 `NpcDef` 居民，`ctx.sense` 面向任意实体
  （流浪者无 `NpcDef`），由调用方从 `isNight` / `sense()` / `wandererAggroRange`
  / `deriveSeed` 派生，语义逐名同源（见 BEHAVIOUR.md §5）。
- 用例树 `WANDERER_PATROL_TREE`（流浪者夜间巡逻）已单测，但**未接线**——
  现有 NPC 不迁移，`stepWandererRoam` 继续服役（AG-28 在 `wandererAtomsFor`
  的注释里对帧级状态机作出了同款判断）。
