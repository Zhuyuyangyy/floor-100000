# 资产对账审计（AG-07 · 2026-11-15）

对账三方：`public/assets/**` 磁盘实况、`src/render/artpack.ts`（+ `fx.ts` / `BootScene.ts`）的映射表、以及本地各资产包与 `素材库/` 的候选素材。

机器可查的版本是 `docs/assets/manifest.json`（由 `tools/assets-manifest.mjs` 生成，`src/tests/assetManifest.test.ts` 守着）。本文是给人看的结论。

## 0. 摘要

- 磁盘 119 个文件（102 PNG + 14 特效 JSON + 2 字体 + 1 许可），全部有归属分类，无孤儿文件、无断链引用。（**AG-19 补审后为 123 个**：+4 张角色行动表，见 §9。）
- **表二（已映射未接入）为空**：映射表里的每个文件都在磁盘上，`furniture.test.ts` 与 manifest 双重把关。
- **本次新接入 3 个文件**（周禾三件套，量化后 11–12 色全在板内），因接线落在非属权文件而标注为 staged——详见 §6 与 §7。
- **门禁现状分裂**：墙（3）、工人宿舍家具（14）、头像（5）、行走表（4）、周禾三件套（3）过了 16 色门禁；通用家具（9）、物品图标（15）、横幅、槽位、面板框、门窗、地板、标题背景、特效图集（15）没过——它们是面积平均降尺/外部绘制产物，色数 22–40045。这是既有状态，不是本次引入，回炉与否见 GAPS.md P2。
- 阶级 4/5/6 的墙缺失是当前最大的美术缺口（`wallKeyFor` 回落贫民墙），素材库里连提示词目录都没有。

## 1. 范围与方法

| 对账方 | 来源 |
| --- | --- |
| 磁盘实况 | `public/assets/**`（manifest 全量扫描：尺寸/通道/色数/板内/引用） |
| 映射表 | `src/render/artpack.ts`（ITEM_ICON_FILES / FURNITURE_FILES / CHARACTER_FILES / PORTRAIT_FILES / ENV_FILES）、`src/render/fx.ts`（FX 15 项）、`src/scenes/BootScene.ts`（字面量加载 20 项） |
| 候选素材 | `F:/new/*.zip`（v3_all_assets / final_character_gifs_v1 / character_runtime_v5_2 / v4_staging / individual_art_candidates_v01 / floor_wall_assets_2026-11-14，解压件在 `D:/ZYY_Inovation/game/tmp/`）、`素材库/`（553 个文件） |

任务点名的三个 zip：`floor100000_v3_all_assets.zip` 与 `floor100000_final_character_gifs_v1.zip` 在 `F:/new` 找到（且已有解压件）；**`floor100000_character_gifs_only_v1.zip` 在 F:/new 与工作区都不存在**（全盘搜索仅命中 final_character_gifs_v1.zip），如其后出现再行对账。

色板口径：`src/render/palette.ts` 的 16 色（manifest 与 `char-sheet-gate.mjs` 均从该文件解析，不复制 hex）。

## 2. 表一：已接入（磁盘有文件且被代码引用）

按 manifest 分类，共 101 个被引用文件（locked 21 + open 80）：

| 组 | 数量 | 文件/键 | 门禁 |
| --- | ---: | --- | --- |
| 阶层墙 ×3 | 3 | `env/wall.png`（贫民）/ `wall-dorm.png`（工人）/ `wall-industry.png`（工业），1280×128 | ✅ 14–15 色在板内 |
| 地板/门/窗 | 3 | `env/floor.png` 1280×64、`tile-door.png` 44×104、`tile-window.png` 56×76 | ❌ 22–117 色 |
| 工人宿舍家具 | 14 | `furn-badge_rack` … `furn-worker_locker`，高 56 | ✅ 11–15 色在板内 |
| 通用家具 | 9 | `furn-bed` / `cabinet` / `crate_wood` / `crate_metal` / `workbench` / `watertank` / `fusebox` / `shelf` / `counter`，高 56 | ❌ 1832–3239 色 |
| 物品图标 | 15 | `item-*.png`，16×16，覆盖全部 ItemId | ❌ 54–183 色 |
| 角色正面静帧 | 4 | `char-player/alin/xiaozhou/wanderer.png`，64×96（CHARACTER_FILES；只被加载，不参与绘制） | ❌ 22 色 |
| 对话头像 | 4 | `ui/portraits/portrait-*.png`，96×96 | ✅ 5–13 色在板内 |
| UI 面板框 | 16 | `ui/frame-{green,yellow}-{8 片}` | ❌ 117–399 色 |
| UI 控件 | 2 | `ui/slot.png` 22×22、`ui/marker.png` 16×16 | ❌ 3 / 234 色 |
| 横幅 | 2 | `artpack/banner-win/lose.png` | ❌ ~10.4k 色 |
| 标题背景 | 1 | `title/dorm-corridor-2x.png` 1280×720（调色板型 PNG） | ❌ 256 色 |
| 特效图集 + JSON | 28 | `fx/**/<id>.{png,json}` ×14（FX 表），图集 320×256–2592×2288 | ❌ 1150–40045 色 |
| 字体 + 许可 | 3 | `fonts/ark-pixel-{latin,zh_hans}.woff2` + `OFL.txt` | — （aux） |
| 特效接触表 | 12 | `fx/**/contact.png`（审阅用，无代码引用） | — （aux） |
| 行走/行动表 ×4 | 4 | `src/assets/characters/{player,npc_alin,npc_xiaozhou,wanderer}.png`，1280×96 二十帧（BootScene glob，超出 manifest 扫描范围） | ✅ 4–12 色在板内 |

