# AG-42：合成闭环诊断与心流修复

**日期**：2026-11-16
**范围**：把"爬高 → 拿好料 → 做好东西"做成闭环——诊断材料链断裂点、修复合成心流（缺料提示/效果预览/档位可见性）
**分支**：`agent/2026-11-16/ag-42-craft-loop`（从 `068f1d3` 出发）
**涉及文件**：`src/data/recipes.ts`（+effect 字段、+MATERIAL_SOURCES）、`src/systems/CraftingSystem.ts`（+hints、+recipePreview、+recipeTierNote、缺料 reason 加出处）、`src/tests/craftLoop.test.ts`（新建，20 例）、`docs/plans/CRAFT.md`（本文）

---

## 1. 断点诊断表（材料 → 掉落楼层 → 最早游戏日）

出处全部对照 `src/data/floorTemplates.ts`（1-10 层实写）与 `src/systems/encounters.ts` 的 `FLOOR_LOOT_POOLS`（100+ 遭遇池）逐条复核。tier 1 = 1-10 层（底层贫民区，第 1 天全程可达）。

| 材料 | 保底来源（层·量） | 概率来源（1-10 层） | 高层梯度 | 最早游戏日 |
|---|---|---|---|---|
| 废金属 scrap | 3层铁箱 ×3 | 6/7/9/10 层 | 100+ 各层 p0.4-0.5 | 第 1 天 |
| 木材 wood | 3层木箱 ×2 | 6/8 层 | 1002/1007 才有 | 第 1 天 |
| 胶带 tape | 3层木箱 ×1 | 6/8/10 层 | 100+ 各层 | 第 1 天 |
| 电池 battery | 3层地面 ×1 | 3层铁箱 p0.6、6/7/10 层 | 100+ 各层 p0.3-0.45 | 第 1 天 |
| 电线 wire | 4层电箱 ×2 | 7/8 层 | 100+ 各层 | 第 1 天 |
| 滤芯 filter | 4层电箱 ×1 | 9 层 p0.2 | 102+ 各层 | 第 1 天 |
| 保险丝 fuse | 4层电箱 ×1 | 7/10 层 p0.25 | 104+ 各层 | 第 1 天 |
| 布料 cloth | 3层地面 ×1 | 1层柜子 p0.6、6-9 层 | 100+ 各层 | 第 1 天 |
| 撬棍 crowbar | 3层铁箱 ×1 | — | 4层商人 60 金 | 第 1 天 |

**三条玩家链路走查**：

1. **想点灯**（battery 1 + wire 1 + scrap 1）：三样全部 3/4 层保底 → **第 1 天一趟可建**。
   ⚠️ 任务书假设"玩家要爬很高才能做第一盏灯"与数据不符——灯从来不是断点，`craftingSystem.test.ts` 的 give 三件套就是按这个写的。
2. **想扩包**（wood 2 + cloth 1 + crowbar 1）：3 层全保底 → 第 1 天；但与门共享木材（economyLoop 钉死的双向取舍）。
3. **想上楼**（五张凭证）：每种料在 1-10 层都有出处，**但需求量超过 tier 1 总供给**。300 种子全清 1-10 层（背包移出视野，只测世界供给）的实跑：

| 配方 | tier 1 内建成率（300 种子） | 结论 |
|---|---|---|
| 灯 / 门 / 净水器 | 300/300 | 保底配额恰好三件（survivalBalance 钉死） |
| 置物架 | 93/300 | 与门抢木头 |
| 工牌（tier 2） | 195/300 | 与三件设施抢 scrap/tape |
| 通行贴（tier 3） | 11/300 | tier 1 供给开始不够 |
| 许可证 / 贵宾卡 / 核心权限 | **0/300** | 必须上 100+ |

**真正的断点（与任务书假设不同，说清楚）**：

- 不是"高阶材料只在高层掉"——tier 1 保底覆盖灯/门/净水器/置物架/工牌；**断裂在信息层**：
  1. 缺料提示只说"材料不足：胶带 0/1"，不说去哪拿——而上链凭证的进阶料客观上必须去 100+ 拿更稳的供应，"100 层以上更常见"这条真实梯度玩家从头到尾看不到；
  2. 制作面板只有 名称+材料 两列，没有效果预览——"通行贴"与一块废金属在面板上长得一样（它实际开 1000-1010 段电梯）；
  3. `recipeTierLocked`↔`recipeAccessTier` 已接通但只有一个测试调用方，档位不出现在任何玩家可见处，"凭证链按档位分层"是纸面设计。

## 2. 修复清单与理由

### R1 = 缺料提示补"去哪拿"（recipes.ts `MATERIAL_SOURCES` + CraftingSystem）

- `MATERIAL_SOURCES`：9 条 recipe 材料的出处表（保底/概率/高层梯度三列），文本与 floorTemplates/encounters 实写逐条对齐，**不改任何世界数据**（floorTemplates 归 AG-43）。
- `craft()` 拒止 reason：`材料不足：废金属 0/1（3层铁箱×3 · 6/7/9/10层概率 · 100层以上各层概率），…`；`canCraft` 失败结果新增可选 `hints?: string[]`（**additive**——`missing` 数组形状不变，`craftingSystem.test.ts` 的 `toContainEqual` 不受影响）。
- 前置资格仍然先拦且不带材料腔（passChain 语义不变，有测试钉）。

### R2 = 效果预览（recipes.ts `Recipe.effect` + CraftingSystem `recipePreview`）

