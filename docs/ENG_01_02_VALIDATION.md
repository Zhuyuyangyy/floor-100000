# ENG-01/02 工程稳定性修复与验证

## 工作边界

在独立工作树 `/workspace/floor-100000-eng-01-02-20261112`、分支 `codex/eng-01-02-ci-e2e-20261112` 上工作，起点为 PR #4 的 `7ed6f60eb4f5d372f9072234c7728ca390016db1`（父提交 `a266d04922ce0d94c0845cfdbcf22e06929af903`）。本次追加的 events/NPC 诊断只调整 `e2e/events.spec.ts`、`e2e/npc.spec.ts` 中的楼层切换测试准备 helper；没有改运行逻辑、楼梯玩法、生存数值或业务断言。撰写此验证记录时，ENG-01/02 改动尚在本地未提交、未推送、未开 PR（仅记录当时状态；之后的授权提交操作以 PR 状态为准）；没有推进 ENG-03/04/05。

## ENG-01：统一 CI 浏览器与安装环境

PR #4 的两次公开 Actions 运行中，`npm ci`、类型检查、单测和构建通过；`Install Chromium for Playwright` 失败，后续 `E2E smoke` 被跳过：[PR 检查](https://github.com/Zhuyuyangyy/floor-100000/actions/runs/43055080000)、[分支检查](https://github.com/Zhuyuyangyy/floor-100000/actions/runs/43055006547)。评估文件报告失败涉及 Ubuntu 包源 DNS；公开 job 元数据能确认失败步骤，但匿名原始日志接口返回 403，因此无法独立核实具体 DNS 主机名或底层错误文本。

