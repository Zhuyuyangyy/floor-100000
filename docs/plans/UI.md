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

---

# AG-12：任务面板（QuestPanelScene）与塔楼详情卡第二数据源（2026-11-15）

## 任务面板 QuestPanelScene

- 场景 key `'QuestPanel'`，在 `main.ts` 用 `game.scene.add('QuestPanel', QuestPanelScene)`
  注册（autoStart false，不动 `core/gameConfig` 的启动清单——那是共享启动契约）。
- 布局 940x480 绿色面板（`buildPanel` + `buildPanelHeader` + `buildListRow`，全是既有
  UI 契约，未重造）：左栏任务列表（标题 + 「阶层N · 状态」），右栏详情（标题 /
  阶层·状态 / 摘要 / 分支 + 阻塞原因）。几何常量导出在
  `src/scenes/QuestPanelScene.ts` 顶部；`src/tests/questPanel.test.ts` 镜像同值做
  算术断言——该模块 import Phaser，Node 下不可加载（同 `render/panels.ts` 顶部注释
  的原因），这是 `uiLayout.test.ts` 对塔楼场景 TYPE_* 表的同一约定。
- 键位：↑/↓ 选择（列表里选任务、分支视图里选分支）；Enter 在列表里打开分支、在
  分支里确认选择；Esc 在分支里返回列表、在列表里关闭。每帧去抖（GHI-03 m9，同
  TowerOverviewScene 的 accept()）。
- 分支置灰：`evaluateBranch().available === false` 时分支行取 `TEXT.disabled`，
  阻塞原因（`blockers`，中文）以 `ROLE.danger` 跟在行下；已选分支（读
  `QUEST_FLAG.branch`）追加「（已选）」并保持 `TEXT.highlight`。Enter 打在阻塞
  分支上会把 blockers 拼成一行瞬态消息，拒绝不再是无声的 no-op。
- dev 句柄 `__PHASER_QUESTS__`（`getEvaluations` / `getSelection` / `getMessage`），
  Playwright 与 AG-11 的 e2e 可断言真实求值结果而不是像素。

## event 契约：quests:changed（AG-11 接线依据）

| 项 | 值 |
| --- | --- |
| 事件名 | `quests:changed` |
| 发送方 | `QuestPanelScene.commitBranch()` |
| 接收方 | **Game 场景的 EventEmitter**：`this.scene.get('Game').events` |
| 载荷 | `{ questId: string; branchId: string }` |
| 时机 | 玩家在分支视图对一条 `available` 分支按 Enter 确认时（done 任务、已选分支、阻塞分支都不发） |

语义与集成层职责：

- 面板自己不写 GameState（`data/quests.ts` 顶部分工）：事件是「请求落地这条分支的
  后果」。AG-11 的 handler 用 `getQuest(questId)` 找到分支，把 `branch.consequences`
  落成 `setFlag / clearFlag / addItem / removeItem / homeUpgrades.push /
  records.bestScore`，并按需写 `QUEST_FLAG.accepted / done / branch`（STORY.md §7
  的接口契约）。
- 发在 Game 场景的 emitter 上而不是面板自己的：scene events 挂在 Scene 对象上，
  与运行状态无关——overlay（launch）下 Game 在跑，handoff（start）下 Game 停着，
  两种打开方式 listener 都能收到。
- 面板 emit 之后立刻重读 `evaluateAllQuests(state)` 刷新：同步落地的 handler 已经
  改了 state，面板无需重开就反映后果（已选标记、状态翻转）。
- GameScene 若自带任务 HUD：同一次事件就是刷新信号，不需要第二个事件。

面板关闭（三种打开方式都认，`close()` 按 Game 的运行状态分支）：

