# B6：NPC 记忆、人格、关系、库存与行为决策（阶段 C）

本文档记录 AG-06 在 `agent/2026-11-15/ag-06-npc-ai` 分支上的实现：NPC 真实库存、
信誉对交易/态度的确定性影响、夜间流浪者导演器、居民自主行动循环，以及
**场景接线缺口**（本文档 §6，需要场景负责人接上才能让玩家看见）。

代码基线：Phaser 4.2.1 + TypeScript strict + Vite；测试 Vitest（node 环境）。
全部 NPC 数值判定为纯函数，**不依赖模型推理**，可离线跑（`VITE_NPC_MODEL=`
环境下 886 个测试全绿，其中 `src/tests/npcBehavior.test.ts` 46 个是本阶段新增）。

## 1. 模块地图

```
src/ai/
  types.ts            数据结构契约（NpcStockEntry/NpcInventory/ReputationTier/ScheduleSlot…）
  npcInventory.ts     真实库存：数量、上限、每日补货、needs 消耗、按天结算、存档桥接
  npcEconomy.ts       信誉 → 报价修正/上架过滤/态度台词/回赠/原子交易（executeBarter）
  npcSchedule.ts      居民自主行动：日程锚点间移动 + 种子化闲逛（纯函数位置）
  config.ts           npcFactFor()：把真实库存喂给规则执行器
src/systems/
  NpcMemory.ts        记忆/关系/情绪 + npcStates 存档读写 + Schema 校验（含 inventory）
  NpcAutonomy.ts      夜间流浪者导演器（planNightWanderer）+ 游荡步进（stepWandererRoam）
  NpcRuntime.ts       观察快照组装（含 reputation 字段）+ 决策环（既有）
src/data/
  npcs.ts             needs（每日需求）、schedule（全天日程）、attitudeLines（分层台词）
  npcPersonalities.ts  ARCHETYPES.hostile.aggroRange = 260（夜间仇恨范围基准）
src/tests/
  npcBehavior.test.ts 本阶段行为测试（46 例）
```

数据流（一次 NPC 交易）：

```
GameState.npcStates[npcId]（JSON 字符串，存档持久化）
  └─ loadNpcState ─→ NpcPersistedState（含可选 inventory 字段）
       └─ syncNpcInventory ─→ advanceNpcInventory（惰性按天结算）
            └─ reputationOf ─→ adjustOffer/availableOffers（确定性报价）
                 └─ executeBarter ─→ TradeSystem.trade（原子交换）
                      └─ takeFromStock + recordMemory + saveNpcState（写回存档）
```

## 2. NPC 真实库存与持久化（npcInventory.ts）

- **有数量**：`NpcStockEntry { itemId, quantity, max, restockPerDay }`。
  默认库存由 `data/npcs.ts` 报价表推导，**每份报价物品开店备 2 件**
  （`OPENING_STOCK = 2`，`max = 6`）。备 2 件是为了 trusted 的「双倍货」
  从第 1 天就兑得现——备 1 件时关系最好的玩家反而最先遇到「下架」。
- **会耗尽**：交易走 `takeFromStock`（绝不超取）；`availableOffers` 按库存
  过滤，NPC 没货就下架，玩家看到的是「现在真的有什么」。
- **会补充**：`advanceNpcInventory` 按天结算——先扣 `needs` 每日消耗
  （阿林每天烧 1 根保险丝、小周每天吃 1 个面包），再按 `restockPerDay`
  补货并封顶 `max`。同日重复调用是恒等操作（返回原对象）；离开 N 天则
  补足 N 天的量（「店老板每天进货」）。
- **赠品不入补货**：`giveToStock` 的新物品按赠品规则入账——上限 9
  （`GIFT_MAX`）、`restockPerDay = 0`，NPC 不会虚空量产玩家送的东西。
- **持久化**：库存是 `NpcPersistedState.inventory` 可选字段，随
  `GameState.npcStates[npcId]` 的 JSON 进存档。**不改 SaveSystem**——
  SaveSystem 只把 npcStates 当不透明字符串校验（`isRecord`），天然兼容。
- **老存档兼容**：`isValidNpcState` 对缺失的 `inventory` 字段放行，读取时
  `inventoryOf()` 按默认库存补建；字段存在但畸形 → 整条状态判坏，按
  「首次遇到」重建（与 SaveSystem 的坏档哲学一致）。坏 JSON 同样不抛错。
