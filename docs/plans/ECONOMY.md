# B5 资源经济：闭环断点、修复与宿舍建设

**日期**：2026-11-15
**范围**：获取（搜刮/交易/制作）→ 消费（饥渴/体温/时间）→ 制作（配方）→ 交易（买/卖）→ 基地（homeUpgrades）五环节闭环
**分支**：`agent/2026-11-15/ag-05-economy`
**涉及文件**：`src/systems/{shop,InventorySystem,SurvivalSystem,CraftingSystem}.ts`、`src/data/recipes.ts`、`src/tests/economyLoop.test.ts`（新建）、`docs/plans/ECONOMY.md`（本文）

---

## 1. 闭环断点表（修前）

对五环节逐一走查后的断点清单。"只进不出"指资源有来源无消耗，"只出不进"指有消耗无来源，"价格无来源"指物品在经济系统里没有一个说得通的价值。

| # | 环节 | 断点 | 性质 | 数据依据 |
|---|---|---|---|---|
| D1 | 交易 | 8 件材料（battery / scrap_metal / wood / cloth / tape / filter / wire / fuse）没有收购价，`sellPrice` 对不上架物品一律跌 1 金地板价 | 只进不出 + 价格无来源 | 15 件物品中 8 件是材料；tier 1 保底材料全变卖只值 8×1=8 金，不够半份压缩口粮（买价 18 金）；配方是材料唯一 sink 且一次性，建完之后整包材料压箱底 |
| D2 | 制作/基地 | crowbar（撬棍）零 sink：没有任何配方消耗它；买 60 金只能 30 金卖回 | 产出物无用途 | `src/data/floorTemplates.ts` 注释自述 "No recipe needs it"；shop band 4 上架 60 金，是 tier 1 商店最贵商品，净亏 30 金的纯陷阱 |
| D3 | 基地/储存 | "宿舍建设"在设施侧只有灯/加固门/净水器三件，储存环节只有一个会爆的 12 格背包，爆了就地掉物 | 环节缺失 | `survivalBalance.test.ts` 钉死"盲搜全塔必爆包、脏水被丢"；GDD §8 的基地建设在 `homeUpgrades` 里无对应储存实体 |
| D4 | 成长线 | `growth.wealth` / `survival` / `power` 三条线零生产者：交易不给 XP、吃喝睡不给 XP、打造凭证不给 XP | 成长线断供 | GAME_DESIGN_LOCK §4 要求四线架构互锁；`docs/plans/GROWTH_INTERFACES.md` §5 明确 AG-05 是 wealth 线与 investedGold/ventures 的所有者，契约表列了"交易达成 +10 / 搜刮出售 +5 / 安睡 +10 / 喝净水 +5 / 新凭证 +100×档位"，此前无一行代码执行 |
| D5 | 交易 | shop 买价不读 `tradePriceMultiplier`——人脉线唯一的登记消费方从未消费 | 跨线影响未接 | 同上 §4 表格登记的消费方就是 shop（AG-05） |
| D6 | 交易 | 商品价按楼层 band 有结构，材料价全世界一个样（1 金）——价格体系半残 | 价格无来源 | `SHOP_STOCK` 只列 5 件消费品；硬通货随楼层变价不合直觉，材料价应全局统一 |

**核查后不断点的项**（避免误修）：dirty_water 有 purifier 批量转化 + 小周 1:1 易物两个出口；flashlight 在 blackout 时被 `nightOverlayAlpha` 读取；medkit 回血兼治病；五张通行证在 `core/segments.ts` 的电梯门禁里真实生效（AG-02 地盘）。

---

## 2. 修复清单与数据依据

### R1 = D1 + D6：材料收购价体系（`src/systems/shop.ts`）

新增 `MATERIAL_SELL_PRICES` 表，`sellPrice` 先查材料表（全局固定价），再查商品 band，最后才跌 1 金地板价：

