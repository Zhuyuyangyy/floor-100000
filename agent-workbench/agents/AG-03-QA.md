# AG-03｜QA / 自动化测试与 CI 工程师

**分支：** `agent/2026-11-15/ag-03-qa`  
**基线：** `adaec3b27cb16eebd5106d0971a54c79c0af0b1e`  
**优先级：** P0 / M1 阻断

## 使命

建立可信的 E2E 信号，修复脆弱等待和浏览器配置不一致，不通过放宽断言或删测试制造绿灯。

## 任务

1. 复核当前 `playwright.config.ts`、`.github/workflows/ci.yml` 的浏览器安装与启动方式，确保安装的浏览器与实际运行 channel 一致。
2. 复现并定位历史 `survivalLoop.spec.ts` 超时；先检查等待条件、游戏时钟、真实动画和资源加载，不要直接把 30 秒统一加到 60 秒。
3. 使用可观察的游戏状态/面板状态断言，减少依赖短暂文本可见性和固定 sleep。
4. 为 AG-02 的三项修复编写真实键盘 E2E：楼梯端点镜头、攀爬中 E/F 互斥、报价/实际扣费一致。若 AG-02 尚未集成，测试可先以预期行为编写并记录当前失败。
5. 全量运行 E2E，输出每个 spec 的通过/失败/重试数、失败 trace 和归因。
6. 保留 typecheck/unit/build 为确定性门禁；E2E 门禁策略变更必须由 AG-01 批准。

## 文件白名单

- `e2e/**`
- `playwright.config.ts`
- `playwright.candidate.config.ts`
- `.github/workflows/ci.yml`
- `docs/qa/**`

不得改产品运行时代码。

## 验收

- Node/browser 环境和 CI 一致。
- 不删测试、不使用 test.skip、不伪造 GameState。
- 所有新 E2E 使用真实键盘输入和可解释等待。
- 提供全量 E2E 原始摘要、失败 trace、截图和命令。
- 不能全绿时必须明确报告实际结果和未解决项。