- **惰性结算**：`syncNpcInventory(state, npc)` 在每次读取时比对
  `lastRestockDay` 与 `state.day`，落后就结算并写回。场景无需接换天钩子，
  老存档第一次被读取时自动补齐。

## 3. 记忆 → 信誉 → 交易与态度（确定性）

信誉分级由 `relationship['player']` 纯函数推导（`npcEconomy.ts`）：

| 分级 | 关系值 | 报价修正 | 台词 |
|---|---|---|---|
| trusted | ≥ +30 | give 翻倍（老主顾让利） | `attitudeLines.trusted` |
| neutral | ≥ -20 | 基准报价 | 兜底句「拿东西换就行。」 |
| disliked | ≥ -50 | get 翻倍（心生芥蒂加价） | `attitudeLines.disliked` |
| hostile | < -50 | 报价全下架，拒不交易 | `attitudeLines.hostile` |

- **确定性铁律**：数值判定（价格、上架、回赠、失败原因）全部是
  `(inventory, npc, tier)` 的纯函数，同输入逐字节同输出，与调用次数、
  帧率、模型是否返回无关。模型推理只负责台词生成（`NpcRuntime` →
  `OllamaBrain`），且 `buildObservation` 把 `reputation` 作为**参考信息**
  带给模型——模型可以参照它组织语言，但改不了价格。
- **关系数据来源**：`recordMemory` 按事件种类加权（gift +0.6 / trade +0.15 /
  attack -0.9…），增量 = 权重 × 20 × (0.5 + loyalty)，敌对 archetype 负向
  记忆双倍记仇。traits 取 `ARCHETYPES` 原型配置（`freshStateFor`），
  阿林（ally, loyalty 0.7）的恩情放大系数高于小周（neutral, 0.3）。
- **赠品闭环**：`receiveGift` 把玩家送的物品真正放进 NPC 库存（赠品规则），
  记 gift 记忆提升关系；`claimGift` 在 trusted 分级下让 NPC 回赠 1 件——
  优先自家补货物且**不是自用物资（needs）**，其次玩家赠品，三条候选路径
  全都排除 needs（「留着口粮不送人」不是假话）。
- **原子性**：`executeBarter` 先校验信誉与库存，再过 `TradeSystem.trade`
  （本身原子：两个前置条件都检查过才动背包），成功后才扣库存、记记忆、
  写回存档；失败不改任何状态。

## 4. 夜间流浪者导演器（NpcAutonomy.ts 阶段 C 段）

只读 `EventSystem` 的产物（`state.worldEvents.activeEvent` + `eventStatus`），
**不改 EventSystem**。`planNightWanderer(state)` 每帧回答：

- 没有巡游体事件 / 非 wanderer 类型 / 事件已解决 → 不在场（带 reason）
- 事件楼层 ≠ 当前层 → 不在场（它只在自己那层活动）
- 非夜间且非 dwell 事件 → 不在场（天亮了；dwell 压力来自停留而非时钟）
- 否则在场：`spawnX`（同 `(runSeed, day, source, floor)` 确定性出生点）、
  `aggroRange`（基准 260；关系 ≤ -30 结仇时 ×1.5 = 390——**记忆真的影响
  行为，且是确定性的**）

`stepWandererRoam(roam, ctx)` 是纯函数游荡步进：withdraw 走向最近出口 /
玩家进入仇恨范围转 approach / 否则 patrol（到达路径点后用调用方给的 rng
换点），x 始终钳制在 `[0, FLOOR_WIDTH]`。扑击状态机仍归 `wandererAI.ts`。

## 5. 居民自主行动循环（npcSchedule.ts）

- 位置是 `(npcId, day, minuteOfDay, runSeed)` 的**纯函数**：无状态、可复现，
  场景每帧用当前游戏时间调用即可，不需要在场景里持有/持久化坐标。
- 日程锚点来自 `data/npcs.ts` 的 `schedule`（阿林/小周各 6 格，覆盖全天，
  末段 `1230→360` 跨午夜，`slotAt` 正确处理回绕）。锚点间按
  `NPC_WALK_SPEED = 40 px/游戏分钟` 匀速步行；到达后在 ±`IDLE_BAND = 28`
  内按 `(runSeed, npcId, day, 时段, 15分钟桶)` 做种子化闲逛。