| 材料 | 收购价 | 依据 |
|---|---|---|
| fuse | 5 | 全链唯一无 barter 来源的凭证料；tier 1 保底仅 F4 电箱 1 个，却是 core_key 硬门槛 |
| filter | 4 | purifier（生存命脉）+ permit 双需求；tier 1 保底仅 F4 电箱 1 个 |
| battery | 3 | 阿林 fuse↔battery 1:1 说明它是"次级 fuse"；全链需求 5（permit 要 2） |
| wire | 3 | 阿林 scrap↔wire 1:1；全链需求 6（最大之一），保底仅 F4 两个 |
| scrap_metal | 2 | 保底 3 为全塔最富；与 wire 等价但供应三倍，故低价 |
| cloth | 2 | 到处都有（每层概率），不稀缺 |
| wood | 2 | 保底 2 恰好等于唯一需求（门要 2），无竞争 |
| tape | 2 | 需求 3 保底 1，但高层概率普遍 |

三锚可复算：① NPC 易物等价序保持 battery(3)<fuse(5)、scrap(2)<wire(3)，且收购价永远低于"找阿林换实物"的期望——商人是保底不是最优路径；② tier 1 保底供应 vs 全链配方需求定档；③ 变现总额约束——tier 1 保底材料按本表全卖 = **32 金 ≈ 2 瓶水 + 1 份口粮**，永远低于"scrap 2 + filter 1 + wire 1 换净水器（无限脏水转化）"的价值，卖料买食不会成为比做配方更优的解（`economyLoop.test.ts` 钉死 32 这个数）。

### R2 = D2 + D3：置物架升级（`src/data/recipes.ts` + `src/systems/CraftingSystem.ts`）

新增 `storage_rack`（置物架）：成本 `wood 2 + cloth 1 + crowbar 1`，效果 = `inventory.slotCount` 12 → 14（`STORAGE_RACK_SLOTS = 2`）。

- **撬棍终于有 sink**：从"买了净亏 30 金的陷阱"变成"60 金买 2 格持久容量 + 拆锁的tool"的投资选项。
- **效果是数值不是 flag**：`craft()` 成功即改 `slotCount`，`addItem` 容量循环、`isBagFull`、`lootContainer` 的 overflow 检查、`shop.buy` 全部既有调用方零改签名吃到容量；存档直接携带大背包（`validateGameState` 只校验数字，`economyLoop.test.ts` 断言 round-trip 后仍 14 格且校验干净）。
- **刻意不吃 scrap_metal**：tier 1 保底 scrap 恰好 = lamp(1) + purifier(2) 三件（survivalBalance 钉死的稀缺事实），置物架再吃一块就会把"三件全建"变成"四件抢三块"——那是把 false choice 引进基地建设。它与加固门共享 wood，二选一是真实取舍（有测试钉双向）。
- 12→14 = +16.7% 携带量，从材料楼层回程时不再丢第六堆。

### R3 = D4 + D5：成长线接入（只调 `growth.ts` 纯函数，未改一字）

| 行为 | 函数 | XP | 依据 |
|---|---|---|---|
| shop 买入 1 件 | `grantGrowthXp(state,'wealth',10)` | wealth +10 | 契约 §5"交易达成 +10" |
| shop 卖出 1 件 | `grantGrowthXp(state,'wealth',5)` | wealth +5 | 契约 §5"搜刮出售 +5"（R1 之后这是真实行为） |
| 喝净水/吃口粮/用医疗包 | `grantGrowthXp(state,'survival',5)` | survival +5 | 契约 §5"喝净水 +5 / 吃口粮 +5" |
| 医疗包关闭一个病症 | `grantGrowthXp(state,'survival',15)` | survival +15 | 契约 §5"治好一个病症 +15" |
| 安睡一晚 | `grantGrowthXp(state,'survival',10)` | survival +10 | 契约 §5"安睡一晚 +10" |
| 打造新凭证 | `grantGrowthXp(state,'power',100×档位差)` | power +100×rungs | 契约 §5"拿到新凭证 +100×档位"；档位差用 `credentialRungs` 读 homeUpgrades，绝不双算 |
| shop 买价 | `× tradePriceMultiplier(ensureGrowth(state))` | — | 契约 §4 登记消费方；只打买价，卖价保持半价 |

**XP 防刷**：满值拒绝使用的物品不给 XP（`useConsumable` 早退路径在授予之前）；失败的交易不给 XP（授予在原子提交之后）。均有测试。

