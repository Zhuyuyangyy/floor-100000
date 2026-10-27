# 《第100000层：末日宿舍》组件清单

- 用途：交给外部（GPT）做审查 / 二次开发的**完整组件索引**
- 仓库：`D:/ZYY_Inovation/game/floor-100000-claude-kit`
- 分支 / HEAD：`feat/tower-zoom-b2` / `fb4f948`
- 技术基线：Phaser 4.2.1 + TypeScript strict + Vite + Vitest(node) + Playwright(chrome)
- 设计权威：`docs/GAME_DESIGN_LOCK.md`（最高，冲突以它为准）
- 当前状态：B2 世界导航 + B3-01 生存循环修复已完成；B3-02 试玩未开始

---

## 一、场景（5 个，`src/core/gameConfig.ts:21`）

| 场景 | 文件 | 职责 |
|---|---|---|
| `BootScene` | `src/scenes/BootScene.ts` | 烘焙全部程序化贴图 → 进 Menu |
| `MenuScene` | `src/scenes/MenuScene.ts` | 标题菜单：开始新游戏 / 继续游戏 / 操作说明；`?devfloor=` 开发入口 |
| `GameScene` | `src/scenes/GameScene.ts` | 楼层内玩法：移动、交互、搜刮、制作、交易、睡眠、HUD、全部面板 |
| `TowerOverviewScene` | `src/scenes/TowerOverviewScene.ts` | 塔楼地图三层：总览 / 区段 / 楼层详情 |
| `EndScene` | `src/scenes/EndScene.ts` | 死亡 / 胜利结算 |

---

## 二、UI 组件

### 2.1 HUD（`GameScene.buildHud`，`src/scenes/GameScene.ts:437`）

| 组件 | 内容 |
|---|---|
| `clockText` | 「第 N 天 HH:MM · M 层 楼层名」 |
| `barsGfx` + `statLabels` | 四条状态条：HP / 饥 / 渴 / 精 |
| `feedbackText` | 屏幕中上方闪现提示（目标、操作反馈），1.6 秒自消 |
| `bagFullText` | 背包满常驻警告（`y=86`，红色），直到腾出格子才消失；打开背包时依然显示 |
| `hintText` | 底部操作提示行 |
| `nightOverlay` | 名为 `night-overlay` 的全屏矩形，夜间/停电压暗 |
| `upgradeBoard` | 宿舍已建升级列表 |
### 2.2 面板（均为 `buildPanel()` 框 + 深色填充，`src/render/panels.ts`）

框由 8 块普通 Image 拼成，不是 NineSlice——原因见 §5.2。深度不变量由 `src/tests/panels.test.ts` 守着。

| 面板 | 打开键 | 内容 |
|---|---|---|
| 背包 `inventory` | `I` | 12 格、每格一个金属槽框 + 图标 + 名称 + 数量、底部 tooltip、方向键选择 / Enter 使用 |
| 制作 `crafting` | `C`（仅第 1 层工作台） | 3 条配方 + 净水动作，显示 `[可制作]`/`[已建]`/`[材料不足]` |
| 暂停 `pause` | `ESC` | 继续游戏 / 塔楼地图 / 重新开始 / 返回标题 |
| 对话 `dialogue` | `E`（NPC 旁） | 问候 / 询问 / 交易 / 退出，交易子菜单 |
| 帮助 `help` | 菜单内 | 操作说明 + 目标 |
| 楼层详情 | 地图内 | 阶层 / 资源·危险·管控 / 探索状态 / 通行状态 / **货物概要** |
| 结束画面 | 自动 | 美术包横幅（成功=绿勾 / 失败=红骷髅）+ 标题、死因、存活天数、重开提示 |

### 2.3 塔楼地图（`TowerOverviewScene`）

| 层 | 内容 |
|---|---|
| 总览 | 100 区段 × 3px 行，阶层渐变着色，已探索左缘条纹，阶层分界线，左侧每 10 段楼层号锚点，**起点(青)/当前(橙)/终点(紫)** 三标记 |
| 区段 | 1000 层 20×50 网格，按 已打通/已探索/未打通 着色，图例 |
| 楼层详情 | 只读面板 + Enter 进入（过 `canEnter` 闸门） |

