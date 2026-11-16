# 测试环境手册（AG-47，2026-11-16）

本文件记录三个"让绿色不可信"的测试环境问题的根因、修法与实测证据，以及日常操作规则。
三个问题都已修复并验证；文末列出残留风险。

**操作规则速查**

| 场景 | 命令 | 说明 |
|---|---|---|
| 单元测试（任何情况） | `npm test` | 走 `tools/vitest-run.mjs`，带环境指纹的缓存隔离，见 §1 |
| 单元测试（隔离 AI 配置） | `VITE_NPC_MODEL= npx vitest run` | 约定前缀写法，直跑也安全（process.env 优先于缓存里的 import.meta.env），见 §1 |
| 单元测试（禁止） | 裸 `npx vitest run`（尤其带 `.env.local` 的 worktree） | 会用默认共享缓存，可能命中历史污染条目，见 §1 |
| e2e（默认） | `npx playwright test` | 端口 5199 + 身份守卫，见 §3 |
| e2e（要独占端口） | 仿 `e2e/playwright.ag32.config.ts` 用没人占的端口 | 彻底消除"抢驻窄窗"，见 §3 |

---

## 1. vitest 共享缓存污染（AG-41 报的 P3-1）——已根治

### 现象

`src/ai/config.test.ts` 的「未 stub 时同样关闭（生产默认）」用例假失败：
`expected 'npc-qwen:latest' to be ''`。删掉 `.env.local` 后重跑**依旧失败**——
`import.meta.env.VITE_NPC_MODEL` 像被烙在了缓存里。

### 根因

Vitest 5 的 `fsModuleCache`（`node_modules/.vitest-cache`）把每个模块的 SSR 变换结果
落盘，缓存键是（vitest/dist/chunks/cli-api.De07GUeT.js `generateCachePath`）：

```
sha1(模块绝对路径 id + 文件内容 + environmentHash)
```

`environmentHash` 只覆盖配置（root/base/mode/plugins/配置文件内容/coverage……），
**不覆盖环境变量与 .env 文件**。而 Vite 的 SSR 变换会把 `import.meta.env`
序列化成字面量烙进变换结果：

```js
__vite_ssr_import_meta__.env = {"BASE_URL": "/", "DEV": true, "MODE": "test", "PROD": false, "SSR": true, "VITE_NPC_MODEL": "npc-qwen:latest"}
```

于是：在带 `.env.local`（`VITE_NPC_MODEL=npc-qwen:latest`）的 worktree 里跑过一次后，
缓存条目里烙着模型名；删掉 `.env.local` 再跑，文件内容没变、配置没变 → 缓存键不变 →
命中旧条目 → `src/ai/config.ts` 的 `envValue()` 回退分支读到烙进去的值 →
「生产默认关闭」假失败。

`node_modules` 是各 worktree 共享的 junction，缓存目录因此也是共享的（281M / 5768 条），
污染条目跨 worktree 堆积。缓存键里的绝对路径 id 使不同 worktree 不会互串，
但同一 worktree 内"建 .env.local → 跑 → 删 .env.local → 跑"必然踩雷。

活证：复现中被驱逐又重新生成的条目 `b3a85a61…` 与原来的干净条目
**缓存键完全相同**（同 id、同内容、同 environmentHash），只是烙入值从"无"变成了
`npc-qwen:latest`——一个键，两种内容。

### 修法（治本，不是每次清缓存）

`package.json` 的 `test` 改为 `node tools/vitest-run.mjs`。wrapper 做一件事：
**让缓存目录随"会影响变换结果的环境"变化**。

```
缓存目录 = <共享缓存>/projects/<worktree 根哈希>/env-<环境指纹>
环境指纹 = 进程里的 VITE_* 变量 + 项目根下全部 .env* 文件内容哈希
```

环境指纹正好覆盖 Vite `loadEnv` 会烙进 `import.meta.env` 的两类输入：
- 环境不变 → 目录不变 → 缓存照常命中（快；全量 84 文件约 5s）；
- 环境变了（建/删 `.env.local`、改 `VITE_*` 值）→ 目录变了 → 缓存未命中 →
  按当前环境重新变换，旧环境烙进去的值不可能再被读到。

wrapper 不做任何清理动作，也不掩盖失败：带 `.env.local` 跑 `npm test` 会**如实**
失败（与无缓存行为一致），只是失败原因永远反映当前环境而不是历史环境。

### 实测证据（2026-11-16，本 worktree）

