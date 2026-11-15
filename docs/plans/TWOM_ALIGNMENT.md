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