- x 始终钳制在 `[NPC_MARGIN, FLOOR_WIDTH - NPC_MARGIN]`（48px 安全边距，
  测试全天采样多 seed 验证不越界）。
- 库存见底时目标变成「寻找某物」：`npcAutonomyFor(npc, { stock })` 用
  `scarcityOf` 找第一个归零的 needs，goal 覆盖日程目标（进 prompt）。

## 6. 场景接线缺口（重要：功能已就绪，尚未接进 GameScene）

AG-06 的工作区不含 `src/scenes/**`（团队约定），以下纯函数已全部实现并
测试通过，但 **GameScene 目前仍走旧静态路径**（`npc.offers` + `trade()`，
NPC 站在 `npc.x` 不动）。要让玩家「真的」看到库存/信誉/日程/夜间流浪者，
需要场景负责人做如下接线（均为新增调用，不改动现有结构）：

1. **交易改走真实库存**（`src/scenes/GameScene.ts:3281-3294`，
   `activateDialogueOption` 的交易分支）：
   ```ts
   // 旧：const offer = npc.offers[d.selected]; const result = trade(getGame(), offer);
   const state = getGame();
   const offerId = availableOffers(/* syncNpcInventory 后的库存 */, npc, reputationOf(/*…*/))[d.selected]?.id;
   const result = executeBarter(state, npc, offerId);
   ```
   商品列表同步改用 `availableOffers(...)`（约 `GameScene.ts:3099-3101`），
   并在面板上显示 `attitudeLine(npc, tier)` 作为开场白。
2. **居民按日程移动**：`drawNpcs()`（`GameScene.ts:2966`）目前用静态
   `npc.x` 立精灵；在 `update()` 里对 floor 2 的居民每帧调用
   `npcAutonomyFor(npc, { day, minuteOfDay, runSeed, stock })` 并
   `sprite.setX(view.x)`，`view.slotLabel` 可挂到名字标签上。
   注意 `nearestNpc`（`GameScene.ts:2986`）的交互距离判定也要跟着用
   `view.x`，否则玩家会对空气按 E。
3. **夜间流浪者呈现**：`updateWanderer`（`GameScene.ts:4384` 起）目前自己
   决定生成/消失；把呈现判定换成 `planNightWanderer(state)`：
   `present` 时用 `plan.spawnX` 出生、`plan.aggroRange` 作为仇恨范围
   （替换 `wandererAI` 调用处硬编码的范围），`withdraw` 时用
   `stepWandererRoam` + `wandererRoamGone` 退场。
4. **推理前喂真实库存**：请求 Ollama 的地方把 `npcFactFromDef(npc)` 换成
   `npcFactFor(state, npc)`（`src/ai/config.ts`），模型看到的才是 NPC
   现在真的有什么。

接线后建议补/改 e2e：`e2e/npc.spec.ts` 的交易断言（`ALIN_TRADE` 常量）
与 `e2e/survivalLoop.spec.ts:299` 仍按旧静态报价书写，接线时一并校准。

## 7. 测试（src/tests/npcBehavior.test.ts，46 例）

| 分组 | 覆盖 |
|---|---|
| NPC 真实库存 | 报价表推导（开店 2 件）/ 不超取 / 赠品规则（上限 9、不补货）/ 同日恒等 / 跨天补货封顶 / needs 先扣 / 老存档缺字段补默认 / 坏 JSON 判坏重建 / SaveSystem serialize→deserialize round-trip / npcFactFor 反映真实库存 |
| 信誉 → 交易 | 分级边界含等号 / adjustOffer 双向修正 / 库存不足下架 / 四句态度台词 / neutral·trusted·disliked·hostile 四态 executeBarter / 确定性（同存档双跑逐字节一致）/ receiveGift 入库升关系 / claimGift 回赠扣库存 / needs 不回赠 |
| 夜间流浪者 | 无事件/非 wanderer/已解决/异层/天亮 → 不在场（各带 reason）/ dwell 白天在场 / 出生点同输入可复现且不同 seed 有差异 / 结仇 ×1.5 仇恨范围 / approach·patrol 换点·withdraw 退场·长时间不越界 |
| 自主循环 | 日程格数与兜底 / 跨午夜 slotAt / 06:00 出发→半程→抵达闲逛的确定轨迹 / 同时段不同位置 / 全天多 seed 不越界 / 同 seed 可复现换 seed 轨迹变 / 库存见底目标变「寻找某物」 |
| 记忆因果链 | 三连赠礼推到 trusted / 敌对 archetype 双倍记仇 / 报价表与库存数据完整性 |

