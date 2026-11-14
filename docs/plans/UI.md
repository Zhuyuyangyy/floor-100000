# UI/UX 面板体检与修复（AG-08）

**日期**：2026-11-15
**范围**：背包 / 制作 / 交易（对话）/ 塔楼总览 / 暂停 / 标题 / 角色选择 / 结算 / HUD / 容器名签
**状态**：已实现并验证（tsc 干净，vitest 60 文件 / 856 测试全绿，Playwright 实测修前/修后）

## 方法

每个面板用 Playwright 打开后遍历场景显示列表，对每个可见对象取 `getBounds()`（设计画布
1280x720 坐标，`Scale.FIT` 信箱缩放不改变画布坐标），找出**出框**、**被裁切**、**文本互压**
三类问题。响应式由此自动成立：所有 UI 都在画布坐标里且不出框，任何窗口尺寸下都不出框
（实测 900x600 / 1280x800 / 1920x1080 三视口，画布完整可见、无滚动条）。

布局断言不靠截图：`src/tests/uiLayout.test.ts`（16 个测试）用
`estimateTextWidth` / `wrapText` 对几何常量做算术断言，派生集合防漂移。

## 体检表（修前实测，单位 px，画布 1280x720）

| # | 面板 | 问题 | 修前实测 | 严重度 |
|---|------|------|----------|--------|
| 1 | 塔楼总览 | 「终点 第100000层」标签右边缘出框 | @(1180,31) 169x25 → right=**1349**（出 69px） | 硬伤 |
| 2 | 塔楼总览 | 「起点 第1层」标签右边缘出框 | right=**1294**（出 14px） | 硬伤 |
| 3 | 塔楼总览（三级） | 底部提示条底部被裁切 | 26px 字+6px padding = 33px 高，@(12,698) → bottom=**731**（出 11px） | 硬伤 |
| 4 | 塔楼总览（区段/楼层） | 图例底部被裁切 | bottom=**721**（出 1px） | 硬伤 |
| 5 | 塔楼总览 | 图例色块与标签错位 ~150px | `label.length * TYPE_AUX * 0.5` 把汉字算成半宽，「当前」估 22 实绘 44 | 观感 |
| 6 | 塔楼总览 | 标题与状态行互压 21px | 标题 32px @(12,8) 348x39 → 8..47；状态 22px @(12,26) → 26..53 | 观感 |
| 7 | 塔楼楼层详情 | 5 行文本行距 20px < 字高 27px，逐行互压 7px | 行 @325/345/365/385/405，重叠 7px/行 | 硬伤 |
| 8 | 塔楼楼层详情 | 动作行压第 5 行 | 「按 Enter 进入」@(556,416) x「储物柜：净水」@(436,405) = **36x16px** | 硬伤 |
| 9 | 塔楼楼层详情 | 内容行不换行，最坏出框 ~680px | `describeFloorContents` 最坏 1113px（seed 42/7/2026，floor 50008）对 434px 内宽 | 硬伤 |
| 10 | 塔楼总览 | 无 boss 标记（真缺口） | 遭遇表可滚 boss 的 {5, 110, 50010} 在地图上无任何表示 | 缺失 |
| 11 | 对话面板 | well 写死 72px（两行），AI 开场白（上限 60 字 = 5 行 = 151px）溢出到选项行 | 60 字台词居中于 72px well → 文本上下各溢出 ~40px，压第一行选项 | 硬伤 |
| 12 | 容器名签 | 标签贴在结构带上、底部压道具顶 4px，且玩家贴近时压在角色身上 | plate @(120,53) 80x30 → 53..83；玩家 @(608,64) 64x96 → 64..160；同 x 时重叠 19px | 硬伤+观感 |
| 12b | 容器名签（像素级） | HUD 上下文档（y64..124, depth 100, alpha 0.94）吞掉 depth<100 的世界标签：旧位置只有顶部一截可见；床/工作台标签（depth 0）完全不可见 | 像素采样：旧 储物柜 plate 区 max lum=192（顶部一截在），旧 床（睡觉）区 max lum=**33**（全平，无文字像素） | 硬伤（新发现） |
| 13 | 角色选择 | 风味文本横跨全面板，压右侧遗物列 | 文本 @(460,465) 360x19 → right=820；遗物列 x≥743，与「◇ 第 5 层」重叠 **77x16px** | 观感 |
| 14 | 背包 / 制作 / 暂停 / 标题 / 帮助 / 结算 / HUD | — | 实测无出框、无互压 | 干净 |