**折扣不套利**：connections 满级倍率 1-0.03×9=0.73（PRICE_MIN 0.7 要到 11 级，不存在），bread 买价 12→9、卖价仍 6，round-trip 依旧亏——三个等级（1/5/10）都有断言。

### R4（部分）= D4：配方档位数据字段

`Recipe.tier` 1..6 对应六个可玩段（`PLAYABLE_SEGMENTS`），并导出 `recipeTierLocked(state,id)` 作为 `recipeAccessTier` 的登记消费方。**门禁刻意不接入 `canCraft`/`craft`**，两个原因：① 权力线冷启动软锁——power XP 只来自打造凭证，若 tier2 门禁要 power≥2，工牌永远造不出来，违反 GAME_DESIGN_LOCK §5"关键推进资源必须存在至少一条确定性获取路径"；② `passChain.test.ts`（AG-03 所有）钉死相反语义：材料齐全必须能按序建全链。字段与读取方已就绪，等权力线有独立等级来源后由负责人统一开门。

---

## 3. 宿舍建设新结构

每条升级 = **成本 + 效果 + 前置** 三件套，效果全部在数值上生效：

| 升级 | 成本 | 前置 | 效果（数值） | 档位 |
|---|---|---|---|---|
| 照明灯 | battery 1, wire 1, scrap 1 | — | 宿舍夜照 alpha 0.16（`nightOverlayAlpha`） | 1 |
| 加固门 | wood 2, tape 1 | — | 宿舍夜照 alpha 0.42；shelter repair 入口 | 1 |
| 简易净水器 | scrap 2, filter 1, wire 1 | — | 批量脏水→净水 1:1（`purifyWater`） | 1 |
| **置物架（新）** | wood 2, cloth 1, crowbar 1 | — | slotCount 12→14（持久，随存档） | 1 |
| 工牌 | scrap 1, cloth 1, tape 1 | — | 开 100-110 段电梯（segments.ts）+ power +100 | 2 |
| 通行贴 | wire 2, tape 1, battery 1 | 工牌 | 开 1000-1010 段电梯 + power +200 | 3 |
| 许可证 | battery 2, filter 1, cloth 1 | 通行贴 | 开 10000-10010 段电梯 + power +300 | 4 |
| 贵宾卡 | scrap 1, cloth 2, battery 1 | 许可证 | 开 50000-50010 段电梯 + power +400 | 5 |
| 核心权限 | fuse 1, wire 2, scrap 1 | 贵宾卡 | 开 100000 段电梯 + power +500 | 6 |

设施（tier 1）与凭证（tier 2-6）分层：前者改宿舍数值，后者改世界门禁 + 权力线等级。未新增任何 ItemId（artpack 图标测试不受影响）。

---

## 4. 测试

- `src/tests/economyLoop.test.ts`（新建，27 例）分六组：
  1. **闭环不断裂**：loot→craft→purify→sell→buy→consume→sleep 整链每环 ok；静态审计"每件物品至少一个 sink"（撬棍的 sink = 置物架）；
  2. **守恒**：buy/sell/purify/craft/barter 各自的逐物品对账（Map diff）+ 整局总账（从开局快照累计每步进出，终态分毫不差，含金币）；
  3. **价格一致**：材料价 floor 2 = floor 50000 且 >1；卖价永低于标价；三个 connections 等级 round-trip 必亏；折扣只打买价；tier 1 保底材料全卖 = 32 金；
  4. **同 seed 可复现**：两次 createNewGame(2026) 同操作序列 → gold/slots/growth/homeUpgrades 逐字段相等；shop 无隐藏随机；
  5. **置物架**：+2 格、14 格满与第 15 件 overflow、存档 round-trip 合法、与门共享木材的双向取舍；
  6. **成长线**：买卖喂 wealth、吃喝睡喂 survival、医疗包治病 +15、满值拒绝不喂 XP、凭证链按档位差喂 power、`recipeTierLocked` 读权力线但不拦建造。
- **全量**：`npx tsc --noEmit` 干净；`VITE_NPC_MODEL= npx vitest run` → **62 文件 931 例全绿**（基线 904 + 新增 27）。survivalBalance 的"每层恰好一瓶 guaranteed 水"未动分毫——本次不碰 `floorTemplates.ts`，置物架与三件设施共享木材的竞争经过设计，`built` 数组不变，该文件零修改。
- e2e 无买卖价格断言，不受影响。

