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

## 九、AG-30 实现说明（楼层环境数据，2026-11-16）

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