## 修复（修后实测）

| # | 修复 | 修后实测 |
|---|------|----------|
| 1-2 | 塔楼条从 1060 收窄到 970（`TOWER_STRIP_W`，右留 200 标签边），标签走 `TOWER_TAG_X` | 终点 right=**1259**、起点 right=**1204**（画布内，分别余 21/76px） |
| 3-4 | 底部带统一到 `TOWER_FOOT_TOP=36`（距画布底），提示/图例/瞬态消息同带 | 提示 bottom=**717**、图例 bottom=**707**（720 内） |
| 5 | 图例色块按 `estimateTextWidth` 镜像连接串布局（汉字 1em，估算即精确） | 色块与各自标签对齐（截图确认） |
| 6 | 状态行移到顶部中央 `(640,50)`：让开标题（8..47）、区段标签列（x≤96）、终点标签与缩放读数 | 状态 @(497,50) → 50..77，与标题相距 3px，与任何对象零重叠 |
| 7-8 | 详情卡重排：行距 20→30，动作行跟随内容块底部，卡片随内容行数长高 | 行 @288/318/348/378/408（30px 距），互压 **0**；动作行 @450..477，与内容行（..435）相距 15px |
| 9 | 内容行开 `useAdvancedWrap`（中文无空格，不开不断行），宽 `DETAIL_CONTENT_W=418`，卡高按 `wrapText` 行数推导 | 最坏 1113px → 3 行；卡高 178→269（1 行）/317（3 行），仍在内容带（660）内 |
| 10 | boss 标记三级体系：总览左缘红脊（8px）+ 1px 尘线挑出；区段网格 boss 单元格 2px 红圈；图例追加「守段者层」 | 红脊/红圈截图确认；图例 5 项（含守段者层）色块对齐 |
| 11 | `dialogueGeometry(message, fontSize)`：well 高、行顶、板高全部由行数推导，取 max 保持原版式；GameScene 只重排不重建（皮肤/header/well/四行/footer 引用化） | 2 行台词：well 324x72、板 460x300（**与修前一致**）；60 字台词：well 324x**151**、消息 288x125 完全在 well 内、首行选项 @377（well 底 369 之下 8px）、板高 **345**，底部离 HUD 脚栏 275px |
| 12 | 名签锚点从「道具顶-8」改为「道具基-36」（`CONTAINER_LABEL_DROP`）：落在道具正面、与楼梯标签同带（y=96）；同时 depth 9/10 → **105/106**（新位置整个落在 HUD 上下文档 64..124 里，depth<100 会被 0.94  alpha 的带吞掉——像素采样实测旧位置就只有顶部一截可见）；玩家进入 `INTERACT_DISTANCE+24px` 距离比例渐隐 | 名签 @(127,**85**) → 85..108（修前 57..80）；像素采样新 plate 区 max lum=**192**（文字在）；贴近容器时 alpha=**0.00**（修前 1.00 压角色），远离 alpha=1.00 |
| 13 | 风味文本移到胸像下方 108px 宽包裹列（`useAdvancedWrap`），4 行 80px 高 | 文本 @(413,386) 108x76 → right=521，距遗物列（743）**222px**，零重叠 |
| 14 | — | 干净，未动 |

## 对话面板自适应怎么做

- 几何全在 `render/dialogueLayout.ts`（纯函数，无 Phaser）：`dialogueWellHeight` =
  `wrapText` 行数 × `estimateLineHeight` + well padding，下限两行；
  `dialogueGeometry` 再推导 `rowsTop`（≥ well 底 + 8px 间隙）与 `panelH`
  （≥ 行底 + 40px 脚栏带），每步都是对基准版式取 max——短句保持 460x300 原样。
- 60 字最坏值按 `ai/rulesExecutor.MAX_UTTERANCE` 设计：5 行 × 27 + 16 = 151px well、
  189 行顶、345 板高；板顶随长高上移，header 条/胸像/名签随顶边走，well 描边重绘。