| 步骤 | 命令 | 结果 |
|---|---|---|
| 复现-1 | 建 `.env.local`（VITE_NPC_MODEL=npc-qwen:latest）+ 驱逐旧条目后 `npx vitest run src/ai/config.test.ts` | 1 failed：`expected 'npc-qwen:latest' to be ''`（真失败：环境确实配了模型） |
| 复现-2（假失败） | 删 `.env.local` 后 `npx vitest run src/ai/config.test.ts` | **仍 1 failed**——缓存命中污染条目，删文件也不失效 |
| 修复验证 | 同一状态 `npm test -- src/ai/config.test.ts` | 7/7 通过（per-env 目录 `env-da39a3ee…`，按当前环境重新变换） |
| 不掩盖验证 | 重建 `.env.local` 后 `npm test -- src/ai/config.test.ts` | 如实 1 failed（用另一个目录 `env-c17eab5e…`，与无缓存行为一致） |
| 全量 | `npm test` | **84 文件 / 1528 测试全绿**（基线 1528，零变化） |
| 全量（约定命令） | `VITE_NPC_MODEL= npx vitest run` | **84 文件 / 1528 测试全绿** |
|  Remediation | 删除共享缓存中全部"烙入非空 VITE_NPC_MODEL"的条目 | 删 2 条（ag-41-spark-verify 的 `0f3da316…`、本次复现产生的 `b3a85a61…`），复扫 0 残留 |

**Remediation 第二轮**（合入集成分支 `8df7178` 后复扫，2026-11-16 晚）：
主工作区又出现 2 条烙入 `npc-qwen:latest` 的条目（其 `.env.local` 仍在，
无前缀直跑产生），已删；留存的 `2a5b32ab` 只烙入 timeout/url、模型为空，
是 `VITE_NPC_MODEL=` 前缀写法的正常产物，不删。删后复扫：烙入非空
`VITE_NPC_MODEL` 的条目 **0 条**。

**合入集成分支后**（`8df7178`，85 文件 / 1547）：`npm test` 与
`VITE_NPC_MODEL= npx vitest run` 均 **85 文件 / 1547 全绿**，tsc 干净。

### 操作规则

- **在带 `.env.local` 的 worktree 里，单元测试一律 `npm test`**；裸
  `npx vitest run` 仍走默认共享缓存，历史污染条目理论上仍可被命中。
- `VITE_NPC_MODEL= npx vitest run` 前缀写法不受影响：`process.env` 优先于
  `import.meta.env` 回退值，前缀为空串时缓存里烙什么都不会改变取值。
- 主工作区目前**有** `.env.local`（Spark 本地推理配置，`*.local` 不入库），
  按上一条同样适用。

---

## 2. Playwright teardown 病态慢（BUG-QA-05）——已根治

### 现象

`survivalJourney.spec.ts` / `tower.spec.ts` 测试体全过，但 teardown 报
`Tearing down "context" exceeded the test timeout`。AG-03（docs/qa/STALE_E2E.md）
实测：journey 主体 254.6s 完成，After Hooks 254.7s 开始，context close 直到 600s
超时都没结束，期间页面继续无人干预运行（游戏没冻结，是 context 关闭本身病态慢）。

### 根因

`playwright.config.ts` 原来写的是字符串 `trace: 'retain-on-failure'`。字符串形式会
沿用 Playwright test runner 的默认 trace 选项
（playwright/lib/worker/workerProcessEntry.js:561）：

```js
const defaultTraceOptions = { screenshots: true, snapshots: true, ... };
```

而 `screenshots: true` 在协议层的含义是 **screencast 持续录帧**
（playwright-core/lib/coreBundle.js `Tracing.start`：`screencast: options.screenshots`）。
即：不写 trace 选项 = 整个测试期间对页面连续录帧。

实测录帧规模：

| 测试 | 时长 | screencast 帧 | 帧体积 |
|---|---|---|---|
| tower › selecting a floor | 18s | 941 | 42MB |
| journey（整场） | ~4min 主体 | 1252 | 125MB |

teardown 要在页面仍以 60fps 渲染（Phaser 主循环）时拆除 screencast 会话，
这就是卡死的环节：AG-41 另测到 `page.route` + 该 trace 组合会让每个测试的 teardown
挂死 120s（e2e/spark.spec.ts 注释有记录，该 spec 已改用页内 fetch 桩规避）。
本机复现（修复前，2026-11-16 13:06）：

```
x 1 [chromium] › e2e\survivalJourney.spec.ts:163:3 › ... (14.1m)
  Tearing down "context" exceeded the test timeout of 600000ms.
```

测试体 12:55–12:59 全部完成（9 张里程碑截图为证），teardown 挂满 600s 超时，
总耗时 14m19s；运行期 artifacts 目录涨到 125MB 仍在涨（screencast 在挂死期间继续录）。

### 修法

`playwright.config.ts` 改为 trace 对象形式，显式关掉 screencast：

```ts
trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true },
```