行走表出处（git 追溯）：player / npc_alin / npc_xiaozhou 来自 `floor100000_character_runtime_v5_2.zip`（提交 4661cdf；逐帧比对 player 首帧与包内 `frames/player/frame_00.png` 色彩分布一致）；wanderer 来自 v3 drop（提交 973273c，v5.2 那笔刻意没动它）。

## 3. 表二：已映射未接入（映射表有条目、磁盘缺文件）

**空。** 映射表 52 个 artpack 条目 + 14 个 FX 条目 + 20 个 BootScene 字面量全部有对应文件。保持为空的机制：

- `src/tests/furniture.test.ts`：每个 FURNITURE_FILES / ENV_FILES 条目断言存在且是 PNG；
- manifest 的 `missingRefs` 检查 + `assetManifest.test.ts` 的快照比对。

## 4. 表三：有素材未映射（素材在本地，未进游戏）

| 素材 | 位置 | 测量 | 为什么没接 |
| --- | --- | --- | --- |
| 周禾三件套 | `素材库/…/04-周禾/` | 表 1280×96 13526 色 → 量化后 12 色；头像源 54795 色 → 12 色 | 资产已就绪并过门禁，但 `CHARACTER_KEYS` 加键会连锁 `walkcycle.ts` 的 `COLORS` 记录（tsc 实证 3 处报错），接线属 AG-09/team-lead。见 §6 |
| v3 包 02 文件夹（15 图标 + 14 道具 + 20 面板 + 7 瓦片 + 5 场景 + 6 特效） | `tmp/floor100000_v3_all_assets/…/02_静态旧版候选_未获美术验收/` | 图标 32×32 ~5 色；道具 96×96 ~8 色；面板 16×16 3 色；场景 640×360 6 色；特效表 128×32–192×48 3–7 色——**全部在板内** | 目录名即答案：未获美术验收。且大多已被批准版取代（图标/道具有 F:/new/sliced 来源的批准版）。技术质量合格 ≠ 可接入 |
| individual_art_candidates_v01 的 16 色变体 | `tmp/floor100000_individual_art_candidates_v01/pixel_palette_16c/` | items 101×84 10 色；characters 136×233 13 色 | manifest 自述 `concept_candidate_not_runtime_ready`，"16-color variant is for visual QA, not automatic final art" |
| final_gifs_v1 / v4_staging | `tmp/_gifs`、`tmp/_art` | 188×348 级原画帧、17631 色 | 是已发布行走表的上游原画，已被消费；v4 目录名 `NOT_FOR_RELEASE` |
| floor_wall_assets_2026-11-14 | `F:/new/floor_wall_assets_2026-11-14.zip` | 3 张阶层墙 SVG+PNG | **已经接入**：即当前 `env/wall*.png`（提交 ad04f7e） |
| 首章五层场景块与动画 | `素材库/…/02-场景/01–05-第N层/` | 每层 9×320×200 分块背景；7 类开启动画透明帧 + JSON 参数 | 游戏走廊是程序化生成（corridors.ts），接入整幅绘制背景是渲染架构决策，属 AG-09；且需美术 Owner 验收 |
| 巡游体候选表 | `素材库/…/01-角色/11-巡游体/` | 1280×96 二十帧（另一个 wanderer 版本） | 游戏已用 v3 drop 版；替换需美术 Owner 定 |
| 后续楼层角色草稿 ×6 | `素材库/…/01-角色/90-后续楼层草稿/` | 1024×1536 级概念图 | 后续内容，未到接入窗口 |
| HUD 切片 | `F:/new/sliced/hud/hud-*.png` | — | 游戏 HUD 是程序化的；slot 来自 hud-27，其余无用 |

