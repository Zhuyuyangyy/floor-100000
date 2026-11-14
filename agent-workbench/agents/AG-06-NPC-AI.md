# AG-06｜NPC-AI / 人格、记忆与库存工程师（B6）

**分支：** `agent/2026-11-15/ag-06-npc-ai`  
**基线：** `adaec3b27cb16eebd5106d0971a54c79c0af0b1e`  
**优先级：** P1 / M2 独立模块

## 使命

在现有 AI NPC 架构上推进“NPC 有真实库存”，解决当前静态报价表导致的赠礼无法成为 NPC 后续真实持有物的问题。

## 任务

1. 先读 `docs/plans/2026-11-11-ai-npc-spark-integration-rfc.md`、`docs/plans/2026-11-11-b6-ai-personality-playtest.md` 和当前 `src/ai/**`。
2. 新增独立 NPC 库存数据模块，支持 NPC ID、ItemId、数量、容量、初始化和序列化/反序列化。
3. 实现原子赠礼、交易报价和交易提交；任何失败不得出现半笔交易、物品复制或负库存。
4. 初始化库存可从当前 NPC offers 生成，但一旦玩家赠送物品，后续状态必须能表示真实库存变化。
5. 写出未来持久化到 GameState/save 的字段提案；本轮不修改 GameState 或 SaveSystem。
6. 不扩大 AI 行动白名单，不接入新的 trade/gift 执行路径；先把库存模块和契约做扎实。

## 文件白名单

- 新增 `src/ai/npcInventory.ts`
- 新增 `src/ai/npcInventory.test.ts`
- 新增 `docs/plans/B6_NPC_INVENTORY_CONTRACT.md`

只读现有 `src/ai/**`、`src/systems/NpcRuntime.ts`、`NpcMemory.ts`、`NpcAutonomy.ts`。

## 验收

- 交易守恒、容量、非法 itemId、零/负数量和重复提交均有测试。
- 序列化 round-trip 通过。
- NPC 不得凭空创造物品。
- Spark 不可用时不影响现有游戏。
- 不修改 GameState、存档 schema、规则执行器和 GameScene；接口交 AG-01 批准。