# AG-02｜NAVIGATION / 楼梯与导航工程师

**分支：** `agent/2026-11-15/ag-02-navigation`  
**基线：** `adaec3b27cb16eebd5106d0971a54c79c0af0b1e`  
**优先级：** P0 / M1 阻断

## 使命

关闭 M1 集成审查中三个楼梯/近路问题，保持现有混合楼梯设计，不重写导航架构。

## 任务

1. **端点相机裁切：** 楼梯攀爬期间，相机纵向 bounds 必须覆盖完整路径和角色高度；第 1 层上楼、第 5 层下楼均不可出框；落地后恢复常规 bounds。
2. **E/F 竞态：** F 近路在 stairClimb 期间必须拒绝；任何旧 traversal 在近路跳层后不得再次提交。
3. **陈旧 traversal：** `completeStairTraversal` 必须验证 traversal.from 与 state.currentFloor 一致；不匹配时拒绝，不得二次推进楼层。
4. **报价统一：** 提供一个纯函数计算有效 skip、目标楼层和 price；提示文案与实际扣费必须使用同一结果。skip 必须按剩余可达楼层截断；不改变现有价格公式。
5. 补齐 `FloorSystem`、`shortcut` 单元测试，覆盖顶层截断、重复输入、陈旧 traversal、金币不足和成功付费路径。

## 文件白名单

- `src/scenes/GameScene.ts`
- `src/systems/FloorSystem.ts`
- `src/systems/shortcut.ts`
- `src/tests/floorSystem.test.ts`
- `src/tests/shortcut.test.ts`

E2E 由 AG-03 负责，不修改 `e2e/**`。

## 验收

- typecheck、相关 Vitest、build 全通过。
- 单测证明 F 不会在攀爬期间触发，旧 traversal 不会在付费跳层后提交。
- UI 报价与执行扣费引用同一纯函数输出。
- 截图/录像证明第 1 层上楼和第 5 层下楼全程角色可见。
- 不改经济定价公式、楼层内容或其他 GameScene 玩法。

## 停止条件

若需要修改 GameState、存档 schema、其他 Agent 文件或 Playwright，先向 AG-01 提交接口申请。