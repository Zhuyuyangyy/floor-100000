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
