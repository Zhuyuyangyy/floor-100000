# 首层 TWOM 式生存纵切片验收报告

**日期**：2026-11-09  
**任务**：B3-17  
**实现提交**：`54ffc69`、`1c01243`、`cdf3186`、`c1e1cc7`、`f08815e`、`3e4753c`

## 已完成

- `GameState` 增加压力、事件日记和 shelter 计划；旧存档缺字段时自动补默认值。
- `DiarySystem` 以状态序列生成稳定事件 ID，保留最近 64 条；事件分钟归一为整数后再写入存档。
- `ShelterSystem` 提供休息、治疗、修理、照顾邻居四个夜间动作，并通过原子物品扣除、伤病治疗和次日睡眠结算产生后果。
- `GameScene` 增加夜间安排面板、压力 HUD、最近日记摘要、Enter/E 双确认路径和次日淡入反馈。
- pixelfx 导入 `sword-slash`、`parry` 两套 atlas；战斗结果分别触发刀光、招架和受击闪光，未改 `combat.ts` 的纯逻辑判定。

## 实际验证

```text
npm run typecheck                                PASS
npm test -- --run                               47 files / 647 tests PASS
npx playwright test e2e/shelter.spec.ts         PASS（含保存重载）
npx playwright test e2e/combat.spec.ts          3/3 PASS
npx playwright test e2e/uiAll.spec.ts           2/2 PASS
npx playwright test e2e/survivalJourney.spec.ts 1/1 PASS（约 3.7 分钟）
npx playwright test --workers=1                 66/66 PASS（约 9.2 分钟）
npm run build                                   PASS
```

浏览器验收覆盖：首层夜间安排面板、休息后第 2 天 06:00、压力下降、日记写入、保存重载，以及战斗图集加载和战斗 E2E。

## 已知边界

- 本轮只做首层 shelter 纵切片，未实现完整 42 类日记、完整 NPC 情绪树或六大阶层社会模拟。
- 建筑与怪物的大型切片集仍未接入；pixelfx 只接入本轮战斗需要的两个新图集。
- 生产构建仍有既有的 bundle 大小警告；本轮目标浏览器流程未观察到运行时 404 或 TypeScript 错误。
- 工作区仍保留用户未提交的四张角色 PNG 与 `re/` 诊断脚本，未纳入本轮提交。
