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

---

## AG-25 实现说明（2026-11-16，生存主循环工程师）

代码由集成方以 `49a4d63` 落盘；本测试文件与本节为后续补提交。以下函数名、
行号、配置键以仓库实物为准。

### 1. 三条新维度（契约第一节）——字段、默认值、读取入口

| 契约字段 | 类型 | 默认值 | 读取入口（缺字段即补，越界自愈） |
|---|---|---|---|
| `bodyHeat` | number 0..100 | 继承 `bodyTemp`，否则 100 | `SurvivalSystem.bodyHeatOf(state)` |
| `morale` | number（可为负） | `morale.defaultMorale` = 0 | `MoraleSystem.moraleOf(state)` |
| `moraleBaseline` | number | `morale.defaultMorale` = 0 | `MoraleSystem.moraleBaselineOf(state)` |
| `sickness` | `'healthy' \| 'sick' \| 'critical'` | `'healthy'` | `SurvivalSystem.sicknessOf(state)` |
| `sicknessDay` | number | 0，染病当日写入 | 随 `tickSicknessTier` 写回 |

字段在 `PlayerState` 里是**可选**的，理由与 `growth` 完全相同：`createNewGame`
在 `core/gameState.ts`（不属 AG-25 可改清单），必填字段会让它编译不过。存档兼容
走 ensureGrowth 同款模式——每个读者先过访问器，缺失/残缺/越界自愈并写回。
**没有升 schemaVersion**；老存档（连 `bodyTemp`/`ailments` 都没有的 v2 存档）
验证通过、跑 tick 不崩，`survivalDimensions.test.ts` 的「老存档加载」三条钉子。

**`bodyHeat` 与 `bodyTemp` 的关系**：`EnvironmentSystem`（2026-11-07 的体温系统）
以 `bodyTemp` 为工作字段，`GameScene`/`SaveSystem`/既有测试都读它；契约把同一个
stat 定名为 `bodyHeat`。这两个文件不属 AG-25，无法合并名字——`SurvivalSystem`
在 `tickEnvironment` 之后镜像（`bodyHeat := bodyTemp`），`setBodyHeat()` 两个
名字一起写。**新代码只读 `bodyHeat`。**

**`sickness` 与 `ailments` 的关系**：档位由 `ailments` 的 worst severity 派生
（≥25 = `SEVERITY_BITING` 起属性加速 = `sick`；≥100 = `SEVERITY_CRITICAL` 起自己
掉血 = `critical`），不做第二套病程——两套各自演化必然漂移。

### 2. 五个 tick 的数值（全部来自 `config/game-balance.json`）

| tick | 行为 | JSON 键 |
|---|---|---|
| TickTemperature | `cold × (1+humidity)` 消耗；热源半径内线性恢复，恢复吃湿度折扣；`bodyHeat=0` 再叠失温掉血 | `FLOOR_ENVIRONMENT.cold/humidity`（constants.ts）、`sickness.hypothermiaHpPerGameHour` |
| TickHeaters | 走近回温、走开停止（半径内线性衰减到 0） | `warmthSources.<floor>[].x/radius/power` |
| 环境叠加（契约第二节） | `environmentFor` 先合并 `FLOOR_TEMPLATES[floor].environment` 微调（template 优先） | `floorWarmth.<floor>`（`warmthOf` 的默认梯） |
| ProcessSickness | 三档派生 + 三条染病条件 | `sickness.starveGameHours` / `exposureGameMinutes` / `exposureHumidity` / `exposureDanger` / `exposureSeverity`；体温过低持续那条沿用 `SicknessSystem.FREEZE_TO_COLD_MINUTES`（既有，不重复造） |
| TickDepression（morale） | 点数池每小时向基线回归；每日基线漂移；物品/创伤/归来按概率改池 | `morale.defaultMorale` / `dayBeginChange` / `decayPerGameHour` / `traumaProbability` / `traumaDelta` / `backHigherMorale` / `backLowerMorale` / `backFullLoad` / `goodMorale` / `badMorale` |
| ProcessSleep 夜间结算 | 床按楼层 warmth 回温；饥饿计时过夜；心情回落；三档重算 | `sickness.sleepBodyHeatPerHour` × `warmthOf(floor)` |

怒气池（`AngryPoints`）**本轮不做**：TWOM 的怒气是独立点数池，等 Depression
这艘船稳了再按同一模式加——两个池共享一套概率基础设施时，seed 语义容易互相
污染，分开上船更安全。

### 3. 场景侧接线（AG-25 只做纯函数；调用由总控/场景侧接）

| 位置 | 接什么 |
|---|---|
| `GameScene.ts:5100`（`useConsumable` 成功分支） | `const cheer = cheerFromItem(getGame(), getItem(stack.itemId), stack.itemId)`；`cheer.applied` 时 flash「心情 +N」。AG-29 的 `moraleDelta`/`moraleChance` 落地后自动生效（无字段即非心情物品） |
| `GameScene.ts:6053-6070`（tick 反应块） | 追加 `tick.morale`（`cheered`/`becameLow`）、`tick.sicknessTier`（`becameSick`/`becameCritical`/`recovered`/`sickNoEffect`）、`tick.contracted` 的 flash |
| `GameScene.ts:6347`（wanderer 命中 `inflict(state,'wound',…)` 处） | 同帧调 `witnessTrauma(getGame())`；`traumatised` 时 flash |
| `GameScene.ts:5781`（`changeFloor` 落层） | 回到 1F（宿舍）时把这一趟所得件数传给 `backFromScavenge(getGame(), n)` |
| `GameScene.ts:3448-3480`（`refreshEnvironmentHud`） | 加心情/疾病两枚 chip：`moraleLabel(state)`、`sicknessOf(state)` + `ailmentLabel(state)` |
| `GameScene.ts:5582-5583`（睡醒 flash） | `finishNight` 之后读 `state.player.sickness` / `moraleOf(state)`，把「你发烧了」加进醒来的那行 |

`EnvironmentSystem.tickEnvironment`（`src/systems/EnvironmentSystem.ts:87`）日后把
恢复增益乘上 `environmentFor(floor).warmth ?? 1`，warmth 就接进了增益公式（一行
改动，属其属主；睡眠侧已经先用 `warmthOf` 消费了）。

### 4. 没处理干净的地方（后续）

1. **夜间不推进病情**：`sleep()` 不跑 `tickSickness`——`ShelterSystem.finishNight`
   的 rest 行动已经「睡觉治病」并记账（`healedAilments`，有测试钉住），夜里再跑
   一遍会双重结算还抢功劳。要 TWOM 式夜间病程，先让 ShelterSystem 把 rest 的 cure
   改成「夜间结算之后按 curedBy 收尾」并更新那个测试。
2. **warmth 只被睡眠侧消费**：`EnvironmentSystem` 的增益公式还没乘 warmth（见上）。
3. **AG-29/AG-30 数据未落地**：`moraleDelta`/`moraleChance`、
   `FloorTemplate.environment` 都还不存在；`cheerFromItem` 用结构类型读（无字段即
   非心情物品），`environmentFor` 的合并用结构转换读（字段出现后转换恒等）。
4. **存档校验**：`SaveSystem.validateGameState` 不校验新字段（不属 AG-25）——
   访问器侧做了钳制自愈，「存档里 morale=999」仍能原样落盘，只是读的时候自愈。
