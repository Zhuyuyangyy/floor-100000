# GHI-04 — Tiddybub 素材授权核实与逐包试用结论

- 任务：GHI-04（素材授权核实 + 首个试用包选型）
- 核验日期：2026-10-26
- 来源：https://github.com/Tiddybub/2d-assets
- 范围：本轮**未引入任何素材**。只做授权核实、目录编目与选型判断；未下载素材进仓库、未改业务代码、未改依赖。
- 上游依据：`docs/OPEN_SOURCE_AUDIT.md` §3.F（"一次只试 1 个素材包，风格不符就继续用程序化占位"）。

---

## 1. 结论

**本轮不引入外部素材，维持 `src/render/pixelArt.ts` 程序化占位。**

授权本身**没有问题**（CC0 1.0，已三级核实，可商用、无需署名）——不引入的原因是**审计原定的试用目标在该仓库里没有合规匹配**，而非授权风险。

---

## 2. 授权核实（三级，均读原文而非搜索摘要）

| 层级 | 文件 | 原文要点 |
|---|---|---|
| 仓库 | `LICENSE` | "All assets in this repository are CC0 1.0 Universal (Public Domain Dedication)... including for commercial purposes, without asking permission and without attribution." |
| 素材包 | `misc/generic-items/License.txt` | "Generic Items #1 by Kenney Vleugels (Kenney.nl). License (Creative Commons Zero, CC0)... You may use these assets in personal and commercial projects. Credit would be nice but is not mandatory." |
| 素材包 | `*/SOURCE.md` | 每个包单独记录 Source / License / Tags / Genres / Files；并注明 "Removed by safety scan: N executable/script file(s)" |

- **作者**：Kenney Vleugels（kenney.nl）
- **许可证**：CC0 1.0，署名非强制（作者表示 appreciated）
- **再分发**：允许，无附加条件
- 结论：授权层面可放心使用；若将来引入，按惯例仍在 `THIRD_PARTY_NOTICES.md` 里记一笔（CC0 不要求，但是好习惯）。

---

## 3. 目录编目

`catalog.json`（仓库根，525 KB）是全量索引，字段：`id / title / genre / genres / tags / license / credit / source_page / path`。

- 素材包总数：**1101**
- 顶层分类：`characters / effects / fantasy / misc / modern-urban / nature / sci-fi / tiles-terrain / ui / vehicles`
- 其中 **CC0-1.0 且为像素画**（标题或标签含 pixel / pico-8 / 1-bit）：**36 个**

---

## 4. 为什么审计原定的目标没有匹配

审计 §3.F 拟借鉴的是「床、柜子、门、楼梯、瓶装水/食物图标」。逐条核实：

### 4.1 家具类（床/柜子/门/楼梯）→ 无像素匹配

在 1101 个包里按 `bed|cabinet|cupboard|wardrobe|closet|door|stair|locker|shelf|furniture|crate|box` 检索，CC0 命中仅 3 个，且**全是俯视/roguelike 视角**：

| 包 | 标题 | 视角问题 |
|---|---|---|
| `fantasy/roguelike-indoors` | Roguelike Indoors | 俯视 roguelike |
| `modern-urban/top-down-shooter` | Top-down Shooter | 俯视射击 |
| `ui/roguelike-rpg-pack` | Roguelike/RPG pack | 俯视 RPG UI |

本项目是**横版宿舍剖面**（`docs/05_ART_GUIDE.md`：640x360、16x16 tile、16x24 人物、横版走廊），俯视资产直接违反视角规范。

### 4.2 覆盖面最广的物品包 → 不是像素画

`misc/generic-items`（Kenney "Generic Items #1"，339 文件）是唯一能覆盖我们 15 种物品中多数的包——预览里能看到瓶子、急救包、食物、扳手/锯/锤/螺丝刀、电池等，正好对得上 `clean_water / dirty_water / ration_pack / bread / medkit / battery / scrap_metal / crowbar` 等。

但下载样本 `PNG/Colored/genericItem_color_001.png` 实测：**平滑抗锯齿的扁平矢量风**（钻头斜边发灰发软、无硬像素边缘），文件为 162x94 RGBA 的非整数尺寸。这直接违反美术指南：

> "先程序化占位：床、门、储物柜、角色、楼梯、容器用 Canvas/Graphics 绘制 **8-16 色像素图形**"
> "整数倍缩放；**禁用平滑滤镜**"

在 640x360 的像素画面里混入平滑图标，会同时破坏像素感和 16/32 模数体系。

---

## 5. 评估过但本轮不用的候选

| 包 | 文件数 | 像素合规 | 覆盖 | 结论 |
|---|---|---|---|---|
| `ui/pixel-ui-pack` | 38 | ✓ | 像素 9-slice 面板框 + 方向箭头 | **已试用并采用**——见 §6.1 |
| `tiles-terrain/pixel-platformer-food-expansion` | 120 | ✓ | 仅食物/饮料，15 种物品中约 4-5 种 | **覆盖不全**：其余 10 种仍无图标，背包会半有图标半没有；且配色明亮甜美（亮粉/亮黄），与 `#18242C` 楼体的「末日压抑」基调冲突 |


