# 环境与架构修复记录（AG-15，2026-11-15）

分支：`agent/2026-11-15/ag-15-env`（从 `integrate/sprint-01` 出发）
范围：`src/core/config.ts`、`playwright.config.ts`、`.github/workflows/**`（审查，无改动）、
`.gitignore`（审查，无需改动）、`src/tests/configImport.test.ts`（新建）、本文件。

## 1. `src/core/config.ts` 裸 JSON import 修复（BUG-QA-04）

### 修法与理由

**采用 import 属性 `with { type: 'json' }`**（src/core/config.ts:10）：

```ts
import balance from '../../config/game-balance.json' with { type: 'json' };
```

备选方案是"把 JSON 改成 TS 模块导出"，未采用，理由：

- `config/game-balance.json` 是文档声明的单一事实来源（  README.md / docs/02_TECH_SPEC.md / CLAUDE.md 引用它，e2e/survivalJourney.spec.ts、e2e/firstChapter.spec.ts 用
  `readFileSync + JSON.parse` 直接读文件）。改成 TS 要么搬数据（破坏单一事实来源），
  要么双份维护（必腐化）。
- import 属性是 ECMA-262 标准写法（旧的 `assert { type: 'json' }` 已废弃），
  Node ≥20.10 / Vite 5+ / Vitest / TS ≥5.3 全部原生支持，属于最小侵入修复。
- AG-03 在 `docs/qa/ACCEPTANCE_2026-11-15.md` §4.1 的结论与此一致。

### 四种环境实测证据（2026-11-15，本机 Node v22.22.2）

| 环境 | 命令 | 结果 |
|---|---|---|
| Node ESM（直接 import） | `node -e "import('./src/core/config.ts').then(m => ...)"` | ✅ `schemaVersion = 1` |
| Node ESM（反证） | 同命令 import JSON 文件本身（修复前同样报错） | ❌ 修复前 `ERR_IMPORT_ATTRIBUTE_MISSING`，修复后带属性 import ✅ |
| Vitest | `npx vitest run src/tests/configImport.test.ts` | ✅ 3/3 通过 |
| Vite build | `npm run build`（= `tsc && vite build`） | ✅ built in 2.05s；`dist/assets/*.js` 内联 JSON（grep 命中 `gameMinutesPerRealSecond`） |
| Playwright（AG-03 被卡的准确场景） | 临时 spec import `../src/core/constants`（链经 config.ts）后跑 `npx playwright test` | ✅ 1 passed (6.3s)（临时 spec 验证后已删，未提交） |

补充：`npx tsc --noEmit` 干净（exit 0）。

注意：纯 Node 直接 import `constants.ts` 会先死于**扩展名解析**（`./config` 无后缀），
这与本次修复无关，是 Node ESM 的固有限制；真实 Node ESM 消费方是 Playwright
（其 loader 负责 TS 扩展名解析），已由上行临时 spec 验证。

### 回归护栏

新建 `src/tests/configImport.test.ts`（3 个断言）：GAME_CONFIG 加载、
`STARTING_FLOOR` / `PLAYABLE_FLOORS_V01` 由 JSON 派生而非手抄。
注意 Vitest 的管线两种 import 形式都接受，**这个测试本身拦不住属性被删**——
真正强制执行属性的是 Node ESM / Playwright（见上表）。

## 2. 环境债清理（BUG-QA-03 / BUG-QA-05）

- 本 worktree 无历史堆积：`test-results/`、`playwright-report/` 不存在
  （AG-03 报告的 16738 文件 / 1.1G 在主工作区及其 QA worktree，按分工不可动）。
- `.gitignore` 审查：`test-results/`、`playwright-report/`、`blob-report/`、
  `.playwright/`、`e2e/screenshots/` **均已在列**，无需改动。
- 本次运行产物（`test-results/.last-run.json`、`dist/`）已删除，删前 `ls` 确认内容。
- Playwright trace/video 策略：维持 `trace: 'retain-on-failure'` +
  `screenshot: 'only-on-failure'` + `video: 'off'`——**已是"失败才留"**。
  teardown 病态慢（BUG-QA-05，context close >346s/646s）的根因是历次 trace
  堆积与长 journey spec 的大 trace，不是保留策略本身；改为 `on-first-retry`
  会在本地 `retries=0` 时丢掉首次失败的 trace，削弱 CI 之外的可诊断性，故不采纳。
  策略注释已更新，说明堆积风险与定期清理要求（CI artifacts retention 已设 7 天，
  本地 trace 无长期保留价值）。

## 3. CI 复核结论（`.github/workflows/ci.yml`，**无需改动**）

独立复核（与 AG-03 结论一致）：

- `verify` job（合并门禁）：`npm ci` → typecheck（`tsc --noEmit`，tsconfig `include`
  含 `e2e`，e2e 类型错误同样被拦）→ vitest 全量 → build。**四步齐全，门槛未降低。**
- `e2e` job：固定镜像 `mcr.microsoft.com/playwright:v1.64.1-noble`（与 devDependencies
  匹配）、Node 22、`--workers=1 --retries=1`、失败产物上传（retention 7 天）、
  `continue-on-error: true`。后者是文档化的既有决策（e2e 驱动真实 Phaser 循环，
  个别 spec 有时序抖动，合并不被硬币翻转 block；`verify` 才是确定性门禁）。
- 端口改动（5173→5199）对 CI 无影响：容器内端口独占，`reuseExistingServer` 在 CI 下为 false。

## 4. e2e 端口隔离

`playwright.config.ts`：`baseURL` 与 `webServer.url` 改 `http://localhost:5199`，
`webServer.command` 改 `npm run dev -- --port 5199 --strictPort`
（vite.config.ts 钉死 5173，CLI 参数优先于配置文件；strictPort 让端口冲突大声失败，
而不是静默换端口打到别的分支的 dev server 上）。配置注释已说明"避免与并行开发的
dev server 冲突"。

## 5. e2e 实跑结果（集成分支基线）

- `e2e/smoke.spec.ts`：✅ 1 passed (9.1s)——标题菜单、Enter 进 Game 场景、
  玩家精灵 + 楼层 HUD 渲染、无 page error / 404。同时验证了 5199 端口 webServer
  启动与健康检查。
- config 链 import 探针（临时 spec，已删）：✅ 1 passed (6.3s)。
- 全量 vitest：**68 文件 / 1083 测试全绿**（基线 1080 + 本次新增 3）。
- `tsc --noEmit`：干净。

## 6. 未处理干净的地方（移交）

- **BUG-QA-05（teardown 性能）未根治**：smoke 通过不能证明长 journey spec 的
  context close 性能；需要干净环境（无 1.1G 堆积）下重跑 `survivalJourney` 复核。
- 主工作区 / 其它 worktree 的 `test-results/` 1.1G 堆积按分工不可动，建议总控统一清理。
- `constants.ts` / `hudLayout.ts`（本分支为 `design.ts`，同样无 config 依赖）**无需同步改动**——
  修复只动了 config.ts 的 import 语句一行，下游接口零变化。
