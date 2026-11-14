# 文件所有权（2026-11-15 第一轮派工）

基线：`feat/portraits-ui`（= `feat/tower-zoom-b2` + 17 提交，54 层可玩，59 测试文件 / 840 测试全绿，tsc 干净）。
十个 Agent 各自在独立 worktree + 独立分支上工作：`agent/2026-11-15/ag-XX-*`。

## 所有权矩阵

| Agent | 拥有的文件 | 明确不拥有 |
|---|---|---|
| AG-01 成长线 | `src/core/gameTypes.ts`、`gameState.ts`、`growth.ts`(新)、`tests/growth.test.ts`(新)、`docs/plans/**` | `segments.ts`、一切 systems/scenes/data/render |
| AG-02 导航 | `src/scenes/GameScene.ts`(仅楼梯/相机/输入/近路)、`systems/FloorSystem.ts`、`systems/shortcut.ts`、`tests/floorSystem.test.ts`、`tests/shortcut.test.ts` | `core/**`、其它 systems、其它 Scene |
| AG-03 QA | `e2e/**`、`playwright.config.ts`、`.github/workflows/**`、`tests/qa/**`(新)、`docs/qa/**`(新) | 一切 `src/**` 源文件 |
| AG-04 世界生成 | `src/core/worldgen.ts`(新)、`tests/worldgen.test.ts`(新)、`data/floorTemplates.ts`(只增不改既有条目)、`docs/plans/WORLDGEN.md` | `segments.ts`、`constants.ts`、`gameTypes.ts` |
| AG-05 经济 | `systems/{Survival,Inventory,Loot,Crafting}System.ts`、`systems/shop.ts`、`data/items.ts`、`data/recipes.ts`、`tests/economyLoop.test.ts`(新)、`tests/survivalBalance.test.ts`、`docs/plans/ECONOMY.md` | `core/**`、`floorTemplates.ts`、`encounters.ts`、`scenes/**` |
| AG-06 NPC | `src/ai/**`、`systems/{NpcRuntime,NpcMemory,NpcAutonomy,npcPersonalities}.ts`、`data/npcs.ts`、`tests/npcBehavior.test.ts`(新)、`docs/plans/NPC.md` | `core/**`、`shop.ts`、`EventSystem.ts`、`scenes/**` |
| AG-07 美术 | `public/assets/**`、`render/artpack.ts`、`render/furniture.ts`、`tools/**`、`tests/assetManifest.test.ts`(新)、`tests/furniture.test.ts`、`docs/assets/**`(新) | `core/**`、`systems/**`、`scenes/**`、`data/**`、其它 render 文件 |
| AG-08 UI | `render/{uiKit,panels,hudLayout,itemIcons,dialogueLayout}.ts`、`scenes/{Menu,MetaSelect,TowerOverview,End}Scene.ts`、`tests/uiLayout.test.ts`(新)、`docs/plans/UI.md` | `GameScene.ts`（除容器名标签位置，需报行号）、`core/**`、`systems/**` |
| AG-09 渲染性能 | `render/{corridors,lighting,fx,walkcycle,feedback,audio,roomDepth,pixelArt}.ts`、`tests/renderPerf.test.ts`(新)、`docs/plans/RENDER.md` | `artpack.ts`、`furniture.ts`、uiKit/panels 系列、`scenes/**` |
| AG-10 剧情 | `docs/plans/STORY.md`(新)、`src/data/quests.ts`(新，需接口批准)、`tests/quests.test.ts`(新) | 一切既有文件 |

## 共享禁区（所有 Agent）
- `src/core/segments.ts`：六段阶梯的唯一真相，冻结。
- `docs/GAME_DESIGN_LOCK.md`：设计锁定，冻结。
- 别人的测试文件：发现红，写报告，不要越界改。
- `node_modules` 是指向主仓库的 junction：可读，不可删改。

## 已知的跨 Agent 接触点（集成时重点看）
1. `data/floorTemplates.ts`：AG-04 可能新增模板，AG-07 可能要改容器 id —— 集成时确认两者没有改同一条目。
2. `scenes/GameScene.ts`：AG-02 改交互，AG-08 改标签位置 —— 集成时按行号核对。
3. `render/corridors.ts`：AG-09 改 `wallKeyFor` 分支，AG-07 交图后要接文件 —— AG-09 负责接。
4. 存档结构：AG-01 加 `GrowthProfile`、AG-06 加 NPC 库存，都要保证旧存档可加载（SaveSystem 只读）。