诊断能力不受损：DOM 快照（`snapshots: true`，每步一份）、网络、console、源码、
失败截图（`screenshot: 'only-on-failure'`）全部保留，retained trace.zip 仍可在
trace viewer 完整复盘；丢的只是连续录帧（对断言游戏状态的测试没有诊断价值）。

### 实测证据

| 阶段 | 命令 | 结果 |
|---|---|---|
| 修复前 | `npx playwright test e2e/survivalJourney.spec.ts --workers=1` | 1 failed，`Tearing down "context" exceeded the test timeout of 600000ms`，14m19s，artifacts 125MB / 1252 帧 |
| 修复后 | 同命令 | **1 passed (4.2m)**，总 4m17s，screencast 帧 0，artifacts 11MB（仅网络资源等） |
| 修复后（回归） | `npx playwright test e2e/tower.spec.ts -g "selecting a floor" --workers=1` | 1 passed (17.7s)——关 screencast 后游戏动画/输入正常（曾怀疑 headless rAF 饥饿，实测排除） |

> 踩坑记录（环境级，非缺陷）：e2e 运行期间**创建/删除 `.env.local` 会触发 Vite
> 监视重启 + 整页 reload**，会把游戏打回标题菜单，后续 walkTo 全部超时。
> AG-47 复现问题 1 时误在 journey 运行中建了 `.env.local`，制造过一次 46.3s 的
> 假失败（截图显示菜单、wake 截图显示游戏正常，据此定位到 reload）。
> **e2e 跑着的时候别动工作区里的 `.env*` 文件。**

### teardown 病态的两个独立成因（AG-47 + AG-41/AG-44，不要混为一谈）

1. **screencast 全程录帧（本仓库 config 的默认行为，AG-47 定位）**：
   字符串 `trace: 'retain-on-failure'` 继承 `screenshots: true` → 协议层
   screencast。**不碰 page.route 的长 spec 也中招**（journey 即此），修法是
   config 层关 screencast（上面的对象形式）。
2. **`page.route` + trace 录制相互等待（AG-41 / AG-44 定位）**：在这台 Phaser
   页面上，`page.route` 走 Playwright 网络层，与 trace 的网络录制相互等待，
   每个测试的 teardown 挂死 120s（测试体 8s 就全过）。AG-44 实测：两个 e2e
   全跑完单跑也要 90–130s，全绿时只写 1KB 的 `.last-run.json`——**不是 trace
   体积，是这个组合本身**。

**防御规定（已写入 `playwright.config.ts` use 块注释）**：spec 需要 mock 网络时，
用 `page.addInitScript` 装**页内 fetch 桩**，**禁止用 `page.route`**。页内桩完全
不碰 Playwright 网络层，trace 开或关都确定性通过。范例与完整理由：
`e2e/spark.spec.ts` 顶部注释（AG-41 的原文）。Playwright 未来若修复该死锁，
此规定可复议——在此之前桩版无外部依赖、严格更稳。

### 全量 e2e 回归（2026-11-16，修复后配置）

33 个 spec / 123 个测试全部跑过（分批跑，每批独立起 dev server）：

- **122 通过**；唯一失败 `saveFailure.spec.ts:59`（「存档失败」警告出现后 10s 内
  不自行清除）。
- 该失败**与本次改动无关**：A/B 实证——同一用例在 `--trace on`（即修复前的
  screencast 开启行为）下**同样失败**，错误一字不差。属存量问题（产品或该 spec
  的时序假设），建议持有方排查存档失败闪烁的清除逻辑；按分工 AG-47 不动
  `src/**`，记录在此。
- 本机环境的两个干扰（都不是仓库问题，复盘长跑时需知）：
  1. **dev server 会在长跑中途静默死亡**（无 crash 日志，连接被拒）——一次
     123 测试的全量跑因此出现 76 个 `ERR_CONNECTION_REFUSED` 假失败和 10 个
     teardown 超时；同 spec 换稳定 server 重跑即过（stairNavigation 6/6、
     events+firstChapter+floor-environment 12/12、hudLayout+npc+npc-atoms 16/16）。
  2. 环境的 bulk-delete 守卫会拦截 Playwright 进程内的 artifact 清理
     （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，单进程删除满 50 次后触发），
     长跑中段开始报 teardown 超时——单批短跑不受影响。AG-44 同样连撞三次
     （281 个文件），其规避手法是独立 `outputDir`（见
     `e2e/playwright.ag44.config.ts` 注释）。
  长跑 e2e 建议分批（每批 3-5 个 spec），或接受 CI 的 `--workers=1 --retries=1`
  语义（continue-on-error 的既定决策见 docs/qa/ENV_NOTES.md §3）。

---

## 3. e2e 端口与身份防御复核——仍管用，已加强

### 机制（AG-15/AG-24 建立，本轮复核）