---

## 5. 没处理干净的地方（交接）

1. **`carryCapacityBonus`（生存线 → 动态背包容量）仍未接入**：`addItem(inv,…)` / `isBagFull(inv)` 是 inv-only 签名，调用方横跨 TradeSystem / dailyGoals / ShelterSystem 等非 AG-05 文件；接入需要统一签名或改 `inv.slotCount` 动态值，超出本工单文件范围。置物架走的是"持久 slotCount"路线绕开此事，但生存线每级 +1 格的动态加成还悬空——建议由负责 InventorySystem 签名的一方统一接入。
2. **`investedGold` / `ventures`（产业投资，终局路线 B 的账本）没有生产者**：契约 §5 归 AG-05，但"投资一条商路"需要 NPC/商路实体配合（与 AG-06 的 NPC 系统相邻），本工单只把 wealth 线的交易侧接通。gold 的终局 sink 目前只有 shortcut 付费与商店消费。
3. **`recipeAccessTier` 门禁未开**（见 R4）：字段、消费函数、测试就绪，等权力线独立等级来源。
4. **shelter `treat` 路径（ShelterSystem.ts，非本工单文件）用医疗包治病不走 `useConsumable`**，因此那一次治疗不给 survival +15——要么该系统改为复用 `useConsumable`，要么由它的 Owner 补一次 `grantGrowthXp`。
5. **商人不收购也不卖材料（buy 侧）**：tier 3 以后"交易网络丰富"的设计意图需要高楼层 shop 上架材料，本工单只做了收购侧（卖→金），避免稀释搜刮价值；上架侧留待楼层经济深化。

---

# AG-14 续篇：经济的时间维度、商人 buy 侧与产业投资

**日期**：2026-11-15
**范围**：接 AG-05 三个遗留（priceJitter/productionDecay 无调用方、商人 buy 侧、investedGold/ventures 无生产者），把经济从"闭环"推进到"有博弈"
**分支**：`agent/2026-11-15/ag-14-economy-deep`
**涉及文件**：`src/systems/shop.ts`、`src/systems/SurvivalSystem.ts`（仅跨日钩子）、`src/tests/economyLoop.test.ts`（只追加）、`docs/plans/ECONOMY.md`（本文）

## 6. 价格与产量的时间维度（priceJitter / productionDecay）

AG-05 遗留第 4 条：两个钩子导出后没有任何调用方，经济是静止的。本节把时间维度接上，全部走 `deriveSeed`/`makeRng`，禁 Math.random：

| 钩子 | 语义 | 调用方 |
|---|---|---|
| `priceJitter(seed, day)` | 当日行情倍率 0.85..1.15，`makeRng(deriveSeed(seed, day, 'shop-price-jitter'))` 一抽 | `materialAsk` / `materialPrice` |
| `productionDecay(day)` | 当日产量系数 `0.97^(day-1)`（第 1 天 1.0，逐日指数衰减） | `settleInvestments` |

**为什么波动的只有"商人出售材料"的要价（buy 侧）**，收购价与商品标价一动不动：

1. 收购价（`MATERIAL_SELL_PRICES`）是全经济的锚——"保底材料全卖 32 金"和"收购价永低于找阿林换实物（battery(3)<fuse(5)、scrap(2)<wire(3)）"两条硬断言钉在具体数字上，任何乘性抖动都会让 32 这个总数与等价序漂移。硬通货 therefore 全世界固定（AG-05 的原注释也是这个意思）。
2. 商品架（`SHOP_STOCK`）标价由 GameScene 直接读 `shopStock().price` 渲染，若 `buy()` 改收抖动的价，面板显示与实际收费会分家（场景归 AG-11，本工单不碰）。
3. 商人出售材料原本不存在，是本次新增的面，没有既有断言钉它——波动放在新面上，硬边界零风险。

**无套利是结构性的，不靠运气**：要价 = `max(收购价 + 1, round(基础要价 × 当日行情))`，买侧的熟人折扣（`tradePriceMultiplier`，最低 0.7）也夹在同一个 `收购价 + 1` 下限上。所以任何 seed、任何一天、任何 connections 等级，材料买价都严格高于卖价——"买价和卖价用不同抖动"的套利在数学上不可能出现。测试对 3 seeds × 40 天 × 8 材料全扫，另扫满级人脉的往返。

