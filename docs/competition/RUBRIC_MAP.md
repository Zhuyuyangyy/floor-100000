# 赛事评分自查映射

> **仅按执行方案自查**：本表是仓库证据索引，不是官方评分项、分值或评分解释的核实。产品代码提交 `73200e165981dd0d230aeac9b88256f742cb5d04` 通过类型检查、完整单测（70 个文件／865 项）、生产构建、离线回放基准（9/9）和完整单 worker Playwright 套件（106/106，25.2 分钟）。完整套件运行后只提交文档状态更新，未改产品代码。外部推理、DGX Spark 与现场演示未实测。

## 已实现且有测试断言

- **赠礼改变真实游戏状态**：`src/scenarios/alinGiftDemo.ts` 串接行动提案、规则校验、执行和持久化；成功时转移玩家物品至 NPC 库存，更新信任与两层记忆。`src/scenarios/alinGiftDemo.test.ts` 覆盖成功、无物拒绝、提交失败回滚及旧存档缺少 `npcStates`。`e2e/competitionAiNpc.spec.ts` 验证游戏对话后的库存、信任和记忆变化；其中赠礼演示用例使用测试物资注入，不能说成自然搜刮流程。
- **维修门闭环**：用户已批准配方为木材×2＋胶带×1。`src/scenarios/alinRepairDemo.ts` 使用该精确配方；`src/scenarios/alinRepairDemo.test.ts` 覆盖缺信任／缺材料时安全拒绝，以及信任达到 70、材料齐备后实际消耗材料并开放门禁。赠礼菜单隐藏维修材料，`src/ai/competitionRules.ts` 另外阻止绕过菜单赠出预留物资。
- **软锁与旧存档**：`src/data/floorTemplates.ts` 的第 2 层维修材料箱固定提供配方所需材料；`src/systems/CraftingSystem.ts` 统一保护木材×2、胶带×1，关闭门禁时工作台制作和宿舍修理最多花掉超出预留的余量。`src/data/floorGates.ts` 只认本局门禁旗标、当前楼层和本局访问记录；`records.deepestFloor` 是跨局记录，不能授权本局通行。`floorGates.test.ts`、`craftingSystem.test.ts` 与 `ShelterSystem.test.ts` 覆盖这些边界。
- **审计与回放**：`src/ai/competitionRunExport.ts` 导出允许字段、状态差异和哈希；`e2e/competitionJudgeMode.spec.ts` 验证游戏内导出 JSON。`src/tools/competitionReplayBenchmark.ts` 用固定 seed 验证离线 fallback 输出一致，并核对赠礼不消耗维修材料。
- **拒绝反馈与重规划**：`src/ai/competitionRuntime.test.ts` 覆盖先反馈、重新观察、再规划及重新校验；道路封锁案例由测试夹具注入，不是现场游戏事件证明。

## 验证边界与未完成项

- 当前 NPC 赠礼和维修场景使用 `offline-fallback`；这证明规则、状态提交和边界测试，不证明实时 LLM 或 DGX Spark 推理。
- 在产品代码提交 `73200e165981dd0d230aeac9b88256f742cb5d04` 上，完整 Playwright 单 worker 套件为 **106/106 通过（25.2 分钟）**，其中制作／面板／AI NPC／Judge Mode 定向 E2E 为 13/13、shelter UI 为 3/3；之后仅更新文档，未改产品代码。通用旧 E2E 中 `e2e/alinGateFixture.ts` 会直接设置门禁旗标（用于无关楼层／生存测试），不代表真实维修；浏览器测试还使用位置夹具，部分赠礼演示用例注入物资，不能替代无注入人工录制。
- ModelScope 尚未部署；赛事资格及旧赛史未核实；代码许可证未选定。公开再分发美术素材的许可不自动适用于代码。
- 演示操作提纲见 `docs/competition/DEMO_SCRIPT.md`；尚未录制或作为实机演示验证。
- PR #21 应保持 **Open / Draft / 未合并**；本分支不改动它，另以独立 Draft PR 供审阅。

## 自查对应关系

| 执行方案自查主题 | 仓库证据 | 边界 |
|---|---|---|
| NPC 行动受规则约束 | `competitionRules`、`competitionExecutor.test.ts` | 不是实时模型接入证明 |
| 赠礼带来库存、关系和记忆变化 | `alinGiftDemo.test.ts`、`competitionAiNpc.spec.ts` | 部分 E2E 使用注入物资／位置夹具 |
| 维修并打开门禁 | `alinRepairDemo.test.ts`、`floorGates.test.ts`、`competitionAiNpc.spec.ts` | 浏览器夹具有位置设置；非现场录制 |
| 门禁材料可得且不软锁 | 第 2 层 `alin_repair_cache`、`CraftingSystem` 预留规则、旧存档与跨局记录回归测试 | 通用 E2E 的 `alinGateFixture` 直接开旗标；不代表真实维修，也不代表未实现楼层均可通行 |
| Judge Mode 与回放证据 | `competitionRunExport`、`competitionReplayBenchmark` | 离线 fallback 可复现性，不衡量模型质量 |