交互：滚轮缩放 1x–6x、拖动平移、点击下钻、方向键 + Enter + ESC 全键盘可操作；HUD 全部 `setScrollFactor(0)` 不随世界缩放。

---

## 三、玩法系统（纯 TS，可单测）

| 系统 | 文件 | 核心导出 |
|---|---|---|
| 时间与生存 | `src/systems/SurvivalSystem.ts` | `advanceTime` / `sleep` / `sleepNightMinutes` / `REST_METABOLISM` / `applyRestDecay` / `isLegacyVictory` / `deathCause` / `isNight` |
| 楼层切换 | `src/systems/FloorSystem.ts` | `hasUpExit` / `hasDownExit` / `tryChangeFloor` / `currentInteractionZone` / `movePlayerX` |
| 搜刮 | `src/systems/LootSystem.ts` | `getFloorView` / `lootContainer` / `lootGround` |
| 背包 | `src/systems/InventorySystem.ts` | `addItem` / `removeItem` / `countItem` / `useConsumable` / `canFit` |
| 制作 | `src/systems/CraftingSystem.ts` | `canCraft` / `craft` / `hasUpgrade` / `purifyWater` / `nightOverlayAlpha` |
| 交易 | `src/systems/TradeSystem.ts` | `trade` / `canFit` |
| 夜间事件 | `src/systems/EventSystem.ts` | `ensureNightEvent` / `rollDayEvent` / `EVENT_FLOORS` |
| 存档 | `src/systems/SaveSystem.ts` | `saveToStorage` / `loadFromStorage` / `clearSave` / `validateGameState` |
| 塔楼模型 | `src/core/tower.ts` | `TOTAL_FLOORS` / `SECTOR_*` / `TIERS` / `tierOf` / `sectorOf` / `describeFloor` / `describeSector` / `canEnter` |
| 塔楼导航 | `src/systems/TowerNav.ts` | `openTower` / `pickSectorAt` / `pickFloorAt` / `nudgeSector` / `nudgeFloor` / `zoomBy` / `scrollBy` / `tryEnterSelected` / `accessOf` |
| 会话 | `src/core/session.ts` | `startNewGame` / `tryContinue` / `getGame`（模块级单例） |
| 开发夹具 | `src/core/devMode.ts` | `parseDevEntry` / `devEntry`（`?devfloor=` / `?devwin=`） |

---

## 四、数据表

| 表 | 文件 | 规模 |
|---|---|---|
| 物品 | `src/data/items.ts` | **15 种**：净水/脏水/压缩口粮/面包/医疗包/电池/废金属/木材/布料/胶带/滤芯/电线/保险丝/撬棍/手电 |
| 配方 | `src/data/recipes.ts` | **3 条**：照明灯(电池1 电线1 废金属1)、加固门(木材2 胶带1)、简易净水器(废金属2 滤芯1 电线1) |
| 楼层模板 | `src/data/floorTemplates.ts` | **5 层**（1–5），8 容器 + 4 地面物品 |
| NPC | `src/data/npcs.ts` | **2 名**（阿林·维修工、小周·邻居），各 2 条交易 |
| 阶层 | `src/core/tower.ts` `TIERS` | **6 阶层**（1–99 / 100–999 / 1000–9999 / 10000–49999 / 50000–89999 / 90000–100000） |
| 夜间事件 | `src/systems/EventSystem.ts` | **3 种**：blackout / wanderer / leak |
| 平衡配置 | `config/game-balance.json` | 时间、玩家衰减、初始物品、可玩楼层、QA 种子 |

### 4.1 五层内容

