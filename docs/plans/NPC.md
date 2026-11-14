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
