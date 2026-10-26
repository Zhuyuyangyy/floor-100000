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

| 包 | 文件数 | 像素合规 | 覆盖 | 不用的原因 |
|---|---|---|---|---|
| `tiles-terrain/pixel-platformer-food-expansion` | 120 | ✓ | 仅食物/饮料，15 种物品中约 4-5 种 | **覆盖不全**：其余 10 种仍无图标，背包会半有图标半没有；且配色明亮甜美（亮粉/亮黄），与 `#18242C` 楼体的「末日压抑」基调冲突 |
| `ui/pixel-ui-pack` | 38 | ✓ | 像素 9-slice 面板框 + 四色方向箭头 | 与现有朴素矩形面板/文字 ▶ 标记确实匹配，且 UI 是独立表层、不影响场景美术、改动面小易回退。但**偏离审计原定的家具/物品图标目标**，需项目负责人拍板后再做 |

---

## 6. 决定与后续触发条件

**决定：本轮不引入，维持程序化占位。**

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

## 7. 本轮改动与测试状态

- 改动文件：`docs/GHI-04_ASSET_TRIAL.md`（新增）。**未引入任何素材、未建 `public/assets/`、未改业务代码、未改依赖/lockfile。**
- `git diff --stat`：空（无已跟踪文件改动）。
- 下载的预览图与样本一律放在系统临时目录并已删除，未进仓库。
- 测试状态：本轮**未运行回归测试**（未改任何业务代码）。仓库工作区与本轮开始前一致。