跨日推进挂在 `SurvivalSystem`（本工单文件）的两个既有路径上，场景零改动：`advanceGameMinutes` 的日滚循环（帧循环 `advanceTime` 与动作 `spendTime` 都汇到这里）和 `sleep`。**每条跨日路径都结一次"刚结束的那天"**，单调递增的 `state.day` 保证每天恰好结一次。

## 7. 商人出售材料（buy 侧）

`buy()` 扩展：先查本层货架（命中就按货架价，局部永远优先于全局），未命中再查材料货架（全球统一价，与收购侧同规则）。材料要价表 `MATERIAL_ASK_PRICES`：

| 材料 | 收购价 | 基础要价 | 定价依据（三锚） |
|---|---|---|---|
| fuse | 5 | 8 | 全链唯一无 barter 来源的凭证料；保底仅 1 个却是 core_key 硬门槛 |
| filter | 4 | 7 | purifier（生存命脉）+ permit 双需求；保底仅 1 个 |
| battery | 3 | 5 | 阿林 fuse↔battery 1:1 的"次级 fuse" |
| wire | 3 | 5 | 阿林 scrap↔wire 1:1；全链需求最大之一 |
| scrap_metal | 2 | 4 | 保底 3 为全塔最富，与 wire 等价但供应三倍 |
| cloth / wood / tape | 2 | 4 | 到处都有 / 保底=唯一需求 / 高层概率普遍 |

三锚可复算：① 要价保持 battery(5)<fuse(8)、scrap(4)<wire(5) 的序（与收购侧同向），且**要价严格高于对应易物的金币成本**——一根电线的要价（≥4）永远高于付给阿林的那块废金属的收购价（2），一枚保险丝的要价（≥7）永远高于那颗电池的收购价（3）：拿货去兑永远是更优路径，阿林因此仍是保底之外的优解，商人只是"没有易物货可兑时的现金通道"；② tier 1 保底供应 vs 全链需求定档，与收购侧同一把尺；③ **变现总额约束的对称面**：tier 1 保底材料按要价全买 ≈ 58 金（行情 ±15%），永远高于全卖的 32 金——买料做配方不会成为比搜刮更优的解，卖料买食也不会（两个方向都有测试钉）。

XP：买材料照付 wealth +10（"交易达成"，与商品买入同一契约行）。

## 8. 投资与产业（investedGold / ventures 的生产者）

终局路线 B"独立商人与产业领袖"的账本（GROWTH_INTERFACES §9）终于有生产者。三门生意（`VENTURES`，`src/systems/shop.ts`）：

| 产业 | 成本 | 日产率 | 当日亏损率 | 倒闭率 |  fiction |
|---|---|---|---|---|---|
| 宿舍水站 | 40 | 5% | 6% | 1% | 路人拿脏水换净水你抽成，客源稳定本小利薄 |
| 废铁商路 | 80 | 10% | 12% | 3% | 去维修层收废铁转手，塔里废铁捡一天少一天 |
| 口粮暗线 | 120 | 16% | 20% | 6% | 从食堂倒出口粮，利润最厚，被查扣一次全没 |

**账本形状**（不能给 GameState 加字段——`core/gameTypes.ts` 不是本工单地盘）：`investedGold` = 在册产业成本合计（沉没资本），`ventures` = 在册产业 id（一种一门，重复入股被拒）。倒闭/亏损只改这两个字段 + `player.gold`，存档天然携带整个账本（round-trip 有测试）。

**结算**（`settleInvestments(state)`，由 SurvivalSystem 的两个跨日路径调用）：结算"刚结束的那一天"（`state.day - 1`）。当日毛产出 = `round(cost × baseRate × productionDecay(当日))`；`wealth +5`/有收入的产业；入股时 `wealth +50`（契约 §5）。

