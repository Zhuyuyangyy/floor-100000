# B2 可缩放塔楼架构（已实现记录）

- 状态：**已实现，待人工验收**（2026-10-27）
- 上游依据：`docs/GAME_DESIGN_LOCK.md`（核心设计已冻结）
- 阶段路线：`docs/ROADMAP.md`（B2–B10，取代本文档 §8 的旧分阶段表）
- 实现分支：`feat/tower-zoom-b2`

---

## 1. 设计前提（不变）

原方案把塔楼当成**静态地图**的假设被推翻，`TowerModel` 升级为**社会空间数据模型**，并加入两条硬规则：

- **玩家从第 1 层开始**，不是第 100000 层。
- **总览不可传送**。点击楼层只做「选择 / 查看」，实际移动必须走已解锁的通行路径。

**起始层重映射属于 B2 而非 B3。** 原路线图让 B2 原型继续用第 100000 层开局、B3 再改回第 1 层，这被明确否决——核心设计已冻结，不能为开发方便沿用与设计冲突的假设。

**第 100000 层的处置**：v0.1 宿舍模板**保留为开发测试场景**，只能通过 `?devfloor=` 查询参数进入，不再是正式新游戏的默认出生点。正式路径下第 100000 层属于统治核心，首版不提供进入。**逻辑楼层本身不删除**——它是未来的顶层终点。

---

## 2. 三层视图与导航（已实现）

| 视图 | 实现 | 数据精度 |
|---|---|---|
| **塔楼总览** | `TowerOverviewScene` 第 1 层：100 个区段、每区段一行、按阶层着色 | 100 区段聚合 |
| **楼层群** | `TowerOverviewScene` 第 2 层：单区段 1000 层，20 列 × 50 行网格 | 区段内每层一格 |
| **楼层细节** | `TowerOverviewScene` 第 3 层：只读详情面板（阶层 / 资源 / 危险 / 管控 / 探索状态 / 通行状态） | 单层完整记录 |

**导航规则（已实现）**：
- 滚轮 = 缩放（1x–6x，0.5 步进）；拖动 = 平移；点击 = 选中并下钻
- 方向键 = 移动键盘光标，Enter = 下钻，ESC = 逐级返回，总览 ESC = 返回游戏
- **当前所在楼层 / 区段始终高亮**，打开地图即定位到玩家所在区段并居中
- HUD 不随世界缩放变形（`setScrollFactor(0)` + 独立 depth）
- 四个单元格状态有色例图例（当前 / 已打通 / 已探索 / 未打通）

### 2.1 与方案的偏差（均为实现期决策，记录在案）

| 方案原文 | 实际实现 | 原因 |
|---|---|---|
| 楼层细节 = 现有 `GameScene` | **楼层细节是 `TowerOverviewScene` 内的只读面板** | `GameScene` 是「实际站在这一层」的玩法场景；用它在详情页渲染会让「查看」变成「进入」，直接违反不可传送规则 |
| 滚轮以鼠标位置为中心缩放 | 以视口中心为锚缩放，滚动独立钳制 | 鼠标锚点需要在拾取前反解坐标，且在钳制边界上手感跳变；中心锚 + 拖动平移覆盖同一需求 |
| zoom 取整数值 | 1x–6x，0.5 步进 | `pixelArt: true` 下非整数 zoom 是最近邻放大，保持像素锐利；整数 zoom 在 640×360 视口内可选档位太少 |
| 楼层群「看十几到几十层」 | 一次展示整个区段 1000 层 | 区段是 1000 层的固定单位，部分展示会让「区段」失去意义 |
| 鼠标坐标统一走 `camera.getWorldPoint` | 自行镜像摄影机变换求世界坐标 | `getWorldPoint` 依赖指针与摄影机的内部状态；显式计算 `left = scrollX + width/2 - (width/zoom)/2` 与 Phaser 的 `worldView` 推导一致且可单测 |
| 楼层群只渲染视口内约 20 行并回收 | 单个 `Graphics` 对象按需重绘全部格子 | 1000 次 `fillRect` 只在状态变化时发生一次，不是每帧；对象回收的复杂度没有换来可测的收益 |

---

## 3. TowerModel 数据模型（已实现）