运行方式（离线，不碰模型）：

```bash
VITE_NPC_MODEL= npx vitest run src/tests/npcBehavior.test.ts
```

## 8. 已知限制 / 未处理干净的地方

1. **场景未接线**（§6）：玩家目前看不到任何阶段 C 行为——所有功能停留在
   纯函数 + 测试层面。e2e 仍断言旧静态交易路径。
2. `receiveGift` 不负责从玩家背包扣除赠品（调用方先扣再调它）；
   `claimGift` 不负责把回赠物品加进玩家背包。场景接线时补齐。
3. 流浪者「结仇」记忆目前只放大仇恨范围；没有「结仇后主动寻仇」的
   跨层追踪（超出本阶段范围）。
4. 闲逛用 `deriveSeed(runSeed, npcId, day, slot, bucket)`：同一 15 分钟桶
   内位置不变，桶切换时跳变——没有做插值平滑，接线时如需可加。

---

# AG-13：NPC 系统深化（2026-11-15，分支 `agent/2026-11-15/ag-13-npc-deep`）

在 AG-06 阶段 C 的基础上推进四件事：**五位首章发布者落地为纯数据实体**、
**gift 背包闭环**、**流浪者跨层寻仇**、**闲逛插值平滑**。全部离线可跑
（`VITE_NPC_MODEL= npx vitest run`：67 文件 **1104** 测试全绿，
`npcBehavior.test.ts` 46 → **70** 例；`tsc --noEmit` 干净）。

## 9. 五位发布者（data/npcs.ts，纯数据）

`docs/plans/STORY.md` §5 的对话稿落成实体。都是完整 NPC：报价（库存由
`defaultNpcInventory` 推导）、needs、全天日程、四档信誉台词、任务挂点
（`quests` 字段指向 `quests.ts` 的任务 id，不 import，测试反向咬合）。

| id | 名字 | 楼层 | 原型 | 任务（anchorFloor） | 报价（give ← get） | needs | 静态 x |
|---|---|---|---|---|---|---|---|
| `recruiter` | 招工员 | 10 | neutral | `work-badge`（10） | 布料×1 ← 废金属×2；胶带×1 ← 木头×2 | — | 120 |
| `blackmarket` | 黑市贩子 | 110 | neutral | `pass-sticker`（110） | 电池×2 ← 废金属×2；滤芯×1 ← 脏水×3 | 电池×1/日 | 1180 |
| `lab_clerk` | 实验室文员 | 1010 | **ally**（§5「ALLY→视分支」） | `permit`（1010） | 医疗包×1 ← 电池×2；滤芯×1 ← 口粮×2 | — | 110 |
| `banquet_staff` | 宴席侍者 | 10010 | neutral | `vip-card`（10010）+ `feast-ledger`（50000） | 口粮×2 ← 电池×2；面包×2 ← 电池×1 | 口粮×1/日 | 1155 |
| `core_terminal` | 核心终端 | 100000 | neutral | `same-pen`（100000） | 保险丝×2 ← 电池×2；手电×1 ← 电池×1 | — | 1165 |

数据完整性由测试钉死：楼层 = 首个任务的 `anchorFloor`、`giver` 回指自身、
日程首尾相接且锚点在 `[NPC_MARGIN, FLOOR_WIDTH-NPC_MARGIN]`、四档台词齐全。

**两个新字段**（`NpcDef`，都可选，老居民不受影响）：
- `floor?: number`——缺省 `NPC_FLOOR`(2)。场景**必须**按层取用：
  `npcsOnFloor(floor)` / `npcFloor(npc)`。别再假设 `NPCS` 全表都在 2 层
  （`GameScene.drawNpcs` / `nearestNpc` / `:948` 的 taken 收集目前是全表遍历，
  接线时按 floor 过滤，见 §12）。
- `active?: boolean`——缺省激活。`core_terminal` 显式 `false`：100000 段
  还没做（`playableFloorsV01` 只到 50010，100000 是 `DEV_TEST_FLOORS`），
  数据就绪但游戏里不出现；`npcsOnFloor` 自动过滤。
