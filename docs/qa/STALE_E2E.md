# 存量 e2e 失败清单（STALE_E2E）

> 集成提交 `562a02a` 的信息承诺"2 个存量失败记入本文档"。
> 经 AG-03 完整会话复核，存量失败的准确清单如下（按严重度排序）。
> 本文档只做记录与定性，不修改任何测试制造绿色。

## 1. BUG-QA-01：塔楼总览起/终点标签出界（真实产品缺陷，稳定复现）

- **表现**：`firstChapter.spec.ts › 面板不出框` 稳定报红：
  "起点 第1层" 文本右缘 1294 > 设计画布 1280（超出 14px），"终点 第100000层" 同因被裁。
- **位置**：`src/scenes/TowerOverviewScene.ts` — `drawEndpoints()` 将标签定位于
  `STRIP_X + STRIP_W + 10 = 1180`（`buildOverviewAnnotations()` 创建），标签自身
  宽度约 114px（起点）/更长（终点），右缘越界。
- **证据**：`test-results-qa/firstChapter-.../test-failed-1.png`（右下、右上均见裁切）。
- **归属**：需持有方修 `src/scenes/TowerOverviewScene.ts`（AG-03 无 src 权限）。
  修法方向：标签右对齐到画布内（如 `DESIGN_WIDTH - 12 - width`），或缩短文案。
- **状态**：未修，e2e 保留红色。

## 2. BUG-QA-05：长测试的 Playwright teardown 卡死（环境性能，非产品缺陷）

- **表现**：三个主体较长的测试以 `Tearing down "context" exceeded the test timeout`
  失败：`survivalJourney`（主体 254s）、`tower › locked floor refused`（114s）、
  `saveFailure › rejected save`（46s）。较短测试无一出现。
- **trace 证据**（journey，`--trace on` 重跑）：全部断言（含 `expect errors`）
  在 254.6s 完成，`After Hooks` 于 254.7s 开始，context close 直至 600s 超时
  仍未结束；失败截图显示 teardown 期间游戏继续无人干预运行至 D3 濒死
  （饥饿/口渴 0、生命 33）——页面未冻结，是 context 关闭本身病态慢。
- **单独重跑**：tower/saveFailure 在机器负载不同时单独重跑即过（16/16）。
  journey 以 600s、900s 两种预算各重跑一次，teardown 均未完成（>646s）。
- **疑似根因**：本机磁盘/CPU 负载（worktree 内 1.1G 历史 `test-results/` trace
  堆积、主工作区并发 Vite、多 agent 进程）导致 Chromium context 退出极慢。
- **处置建议**：
  1. 清理 `agent-worktrees/ag-03-qa/test-results/`（1.1G 历史 trace，gitignored）。
  2. 在干净机器或 CI（`--workers=1 --retries=1`，continue-on-error）复核这三个测试。
  3. 若 CI 上 journey 的 teardown 仍超时，考虑将其 `test.setTimeout(600_000)`
     上调或拆分（改动属 e2e 维护，AG-03 授权内，但需先在 CI 确认）。
- **状态**：记录在案；本机无法进一步复核（src 排查越权 + 环境负载不可排除）。

## 3. 已修复的历史腐化（非存量失败，备查）

- `crafting.spec.ts › purifier`：通行证链把 `RECIPES` 从 3 个扩到 8 个后，
  purify 行从第 4 移到第 9，原"固定按 3 次 ArrowDown"导航落到通行证配方上
  稳定失败。已改为按行标签名导航（`navTo(page, '净化')`）。
- `gameplay.spec.ts`：AG-03 本次引入的 `waitForFunction` 未传参 bug
  （`ReferenceError: START_FLOOR is not defined`），已修。