| 层 | 名称 | 保证掉落 | 概率掉落 | 地面 | 独有动词 |
|---|---|---|---|---|---|
| 1 | 玩家宿舍 | 净水×1 | 布料 0.6 | — | 睡 / 制作 / 净水 / 升级；事件免疫 |
| 2 | 邻居宿舍 | — | 面包 0.5 | — | 交易（唯一） |
| 3 | 废弃储物层 | 木材×2 胶带×1 废金属×3 撬棍×1 | 电池 0.6 | 电池 布料 | 地面拾取（唯一） |
| 4 | 维修层 | 保险丝 滤芯 电线×2 脏水×6 | — | — | 纯保证补给点 |
| 5 | 废弃食堂 | 口粮×3 脏水×2 面包×4 | 医疗包 0.5 | 面包 | 探索终点（仅下楼） |

---

## 五、美术组件

### 5.1 程序化贴图（`src/render/pixelArt.ts`，`generateAllPixelArt` 烘焙）

- 人物（16×24）：`player` `npc_alin` `npc_xiaozhou` `wanderer`
- 地块（16×16）：`tile_wall` `tile_floor` `tile_door` `tile_window` `tile_stairs_up` `tile_stairs_down`
- 家具：`furn_bed`(32×16) `furn_cabinet` `furn_crate` `furn_workbench`(32×16) `furn_watertank` `furn_fusebox` `furn_shelf`
- `blank`（1×1 全透明）：图标槽的占位贴图。**不能**用 `add.image(x, y, '')` 建图标槽——Phaser 4 里这样建出来的对象即使之后 `setTexture()` 换成真贴图也永远不会渲染。
- **15 个物品图标不再是程序化绘制**，改为从美术包加载（见 §5.2）。映射在 `src/render/artpack.ts` 的 `ITEM_ICON_FILES`，是 `Record<ItemId, string>`，漏一个编译报错；`src/tests/itemIcons.test.ts` 另外校验每个文件真实存在且是 16×16。

### 5.2 美术包素材（`public/assets/`，由 `tools/build-artpack.mjs` 从设计图切片生成）

| 位置 | 内容 |
|---|---|
| `assets/artpack/item-<ItemId>.png` | 15 个物品图标，16×16（源图 ~250px，用面积平均降采样，最近邻会只取十五分之一变成噪点） |
| `assets/ui/frame-<green|yellow>-<tl/tr/bl/br/top/bottom/left/right>.png` | 面板框的 8 块拼图 |
| `assets/ui/slot.png` | 背包物品槽框，22×22 |
| `assets/artpack/banner-win.png` `banner-lose.png` | 结束画面的成功/失败横幅 |
| `assets/ui/marker.png` | 选择箭头（Kenney CC0 1.0，见 `THIRD_PARTY_NOTICES.md`） |

**面板框为什么是 8 块 Image 而不是 NineSlice**：Phaser 4 里 NineSlice 在比普通 Image 更晚的通道合成，与 depth 无关——框在 depth 195、图标在 200，图标会被框的不透明中心吃掉；把框降到 -100 图标就回来了。所以改成 4 个原尺寸角 + 4 个可拉伸边。`src/tests/panels.test.ts` 守着这条不变量。

### 5.3 走廊主题（`src/render/corridors.ts`）

四套按楼层区分：`drawWorkerDorms`(2) / `drawStorage`(3) / `drawMaintenance`(4) / `drawCanteen`(5)，各带淡色罩调 `CORRIDOR_TINT`。第 1 层宿舍由 `GameScene.drawDormRoom` 单独绘制。

### 5.4 音频（`src/render/audio.ts`）

7 个程序化音效：`click` `pickup` `craft` `sleep` `trade` `hurt` `danger`。

---

## 六、测试

| 层 | 文件数 | 用例数 |
|---|---|---|
| 单元（`src/tests/`） | 22 | **268** |
| E2E（`e2e/`） | 15 | **54** |