- `archetype?: NpcArchetype`——`freshStateFor` 优先取它（`lab_clerk` 因此
  拿到 ally 的 traits，而不是被兜底成 neutral）。注意 `ai/config.ts` 的
  `archetypeForNpcId`（场景侧用）暂不读这个字段，仍返回 neutral——
  config.ts 不属本分支文件范围，已列入 §12 接线清单。

**静态 x 的约束**（测试钉死）：`encounterSpots` 的占位测试把所有 `NPCS`
的 `x` 都并入 2 层 taken（`GameScene.ts:948` 同款逻辑），采样窗口
`[260, 1020]`、clearance 130——新发布者的 x 落在 `[130, 1150]` 会连坐
吃掉窗口。所以五位都靠边（<130 或 >1150），2 层遭遇点布局逐字节不变。

## 10. gift 背包闭环（npcEconomy.ts）

AG-06 遗留：`receiveGift` / `claimGift` 只动 NPC 库存，不碰玩家背包。
本分支把闭环补上（**只调用 InventorySystem，不改它**）：

- `receiveGift`：先校验 `countItem ≥ quantity`，通过才 `removeItem` 扣背包、
  `giveToStock` 入 NPC 账、记 gift 记忆。背包里没有就说没有——失败时
  NPC 库存/关系/记忆一律不动（不再能「无中生有刷关系」）。
- `claimGift`：先用 `canFit`（TradeSystem 的纯谓词）预检背包容量，
  装不下整体失败并回执「背包空间不足」——NPC 库存和玩家背包都不动，
  物品绝不凭空蒸发；通过才 `takeFromStock` + `addItem`。
- 铁律未变：数值判定仍是纯函数；随机不进这两个函数（它们不摇骰）。

## 11. 流浪者跨层寻仇（systems/NpcAutonomy.ts）

AG-06 遗留：「结仇只放大仇恨范围，没有跨层寻仇」。概率模型
（全部走 `deriveSeed`/`makeRng`，禁 `Math.random`）：

```
P(寻仇) = 0                                未结仇（关系 > -30）
        = 0                                结仇当日（一夜缓冲）
        = 0                                宿舍层（STARTING_FLOOR，安全屋）
        = WANDERER_VENDETTA_CHANCE = 0.4   结仇次日起，每日一次判定
```

- **每日判定**：`makeRng(deriveSeed(runSeed, day, 'wanderer', 'vendetta'))`
  掷一次 `< 0.4` 即当日盯上玩家——**不管夜间事件抽没抽到这层**（寻仇独立
  于 EventSystem，测试用「无事件且 present」钉死）。
- **记仇日** `wandererGrudgeDay`：关系已结仇时取最近一条负面记忆
  （weight < 0）的日期；无负面记忆（如直接写进存档的结仇状态）→ 0，
  视为早于本存档，第 1 天起即可寻仇。
- **呈现**：沿用流浪者的夜行习性——`hunting`（判定命中）白天也在，但
  `present`（该不该在场上）要求夜间；入夜才以 `spawnX`
  （`wandererNightSpawnX(state,'vendetta',floor)`，确定性出生点）在
  **玩家当前楼层**登场，`aggroRange` 自然是结仇放大的 390。
- **与 `planNightWanderer` 的关系**：两者独立求值，场景 `present` 时
  优先采用寻仇计划（它无视抽层结果），否则回落夜间事件计划。

## 12. 闲逛插值（ai/npcSchedule.ts）

AG-06 遗留：15 分钟闲逛桶切换时位置跳变（最大可达 2×`IDLE_BAND`=56px）。
现在桶内按 **smoothstep** 在相邻两桶的确定性偏移之间连续过渡：

```
x = anchor + (offset(bucket) + (offset(bucket+1) - offset(bucket)) × smoothstep(t)) × IDLE_BAND
```

- 偏移量仍由 `deriveSeed(runSeed, npcId, day, slot, bucket, 'idle')` 出，
  **确定性不变**（同输入同时刻逐字节可复现，测试双跑相等）。
- 两端点偏移都在 [-1,1]、smoothstep 权重在 [0,1] → 插值结果必在 [-1,1]，
  **闲逛半径不变**（全天采样仍钳在锚点 ±28，多 seed 验证）。