`src/core/tower.ts` 为纯函数模块，**不按层存储对象**——十万层的每个答案都是楼层编号的函数，只有玩家真正到过的楼层才进 `GameState.visitedFloors`。

| 字段 | 实现 |
|---|---|
| `floor` | 楼层身份 |
| `tier` / `tierName` / `zoneType` | 阶层 1–6（贫民 / 工人 / 工业 / 商业 / 特权 / 统治） |
| `resourceLevel` / `dangerLevel` / `security` | 1–5 梯度，单调不减 / 单调不降 |
| `faction` | 恒为 `'none'`，字段已存在（B6/B7 落地） |
| `access` | 取阶层 `security`，B7 细化 |
| `explored` | 由 `visitedFloors` 推导，不重复存储 |

区段：`SECTOR_SIZE = 1000`，`SECTOR_COUNT = 100`，`sectorOf()` / `sectorRange()` / `describeSector()`。

**通行判定**（`canEnter(floor, access)`）是唯一闸门：

```ts
floor <= access.highestUnlocked || floor === access.currentFloor
```

`highestUnlocked` 由 `accessOf(state)` 从 `currentFloor` 与 `visitedFloors` 推导——爬到过 5 层再回 1 层，2–5 层不会重新上锁。

---

## 4. 模块划分（实际改动）

| 模块 | 形式 | 本轮改动 |
|---|---|---|
| `src/core/tower.ts` | 纯 TS，可单测 | **新增**：区段聚合、阶层梯度、通行判定 |
| `src/systems/TowerNav.ts` | 纯 TS，可单测 | **新增**：三层导航状态机、坐标拾取、缩放滚动钳制、键盘光标 |
| `src/core/devMode.ts` | 纯 TS + 查询参数 | **新增**：`?devfloor=` / `?devwin=` 开发夹具 |
| `src/scenes/TowerOverviewScene.ts` | 新 Phaser Scene | **新增**：渲染与输入 |
| `src/scenes/GameScene.ts` | Phaser Scene | 加入口（`M` 键 + 暂停菜单「塔楼地图」）、HUD 目标文本；**未改**生存 / 背包 / 制作 / 交互逻辑 |
| `src/scenes/MenuScene.ts` | Phaser Scene | `?devfloor=` 开发入口、帮助文本目标描述 |
| `session` / `SaveSystem` | — | **未改动**。GameState 本就是模块级单例，跨视图天然保持 |
| `src/data/floorTemplates.ts` | 数据 | 模板键重映射 100000→1 … 99996→5；新增 `DEV_FLOOR_ALIAS` 让 `?devfloor=100000` 复用第 1 层布局而不复制表格 |

未引入大型依赖；未改物品 ID、制作配方、交易规则、生存数值。

---

## 5. 起始层重映射清单（已完成）

| 位置 | 原值 | 现值 |
|---|---|---|
| `config/game-balance.json` `player.startingFloor` | `100000` | `1` |
| `config/game-balance.json` `world.startingFloor` | `100000` | `1` |
| `config/game-balance.json` `world.playableFloorsV01` | `[100000…99996]` | `[1…5]` |
| `src/core/constants.ts` | `STARTING_FLOOR` 派生 = 100000 | = 1；新增 `DEV_TEST_FLOORS = [100000]` |
| `src/data/floorTemplates.ts` | 键 100000…99996 | 键 1…5；`DEV_FLOOR_ALIAS = { 100000: 1 }` |
| `src/data/npcs.ts` `NPC_FLOOR` | `99999` | `2`（台词楼层号同步 4 / 5 / 3） |
| `src/systems/EventSystem.ts` `EVENT_FLOORS` | `!== 100000` | `!== STARTING_FLOOR` |
| `src/scenes/GameScene.ts` | `drawCorridor` 墙色表键 100000…99996、`drawDormRoom` 注释 | 键 1…5、注释改为起始层 |
| `src/scenes/MenuScene.ts` 帮助文本 | 「熬过 7 天，第 8 天 06:00 仍活着」 | 「从第 1 层爬到第 100000 层的统治核心」 |
| `e2e/*`、`src/tests/*` | 硬编码 100000 / 下楼方向 | 同步更新；**存档键 `floor100000.save.v1` 保持不变** |