## 5. 表四：完全缺失（游戏需要，但没有素材）

| 缺口 | 现状 | 优先级 |
| --- | --- | --- |
| 阶层 4/5/6 的墙（中产与商业区 / 富人特权区 / 统治核心） | `wallKeyFor` 只有 tier 2/3 有专属墙，其余回落贫民墙（corridors.ts:434）；素材库 `02-场景/` 只有首章五层，连 10-中产与商业区 / 11-富人特权区 的提示词目录都不存在 | **P0** |
| 周禾接线（不是图，是线路） | 资产就绪；缺 walkcycle.ts COLORS + WALK_CHARACTERS、metaProgress NAMES/UNLOCKS、MetaSelectScene ROSTER、`src/assets/characters/npc_zhouhe.png` 落位 | **P0** |
| 阶层 4/5 家具差异化 | 容器 id 已全覆盖（floorTemplates 全部 24 个 id 均有贴图，阶 4/5 复用工人宿舍道具）——缺的不是覆盖，是"中产商业区摆着工牌柜"的违和感 | P1 |
| 4 个新特效的合规版 | v3 包里的 electric_spark / lamp_flicker / metal_crate_open / valve_turn 是未获验收旧候选；接入还需 fx.ts（AG-09） | P2 |
| 通用家具/图标/横幅等的 16 色回炉 | 9 家具 + 15 图标 + 横幅/槽位/面板框/门窗/地板/标题背景未过门禁（§7） | P2 |
| UI 界面图（标题/背包/交互/塔楼） | `素材库/…/04-界面/` 只有提示词，无图 | P3 |
| 首章五层场景背景接入 | 素材在（§4），缺架构决策与验收 | P3 |

## 6. 本次接入的资产（量化前后测量）

接入走 `tools/quantize-sheet.mjs`：二值 alpha（≥128）→ 16 色最近映射（luma 加权）→ 脚底对齐（整体下移，不缩放）。门禁不达标拒绝写盘。周禾源图自带干净 alpha，**不需要洋红抠图**那一步。

| 文件 | 源 | 量化前 | 量化后 | 脚底行 |
| --- | --- | --- | --- | --- |
| `public/assets/artpack/char-zhouhe-sheet.png` | `素材库/…/04-周禾/游戏导入候选/zhouhe.png` | 1280×96，13526 色，抗锯齿 | 1280×96 二十帧，**12 色全部在板内**，半透明像素 0 | 每帧 95（源统一收在 87，整体下移 8） |
| `public/assets/artpack/char-zhouhe.png` | 同上（--still 0） | — | 64×96，**11 色在板内** | 95 |
| `public/assets/ui/portraits/portrait-zhouhe.png` | `素材库/…/04-周禾/视角/周禾-正面.png` 裁 301,20,420,420 | 1024×1536，54795 色 | 96×96，**12 色在板内** | — （头像无脚） |

额外验证：`node tools/char-sheet-gate.mjs public/assets/artpack/char-zhouhe-sheet.png --allow-missing` 全项 PASS（尺寸/二值 alpha/板内/20 帧/脚底 spread 0/行走尺度 heights 75–76、heads 20–23/漂移 0.5px/边距/节奏 0.83）。

**为什么标注 staged 而不是直接进 `CHARACTER_FILES`**：实证给 `CHARACTER_KEYS` 加 `npc_zhouhe` 后 `tsc --noEmit` 恰好 3 个错——artpack.ts 两处（我能补）和 `walkcycle.ts:1030` 的 `COLORS: Record<CharacterKey, CharacterColors>`（非我属权）。已给 AG-09 发去精确 diff（COLORS 加一项 + WALK_CHARACTERS 加一项）；合并时连同 `metaProgress.ts`、`MetaSelectScene.ts` 的 ROSTER、`src/assets/characters/npc_zhouhe.png`（直接复制 sheet 文件）一起落位即可。本次不编造占位图、不改非属权文件、分支保持全绿。

体型备注：周禾行走帧墨迹 24×76，玩家 45×89——她比玩家瘦，这是素材原样比例，未做拉伸放大；如需统一比例请美术 Owner 定。

## 7. 16 色门禁现状（谁过了，谁没有）

过了（locked/staged，共 24 个文件）：3 墙、14 工人宿舍家具、5 头像、周禾三件套；加上扫描范围外的 4 张行走表。