- overlay（`scene.launch('QuestPanel')`，Game 仍 active）→ `scene.stop()`；
- launch + `scene.pause('Game')` → `resume('Game')` 后 `stop()`；
- handoff（`scene.start('QuestPanel')`，同塔楼总览的打开方式）→ `scene.start('Game')`
  （Game.create() 对同一份模块级 GameState 重跑，变更自然被读到）。

## 塔楼楼层详情卡的第二种数据源

`TowerOverviewScene.refreshDetail` 的内容行（第 5 行）按 `hasFloorContent(floor)`
切换数据源——判据是「有没有手写模板」，不是 visitedFloors：未走访的已创作楼层依然
有真实内容（已解析视图），没有模板的楼层在世界生成前什么都没有。

- 已创作楼层：保持 `LootSystem.describeFloorContents`（已解析世界，取走的栈会消失），
  行色 `TEXT.primary`。
- 未探索楼层（100000 层里的 99946 层，含 100000——dev 别名 `DEV_FLOOR_ALIAS` 不算
  已创作，见 `floorTemplates.hasFloorContent` 的注释）：改读
  `worldgen.summarizeFloor(state.runSeed, floor)`，渲染
  「未探索·预估：{阶层} · 容器 N 个 · 物资 N 档 · 威胁「标签」 · 或可找到 …」，
  行色 `TEXT.warn`。两种数据源在 UI 上的区分 = 前缀（内容： vs 未探索·预估：）+
  行色；阶层行走第 1 行（两种数据源同值——tower.ts 的结构量，无种子）。
  预估与实际生成同源：`summarizeFloor` 与 `generateFloorContent` 共用
  `planUnexploredFloor`，卡片承诺的数字就是玩家进门时 roll 出来的数字。
- 实测（Playwright getBounds，seed 42，键盘下钻到楼层详情）：
  - floor 5（已创作）：「餐台：压缩口粮·脏水　补给架：面包·医疗包　地面：面包」；
  - floor 11（未探索，阶层 1）：「未探索·预估：底层贫民区 · 容器 2 个 · 物资 1 档 ·
    威胁「中」 · 或可找到 布料·胶带·废金属·木材·电池·电线·撬棍」（7 件物资池 =
    最坏预估行）。
- 连带修掉一个实测缺陷：自适应卡高原来按 `wrapText` 行数推导，估算器比光栅器窄几个
  百分点，阶层 1 的 7 件物资池预估行**实际包 5 行、预估 4 行**，动作行压内容行
  6px——正是 AG-08 修过的同一类缺陷经新数据源复发。改为按 `Text.height`
  （setText 同步更新，就是实际包出来的行高）推导；实测修后动作行距内容行 13px。
  `wrapText` 保留在测试里做算术守卫（含 +1 行的估算漂移余量）。

## 塔楼总览右上角重叠（AG-08 遗留项 1，本轮解决）

缩放读数从右上角独立 chip 移入顶部中央状态 chip：
`当前 X 层 · 已打通至 Y 层 · 缩放 Zx`。

**为什么动读数而不是终点标签的 y**：右留边（`TOWER_ENDPOINT_MARGIN`）是塔楼自己的
标注区——起点/终点标签是世界坐标，缩放 >1x 时会在整个留边里滚动（2x 时终点标签的
屏幕 y 可达 26..78，离开画布顶部前始终压得住任何固定 chip 的位置），把 chip 在
留边里下移只是把重叠从 1x 搬到 2x。顶部中央是 AG-08 已验证的唯一空带：tierText
12..41 之上、状态 chip 50..77，与标题（x ≤ 360）、区段标签列（x ≤ 96）、两个端点
标签（x ≥ 1090）在任何缩放/滚动下都不相交。读数并进状态 chip 不新增对象，也不新增
重叠面。

实测（Playwright getBounds，设计画布 1280x720，默认打开态 1x）：