**存档键刻意不变**：`SAVE_KEY` 是稳定的存档槽位。改了它，旧存档会被静默遗弃；不改，旧存档会被找到、列出、然后以 `SCHEMA_VERSION` 不匹配为由可读地拒绝。

### 5.1 方向语义

楼层编号向上增长：第 1 层 → 第 2 层是**上楼**，位于楼层**左端**（`UP_EXIT_X = 40`）。原 v0.1 从 100000 往下走，所以「下一层」在右端；重映射后所有依赖下楼位置的测试夹具同步改到左端。

---

## 6. 胜利条件的处置

v0.1 的「活到第 8 天 06:00」按设计冻结文档 §7 降级为阶段性生存目标，并**从生产逻辑中移除**：

- `src/systems/SurvivalSystem.ts` 新增 `isLegacyVictory(state)`，纯函数保留阈值语义
- `advanceTime()` / `sleep()` 只在 `devEntry().legacyWin`（`?devwin=1`）为真时才判定胜利
- 生产路径下第 8 天只是普通的一天，不会自动跳 `EndScene`
- `time.victoryDay: 8` 数值保留在 config 中，仅被开发夹具读取

B2 **不实现完整终局系统**（属于 B8）。`EndScene` 的「won」分支保留，由 `?devwin=1` 夹具与坏档兼容路径覆盖。

---

## 7. 状态跨视图保持

`GameState` 是 `src/core/session.ts` 的模块级单例。打开地图是 `GameScene.scene.start('TowerOverview')`，返回是 `TowerOverviewScene.scene.start('Game')`，`GameScene.create()` 依据同一份状态重建视图。

- 打开 / 关闭地图：`currentFloor`、`day`、HP、背包、`visitedFloors` 全部不变（`e2e/tower.spec.ts` 断言）
- 地图打开期间生存时钟停止（`GameScene.update()` 不运行），不存在「挂机地图刷时间」
- 从地图进入已解锁楼层：写入 `currentFloor` 与 `player.x = ENTRY_X`，与普通上楼一致

---

## 8. 风险与实测结论

| 风险 | 等级 | 实际情况 |
|---|---|---|
| 楼层群渲染上千行对象拖垮帧率 | 高 | 单个 `Graphics` 重绘 1000 个 `fillRect`，仅在状态变化时执行；实测无可感知卡顿 |
| 缩放导致像素模糊 / 抖动 | 高 | `pixelArt: true` 下最近邻放大；HUD 用 `setScrollFactor(0)` 独立于世界缩放 |
| 视图切换丢失玩家状态 | 中 | 单例 + e2e 断言覆盖，未复现 |
| `Scale.FIT` 与塔楼逻辑高度的坐标转换 | 中 | 显式镜像摄影机变换（见 §2.1），并用 `src/tests/towerNav.test.ts` 锁定 `viewTop` / 滚动边界 |
| 总览被误用为传送器 | 中 | `tryEnterSelected()` 是唯一出口；e2e 断言从第 1 层无法抵达第 100000 层 |
| Phaser 键盘输入重复投递 | **高（实测复现）** | 同一 DOM keydown 会在同一帧内被投递三次（GHI-03 m9 已在菜单修复）。`TowerOverviewScene` 用同一套按帧去抖；**不能改用 `JustDown` 轮询**——Phaser 在 DOM 事件上同步排空键盘队列，两个帧之间完成的按键会先被 `onUp` 清掉 `_justDown`，导致按键整帧丢失 |
| 与既有 e2e 冲突 | 低 | 8 条失败全部源于下楼方向反转，改夹具后通过 |

---

## 9. 验证证据

- `npx tsc --noEmit -p tsconfig.json` — 通过
- `npx vitest run` — 20 个文件 / 217 个用例通过
- `npx playwright test` — 全量通过（含 `e2e/tower.spec.ts` 9 条）
- `npm run build` — 生产构建通过
- 真实浏览器截图：`e2e/screenshots/20-tower-overview.png`、`21-tower-sector.png`、`22-tower-floor.png`

---

## 10. 明确不在 B2 实现

程序化楼层生成、社交模拟数据、经济系统、NPC 关系深化、派系与权力、终局系统、美术定型。引擎迁移、合并 main、发布安装包同样不在本轮范围。
