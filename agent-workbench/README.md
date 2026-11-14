# 《第100000层：末日宿舍》Agent Workbench

本目录是 2026-11-15 第一轮十 Agent 冲刺的执行入口。每个 Agent 只领取自己的 Task ID 和分支，不共享写入工作区。

## 本轮目标

1. 先关闭 M1 的楼梯相机裁切、E/F 输入竞态、近路报价不一致与 E2E 稳定性问题。
2. 并行推进 B4 世界生成、B5 经济模拟、B6 NPC 库存契约。
3. 并行完成首章美术资产审计、独立 UI 场景收口、渲染性能审计和第一章叙事设计。
4. 所有结果通过 PR 回到 `feat/tower-zoom-b2`；不直接推送、不合并 `main`。

## 开工阅读顺序

1. `BASELINE.md`
2. `AGENT_RULES.md`
3. 自己的 `agents/AG-xx-*.md`
4. `OWNERSHIP.md` 与 `INTERFACES.md`

## 目录

- `BASELINE.md`：唯一基线与项目事实。
- `AGENT_RULES.md`：并行开发硬规则。
- `OWNERSHIP.md`：文件所有权与冲突边界。
- `INTERFACES.md`：跨模块接口和集成约定。
- `TASK_BOARD.md`：任务状态、依赖和验收情况。
- `INTEGRATION_LOG.md`：每次集成的证据记录。
- `agents/`：十份可直接交给子 Agent 的任务书。
- `templates/`：交付、PR、测试报告模板。

## Agent 数量

AG-01 为总控；AG-02 至 AG-10 为九个专业执行位。GitHub Issue 是派工单，分支是隔离工作线。GitHub 不会把这些虚拟 Agent 自动启动；项目负责人需将对应 Issue 和任务书交给十个实际 Agent 会话。