关键测试文件：
- `survivalBalance.test.ts`（21）— 材料确定性、三升级可共建、背包约束、无孤儿物品、交易守恒、净水器批量、升级生效、睡眠规则、七日预算
- `towerNav.test.ts`（35）— 三层导航状态机
- `tower.test.ts`（17）— 阶层/区段/通行判定
- `save.test.ts`（31）— 存档校验与兼容
- `itemIcons.test.ts`（9）— 图标键恒等 + 美术包每个图标文件存在且为 16×16 + 无孤儿文件
- `panels.test.ts`（4）— 面板框/填充深度必须低于所有面板内容（防图标被静默吞掉）
- `survivalLoop.spec.ts`（4）— 真实浏览器走遍五层：搜集→建造→交易守恒→睡觉→夜色三档
- `tower.spec.ts`（10）— 地图导航 / 高亮 / 禁传送 / 状态保留
- `art.spec.ts`（1）— 五层美术回归截图

---

## 七、已知未完成 / 遗留

| 项 | 状态 |
|---|---|
| 第 6 层以上内容、程序化楼层生成 | 未做（B4） |
| 经济 / 价格 / 基地建设扩展 | 未做（B5） |
| NPC 关系 / 好感 / 委托 / 背叛 | 未做（B6）；`npcStates` 字段存在但从未写入 |
| 派系 / 阶级 / 权力 | 未做（B7） |
| 四条终局 | 未做（B8）；生产逻辑中无胜利条件，`EndScene` 胜利分支仅 `?devwin=1` 可达且文案是已作废的第 8 天叙事 |
| **D7 装饰道具与可交互对象不一致** | **待修**：第 4 层 5 电箱/5 水箱仅 2 可交互；第 5 层 4 柜台仅 1 可交互且**无贴图** |
| **D8 EndScene 胜利文案** | 待修（横幅已换成美术包，文案仍未改） |
| **D9 存档失败静默** | ✅ 已修（B3-01） |
| `unlockedDoors` / `localEvents` | `FloorVisit` 字段被校验但从未写入 |
| `maxMajorEventsPerDay` | 配置项存在但无任何系统读取 |
| `batteryState` | 起始手电标记 `low`，无任何读取点（电池永不消耗） |
| 第 4 层描述「漆黑区域」 | 未实现按楼层黑暗，仅区分宿舍/非宿舍 |
| B3-02 完整章节试玩 | ✅ 已完成并验收（`docs/B3-02_JOURNEY_VERIFICATION.md`） |
| 美术包中其余素材（角色 / 建筑 / 怪物 / 家具） | 已切片到 `F:/new/sliced/`，尚未接入游戏。家具映射最值得做：宿舍与容器现在仍是程序化贴图 |

---

## 八、给 GPT 的说明

1. **设计冻结**：`docs/GAME_DESIGN_LOCK.md` 是最高权威。任何与它冲突的改动必须先报告冲突，不得自行更改核心设计。
2. **核心规则必须是纯 TS**：Phaser 只负责渲染与输入，逻辑在 `src/systems/` 与 `src/core/`，可单测。
3. **禁止 `Math.random()`** 进入世界生成与事件判定，一律用 `src/core/rng.ts` 的 seeded RNG；房间装扮用 `variant(floor, room, n)`。
4. **Phaser 4 有两个已踩过的坑**（记录在 `docs/B2_TOWER_ARCHITECTURE.md` §8）：
   - 类字段初始器在场景重启时**不会**重新执行——所有按 create 填充的数组必须在 `create()` 里重置。
   - 键盘**不能**用 `JustDown` 轮询：Phaser 在 DOM 事件上同步排空键盘队列，两个帧之间完成的按键会先被 `onUp` 清掉 `_justDown`，整帧丢失。必须用事件监听 + 按帧去抖（GHI-03 m9 那套 `lastInputFrame`）。
5. **存档键 `floor100000.save.v1` 不要改**：`SCHEMA_VERSION` 现在是 2，键保持稳定才能让旧存档被找到、列出、再以可读理由拒绝。
6. **运行命令**：`npm run typecheck` / `npm run test` / `npm run test:e2e` / `npm run build`。
7. **分支纪律**：不合并 main、不发布安装包；改动走独立分支。
