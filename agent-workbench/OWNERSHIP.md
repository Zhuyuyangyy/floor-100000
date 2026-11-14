# 文件所有权与冲突边界

| Agent | 唯一负责范围 | 禁止触碰 |
|---|---|---|
| AG-01 LEAD | `agent-workbench/**`、集成日志、接口批准、PR 审查 | 产品运行时代码；未经批准不合并 |
| AG-02 NAV | `src/scenes/GameScene.ts`、`src/systems/FloorSystem.ts`、`src/systems/shortcut.ts`、`src/tests/floorSystem.test.ts`、`src/tests/shortcut.test.ts` | `e2e/**`、UI 专用 helper、其他系统 |
| AG-03 QA | `e2e/**`、`playwright*.ts`、`.github/workflows/ci.yml`、QA 报告 | 产品逻辑与渲染代码 |
| AG-04 WORLDGEN | 新增 `src/worldgen/**`、`src/worldgen/**/*.test.ts` | 现有 `src/core/**`、`src/data/floorTemplates.ts`、场景和存档 |
| AG-05 ECONOMY | 新增 `src/economy/**`、`src/economy/**/*.test.ts`、`docs/plans/B5_ECONOMY_AUDIT.md` | 现有生存/交易/物品/配方规则文件 |
| AG-06 NPC | 新增 `src/ai/npcInventory.ts`、`src/ai/npcInventory.test.ts`、`docs/plans/B6_NPC_INVENTORY_CONTRACT.md` | `GameState`、存档 schema、`NpcRuntime.ts` 及现有规则执行器 |
| AG-07 ASSETS | `tools/first-chapter-asset-audit.mjs`、`docs/assets/**` | 不覆盖/移动/删除 PNG/GIF，不修改现有 artpack loader |
| AG-08 UI | `src/scenes/MenuScene.ts`、`MetaSelectScene.ts`、`TowerOverviewScene.ts`、`EndScene.ts`、`src/render/uiKit.ts`、`panels.ts`、`hudLayout.ts`、`itemIcons.ts` 及对应测试 | `GameScene.ts`、核心规则、环境渲染 helper |
| AG-09 RENDER | `src/render/corridors.ts`、`furniture.ts`、`lighting.ts`、`roomDepth.ts`、`pixelArt.ts`、`fx.ts`、`walkcycle.ts`、`feedback.ts`、`audio.ts`、`weapon.ts` 及对应测试 | `GameScene.ts`、`public/assets/**`、UI scene 文件 |
| AG-10 STORY | `docs/plans/CHAPTER_01_STORY.md`、`docs/plans/CHAPTER_01_QUESTS.md`、可选 `docs/plans/CHAPTER_01_FLAGS.md` | 运行时代码、冻结设计、现有已实现任务/事件规则 |

## 特别共享文件

- `src/scenes/GameScene.ts`：只允许 AG-02 改。
- `src/core/gameState.ts`、`src/core/gameTypes.ts`：只允许 AG-01 统一批准和集成。
- `src/render/uiKit.ts`：AG-08 唯一写入者；其他 Agent 只读。
- `src/render/roomDepth.ts`、`corridors.ts`、`lighting.ts`：AG-09 唯一写入者。
- `public/assets/**` 和现有素材库：本轮只读；新增图片需另行批准。
- `e2e/**`：AG-03 唯一写入者。

未列入白名单的文件默认不可改。