| | 缩放读数 | 终点标签 | 重叠 |
| --- | --- | --- | --- |
| 修前 | 独立 chip @(1179,12) 89x31 | @(1090,31) 169x25 | **80x12px** |
| 修后 | 并入状态 chip @(442,50) 397x27 | @(1090,31) 169x25（未动） | **0**（全屏可见文本两两求交 0 处；1.5x / 2.5x 同样 0 处） |

（AG-08 记录为 88x12，同一样态；差异在 chip 宽度取值——本次按 getBounds 实测 89px
宽、与终点标签交宽 80px。修后状态 chip 右缘 839，距终点标签左缘 1090 还有 251px。）

## 改动文件（AG-12）

- `src/scenes/TowerOverviewScene.ts`：内容行双数据源（worldgen 预估 + 「未探索·预估」
  标记 + warn 行色）、标题按 authored 判据取模板名（100000 不再借第 1 层宿舍名）、
  自适应卡高改按 `Text.height`、缩放读数并入状态 chip（删除 infoText）。
- `src/scenes/QuestPanelScene.ts`（新）：任务面板（列表/分支两态、分支置灰与阻塞
  原因、已选标记、`quests:changed` 事件、三种打开方式的关闭逻辑、`__PHASER_QUESTS__`
  dev 句柄）。
- `src/main.ts`：`game.scene.add('QuestPanel', QuestPanelScene)`。
- `src/tests/questPanel.test.ts`（新，17 个测试）：面板布局算术断言（任务名/分支名/
  阻塞原因不溢出、详情流不压脚注带）、`evaluateAllQuests` 在 6 个代表 state 上的
  输出稳定性（状态向量钉死 + 分支可得性/阻塞原因抽样）、塔楼预估行的包裹与卡高。
- `docs/plans/UI.md`：本节。

## 未处理干净 / 已知限制（AG-12）

1. **分支的后果落地依赖 AG-11**：面板只发 `quests:changed`，不写 GameState。在
   GameScene 接线之前，确认分支后面板上会显示「已记录：…」但状态不会真变
   （纯 viewer 语义，见上）。
2. **任务目标（objectives）未上面板**：本轮按任务书范围做「标题/阶层/状态/分支 +
   阻塞原因」，objective 的完成度（`QUEST_FLAG.objective`）留待集成层定义 HUD 时
   一起做。
3. **面板只接受键盘**：未做指针行点击（任务书指定键位；Phaser 4 下本项目 e2e 也
   全是键盘驱动，鼠标路径无既有先例）。
4. **buildPanelHeader 的 30px 标题在 20px header 条里上下各溢出 ~5px**：既有 UI kit
   行为（行商/战斗等所有面板同样），实测任务面板 header 标题顶缘在面板顶缘上方
   5px，非本轮引入，未动（uiKit.ts 在禁区清单里）。
5. **缩放 >1x 时塔楼条水平方向不出血**：相机 scrollX 恒 0，2x 下只露世界 x
   320..960（既有行为，TowerNav 的滚动钳制只建模了纵向；非本轮范围）。

---

# AG-23：UI 遗留债务清理（2026-11-15）

**范围**：AG-08/AG-11 遗留项复测 + Noto Sans SC（GameSans）换字体后新暴露的布局
回归。只动 `render/uiKit.ts` / `render/panels.ts` / `render/hudLayout.ts` /
`render/dialogueLayout.ts` / `render/itemIcons.ts` 与两个布局测试文件；场景代码
只读复核，问题进属主清单。测量方法同 AG-08：Playwright（独占端口 5403/5404）
取 `getBounds()`（设计画布 1280x720 坐标）+ 画布元素截图像素采样，无截图比对断言。

## 遗留项 1 复测：床/工作台招牌可见性——结论：**可见，从遗留里划掉**

AG-08 记录「床（睡觉）/工作台招牌 depth 0 在 HUD 带内，像素采样 max lum=33 完全
不可见」；AG-11 已把两处提到 depth 105（与容器名签同线）并质疑 33 是把世界坐标
当屏幕坐标采样了 HUD 带本身。本轮独立复测（seed 42，floor 1 站定，相机
scrollY=-102 / zoom=1，GameSans status=loaded）：