原 CI 使用 Node 20，并在运行时执行 `playwright install --with-deps chromium`；Playwright 默认与候选配置却都指定系统 `channel: 'chrome'`。锁文件中的 `playwright` 与 `@playwright/test` 均为 1.64.1。现已将 CI 切换到版本匹配的 `mcr.microsoft.com/playwright:v1.64.1-noble` 容器（预装 Playwright 浏览器与系统依赖），Node 升为 22，并移除运行时 apt/浏览器安装步骤；两个 Playwright 配置均使用锁定版本自带的 Chromium，不再依赖系统 Chrome。该做法绕开易受 Ubuntu 软件源 DNS 影响的运行时依赖安装，并统一浏览器版本；它不是对底层 DNS 解析器的通用修复。官方依据：[Playwright Docker 文档](https://playwright.dev/docs/docker)（镜像含浏览器和系统依赖，并建议镜像与项目 Playwright 版本匹配）、[GitHub Actions job container 文档](https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container)。

本地 `npm ci --no-audit --no-fund` 成功安装 343 个包；`npx playwright install chromium` 只安装浏览器文件、未运行 apt 步骤，成功完成。

## ENG-02：楼层切换测试等待

### 漏水用例（原 ENG-02 修复）

修复前把漏水用例重复运行 5 次，5/5 都在第 169 行楼层断言失败：期望 `currentFloor === 2`、实际为 `1`；因此没有执行后续漏水与补给数量断言。具体复现命令：

```bash
npm run test:e2e -- --config=playwright.candidate.config.ts --workers=1 \
  --output=/tmp/eng02-survival-before e2e/survival.spec.ts \
  -g "a leak spoils the floor's ground supplies" --repeat-each=5
```

静态代码解释是：楼梯动作约 1000ms，原测试每轮按 E 后固定盲等 250ms，最多尝试 5 轮；攀爬期间后续 E 会被忽略，且楼层只在落地时提交。名义等待总长约 1.25 秒，但并未等待楼层状态，帧延迟或较晚启动会消耗余量。这解释了测试脆弱性；实测结论仍仅是前述楼层断言失败，不能据此声称漏水机制失败。

漏水用例修复后，每次真实 E 输入后用 `waitForFunction` 最多等待 2 秒，直到 `currentFloor` 精确变为目标楼层；等待超时才重试。该用例最终楼层断言及漏水期间 battery 数量为 0、清除漏水后为 1 的断言均未改动。修复后重复 10 次，10/10 通过。**本段的 2 秒等待只描述 `e2e/survival.spec.ts` 漏水用例，不是下方 events/NPC helper 的最终实现。**

```bash
npm run test:e2e -- --config=playwright.candidate.config.ts --workers=1 \
  --output=/tmp/eng02-survival-after e2e/survival.spec.ts \
  -g "a leak spoils the floor's ground supplies" --repeat-each=10
```

### events / NPC 楼层准备竞态（独立于漏水用例）

修复前对两条目标用例各重复 5 次，合计 7/10 通过：wanderer 用例失败 1/5，阿林交易用例失败 2/5。两条用例更早的独立重复曾各自 5/5 通过，但这不能排除完整套件中的竞态。失败截图显示 wanderer 用例已到第 3 层，而测试事件目标仍是第 2 层；阿林交易用例已到第 5 层，而 `goToNeighborFloor` 期待第 2 层。这是楼层准备状态与断言前置条件不一致，不是漏水用例失败。

诊断中间版本并非全部通过：第一版测试 helper 以 2 秒楼层等待重试后，专项为 19/20；第二版加入 settled-floor 检查但仍用 2 秒上限，专项为 4/20。第二版失败截图显示玩家在 helper 超时后实际已落地，说明在该运行条件下 2 秒上限不足。这里如实记录各轮结果，不把中间运行描述为全绿。

最终只修改 `e2e/events.spec.ts`、`e2e/npc.spec.ts` 中的测试准备 helper：每次只发送一个 E，然后最多等待 5 秒，直到 `currentFloor` 为原楼层或目标楼层且 `stairClimb` 已结束；只有确认仍在原楼层、楼梯动画也已结束时才允许再次尝试。到达目标层并落地后 helper 才返回。这样保留楼层切换的真实 E 输入，避免动画期间重复触发下一次爬楼；没有改游戏运行逻辑，也没有放宽或删除任何业务断言。最终两条目标用例各重复 10 次，20/20 通过；最终版完整 E2E 92/92 通过，耗时 15.8 分钟。此前出现过的 19/20 与 4/20 中间结果仍保留在记录中，不宣称所有中间运行全绿。

## 验证结果

- `npm run typecheck`：通过。
- `npm test`：51 个文件、661/661 项通过。
- `npm run build`：通过；保留已有的单 bundle 大于 500 kB 警告。
- 追加 events/NPC helper 前的三轮完整 E2E（候选配置、单 worker）：第一轮 92/92（15.9 分钟）、第二轮 90/92（16.4 分钟）、第三轮 92/92（16.1 分钟）；漏水用例三轮均通过。第二轮两项失败分别为 `events.spec.ts` 等待 wanderer 精灵 5 秒超时，以及 `npc.spec.ts` 在楼层准备后等待阿林对话的 E 输入超时。
- 修复前 events/NPC 目标合计 7/10；第一版 helper 19/20；第二版 4/20（2 秒 settled wait 超时）；最终版两条目标各 10/10、合计 20/20；最终版全量 E2E 92/92、15.8 分钟。运行范围只包括上述测试准备 helper；最终验证未观察到这两条用例残留 flake。
- 默认 `playwright.config.ts` 枚举出 30 个文件、92 项；其 smoke 实际运行 1/1 通过。
- 修复前条件与截图/trace 目录：`/tmp/floor100000-eng02-before-20261112/`。最终专项日志与结果：`/tmp/floor100000-eng02-after-20261112/post-fix-targeted-repeat3.log`、`/tmp/floor100000-eng02-after-20261112/target-round3-results/`。最终全量日志与结果：`/tmp/floor100000-eng02-after-20261112/full-e2e.log`、`/tmp/floor100000-eng02-after-20261112/full-e2e-results/`。全量运行中的 18 张显式 UI 预览截图最终存于 `/tmp/floor100000-eng02-generated-ui-previews-20261112/`；最终工作树中没有遗留 `art-src/community-ui/`、`e2e/screenshots/` 或这些截图文件，也没有截图链接/测试产物残留在共享工作树。

## 复现命令

依赖已安装且 Playwright 1.64.1 Chromium 已安装时，项目常规检查为：

```bash
npm run typecheck
npm test
npm run build
CI=1 npm run test:e2e -- --config=playwright.candidate.config.ts --workers=1 \
  --output=/tmp/eng01-02-e2e-full-results
CI=1 npm run test:e2e -- --config=playwright.config.ts --workers=1 \
  --output=/tmp/eng01-02-default-config-smoke e2e/smoke.spec.ts
```

本次最终目标专项与完整 E2E 在一次性 `/tmp` 运行目录中执行；相对截图路径、Playwright 结果和日志均放在临时目录。记录的实际命令为：

```bash
cd /tmp/floor100000-eng02-after-20261112
CANDIDATE_E2E_PORT=5304 ./node_modules/.bin/playwright test \
  --config=/tmp/floor100000-eng02-after-20261112/playwright.debug.config.ts \
  --workers=1 \
  --grep='the wanderer is avoidable|trade with 阿林 changes the bag' \
  --repeat-each=10 \
  --output=/tmp/floor100000-eng02-after-20261112/target-round3-results
CI=1 CANDIDATE_E2E_PORT=5305 ./node_modules/.bin/playwright test \
  --config=/workspace/floor-100000-eng-01-02-20261112/playwright.candidate.config.ts \
  --workers=1 \
  --output=/tmp/floor100000-eng02-after-20261112/full-e2e-results
```

CI workflow 在一次性 runner/container 中执行候选配置与单 worker：`npm run test:e2e -- --config=playwright.candidate.config.ts --workers=1`。截至本地验证结果收集截止时，远端 post-fix Actions 尚未运行；该句只描述测试记录的截止状态，不代表之后的授权提交、推送与 Draft PR 状态。
