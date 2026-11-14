# 资产缺口清单（GAPS · AG-07 · 2026-11-15）

"游戏需要但还没有"的美术资产，按优先级排序。测量数据来自 `docs/assets/manifest.json` 与 AUDIT.md；每项给出规格与验收口径，拿到图即可照单验收。

## P0 — 阻塞体验

### G1. 阶层 4/5/6 的专属墙（中产与商业区 / 富人特权区 / 统治核心）

- **现状**：`wallKeyFor`（src/render/corridors.ts:434）只给 tier 2/3 专属墙，tier 1/4/5/6 全部回落贫民墙 `wall.png`。阶层 4（10000–10010）、5（50000–50010）、6（100000）可玩但视觉与贫民区无法区分。
- **影响**：设计冻结的阶级梯度要求"玩家从房间看出自己在哪"（ corridors.ts 头注 ），这是该承诺目前最大的漏洞。
- **需要的产出**：3 张 1280×128 墙，16 色全部在板内、硬边无渐变，工艺同现有三张（`tools/build-env.mjs` 程序生成，或 SVG 交付后走量化）。命名 `wall-middle.png` / `wall-rich.png` / `wall-core.png`，接入 ENV_FILES + wallKeyFor 两个 case（ corridors.ts 属 AG-09）。
- **素材侧**：`素材库/…/02-场景/` 只有首章五层；10-中产与商业区 / 11-富人特权区 目录不存在，提示词也需补写（可参考 `场景生图提示词.md` 里阶层 1–3 的墙描述）。

### G2. 周禾接线（资产已就绪，缺代码落位）

- **现状**：三件套已量化过门禁并 staged 在 `public/assets/`（AUDIT.md §6），差接线。
- **需要的改动**：① `walkcycle.ts` COLORS 加 `npc_zhouhe` + WALK_CHARACTERS 加项（已发 AG-09 精确 diff）；② `metaProgress.ts` CHARACTER_NAMES/CHARACTER_UNLOCKS（ metaProgress.test.ts:123 有精确表断言要同步）；③ `MetaSelectScene.ts:34` ROSTER；④ `src/assets/characters/npc_zhouhe.png` ← 复制 `public/assets/artpack/char-zhouhe-sheet.png`；⑤ `artpack.ts` 三处（CHARACTER_KEYS/CHARACTER_FILES/PORTRAIT_FILES）。
- **验收**：`npx tsc --noEmit` 干净 + 全量 vitest 绿 + 选人界面出现周禾。

## P1 — 明显违和

### G3. 阶层 4/5 的家具差异化

- **现状**：容器 id 已全覆盖（floorTemplates 全部 24 个 id 都有贴图），但阶 4/5 的模板复用工人宿舍道具——中产商业区摆着工牌柜、出餐台、工具架。
- **需要的产出**：先出"中产商业区"6–8 张（如货架/收银台/冷藏柜/广告屏/快递柜/自动售货机），56 高、≤16 色在板内；新容器 id 需 AG-04（worldgen）在 floorTemplates 里开，双方协同。富人区（G1 之后）再出一组。

### G4. 统治核心（100000）场景资产

- **现状**：floorTemplates 无 100000 模板，该层现状不明。
- **动作**：先与 AG-04/AG-10 确认 100000 的玩法形态（Boss 房？终局？），再定美术清单。

## P2 — 统一性回炉与新特效

### G5. 通用家具 16 色回炉（9 张）

- **现状**：`furn-bed/cabinet/crate_wood/crate_metal/workbench/watertank/fusebox/shelf/counter`，1832–3239 色，是面积平均降尺的绘制产物，与 14 张工人宿舍家具（11–15 色）并排时风格断裂。
- **便宜的路径**：无需重画，原地量化即可——`node tools/quantize-sheet.mjs public/assets/artpack/furn-bed.png --out X --frame 94x56 --crop 0,0,94,56`（按各张实际尺寸）。
- **注意**：56 高小图上 16 色可能丢细节，回炉后需美术 Owner 过目；这是视觉统一项，不阻塞。

### G6. 物品图标 16 色回炉（15 张）

- **现状**：54–183 色 @16×16。同 G5 路径（`--frame 16x16 --crop 0,0,16,16`）。医疗包 183→16 色风险最高，建议逐张验收。

### G7. 其余 open 类量化（横幅/槽位/面板框/门窗/地板/标题背景）

- 色数 22–40045。HUD chrome 对色数不敏感，优先级低于 G5/G6；标题背景是允许的"绘制场景"特例，建议保持不量化。

### G8. 4 个新特效的合规版

- **现状**：v3 包的 electric_spark / lamp_flicker / metal_crate_open / valve_turn 技术合格（3–7 色在板内）但目录名即"未获美术验收"。
- **动作**：请 Owner 验收旧候选或重出；接入路径 = `public/assets/fx/<group>/<id>.{png,json}` + fx.ts FX 表加项（AG-09）。

## P3 — 内容储备

### G9. UI 界面图（标题/背包/交互/塔楼）

- `素材库/…/04-界面/` 只有提示词，无图。等 Owner 出图后按既有量化流程接入（面板框已有绿/黄两套，新界面图需先定用途再画，避免再造一套没人用的边框）。

### G10. 首章五层场景背景接入

- 素材在（每层 9×320×200 分块 + 7 类开启动画帧），但游戏走廊是程序化生成。接入前需要架构决策：整幅绘制背景替换 corridors.ts 程序化，还是仅作选人/标题用。属 AG-09 + 美术 Owner。

### G11. 后续楼层角色 ×6（石南/贺钧/梁铎/许棠/唐霁/秦真）

- 概念图在 `素材库/…/01-角色/90-后续楼层草稿/`（1024×1536 级）。到接入窗口时走 `tools/quantize-sheet.mjs`（表模式 + `--still`），并用 `tools/char-sheet-gate.mjs` 过门禁。

## 验收工具（拿到图之后）

| 工具 | 用途 |
| --- | --- |
| `node tools/quantize-sheet.mjs <in> --out <out> [--frame 64x96] [--crop X,Y,W,H] [--still N] [--feet-row 95]` | 量化门禁：二值 alpha + 16 色最近映射 + 脚底对齐；不达标拒绝写盘 |
| `node tools/char-sheet-gate.mjs <sheet.png> --allow-missing` | 角色表门禁（尺寸/alpha/板内/20 帧/脚底/尺度/漂移/边距/节奏） |
| `node tools/assets-manifest.mjs [--json docs/assets/manifest.json]` | 全量扫描；新文件必须登记分类，否则 `assetManifest.test.ts` 失败 |
| `node tools/measure.mjs <png...>` | 单文件尺寸/色数速查 |

接入任何一张图后：跑 manifest 重新生成快照 + 全量 `npx vitest run`，再提交。