- `GameScene` 只改 `buildDialoguePanel`（存引用）与 `refreshDialogue`（按 geometry
  重排），未碰任何楼梯/相机/输入/电梯代码（team-lead 划定的硬边界）。

## 容器名签为什么选渐隐

标签带横跨玩家头肩（玩家 64..160），而玩家就站在容器 x 上——**任何静止位置都躲不开角色**
（实测同 x 时重叠 19px、全宽）。底栏在玩家进入交互距离时正好显示「按 E 打开 储物柜」，
名字在可操作的那一刻由底栏承载，名签渐隐不丢信息；距离比例（24px 过渡）而非硬切，
走过不弹跳。监听器按楼次注册、模块级 WeakMap 保证全局只有一个，不随楼层切换叠栈。

## boss 标记的防漂移

`BOSS_FLOOR_NUMBERS` 通过 `encounterSpots(0, floor).some(s => s.isBoss)` 读取——
即遭遇表标记逻辑自己的公开 API，不在场景里复制 `ENCOUNTER_TABLE` 过滤表达式。
`uiLayout.test.ts` 断言派生集合 == [5, 110, 50010] 且与表一致，表改了地图自动跟随。
（注：`systems/encounterSpots.ts` 当前未导出 `bossFloors` 符号，只有内部
`BOSS_SPOT_FLOORS` 与 `bossSpotId`；若遭遇线补导出，场景可一行切换。）

## 改动文件

- `src/render/dialogueLayout.ts`：`dialogueWellHeight` / `dialogueGeometry` /
  `DIALOG_ROW_COUNT` / `DIALOG_WELL_ROW_GAP` / `DIALOG_FOOTER_H`。
- `src/render/hudLayout.ts`：塔楼总览车道（`TOWER_STRIP_X/W`、`TOWER_TAG_X`、
  `TOWER_FOOT_TOP`）、楼层详情卡几何（`DETAIL_*`）、`CONTAINER_LABEL_DROP`。
- `src/render/panels.ts`：导出 `PANEL_SLICE` / `PANEL_FILL_BANDS` / `PANEL_FRAME_PIECES`。
- `src/render/uiKit.ts`：导出 `PANEL_HEADER_H`。
- `src/scenes/TowerOverviewScene.ts`：车道/端点标签/底部带/图例/HUD 状态行/详情卡自适应/
  boss 脊与红圈。
- `src/scenes/GameScene.ts`：`buildDialoguePanel` + `refreshDialogue`（自适应）、
  `buildContainers`（名签位置 + 渐隐）——仅此三处，lead 批准范围。
- `src/scenes/MetaSelectScene.ts`：风味文本移至胸像下方包裹列。
- `src/tests/uiLayout.test.ts`（新）：16 个布局断言。

## 未处理干净 / 已知限制

1. **塔楼总览右上角**：缩放读数（12..43）与终点标签（31..56）本就有 88x12px 重叠
   （修前就有，非本轮引入）。本轮把状态行让到顶部中央已避开加剧；彻底解决需要动
   缩放读数的位置或终点标签的 y，属于另一处权衡，留待下轮。
2. **床标签「床（睡觉）」**（`drawBed`）与工作台招牌（楼层道具）在 depth 0，位于 HUD 上下文档（64..124, depth 100, alpha 0.94）之内——像素采样实测**完全不可见**（区域 max lum=33，无文字像素；修前旧截图同样 33，属存量缺陷，非本轮引入）。本轮按 lead 划定只改容器名签一处，未动；建议下轮把这两个提到 depth 105 同线。
3. **NPC 名签**（`drawNpcs`，y=FLOOR_HEIGHT-68=132）贴在楼板上沿，玩家贴近同样压角色；同为划定范围外，未动。
4. **GameScene 的世界装饰出框**（邻居楼层窗户/墙画，depth 24）是有意的跨层可视，非缺陷。
5. **对话 60 字最坏值**：Playwright 用注入 `dialogue.message` 实测过几何；真实 AI 路径
   （`VITE_NPC_MODEL`）未开，降级脑只产两句以内的 authored 台词。
6. **探针残留**：`e2e/_ag08_probe.spec.ts`、`_ag08.config.ts`、`.ag08tmp/` 为临时测量工具，
   提交前删除；测量 JSON/截图在 gitignore 的 `e2e/screenshots/` 下可留作证据。