- 每条配方加一句话 `effect`（机制事实：数值/门禁/权力线），凭证必须写明开的段（"开 1000-1010 段电梯；权力线 +200"）。
- `recipePreview(state, id)` 打包面板一行需要的全部数据：名称、效果、逐项成本（need/have/出处）、前置（met）、档位（tier/tierLocked/tierNote）、built、canCraft、missing、hints。
- **场景接线不在本工单**（GameScene 归 AG-11）：函数与数据就绪，`buildCraftPanel` 的 `refreshCraft` 改为逐行调 `recipePreview` 即可获得三样新信息。交接见 §5。

### R3 = 档位可见性（CraftingSystem `recipeTierNote`）

- `档位 2｜权力线 1 级未达` / `档位 1` 一句读数，由 `recipeAccessTier`（growth.ts，AG-01）驱动。
- **门禁语义零改变**：craft/canCraft 依旧不因档位拒绝（冷启动软锁 + passChain"材料齐全必可建"两条硬约束，economyLoop.test.ts 有断言），档位是进度感不是准入。

### 为什么没做"配方分层/材料梯度"（任务书给的三个方向）

- **九条配方成本全被钉死**：lamp（craftingSystem.test.ts）、门/灯（craftingSystem.test.ts）、purifier（survivalBalance/economyLoop 的 F3+F4 断言）、置物架（economyLoop 的四条专属断言）、五张凭证（passChain.test.ts 的 `giveChainMaterials` 恰好等于全链成本合计，economyLoop 的权力线 XP 断言同）。动任何一条成本都会红别人的测试——那不在本工单权力内。
- **材料梯度在数据层已存在**：高层掉率梯度真实（§1 的 0/300 就是证据），缺的只是让它被玩家看见。所以正确修法是**把已有梯度显示出来**，而不是改数字。
- 结论：R1+R2+R3 就是"配方分层"的信息层等价物——玩家现在能在面板上看出"这条属于更高档位、差的料去哪拿、做出来会怎样"。

## 3. 心流三点检查结果

| 检查项 | 修前 | 修后 |
|---|---|---|
| 缺料提示说清"缺什么、去哪拿" | ❌ 只说缺什么（`材料不足：胶带 0/1`） | ✅ reason 与 canCraft.hints 双通道带出处（保底层/概率层/高层梯度） |
| 面板显示"能做出什么" | ❌ 面板只有 名称+材料（description 字段从未被渲染） | ✅ `Recipe.effect` + `recipePreview()` 数据就绪（场景接线归 AG-11，见 §5） |
| tier 门禁与 recipeAccessTier 打通 | ⚠️ 函数接通但零玩家可见面 | ✅ `recipeTierNote()` 档位读数 + preview.tierLocked；门禁仍不拦建造（钉死语义） |

## 4. 测试（src/tests/craftLoop.test.ts，新建 20 例）

1. **诊断表断言版**（5 例）：F3+F4 保底配额 8 种子恰好只建三件设施；未建时置物架/工牌均可建（取舍设计）；三件后置物架/工牌被拒且点名被吃掉的料；每种凭证料在 1-10 层都有出处（断裂是量不是有无）；**凭证链在 tier 1 内 0/40 种子可完成**（许可证以上恒 0、工牌 >0、通行贴 < 工牌）。
2. **缺料提示**（4 例）：reason 点名缺失料 + have/need + 楼层出处 + 高层梯度、只列缺的、原子不扣；canCraft.hints 三通道齐；缺前置时报 gate 不报材料；每种 recipe 材料都有出处提示且带楼层号。
3. **tier 门禁**（4 例）：权力 1 级时 tier2+ 全锁、设施不锁；note 文本；全链建成后权力 6 级、档位全开；**锁而不拦**（材料齐照建）。
4. **survivalBalance 硬边界**（2 例）：保底配额六项数字未动；无 recipe 依赖纯概率材料（audit D1 复钉）。
5. **同 seed 同材料同结果**（2 例）：两次同 seed 同操作逐字段相等（含拒止 reason）；recipePreview 纯数据。
6. **效果预览**（3 例）：九条 effect 非空、凭证写明开的段；preview 成本逐项 have/need/出处；前置与 built 标志随状态翻转。

**全量**：`npx tsc --noEmit` 干净；`VITE_NPC_MODEL= npx vitest run` → 见提交记录（基线 1457 + 本文件 20 例，全绿）。

## 5. 没处理干净的地方（交接）

1. **面板渲染没接线**（本工单文件边界外）：`GameScene.refreshCraft/buildCraftPanel`（AG-11）仍只画 名称+材料。接入方式：每行改调 `recipePreview(getGame(), id)`，把 `effect` 画成选中行的详情行（现 `craftReqText` 位置）、`tierNote` 画进行尾、`cost[].source` 与 `hints` 在"材料不足"时亮出。面板行高/排布预算归 uiLayout 测试，接入前先量。
2. **`canCraft` 对"已建造"仍可能报 ok**（材料又凑齐时）：UI 有 `已建` 列掩着，craft() 也正确拒绝；统一语义（canCraft 增加 built 检查）涉及 passChain/craftingSystem 的既有断言语义，留待 CraftingSystem 属主统一。
3. **遭遇池（FLOOR_LOOT_POOLS）的产出没进 §1 的 0/300 统计**：诊断只数了楼层容器；问号点/ambush/cache 还会再添概率料，上链凭证在 tier 1 的建成率只会更高一点、不改变"许可证以上 0/300"的结论（许可以上的材料缺口是数量级）。
4. **`recipeTierNote` 的消费方同样缺场景接线**：数据与测试就绪，等 AG-11 与 R2 同一次面板改版落地。