- `playwright.config.ts`：`baseURL` 与 `webServer.url` = `http://localhost:5199`，
  `command` 带 `--strictPort`（端口冲突大声失败，不静默换端口）；
- `e2e/verifyServerIdentity.ts`（globalSetup）：在**任何测试运行前** fetch 若干模块，
  从内联 sourcemap 的 `sourcesContent` 取出服务端实际编译的源码，与本 worktree
  磁盘上的同一文件逐字节比对——5199 上复用的 dev server 只要不是本 worktree 的代码，
  整轮 e2e 直接失败，而不是静默测错分支。

### 复核结论与加强

1. **仍管用**（三项实证，2026-11-16）：
   - 空端口：历次运行 Playwright 自建 server，守卫直接放行（平常路径）；
   - **外来 server 被拦**：用临时工具在 5199 起了一个"内容被改动但带合法 sourcemap"
     的服务 → `Error: [server-identity] http://localhost:5199 服务的代码与本 worktree
     不同：src/scenes/GameScene.ts（server md5 febe3163… vs 本地 md5 e5c66aad…）`；
   - **本 worktree server 放行**：本 worktree 的 vite 起在 5199 → 守卫 6 文件指纹
     全中 → smoke 1 passed (6.4s)（且复用了该 server）。
2. **指纹从 1 个文件扩到 6 个**：原来只探 `src/scenes/GameScene.ts`（"每个特性分支
   都会碰"的启发式）。两棵树只在别的文件上分叉时，单文件指纹会漏过去——
   正是守卫要防的"静默测错代码"。现探针：GameScene / core/config / core/constants /
   core/segments / core/tower / data/npcs。只增严，不放松；失败信息带文件级 md5。
3. **baseURL 解析经实证**：Playwright 会把顶层 `use` 合并进每个 project 的 `use`
   （实测：仅顶层声明 baseURL 的 config，`projects[0].use.baseURL` 仍读得到），
   所以 `config.projects[0].use.baseURL` 单源读取对主/hud/qa/ag32 四个 config 都正确。
4. **端口现状**：5199 当前无服务；主工作区的 dev server 实际跑在 **5396**。
   主工作区与各 worktree 同提交时文件逐字节相同，此时"误复用"无害；一旦分叉，
   GameScene（或其余 5 个探针文件）必然不同 → 守卫大声失败。

### 残留风险（未闭环，规避模式已知）

- **抢驻窄窗**：globalSetup 探测端口与 Playwright 随后启动 webServer 之间，
  外来服务理论上可能抢驻 5199 并被 `reuseExistingServer: !CI` 复用。窗口约 1-3 秒，
  守卫覆盖不到。结构性规避：用没人占用的专属端口——`e2e/playwright.ag32.config.ts`
  就是这么做的（5420），需要绝对确定时照它改一个临时 config。
- `playwright.hud.config.ts` / `playwright.qa.config.ts` 用 `reuseExistingServer: false`，
  Playwright 必自建 server，误复用风险结构上不存在；其守卫探针经顶层 use 合并后
  指向各自端口（5175 / 5183），行为正确。
- `reuseExistingServer` 语义本轮**未改**（保留"本地复用热 server"的便利，靠守卫兜底）。

---

## 4. 环境杂项

- **test-results/ 清理**：Playwright 启动时会清空 outputDir。本 agent 环境有
  bulk-delete 守卫（>50 文件的删除会被拦），大堆积需分批删或走 PowerShell
  `Remove-Item -Recurse -Force`。CI 的 e2e job 自带 7 天 artifacts 保留，本地
  trace 无长期价值，定期清即可（BUG-QA-03：曾堆积 16738 文件 / 1.1G）。
- **`.env.local` 与 Vite**：建/删 `.env*` 会触发 dev server 重启 + 整页 reload，
  运行中的 e2e 会被打回菜单（见 §2 踩坑记录）。
- **unit 与 e2e 的分工**：vitest 只测纯逻辑（node environment，无 Phaser/DOM）；
  运行时行为一律 Playwright。改 trace/端口相关配置后，至少回归
  `e2e/survivalJourney.spec.ts`（最长、trace 最大）与 `e2e/tower.spec.ts`。

---

## 5. 本轮变更清单

| 文件 | 变更 |
|---|---|
| `tools/vitest-run.mjs` | 新建：`npm test` 入口，per-(worktree, env 指纹) 缓存目录 |
| `package.json` | `test` 脚本改走 wrapper（仅此项） |
| `playwright.config.ts` | `trace` 改对象形式，`screenshots: false` 关 screencast（BUG-QA-05 根治） |
| `e2e/verifyServerIdentity.ts` | 指纹探针 1 → 6 文件；失败信息带文件级 md5；注释补根因与残留风险 |
| 共享缓存（非 git） | 删除 2 条污染条目（§1 Remediation） |
