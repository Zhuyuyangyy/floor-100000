# WORLDGEN — 可扩展到十万层的世界生成架构（B4）

- 日期：2026-11-15
- 分支：`agent/2026-11-15/ag-04-worldgen`
- 新增：`src/core/worldgen.ts`（纯函数 + 数据）、`src/tests/worldgen.test.ts`（38 个测试）
- 不动：`segments.ts`、`constants.ts`、`gameTypes.ts`、`gameState.ts`、`systems/**`、`scenes/**`、`render/**`、`floorTemplates.ts` 的既有 54 层条目

## 1. 问题

塔有 100000 层，已创作的只有 54 层（1–10 / 100–110 / 1000–1010 / 10000–10010 / 50000–50010）。
剩下 99446 层此前的状态是「未探索区」——一个被电梯跳过的数字。`GAME_DESIGN_LOCK.md` §3
要求：「未探索区域用紧凑聚合状态 + 程序化模板 + 可复现种子按需生成」。本文件就是这条
要求的实现：任意楼层号（含 11–99、111–999 这些没有模板的）都能问出「这一层如果被
探索，会长什么样」，且同 seed 可复现。

## 2. 架构：三条界线

1. **结构量没有种子。** 阶层、物资/威胁曲线、环境与遭遇梯度都是楼层号的纯函数
   （同 `tower.ts` 的 `describeFloor`：一个楼层在层级里的位置不会两次访问给出两个
   答案）。种子只决定「这一层里的箱子怎么摆、掉什么」。
2. **已创作楼层委托，不重写。** `generateFloorContent` 对有模板的楼层一律转交
   `floorTemplates.generateFloor`；合成器只接管没有模板的楼层——`generateFloor` 对
   它们会 throw，这正是调用方要改用本入口的理由。楼层 100000 第一次不再借用第 1 层
   宿舍的模板（`DEV_FLOOR_ALIAS` 只服务 `?devfloor=` 开发入口）。
3. **纯函数，零框架。** 不 import Phaser、不读全局状态、不碰存档。测试里有一条
   源码扫描断言这一点（`worldgen.test.ts`「imports no framework and no runtime state」）。

## 3. 数据结构

### FloorSummary（区段摘要，`worldgen.ts:202`）

```ts
interface FloorSummary {
  floor: number;
  tier: Tier;                    // 阶层（tower.ts 的结构量）
  segment: PlayableSegment | null; // 所在可玩段；未探索楼层为 null
  authored: boolean;             // 是否有手写模板（电梯接通判定读它）
  supplyLevel: number;           // 物资曲线 0..4（连续）
  threatLevel: number;           // 威胁曲线 0..4（连续）
  supplyGrade: number;           // 整数物资档 1..5
  threatGrade: number;           // 整数威胁档 0..5
  threatLabel: string;           // 威胁档中文标签
  environment: FloorEnvironment; // environmentFor 的运行时答案
  containerCount: number;        // 模板楼层读模板；未探索楼层 2..5 由种子抽
  containerIds: string[];        // 全部有贴图（render/furniture.ts）
  lootPool: ItemId[];            // 模板楼层读模板；未探索楼层取阶层材料池
}
```

已创作与未探索楼层长着同一张脸：总览 UI 不需要区分两种数据源。

### EncounterProfile（遭遇权重梯度，`worldgen.ts:150`）

`{ loot, ambush, trader, note, cache, boss }`， encounters.ts 的 `FLOOR_WEIGHT_PROFILE`
（54 行手写表）的曲线版。锚点取该表五个段首的值，100000 一档外推。

### CrossingSummary（电梯的一句话，`worldgen.ts:460`）

```ts
interface CrossingSummary {
  from: number;                  // 出发层（段顶）
  target: number;                // 到达层（下一段首层）
  skipped: number;               // 与 segments.skippedFloors 一致
  span: { from: number; to: number };
  tierNames: string[];           // 跨越的阶层名（跨两段时有两个）
  text: string;                  // 「穿过 89 层：底层贫民区的废弃段」
}
```

