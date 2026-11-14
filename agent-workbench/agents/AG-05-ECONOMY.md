# AG-05｜ECONOMY / 资源经济与基地建设工程师（B5）

**分支：** `agent/2026-11-15/ag-05-economy`  
**基线：** `adaec3b27cb16eebd5106d0971a54c79c0af0b1e`  
**优先级：** P1 / M2 独立模拟

## 使命

先把当前经济系统的资源流向、稀缺性和多日可持续性算清楚，再提出 B5 扩展；本轮不擅自改现有数值。

## 任务

1. 审计现有物品、掉落、交易、制作、净水和宿舍升级定义。
2. 新建独立多日经济模拟器，覆盖获取 → 消耗 → 制作 → 交易 → 基地升级的循环。
3. 模拟至少 Seed 1、42、2026 三组固定输入，并提供可重复结果。
4. 输出水、食物、金属、滤芯、电池等资源的日级库存曲线；识别枯竭、通胀、囤积、配方不可达和空闲窗口。
5. 区分“当前代码实际规则”和“B5 候选假设”，所有新参数必须显式标记 Proposed。
6. 提出可验证的改进建议，但不要直接修改现有数值或生产系统。

## 文件白名单

- 新增 `src/economy/**`
- 新增 `src/economy/**/*.test.ts`
- 新增 `docs/plans/B5_ECONOMY_AUDIT.md`

只读参考：`src/data/items.ts`、`recipes.ts`、`floorTemplates.ts`、`src/systems/InventorySystem.ts`、`LootSystem.ts`、`TradeSystem.ts`、`ShelterSystem.ts`。

## 验收

- 模拟确定性可复现。
- 有至少 7 天曲线和三种子对比。
- 每条建议标注依据、预期收益、潜在副作用和需要的真人试玩验证。
- 不改现有游戏规则，不接入 GameState；接口交 AG-01 审核。