没过（open，共 80 个引用文件 = 66 PNG + 14 JSON）：9 通用家具（1832–3239 色）、15 图标（54–183）、横幅（~10.4k）、槽位（234）、面板框（117–399）、地板（117）、门窗（各 22）、char-* 静帧（各 22）、标题背景（256）、14 特效图集（1150–40045）。

即" approved 的绘制资产普遍未过门禁，未验收的旧候选反而全在板内"。manifest 对每个文件记录实测色数与板内判定，回炉优先级见 GAPS.md P2。

## 8. Manifest

- 工具：`tools/assets-manifest.mjs`（`--json <path>` 出机器版；退出码非零=有未分类/门禁失败/断链）。
- 快照：`docs/assets/manifest.json`（119 文件全量实测）。
- 测试：`src/tests/assetManifest.test.ts`（10 项：扫描干净、门禁、无断链、引用表与 TS 模块一致、快照比对、周禾三件套几何与门禁）。
- 分类口径：`locked`（门禁适用）/ `staged`（已过门禁待接线）/ `open`（既有未量化，记录不门禁）/ `aux`（字体/许可/接触表）。新文件必须显式登记，否则测试失败——这是"资产不能静默落地"的机制。

## 9. AG-19 补审：F:/new 漏盘的六个包（2026-11-15）

AG-07 的审计范围漏了四个包（`四角色动作GIF预览包_v3_重新提取清晰版` / `末日宿舍_HUD_UI分件包` / `AI_baye_first_10_assets` / `AI_Baye_Visual_Assets_v1`），用户明确指出"美术啥的都没改上去"之后由 AG-19 补审并接入。色板与门禁口径同 §1；六个包全部解压核对过（`D:/ZYY_Inovation/game/tmp/ag19-extract/`）。

### 9.1 表五：本次接入（量化前后测量）

接入走 `tools/quantize-sheet.mjs`（二值 alpha ≥128 → 16 色最近映射 → 脚底对齐 95 行，门禁不达标拒绝写盘）；四张行动表另过 `tools/char-sheet-gate.mjs` 全项。源图本身就在板内（15/15/15/5 色），量化接近恒等，真正做掉的是 256 级抗锯齿 alpha → 二值。

| 文件 | 源（F:/new 包内路径） | 量化前 | 量化后 | 门禁 |
| --- | --- | --- | --- | --- |
| `public/assets/artpack/char-player-sheet.png` | 四角色动作GIF预览包_v3_重新提取清晰版/`player_sprite_sheet_1280x96.png` | 1280×96，**15 色全在板内**，抗锯齿半透明 alpha（256 级，65,553 px） | 1280×96 二十帧，**15 色在板内**，二值 alpha，脚底 95 行 spread 0 | ✅ char-sheet-gate 全项 PASS |
| `public/assets/artpack/char-alin-sheet.png` | 同上/`alin_sprite_sheet_1280x96.png` | 1280×96，15 色在板内，半透明 alpha | 1280×96 二十帧，**13 色在板内**，二值 alpha，脚底 spread 0 | ✅ PASS |
| `public/assets/artpack/char-xiaozhou-sheet.png` | 同上/`xiaozhou_sprite_sheet_1280x96.png` | 1280×96，15 色在板内，半透明 alpha | 1280×96 二十帧，**14 色在板内**，二值 alpha，脚底 spread 0 | ✅ PASS |
| `public/assets/artpack/char-wanderer-sheet.png` | 同上/`wanderer_sprite_sheet_1280x96.png` | 1280×96，5 色在板内，半透明 alpha | 1280×96 二十帧，**4 色在板内**，二值 alpha，脚底 spread 0 | ✅ PASS |
| `public/assets/artpack/char-player.png` 等 4 张静帧 | 同批行动表 `--still 6`（待机首帧） | 原为 build-characters.mjs 的 22 色程序化产物（不在板内） | 64×96，**4–15 色在板内**，二值 alpha | ✅ 量化门禁 |

char-sheet-gate 实测（`node tools/char-sheet-gate.mjs`，含与现役程序化表对比）：

- 尺寸/alpha/板内/20 帧全绘制：四表全过；
- 脚底基线 spread **0px**（行走+待机 8 帧全部 95 行），与现役表基线差 **0px**——零跳动交接；
- 行走尺度 heights spread 1–3px、头部宽度 spread 3–5px（阈值 3/6），轮廓中心漂移 **0.5px**（阈值 4）；
- 行走边距全部在 1..62 内，节奏最大帧间重叠 0.85–0.93（阈值 0.98）；
- **8–19 帧 vs 现役程序化姿态：平均轮廓重叠 0.58–0.80，仅 0–1/12 命中旧姿态**——即攻击/受击/搜索/倒地/拾取是全新绘制，不是旧姿重绘（compareToLegacy 的存在意义就是这个）。