| 对象 | depth | 世界坐标 | 屏幕坐标 | 与 HUD 带关系 | 像素采样（修后） |
|------|-------|----------|----------|----------------|------------------|
| HUD 上下文带 | 100 | — | (0,0) 1280x102，alpha 0.98 | — | — |
| 床（睡觉） | 105 | (1065,64.5) 110x27 | (1065,**166.5**) 110x27 | 带外（带下缘 102，差 64.5px） | max lum=**232**，901/3828 亮像素 |
| 工作台 | 105 | (447,62.5) 66x27 | (447,**164.5**) 66x27 | 带外（差 62.5px） | max lum=**232**，693/2376 亮像素 |
| 正对照：HUD 目标行 | — | — | — | — | max lum=232 |
| 背景对照：床标签矩形上移 40px | — | — | — | — | max lum=104，0 亮像素 |

- 两个标签都采样到 TEXT.primary（#ece8d8，亮度 232）的文字像素，与正对照一致、
  与背景对照（104）差异显著 → **可见，遗留项 12b 划掉**。
- AG-11 记的「屏幕 y=140」与实际（164.5/166.5）有 24px 偏差（可能在爬梯中的瞬态
  相机上量的），但结论方向正确：标签在 HUD 带下方。
- AG-08 的 33 是存量缺陷在旧相机边界下的实测（相机当时能滚到带内）；现有双重
  保证：f359330 把 floor 1 相机上界压到 -102（世界坐标 y<0 不可见，而标签在
  y≈63..65），AG-11 把 depth 提到 105（带与其 chrome 之上）。
- 夜间 overlay 在 depth 23、灯光层 24，标签 105 在其上——夜间名签依然全亮可读
  （特性，非缺陷）。

## 新字体暴露的回归与修复（修前/修后均为 Playwright getBounds 实测）

换字体提交实测过「容器名签/HUD/任务目标」，但没量**面板 header 条**与**塔楼底带**
——这两处的车道是按旧像素字体 ~1.0em 的行盒定的，GameSans 画 1.21-1.25em 的行盒
（实测 30→37、26→32、24→30、22→27、20→25、18→22、16→20、14→17、13→16、12→15；
`floor(size×1.25)` 精确复现全部实测点，已固化为 `uiKit.fontLineBox()`）。

### 1. buildPanelHeader：30px 标题在 20px 条里（AG-08 遗留项 4 / AG-12 已知限制 4）

| | 标题实测 | 条实测 | 溢出 |
|---|----------|--------|------|
| 修前（背包） | (430,233.5) 60x**37** | y=242 440x20 | 上 8.5px / 下 8.5px |
| 修前（工作台·制作） | (385,201.5) 194x**37** | y=210 530x20 | 上 8.5px / 下 8.5px |
| 修后（背包） | (430,242) 48x**30** | y=242 440x**30** | **0 / 0** |
| 修后（工作台·制作） | (385,210) 155x**30** | y=210 530x**30** | **0 / 0** |

旧字体时是 ~5px（AG-08/AG-12 的记录），换字体后恶化到 8.5px——标题墨迹穿过面板
顶框和第一条内容行。修法（`uiKit.ts`）：`PANEL_HEADER_H` 20→30、标题字号
`TYPE.title`(30)→`TYPE.body`(24)，标题行盒（30）正好入条，墨迹（~21px）上下各
4.5px 气。**为什么不只缩字号**：20px 条最多容 16px 字（行盒 20），低于本文件自己
的「caption 20 是可读性下限」；**为什么条不再长**：所有场景的内容都从 panel-top+30
起（对话胸像/well、背包格子、制作行、行商行、战斗血条），条过 30 会压内容——
30 是刚好擦着内容偏移的最大值。对其它面板的影响：所有 header 条长高 10px、
标题小 6px，内容不下移（场景各自定位，未碰任何场景文件）；QuestPanel 分隔线在
+34、MetaSelect 模式行在 +34、EndScene well 在 +26——well 顶 2-4px 会被条盖住
（well 与条同 depth，后建的 well 画在条上，仅底部发丝线位置可见差异，实测无文字
受影响）。对话面板的自绘标题不在本修复范围（见属主清单 1）。

