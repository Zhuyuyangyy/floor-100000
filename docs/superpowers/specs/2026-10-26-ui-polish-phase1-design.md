# UI 打磨第一阶段设计（A + B）

- 日期：2026-10-26
- 分支：`feat/ui-polish-phase1`
- 范围：接入现有像素美术（阶段一）+ 改善可读性（阶段二）
- 上游：GHI-04 试用结论（`docs/GHI-04_ASSET_TRIAL.md`）

## 1. 背景与动机

`src/render/pixelArt.ts` 烘焙了 **32 张贴图**，但只有 4 张（角色）被场景使用。闲置的 28 张是：

| 类别 | 数量 | 贴图键 | 状态 |
|---|---|---|---|
| 地块 tile | 6 | `tile_wall` `tile_floor` `tile_door` `tile_window` `tile_stairs_up` `tile_stairs_down` | 闲置，**本轮不用** |
| 家具 furn | 7 | `furn_bed`(32×16) `furn_cabinet`(16×24) `furn_crate`(16×16) `furn_workbench`(32×16) `furn_watertank`(16×24) `furn_fusebox`(16×16) `furn_shelf`(16×24) | 闲置，**本轮接入** |
| 物品图标 | 15 | `clean_water` `dirty_water` `ration_pack` `bread` `battery` `scrap_metal` `wood` `cloth` `tape` `filter` `wire` `medkit` `crowbar` `fuse` `flashlight` | 闲置，**本轮接入** |

也就是说：美术资产已经存在（且是程序化生成的，无授权风险），但没有接到任何界面上。背包是纯文本列表，场景里的床和箱子是 Graphics 矩形。

**本轮不碰 6 个 tile**——用户明确只列了 7 件家具，tile 化会牵动整个走廊渲染方式，属于更大范围的改动。

## 2. 阶段一：接入现有像素美术

### 2.1 物品图标接入三个列表

**统一映射（关键约束：按物品 ID，不按显示名称）**

`src/data/items.ts` 里的 `ItemId` 与贴图键**已经同名**（`clean_water` / `ration_pack` / …）。因此不需要新建映射表，直接以 `ItemId` 作为贴图键即可——这是最稳妥的形式，从结构上消除了「显示名改动导致图标错配」的可能。

需新增一个纯函数并单测：

```ts
// src/render/itemIcons.ts
export function itemIconKey(itemId: ItemId): string  // 恒等于 itemId，但集中一处便于断言
```

接入点（3 处）：
- `GameScene.refreshInventory()` —— 每个背包格左侧加 16×16 图标
- `GameScene.refreshCraft()` —— 制作条目左侧加成品图标
- `GameScene` 对话交易列表 —— 交易选项左侧加图标

**布局影响**：背包行当前是「▶ 净水 ×3」（箭头 + 文本）。加图标后变为「▶ [icon] 净水 ×3」，行高需从 13px 提到 20px 左右以容纳 16px 图标。`INVENTORY_SLOTS = 12` 不变，面板高度随之增加。

### 2.2 家具贴图接入场景

当前场景用 Graphics 画家具，逐点替换为贴图：

| 场景元素 | 当前位置 | 现绘制方式 | 目标 |
|---|---|---|---|
| 床 | `drawBed()` | Graphics `fillRect` ×2 + 文本 | `furn_bed` 贴图（32×16） |
| 储物柜 | `buildContainers()` 的 container box | Graphics `lineStyle` 框 + 文本 | `furn_cabinet`（16×24） |
| 木箱/铁箱 | 同上 | 同上 | `furn_crate`（16×16） |
| 工作台 | `drawWorkbench()` | Graphics | `furn_workbench`（32×16） |
| 储水罐 | `buildContainers()` | 同上 | `furn_watertank`（16×24） |
| 电箱 | `buildContainers()` | 同上 | `furn_fusebox`（16×16） |
| 货架 | `buildNpcs()` 附近 | 同上 | `furn_shelf`（16×24） |

**约束**：容器当前的视觉是「一个框 + 一个标签」，其**判定用的是 `container.x` 与 `INTERACT_DISTANCE`**，与绘制无关。因此替换绘制**不得改动** `containerObjs` 的判定逻辑、`nearestContainer()` 的距离计算、或 `x` 坐标——只换 GameObjects 的创建方式。