- 桶边界处两侧位置差 ≤ ~0.7px，桶内逐分钟步长 ≤ 5.6px（测试断言 ≤ 8px，
  旧实现的 56px 跳变会被直接抓住）。
- 遗留小跳变：闲逛→行走的日程切换仍有 ≤28px 的「起身」 pop（行走分支
  从上一锚点出发，这是 AG-06 既有语义，`npcAutonomyAt` 的既有断言
  钉着 `x === prev.x`，未动）。要做的话属于改行走起点语义，超出本分支。

## 13. 测试（npcBehavior.test.ts 46 → 70 例，全追加）

| 分组 | 新增覆盖 |
|---|---|
| 五位发布者 | 楼层/报价/日程/四档台词完整性；`quests`↔`QUESTS` 的 id/giver/anchorFloor 三方咬合；archetype 映射（lab_clerk=ally 且 traits 继承）；core_terminal 未激活且 `npcsOnFloor` 过滤、2 层仍只有两位老邻居；静态 x 不挤占 2 层遭遇窗口；needs 进库存循环 + scarcity 通路 |
| gift 闭环 | 接收扣背包（送 3 留 2）/ 不足整体失败且状态全不动 / 数量 0 无效 / 领取加背包 / 背包满明确回执且双方库存不动 |
| 跨层寻仇 | 未结仇(0 与 -29.99)不寻仇；-30 边界含等号；当日缓冲次日开掷；宿舍豁免；确定性（双跑相等 + roll 与 deriveSeed 手算相符）；30 天扫描既有寻仇日也有平静日且换 seed 轨迹变；白天埋伏不上场、夜间登场带确定性出生点与 390 仇恨范围；无负面记忆的结仇存档从第 1 天可寻仇；无事件也照来 |
| 闲逛插值 | 闲逛区逐分钟最大步长 ≤8px；桶边界连续；半径不放大（±28）；插值后仍是纯函数 |

既有断言只做一处「按新语义修 fixture」：`receiveGift` 原测试的玩家背包
里没有木头（无中生有），闭环后补 `addItem(wood, 3)` 并**加强**为断言
「背包扣到 0」——未删断言、未放宽强度。

## 14. 场景接线清单（给 AG-11 / 场景属主）

1. **按层取 NPC**：`drawNpcs` / `nearestNpc` / 遭遇 taken 收集
   （`GameScene.ts:948`）目前遍历全表，会把五位新发布者画到 2 层。
   改用 `npcsOnFloor(state.currentFloor)`。
2. **立绘与行走图**：`drawNpcs` 的 `npc.id === 'alin' ? 'npc_alin' : 'npc_xiaozhou'`
   二元判断要换成按 id 查 artpack（`render/artpack.ts` 的 portrait 键）。
3. **archetypeForNpcId**（`ai/config.ts`，不属本分支）：场景建状态时对
   新 id 返回 neutral；要 lab_clerk 拿到 ally traits，需改成读
   `npc.archetype`（数据已就绪）。
4. **gift 交互**：场景调 `receiveGift` / `claimGift` 即可，背包扣/加已
   在函数内闭环；失败回执（背包不足/装不下）直接显示 `reason`。
5. **跨层寻仇**：每帧 `planWandererVendetta(state)`，`present` 时按
   `spawnX` 出生、`aggroRange` 索敌；与 `planNightWanderer` 二选一
   （寻仇优先）。
6. **居民移动**：`update()` 里对当层 NPC 调 `npcAutonomyFor`，插值后的
   轨迹已是连续的，直接 `sprite.setX(view.x)` 即可。
7. **任务选项树**：五位发布者的 §5 对话稿（forge / slipped-shift /
   sign-up / handler-invite / 四个终局分支）归任务接线层，`quests` 字段
   已给出锚点。

## 15. 遗留限制

1. 场景仍未接线（§14）：新发布者、寻仇、插值轨迹都还在纯函数层。
2. 闲逛→行走切换的 ≤28px「起身」pop 未做（§12 末）。
3. `config.ts` 的 `archetypeForNpcId` 不读 `npc.archetype`（§14.3）。
4. 寻仇的 0.4 是设计初值，未经试玩调校；`WANDERER_VENDETTA_CHANCE`
   单点可调。
5. core_terminal 的数据是「占位规格」：100000 段落地时需校准台词与报价。
