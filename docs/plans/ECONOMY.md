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