**静态 vs 动态分工**（按用户原则）：
- 静态家具 → 贴图（`add.image`）
- 动态状态 → 继续用 Graphics：夜晚遮罩、血条/状态条、选中高亮、feedback 闪烁

### 2.3 明确不做

- 不新增外部美术资源、不引入依赖、不换引擎
- 不改交互逻辑、碰撞区域、物品数量、交易规则、制作规则
- 不动 6 个 tile
- 不做整套 UI 重设计

## 3. 阶段二：改善可读性

### 3.1 现状问题（实测）

640×360 内部分辨率下：

| 元素 | 当前字号 | 问题 |
|---|---|---|
| HUD 状态标签 | **10px** | 美术指南明令「禁止小到无法辨识的字号」；640×360 下 10px 约等于 1280×720 下的 20px，尚可，但四条挤在 13px 行距里偏挤 |
| 时钟 | 16px | 可接受 |
| 提示语（底部） | 12px | 偏小，且是常驻信息 |
| feedback 闪现 | 13px | 可接受 |
| 背包行 | 13px | 接图标后需重排名 |
| 面板标题 | 16px | 可接受 |

### 3.2 方案：建立三级字阶，不做重新设计

| 层级 | 字号 | 用途 |
|---|---|---|
| 标题 | 16px | 面板标题、时钟 |
| 正文 | 13px | 列表行、对话、feedback |
| 辅助 | 11px | 面板页脚提示、tooltip 次要信息 |

- HUD 状态标签 10px → **11px**，行距 13px → **15px**，给状态条留出呼吸空间
- 底部常驻提示 12px → **12px 保持不变**但提高对比度（`#77c6a4` → `#a8e0c8` 一类），因为它是常驻信息而非辅助信息
- 所有字号保持**整数像素**，不做非整数缩放（美术指南：整数倍缩放、禁用平滑滤镜）
- **不改变既定配色**（楼体深蓝灰/墙体灰/灯光橙/危险红/安全青/文字米白），只调整少量前景色的明度以提升对比度

### 3.3 需检查的具体问题

1. 文字截断：背包行加图标 + 「×N」后，最长物品名（「低电量手电」5 字 × 13px = 65px）加图标 16px + 间距，是否超出面板宽 300px
2. 图标模糊：贴图为 16×16，须以 1:1 像素比绘制，**不得** `setScale`
3. 面板遮挡：背包面板变高后是否盖住 HUD 状态栏或底部提示

## 4. 测试策略

**单测（纯逻辑）**
- `itemIconKey()`：15 个 ItemId 全部有对应贴图键，且键 === id
- 若引入字阶常量，断言其满足「标题 > 正文 > 辅助」且全为整数

**E2E（浏览器，真实渲染）**
- 背包打开后，每个有物品的格子旁出现 `type === 'Image'` 且 `texture.key === 对应 ItemId`
- 制作面板：条目旁出现成品图标
- 交易面板：选项旁出现图标
- 场景：床/箱子/工作台等位置出现 `furn_*` 贴图（按 floor 断言）
- HUD：状态标签字号 ≥ 11px（读 `style.fontSize`）
- 现有 35 条 e2e 不得退化

**构建**：`npm run build` 通过，bundle 不应显著增长（贴图本是程序化生成，接入不增包体）。

## 5. 验证要求（对应用户验收标准）

1. `npm run typecheck` / `npm test` / `npm run build` / `npx playwright test` 全部实跑并记录
2. 真实浏览器分别打开背包、制作、交易、暂停，验证场景家具贴图
3. 提供**前后对比截图**（改造前截图已在 `e2e/screenshots/ghi04-*.png`）
4. 检查图标与物品映射、面板布局、点击区域、文字可读性
5. 只报告实际执行结果；失败项修复或明确记录
6. 不合并 main，不发布安装包

## 6. 明确不做（防范围蔓延）

- 不接入 6 个 tile
- 不重设计 UI 视觉体系
- 不改配色方向
- 不加新美术资源/依赖
- 不做移动端适配（v0.2 范围）