## 4. 梯度曲线与断点

### supplyLevel / threatLevel（`worldgen.ts:54` / `:64`）

锚定 `tower.ts` 的 `TIERS` 表（`resourceLevel` 1..5、`dangerLevel` 0..5），阶层内按
楼层号线性增长，到段顶恰好涨到下一阶层的基面——整条曲线连续且单调非递减。

**断点就是六个阶层的边界**：99/100、999/1000、9999/10000、49999/50000、89999/90000。
在这些楼层上斜率变化（阶层 1→2 之间 99 层涨一级，阶层 4→5 之间 40000 层才涨一级，
5→6 之间 resourceLevel 持平所以走平）。返回 0 基连续值；整数档
`Math.floor(level) + 1` 恒等于 `TIERS` 表里该阶层的档位——测试扫全塔 100000 层钉住
这个等式，曲线因此不可能与阶层表漂移。

### environmentProfile（`worldgen.ts:111`）

`constants.ts` 的 `SEGMENT_ENVIRONMENT` 只写到 50000，且 `environmentFor` 对表外楼层
回落到「下方最近的已创作层」。本曲线的锚点与 `SEGMENT_ENVIRONMENT` 逐值一致
（1/100/1000/10000/50000），90000 一档是对阶层 6 的外推（cold 3.4 / humidity 0.35 /
danger 1.0 封顶）。**danger 全塔单调非递减**（0.45 → 1.0）；humidity 故意不单调
（工业区 0.5 比宿舍区 0.3 潮，中产区起变干）——这是 constants.ts 已写定的读数。

复川方式：`environmentFor` 把表外分支改成调用 `environmentProfile`，已创作的 1–5 层
保留精确层覆盖（宿舍是安全的，这条不能被曲线抹掉）。测试验证两者在四个段首
（100/1000/10000/50000）逐值相等，并把第 1 层的分歧记录在案。

### encounterProfile（`worldgen.ts:170`）

同一套插值纪律。**单调性只承诺两条轴**：ambush 全塔单调非递减（4 → 110），loot 全塔
单调不增（60 → 2）——即该表注释里「层数越高，ambush+cache 合计占比越大、普通 loot
占比越小」的总体趋势。trader/cache/note 不承诺单调：商人权重在阶层 4 达到峰值
（商铺街），这是设计明确的阶层性格。

boss 是另一套逻辑：只在三个守段者楼层（5 / 110 / 50010，见 encounterTableCoverage 的
`BOSS_FLOORS`）非零，权重取该表原值（24 / 32 / 108）。已创作楼层的手写表仍然是运行时
权威（它在 boss 楼层会把 ambush 压低让守段者成为最常见的遭遇）；本曲线是「无 boss
基线 + 守段者叠加」。复用时把手写表降级为逐层覆盖即可。

## 5. 确定性怎么证明

- 一切种子派生走 `core/rng.ts` 的 `deriveSeed(...)` + `makeRng(...)`（xorshift32），
  没有 `Math.random`、没有时间、没有全局状态（源码扫描断言）。
- 派生键带 `WORLDGEN_DATA_VERSION`（= 1）： loot 表调整时 bump 它，旧 seed 滚出一个
   deliberately different 的新世界，而不是静默重排（同 `LOOT_DATA_VERSION` 的契约，
  但两者独立：调模板不改写未探索半座塔，反之亦然）。
- 摆放计划（容器数 / id / x / label）与掉落 roll 用同一 `(seed, floor)` 派生、两条独立
  键（`worldgen:plan` / `worldgen:loot`），名字再走第三条（`worldgen:name`）。摘要与
  内容生成共用 `planUnexploredFloor`，所以「摘要说的几个箱子」与「真生成出来的几个
  箱子」永远是同一批。