帧序与 `walkcycle.ts` 契约逐段对齐（包内 manifest.json 声明 + 检查图目检）：走 0-5、待 6-7、攻 8-10、受 11-12、搜 13-14、倒 15-17、拾 18-19。四角色身份与 walkcycle 四套配色一一对应（青帽幸存者 / 灰胡胖工装 / 黑发小孩 / 黑暗兜帽幽灵），面朝左，场景以 `setFlipX` 翻转，朝向无碍。

### 9.2 为什么是 staged 而不是直接覆盖运行时文件

运行时落位 = `src/assets/characters/<who>.png`（BootScene glob  eager 加载，`bakeWalkSheets()` 对已存在 key 跳过——README 明言"放进去即替换，无需代码改动"）。这是**纯粹的 4 个文件复制**，但属渲染线属权，故表以 staged 形态驻留 artpack，等 AG-09/team-lead 执行：

```
cp public/assets/artpack/char-player-sheet.png    src/assets/characters/player.png
cp public/assets/artpack/char-alin-sheet.png      src/assets/characters/npc_alin.png
cp public/assets/artpack/char-xiaozhou-sheet.png  src/assets/characters/npc_xiaozhou.png
cp public/assets/artpack/char-wanderer-sheet.png  src/assets/characters/wanderer.png
```

`walkcycle.ts` / `hudLayout.ts` / `GameScene.ts` **一行都不用改**。静帧已经 `CHARACTER_FILES` 接线（BootScene 加载），故直接 locked 入列。

### 9.3 表六：未接入及原因（按包）

| 包 | 结论 | 原因（测量数据） |
| --- | --- | --- |
| `末日宿舍_HUD_UI分件包.zip` | **不接**（仅作美术方向参考） | 完整预览 1656×247、**67,499 色**平滑渲染、**RGB 无透明通道**、数值与中文**烤死在图上**；组件切片 1568×156 级、1.2 万–3.9 万色。包自带 README 声明"尚不是透明九宫格/可拉伸运行时皮肤"。游戏 HUD 是代码绘制（`GameScene.ts:2446` 起 + `hudLayout.ts` 常量，1280×64 顶栏 + 124 上下文带），动态数值无处覆盖。量化到 16 色会同时毁掉烤死文字与金属渐变。可用交付物规格见 GAPS.md G12 |
| `AI_baye_first_10_assets.zip` | **不接** | 《AI霸业》（AI 公司模拟）的地面/河流/桥/灯，1024–1536px、3,067–6,914 色、半透明边缘。题材、风格、尺度、色板全部不符，与本游戏无交集 |
| `AI_Baye_Visual_Assets_v1.zip` | **不接** | 同上，另一款游戏的设施缩略图（20 张 156×138）/图标（12 张 128×142）/地形（6 张），6,072–16,822 色，README 自述"原型视觉验证，不是最终生产级 sprite" |
| `floor100000_v3_all_assets.zip`（01 文件夹） | **不接（被本次接入取代）** | 同源旧提取（V2 家族）：试验表 216–234 色不在板内，且只有 6/8/12 帧未凑齐 20 帧契约；v3 重提取清晰版修正了调色板距离计算（int32 防平方溢出）与缩放（最近邻），其产出即本次接入的四张表 |
| `floor100000_v3_all_assets.zip`（02/03 文件夹 + README/preview） | **不接** | AG-07 §4 表三已记录：02 是"未获美术验收"的静态旧版（技术合格 ≠ 可接入），03 是元数据 |
| `floor100000_final_character_gifs_v1.zip` | **不接（上游已被消费）** | `runtime_trial_sheets/` 216–234 色不在板内，其 README/QA_REPORT 明言"仍不能直接替换项目文件"；14 帧动作源图是 1916×821 原画（连通域提取到 256×256 画布），其合格下游就是本次接入的 v3 重提取版。walk/run GIF 的帧率节奏（走 360ms 循环 6 帧等）只属预览 |

### 9.4 manifest 数字变化

磁盘 119 → **123** 文件（+4 表）；locked 21 → **25**（4 静帧入列）；staged 3 → **7**（+4 表）；open 80 → **76**（4 静帧移出）；unclassified / gateFailures / missingRefs 均为 **0**。测试 1173 → **1176**（`assetManifest.test.ts` +3 断言：四表 staged 几何与门禁、四静帧 locked 门禁）。
