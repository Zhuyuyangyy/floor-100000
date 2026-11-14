# AG-04｜WORLDGEN / 十万层世界生成工程师（B4）

**分支：** `agent/2026-11-15/ag-04-worldgen`  
**基线：** `adaec3b27cb16eebd5106d0971a54c79c0af0b1e`  
**优先级：** P1 / M2 独立模块

## 使命

构建十万层世界的可复现、按需生成基础模块，为后续 100 个区段和 100000 层内容扩展提供数据契约。

## 任务

1. 新建独立 `src/worldgen/` 模块，不修改现有 floorTemplates、tower、FloorSystem 或 GameState。
2. 设计 SectorProfile 和 FloorDescriptor 的最小类型；100 个区段，每区段 1000 层。
3. 提供 `generateSectorProfile(worldSeed, sectorId)` 和 `generateFloorDescriptor(worldSeed, floorId)`（函数名可调整，但必须在文档记录）。
4. 生成必须按需执行，不创建十万层对象数组。
5. 同一 worldSeed + floorId 必须稳定；不同 seed 可变化，但阶层资源/风险曲线必须单调或遵守明确规则。
6. 记录区段主题、资源等级、危险等级、通行条件的可扩展字段；不要虚构已冻结的数值。

## 文件白名单

仅新增：
- `src/worldgen/**`
- `src/worldgen/**/*.test.ts`
- 可在模块内新增 README / schema 文档。

只读参考：`src/core/rng.ts`、`src/core/tower.ts`、`src/data/floorTemplates.ts`、`docs/ROADMAP.md`。

## 验收

- 覆盖 floor 1、1000、1001、100000 的边界。
- 同 seed 同楼层结果一致；不同 seed 有可测差异。
- 100 区段范围正确，无越界和无效 floorId。
- 性能测试证明单层按需生成，不预分配十万对象。
- 输出接口契约给 AG-01；未获批准不得接入 GameScene。