---

## 6. 决定与后续触发条件

**决定：审计原定的家具/物品图标目标本轮不引入，维持程序化占位；`ui/pixel-ui-pack` 经批准后试用并采用了面板框（见 §6.1）。**

后续值得重新启动试用的情况（满足任一）：
1. 出现**现有 UI 确实难以实现**的具体需求（如背包网格滚动、交易确认框、物品 tooltip 富文本）——按 GHI-01 的先例，先在独立分支做**单个组件**的隔离原型并测量 bundle 变化，明显更优才保留。
2. 美术交付清单（`docs/05_ART_GUIDE.md` §5）正式启动，需要统一图块尺寸/色板/图层命名时——那时应以「像素 + 指定色板」为硬门槛重新筛包。
3. `ui/pixel-ui-pack` 获项目负责人批准试用（见 §5）。

**选包时的硬门槛**（本次实测得出的经验）：
- 必须下载**样本文件**确认是硬边缘像素画，不能只看预览图或包名——`generic-items` 的预览图就看不出来。
- 必须核对原生尺寸是否为 16/32 模数；非整数尺寸（如 162x94）基本可判定为矢量导出。
- 视角必须是横版正侧视；`top-down` / `isometric` / `roguelike` 标签直接排除。
- 一次只引入一个包，引入后必须游戏内截图审查。

---

## 6.1 试用结果：`ui/pixel-ui-pack` 的面板框（已采用）

2026-10-26 当日，经项目负责人批准后试用。**面板框与箭头标记均已采用。**

**做法**：新增 `src/render/panels.ts` 的 `buildPanel()` / `createMarker()` / `placeMarker()`。5 处面板（背包/制作/暂停/对话/菜单帮助）原先的 `Graphics.fillRoundedRect + strokeRoundedRect` 换成「深色填充矩形 + licensed 像素 nine-slice 边框」，accent 按各面板原描边色对应：安全青 `#77C6A4` → green 框（背包/对话/帮助），灯光橙 `#F4B66A` → yellow 框（制作/暂停）。`▶` 文字前缀在 5 处列表（菜单/背包/制作/暂停/对话）全部换成包内 spritesheet 裁出的 16x16 像素箭头，标签随之左对齐——原先前缀还把每个标签往右推了一格。`BootScene.preload()` 加载贴图。

**过程中实测发现并修掉的三个坑**：

1. `Outline/*.png` 的名字容易误判——它的 interior 是**不透明 `#EEEEEE`**，不是透明。直接用会把浅灰底盖在深色填充上，变成「浅底 + 米白字」，对比度崩掉。已把 interior 精确抹成透明（只清除 `238,238,238` 像素，边框与圆角原样保留），深色填充这才透上来。CC0 允许修改，已在 `THIRD_PARTY_NOTICES.md` 记录。
2. 4 个 marker 精灵若不在建成时隐藏、也不加进面板对象数组，就会有 3 个停在 `(0,0)` 一直可见——屏幕左上角挂着一排箭头。e2e 查找 marker 也必须过滤 `visible`，否则会命中隐藏的那个。
3. **顺带修掉一个比本轮主题更严重的真 bug**：`重新开始` 时暂停菜单还开着，而 `pauseOpen` / `inventoryOpen` 等 UI 状态字段**不随场景重启重置**，`update()` 于是一直 early-return——重启后的游戏完全冻住，背包和暂停菜单都打不开，且无任何报错。同类的还有 `invSlotTexts` / `craftEntryTexts` / `dialogueOptions` / `pauseObjects` / `floorObjects` / `invObjects` 等**只在 builder 里 push、从不在 `create()` 重置**的数组（含我改动 `helpObjects` 时自己引入的一处回归）。已在 `create()` 开头统一重置，并有 e2e 守卫。

**截图审查结论（通过）**：背包为深色底 + 清晰硬边缘像素边框 + 圆角，箭头标记在选中行左侧、标签左对齐，文字对比度良好；相比原先抗锯齿的 `strokeRoundedRect` 与带前缀的文本游标是明确提升。

回归：`npm run typecheck` 无错误；`npm test` **152 passed**；`npx playwright test` **35 passed**（30→35）；`npm run build` 通过，贴图正确产出到 `dist/assets/ui/`。

## 7. 本轮改动与测试状态

- **第一轮（授权核实，只读）**：仅新增 `docs/GHI-04_ASSET_TRIAL.md`。未引入素材、未建 `public/`、未改业务代码与依赖，未跑回归。
- **第二轮（面板框 + 箭头试用）**：新增 `public/assets/ui/{panel-green,panel-yellow,marker}.png`、`src/render/panels.ts`、`THIRD_PARTY_NOTICES.md`；改 `BootScene`、`GameScene`、`MenuScene` 及 `e2e/{ui,npc,crafting}.spec.ts`。
- 下载的预览图与样本一律放系统临时目录并已删除，未把整个素材包入库。
- 回归（第二轮实跑）：`npm run typecheck` 无错误；`npm test` **152 passed**；`npx playwright test` **35 passed**；`npm run build` 通过，贴图正确产出到 `dist/assets/ui/`。