**风险怎么触发**（不是稳赚）：对每门在册产业用 `makeRng(deriveSeed(runSeed, 当日, 'venture', 产业id))` 依次摇两个 chance——先 `collapseChance`（**倒闭**：本金全损、产业出局、当天没收入、不给 XP），再 `lossChance`（**当日亏损**：没收入，本金还在）。同 seed 同一天同一门产业必然同结果（可复现），跨天真的不同。期望周收益沿风险梯度上升（≈+23% / +32% / +32%），但左尾很肥：口粮暗线一周内存亡率约四成——"把钱沉下去还是攥在手里过冬"因此是个真决定。

**幂等**：结算水位标记存在 `state.flags['economy:settled-day']`（走 WorldFlags 的 `flagCount/setFlag`，只读不改那个文件），任何调用方（包括未来一个"查看收益"的面板按钮）在同一天内重复调用不会重复结算刷钱。

**产量的时间维度**：`productionDecay(day) = 0.97^(day-1)`——塔里存量逐日枯竭，捡一天少一天，产业产量随结算日指数衰减。"早入场"本身就是收益，长线不再复利。

## 9. 测试增量（economyLoop.test.ts 只追加，21 例）

1. **当日市场**：priceJitter 同 (seed, day) 两次同抽、区间 [0.85, 1.15]、跨天真不同、跨 seed 不同；同日两次购买同价且逐金等于 `materialAsk`；3 seeds × 40 天 × 8 材料全扫"要价 > 收购价且 ≥ 收购价+1"；要价 > 阿林易物的金币成本（wire>scrap 收购价、fuse>battery 收购价）；材料往返在每个扫描日必亏；满级人脉折扣也不能套利材料架；保底材料全买 > 32 金且一进一出必亏；`materialShelf` 八件齐全、按价降序、fuse 恒贵于 battery。
2. **投资与风险**：入股金→账本 +50 XP、账本不变量（investedGold ≡ 在册成本合计）；拒绝未知/重复/钱不够且原子；结算确定性（两次运行逐字段相等）且逐金对上公式；日内幂等；productionDecay(1)=1 且严格递减、30 天不足半产；30 seeds × 3 门 × 29 天长扫——亏损日、倒塌、收钱都真实发生且每个结算日账本不变量成立；倒塌亏本金出局不给 XP；亏损日本金还在；睡一晚结算（醒来有钱）；熬过午夜也结算（与直接调用逐字段一致）；存档 round-trip 后账本完整且能继续结算。
3. **survivalBalance 不被破坏**：材料楼层保底配额（scrap 3 / wood 2 / tape 1 / fuse 1 / filter 1 / wire 2）逐项未动，三件设施照旧可建——金币通道没有替代搜刮路径。

**全量**：`npx tsc --noEmit` 干净；`VITE_NPC_MODEL= npx vitest run` → **67 文件 1101 例全绿**（基线 1080 + 21）。AG-05 钉死的硬边界（32 金 / 永低于找阿林换实物 / 三等级不套利 / 每层恰好一瓶 guaranteed 水）逐条未动分毫。

## 10. 没处理干净的地方（交接）

1. **材料 buy 侧没有 UI**：GameScene 的商店面板仍只渲染 `shopStock()` 的条目，材料货架（`materialShelf`）与投资面板（`VENTURES`/`invest`/`settleInvestments`）在系统层就绪，等 AG-11 接线；接线时注意牌价是当日价，重复打开面板会刷新。
2. **撤资（退出产业收回部分本金）没做**：资本沉下去后只能等倒塌或收益，没有流动性出口。攥着金币过冬的玩家因此完全被锁死——不构成软锁（搜刮/卖料仍是现金来源），但"落袋为安"的反向操作缺失。
3. **风险参数是拍的不是算的**：成本/日产率/亏损率/倒塌率按"风险梯度上周收益 ≈ +23%/+32%/+32%"拍的，未做完整蒙特卡洛平衡，等 playtest 数据回修。
4. **结算只结"刚结束的那天"**，跳日（一次 `spendTime` 跨两天以上）时引擎循环逐日补结，但直接调用方若手工把 `state.day` 推远，中间日不补结算——水位标记是单点不是区间。
5. **`investedGold` 与 NPC 经济的互动为零**：商路 fiction 上应该跟 AG-06 的 NPC 库存/补货压力联动（收废铁→阿林库存紧张），本工单只做了纯金币账本。