### 2. 塔楼总览底部提示条：新字体下底缘出画布 2px

`TOWER_FOOT_TOP` 36 是按旧字体的 33px 行高（27 字 + 6 padding）定的；GameSans 下
同一行是 32px 字 + 6 padding = **38px**，@(12,684) → 底缘 **722**，出 720 画布 2px
（三视口实测一致）。修法（`hudLayout.ts`）：36→41，底带改在 679 开，38px 行到
717，恢复 AG-12 原本设计的 3px 余量；图例底缘 706；「← 返回」637..669，与底带
相距 10px（不变）。`uiLayout.test.ts` 原断言用 1.1em 估算（会放过这个 bug），已
按实测因子收紧为 `fontLineBox(TOWER_HINT_FONT)+6`。

### 3. NPC 名签复核（AG-11 备注「plate 比容器窄」）

floor 2 实测：阿林/小周 label 44x27（两字 22px，estimateTextWidth 精确：44=2×22），
plate 58x30，左右各 7px、上下 1.5px；与容器名签同一公式
（`estimateTextWidth(name,22)+14`）。plate 窄是因为名字短（2 字 vs 3 字），不是
缺陷；新字体下估算对汉字精确，标签不溢 plate。**无需改动**（`drawNpcs` 在
GameScene，也不归本轮）。

### 4. 塔楼总览右上角复核（AG-12 修复确认）

默认打开态 1x：全屏可见文本两两求交 **0 处**（AG-12 的修复成立）；状态 chip
@(456,50) 368x31，右缘 824，距终点标签左缘（1090）266px。1.5x/2.5x 同样 0 处
——但那是因为固定 HUD 整体离开了画布（见属主清单 4），属「vacuous zero」。

### 5. 响应式三视口（900x600 / 1280x800 / 1920x1080）

HUD/背包/制作/暂停/塔楼总览全部实测：出画布文本 **0**、横向滚动条 **0**
（Scale.FIT 信箱缩放不移动设计车道，修完塔楼底带后三视口全净）。

## 留给属主的清单（场景代码，本轮只读）

1. **GameScene.ts `dialogueTitle`（约 3865-3868）**：对话面板自绘的 30px 标题在
   `top+10`，实测 (420,201.5) 210x37——板顶在 210，标题盒顶 201.5，**超出板顶
   8.5px**，且在 30px 新条里偏高 5px（条心在 +15）。改法：`fontSize` 用
   `TYPE.body`、y 用 `top + PANEL_HEADER_H/2`；或直接把这个标题并进
   `buildPanelHeader` 的 title 参数（strip 已在 `dialogueHeaderParts` 里，
   `refreshDialogue` 已按 `PANEL_HEADER_H` 重排，改常量即自动跟随）。
2. **GameScene.ts 制作行 `CRAFT_ROW_PITCH=24` 配 24px 字**：行盒 30px，相邻行盒
   互压 6px（墨迹差 3px 不碰，视觉尚可）；战斗菜单 26px pitch 配 24px 字，行盒
   互压 4px。getBounds 级回归（旧字体行盒≈pitch）。建议 pitch ≥30 或行字改
   `TYPE.caption`。
3. **GameScene.ts 室友床标签（约 2778，depth 3）**：x=428 床位的「室友」标签
   （x≈469）与工作台招牌（depth 105，x 414..480）盒级相交 36x22，标签被亮招牌
   盖住（存量缺陷，位置未随字体变，非本轮引入；截图证据在
   `e2e/screenshots/ag23-floor1-dorm.png`）。修法：床位标签 x 偏移避开 480，或
   招牌与床位二选一让位。