- 测试证据：同 seed 同楼层 `JSON.stringify` 逐字节相等（边界楼层 + 10011–10060 整段）；
  不同 seed 在 11–110 的扫描中必然至少一处不同（容器数有 4 个取值、id 要洗牌、
  roll 概率 0.5——差异是算术，不是许愿）；全塔 100000 层扫一遍不抛。

## 6. 生存规矩：合成层不是法外之地

合成楼层遵守手写段立下的全部规矩，且测试扫全塔验证：

- 每层**恰好一瓶 guaranteed 水**（阶层 4 起净水，之下脏水）。概率化的水会踩穿
  `survivalBalance` 的每层水量上限，所以保底那份钉死，材料池里干脆没有水。
- 每层**恰好一份 guaranteed 食物**（阶层 3 起口粮，之下面包）。
- 材料 roll 只从阶层材料池抽（与 `encounters.ts` 的 `FLOOR_LOOT_POOLS` 同读数），
  每容器两次、概率 0.5；第三个起的容器强制第一件——两次 roll 都落空会开出空容器，
  那是死互动，不是难度。
- 容器 id 全部落在 `containerTextureKey` 认得的家具上（没有新美术），同层不重复、
  x 不重叠、label ≤ 3 字（`floorTemplates.ts` 顶部记着第 6 层首版的叠字事故）。

1–5 层是 v0.1 初始切片，有自己的读数（第 1 层宿舍一瓶水、2/3 层没有楼层水、第 4 层
一整罐六瓶），测试逐层钉死这些数字——它们不在「6 层起」的规矩里，但也不许悄悄改变。

## 7. 电梯的一句话

`crossingSummary(from)` 把 `segments.ts` 数出来的 N 层概括成 UI 能直接显示的一句话。
阶层名取**被穿过楼层真实所属的阶层**（11–99 属底层贫民区，不是抵达的工人宿舍区），
措辞取跨越区间里最低阶层的措辞——你从哪一段封存的空间里穿出来，那句话就是哪一段的
语气：

| 出发 | 穿过 | 一句话 |
|---|---|---|
| 10 | 89 | 穿过 89 层：底层贫民区的废弃段 |
| 110 | 889 | 穿过 889 层：工人宿舍区的无人段 |
| 1010 | 8989 | 穿过 8989 层：工业与交易区的封锁段 |
| 10010 | 39989 | 穿过 39989 层：中产与商业区的门禁段 |
| 50010 | 49989 | 穿过 49989 层：富人特权区与统治核心的封存段 |

非段顶、塔顶返回 `null`（没有向上的电梯，就没有话可说）。

## 8. 没处理干净的地方

1. **没有接线到 UI / 场景。** 本分支只交付纯函数层与测试；`GameScene` 的电梯文案、
   总览 UI 的接入是后续任务（`scenes/**` 在本分支的禁改清单里）。
2. **100000 仍是「未创作」段。** `hasFloorContent(100000)` 保持 false，电梯照旧拒绝
   从 50010 上行（`segments.ts` 的 `liftOutcome` 语义没动）；世界生成层只是让这一层
   「可被问出样子」，不让它「可被抵达」。
3. **阶层 6 的环境与遭遇读数是外推。** constants.ts / encounters.ts 都没有定义 90000
   以上，本文件的 90000/100000 锚点（cold 3.4、danger 1.0、ambush 110）是 worldgen
   的提案值，等手写终局段时校准。
4. **遭遇曲线不含 boss 楼层的 ambush 压低。** 手写表在 5/110/50010 把 ambush 压到
   boss 之下；曲线给的是无 boss 基线。复用时需要保留「逐层覆盖」这个逃生口。
5. **生成内容没有经过可玩性验证。** 测试保证结构与生存契约，不保证手感；未探索楼层
   真要开放给玩家走之前，应该跑一轮 survivalSim 风格的平衡检查。