4. **TowerOverviewScene.ts：缩放 >1x 时固定 HUD 整体出画布**。场景注释认为
   「scrollFactor(0) 的对象不受世界缩放影响」——Phaser 的相机矩阵会缩放
   scrollFactor(0) 对象（源码：`Camera.preRender` 的矩阵 +
   `TransformMatrix.copyWithScrollFactorFrom`；实证：1.5x/2.5x 截图里标题、状态
   chip、提示条、图例、返回全部消失，固定 HUD 按 `zoom*p + origin*(1-zoom)` 漂移）。
   修法：给 HUD 对象建第二个 `zoom=1` 的相机（`cameras.add(0,0,1280,720)`，
   `main.ignore(hudObjects)` + `hudCam.ignore(世界内容)`），或把 HUD 搬进独立
   Scene。附带后果：水平滚动未建模（AG-12 已知限制 5）时，zoom>1 端点标签滑出
   右缘（1.5x 实测起点标签 @(1315,318)）。
5. **GameScene.ts 背包计数文本（约 3166，`top+10`，20px）**：30px 条里偏高 5px
   （盒 25px 在 20px 旧条里也溢 2.5px，墨迹不溢）。小瑕疵，随属主清单 1 一起顺手
   即可（y 改 `top + PANEL_HEADER_H/2`）。

## 改动文件（AG-23）

- `src/render/uiKit.ts`：`PANEL_HEADER_H` 20→30、header 标题字号
  `TYPE.title`→`TYPE.body`；新增 `GAMESANS_LINE_FACTOR` / `fontLineBox()`
  （实测行盒因子，供布局测试与后续车道使用）。
- `src/render/hudLayout.ts`：`TOWER_FOOT_TOP` 36→41（新字体行高 + 3px 余量）。
- `src/tests/uiLayout.test.ts`：塔楼底带断言按实测因子收紧（原 1.1em 估算会放过
  出界 2px 的缺陷）；不断言、不删除。
- `src/tests/uiLayout2.test.ts`（新，11 个测试）：GameSans 行盒因子钉死、header
  条契约（装得下标题行盒且不越内容偏移）、对话面板按真实行高的「不压选项行」
  守卫（含 60 字最坏行）、名签 plate 契约（估算对汉字精确 + label 入 plate）、
  塔楼底带与返回箭头的真实行高守卫。
- `docs/plans/UI.md`：本节。

## 验证

- `npx tsc --noEmit`：干净。
- `VITE_NPC_MODEL= npx vitest run`：**71 文件 / 1187 测试全绿**（基线 70/1176，
  新增 uiLayout2 的 11 个；无既有测试变红）。
- Playwright：探针 A-E 全过（端口 5403）；全量 e2e（端口 5404）：**待填**。

## 未处理干净 / 已知限制（AG-23）

1. 属主清单 5 项全部未动（场景代码在禁区）；其中对话面板标题与制作行行距是
   getBounds 级回归，墨迹尚未相碰，优先级中。
2. 塔楼 zoom>1 固定 HUD 消失是本轮新发现的存量缺陷（截图证据 3 张），比 AG-12
   记录的「右上角重叠」严重，建议集成层优先处理。
3. 对话 well 仍按 1.1em 估算行高：5 行最坏值行盒会探出 well 边缘 2px（墨迹在
   well 内，且离选项行 6px），实测无视觉问题；未改估算因子是为了不打乱 AG-08
   钉死的基准版式（DIALOG_WELL_H=72 等）。
4. 战斗面板行盒互压 4px 未实测进面板（需触发遭遇战，流程同 e2e/combat.spec.ts），
   数字由行距算术推出（26 pitch vs 30 行盒），已列属主清单 2。
