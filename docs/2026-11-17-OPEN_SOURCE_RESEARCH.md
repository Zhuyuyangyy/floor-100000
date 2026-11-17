# 开源调研报告：面向《第100000层：末日宿舍》的 GitHub 项目借鉴与优化提案

- 调研 agent：research-oss
- 日期：2026-11-17（所有 star / 提交时间 / 许可证均为当日实时抓取）
- 约束：只读调研。未克隆仓库、未安装依赖、未修改游戏代码；仅读取公开页面与源码片段。
- 目标项目（只读参考）：`/d/ZYY_Inovation/game/floor-100000-ai-ci`（Phaser 4.2.1 + TypeScript 7 + Vite 8 + Vitest 5 + Playwright + Electron 45）
- 已知短板（按优先级）：① 相邻楼层陈设 draw call 多（无头 Chromium 60→47-51fps，RenderTexture.draw 丢 Graphics 之后批次）；② 游戏感/juice（战斗反馈、受击、震屏、命中停顿）；③ 生存平衡对物资极敏感（7 日模拟 42→20→6→2 连环红）；④ B4 100 区段按需生成；⑤ E2E 时序抖动（观测项）。
- 历史结论（不重复推翻）：Rex 插件已否决；Tiddybub 素材已核实 CC0 但本轮不引入；引入运行时依赖需单独评估。

---

## 1. 候选项目表

| 项目 | URL | star（抓取时点） | 最近推送 | 许可证（核实方式） | 与本项目相关点 | 可借鉴什么 |
| --- | --- | --- | --- | --- | --- | --- |
| **gamedev-skills/awesome-gamedev-agent-skills** | https://github.com/gamedev-skills/awesome-gamedev-agent-skills | **9,250** | **2026-11-12** | **Apache-2.0**（GitHub API `license.spdx_id` + README 标注；仓库内含 LICENSE/NOTICE） | 79 个 agent 技能覆盖本项目 5 个短板中的 4 个：`phaser-core`（**锁 Phaser 4.2.1**）、`game-feel`、`performance-optimization`、`procedural-gen`、`survival-crafting`、`save-systems` | 已全文读取 5 个 SKILL.md（见 §4）。trauma² 震屏、hitstop 重叠取最长、帧预算 16.67ms/p95 CI 门槛、200 种子 sweep、单 PRNG + 子种子派生、生存需求模拟测试清单 |
| **chongdashu/vibejam-starter-pack** | https://github.com/chongdashu/vibejam-starter-pack | 157 | 2026-04-15 | **无 LICENSE**（API `license=None`；raw LICENSE 链接两次抓取 503/404，按无许可处理） | `.agents/skills/phaser4-gamedev/references/rendering-and-performance.md` 是 Phaser 4 渲染性能专题参考（本项目 OPEN_SOURCE_AUDIT 提到的 phaser4-gamedev 技能大概率源自此）；`projects/oakwoods` 是 Phaser 平台 starter | 只借鉴思路（无许可证不搬码）：RenderTexture/DynamicTexture「queued work ≠ executed work，必须调 render()」、批处理断点清单、SpriteGPULayer/TilemapGPULayer 适用边界、像素画 roundPixels 在 v4 默认 false 的处理 |
| **notAnKy/riftbound-survivors** | https://github.com/notAnKy/riftbound-survivors | 2 | 2026-09-10 | **GPL-3.0**（API + README 许可证原文） | Godot 4 波次生存。`scripts/data/balance.gd` 单文件承载全部难度曲线；`tests/balance_report.gd` **用同一套公式走查全部 20 波**，报告"怪群是否超过玩家输出、钱包是否超过物价"；headless 集成测试驱动真实游戏并断言断言条数；quality 设置是**帧成本旋钮**（封顶伤害数字/散射/震屏等随规模膨胀的元素） | 只借鉴方法论（GPL 不搬码）：单文件平衡 + 公式复用报告 + 帧成本质量 dial。直接对应本项目「7 日模拟连环红」与性能预算 |
| **sunflower9264/inoita-game** | https://github.com/sunflower9264/inoita-game | 9 | 2026-11-17（当天） | **MIT（代码）**：LICENSE 文件原文核验（© 2026 sunflower9264，MIT 全文）；API `license=None` 属检测缺失。**注意：素材为原游戏版权，仅代码 MIT** | 罕见的 **Phaser 4.2.1 全栈真实游戏**（Inotia 4 同人重制）：实时战斗 + party AI、任务/对话/选择、`validate:content` 内容校验、cloud save、Android APK（自带 Chromium + OTA 热更）、GM debug 模式、`tests/combat.test.ts` | 代码可借鉴（MIT，保留版权声明）：Phaser 4.2.1 战斗/对话/内容校验的组织方式；Electron 之外的「自带 Chromium Android 壳」路线参考。**素材不可碰** |
| **GLukaz/OverclockedServerRoom** | https://github.com/GLukaz/OverclockedServerRoom | 1 | 2026-04-22 | **无 LICENSE**（API `license=None`） | Phaser 4 + TS + Vite 小生存原型：服务器过热/水位 tradeoff（「救服务器耗水，无视则丢服务器」）、`events/EventManager.ts` 定时难度升级、entities 分层 | 只借鉴思路：资源 tradeoff 压力设计与 EventManager 难度曲线结构；体量小，参考意义有限 |
| **danijar/crafter** | https://github.com/danijar/crafter | 607 | 2024-01-23（**2 年+ 未更新，降权**） | **MIT**（API） | 开放世界生存 RL benchmark：seeded 世界生成、food/water/shelter/defend 生存四件套、**22 项成就作为可机器判定的成功指标** | 思路（>2 年停更，仅概念）：把「7 日生存成功」拆成成就式指标（首次获得净水天数、饥饿告警次数等），让模拟报告可读 |
| **m2-md/game-feel-hitstop-juice** | https://github.com/m2-md/game-feel-hitstop-juice | **0** | 2026-09-03 | **MIT**（API） | 引擎无关 juice 微引擎：`hitstop.ts` 用**累加器**（冻结期 simDt=0、不丢时间；重叠取最长）、`noise.ts` **seeded 1D value noise**（无 Math.random、可测试）、`shake.ts` trauma² + seeded noise 采样 + 小角度旋转、`squash.ts` sx=1/sy 保体积、`flash.ts` 50-80ms、`feel.ts` 统一 `impact()` 管线（trauma 相加/hitstop 取大/squash 取强/flash 取亮） | 概念 + 可读源码（0 star 未经社区验证，不建议直接引依赖；MIT 允许借鉴实现思路）：**震屏噪声也走种子流**——与本项目「禁 Math.random 进世界生成」同哲学，回放可复现 |
| **Yakoub-ai/phaser4-gamedev** | https://github.com/Yakoub-ai/phaser4-gamedev | 30 | 2026-08-27 | **无 LICENSE**（API `license=None`） | Phaser 4（v4.2.1）技能包：26 skills + headless Playtest harness（启动真实游戏、捕获黑屏/素材 404/未捕获异常/**FPS 崩溃**、驱动输入、断言实时状态）；`--repeat N` 把失败分级 clean/intermittent/consistent；`--seed` **分离 RNG bug 与时序 bug** | 只借鉴思路（无 LICENSE 不搬码）：E2E flake 分级协议正好对症本项目「时序抖动降级为观测项」——用 --seed 证明某失败是帧时序而非逻辑 |
| **EnclaveGames/Enclave-Phaser-Template** | https://github.com/EnclaveGames/Enclave-Phaser-Template | 301 | 2026-11-07 | **CC BY-SA 3.0**（README 许可证段 + License.txt 指向；API NOASSERTION） | Phaser 4 移动端模板：boot/preloader/menu/gameplay 状态划分、相机 shake/flash/fade、PWA、渐进式加载 | 仅思路。CC BY-SA 3.0 需署名 + 相同许可传染，**不搬码**；且方向是移动/PWA，与本项目横版宿舍不完全匹配 |
| **TheDarkSkyXD/pirate-survival-beatemup-game** | https://github.com/TheDarkSkyXD/pirate-survival-beatemup-game | 0 | 2026-05-15 | **README 写 MIT 但仓库无 LICENSE 文件**（API `license=None`）——自相矛盾，按无许可对待 | Phaser 4 + Vite + TS 教学 starter：DOM shell 与游戏分离（`src/shell` 纯 DOM / `src/game` 引擎关注点）、debug panel、教程第 17 步专讲 juice | 仅思路：shell/场景分层与调试面板；且是未完成教学起点，无可玩实现 |
| **dmaslov/phaser-screen-shake** | https://github.com/dmaslov/phaser-screen-shake | 26 | 2014-08-29（**12 年未更新**） | MIT（API） | Phaser 2/3 时代震屏插件，`game.plugins` API 在 Phaser 4 已不存在 | **不建议**（见 §3） |
| **JohnVonDrashek/dungeon-crawler-now** | https://github.com/JohnVonDrashek/dungeon-crawler-now | 1 | 2026-01-11 | MIT（API） | Phaser 3 + TS 地牢爬行，上轮 OPEN_SOURCE_AUDIT 已列 REFERENCE_ONLY | 维持上轮结论；Phaser 3 场景代码不可直移 |

### 官方 Phaser 来源（非 GitHub 仓库，但为权威一手资料）

| 来源 | 日期 | 内容 | 用途 |
| --- | --- | --- | --- |
| https://phaser.io/tutorials/phaser-4-rendering-concepts | 现行教程 | 批处理家族表（Quad/TileSprite/Flat/PointLight…）、SAR（独立渲染）对象、批处理断点（滤镜/混合模式/光照/roundPixels/批次满 16,384 quads）、图集 + 1px padding、16MB 通用缓冲 | 性能提案 P4/P5 的理论依据 |
| https://phaser.io/news/2026/05/phaser4-spritegpulayer-performance | 2026-05 | SpriteGPULayer（静态 GPU 缓冲、单 draw call、member 修改昂贵、单纹理）+ TilemapGPULayer（整图层单 quad、4096² 上限、正交） | B4 规模化的选型边界 |
| https://phaser.io/devlogs/240 | dev log | static layers：从对象数据构建可复用缓冲，减少 buffer swap/draw call/uniform set | 陈设静态化路线 |
| https://phaser.io/packs/feel | 现行 | `game.feel.shake/addTrauma/hitstop/slowMotion/flash/zoomPunch`；**抖动取自游戏 seeded random stream（回放安全）、只写渲染偏移不动模拟** | API 设计借鉴；**账号门槛 + 闭源，不作为依赖**（见 §3） |

---

## 2. 优化提案表（按优先级）

> 总原则：全部提案**零新运行时依赖**（复用 Vitest/Playwright/Phaser 自带能力），与本项目「核心规则可测纯 TS、Phaser 只管渲染输入」架构一致。

### P1. 战斗 juice 层：trauma² 震屏 + hitstop + 受击闪白/伤害数字（对症短板②）

- **针对文件/系统**：`src/systems/combat.ts`（命中事件钩子）→ 新建 `src/render/juice.ts`（或扩展 `src/render/feedback.ts`，该文件已是零 Phaser 依赖纯函数 + 读 `config/game-balance.json` 单一数据源的先例）→ `src/scenes/GameScene.ts` 相机消费；单测进 `src/tests/feedback.test.ts` 同款模式。
- **借鉴自**：`gamedev-skills/awesome-gamedev-agent-skills` 的 `game-feel` SKILL.md（Apache-2.0）+ `m2-md/game-feel-hitstop-juice` 的累加器 hitstop 与 seeded noise 震屏（MIT）+ phaser.io/packs/feel 的 API 形状（仅设计）。
- **具体做法**：
  - 震屏 = trauma²，写**相机 offset**（绝不动物体，避免碰撞/瞄准失步）；trauma 随时间衰减，用**真实时间**衰减（hitstop 期间相机不冻住）；偏移用 seeded value noise / 叠加正弦（不用逐帧随机，避免电流杂音感；且与回放确定性一致）。
  - hitstop：真实时间计时器恢复；**重叠只取最长**（新的顿帧不被旧的提前结束）；冻结期只冻模拟，UI/震屏衰减走真实时间。
  - 分级表（game-feel skill 原文数值）：small=trauma 0.10-0.20/无 hitstop/0-4 粒子；medium=0.30-0.50/0.04-0.06s/6-12/闪白；large=0.70-1.00/0.10-0.15s/20-40/闪白+缩放+数字。每个事件一个 `feedback(tier, pos)` 入口，全游戏比例统一。
  - squash & stretch 保体积（sx=1/sy）+ easeOutBack 回弹；受击闪白 50-80ms。
- **预期收益**：战斗反馈从无到有；纯 TS 层可单测（契约：两次 30ms 内的顿帧后 timeScale 回到 1.0、trauma 在 1/decay 秒内归零、scale tween 终点为 1）。
- **风险/成本**：juice 过量致眩晕（用 tier 表 + P7 无障碍开关兜底）；改的是渲染层，不动模拟，回归面小。
- **新依赖**：无。

### P2. 单文件平衡 + 200 种子 sweep 平衡报告（对症短板③）

- **针对文件/系统**：`config/game-balance.json`（确认全部生存数值单一数据源收口，`feedback.ts` 已是此模式）；扩展 `src/tests/survivalBalance.test.ts` / `src/tests/survivalSim.test.ts`（现有 7 日模拟只跑 seed 1/42/2026 三个固定种子）；新增一个报告式脚本（`tools/balance-report.ts` 或 vitest reporter 形式）输出机器可读结论。
- **借鉴自**：riftbound-survivors 的 `balance.gd` + `balance_report.gd`（**用同一套公式走查全部波次**，GPL-3.0 仅方法论）+ procedural-gen SKILL 的 seed sweep（200 种子、报告失败数/分布/distinct 数、跨进程 digest 对比）+ survival-crafting SKILL 的「simulated needs: minutes from full to warning and to empty at idle and at sprint, printed against the day length」测试清单。
- **具体做法**：把 7 日模拟从 3 个种子扩成 **≥200 种子扫描**，每次改数值后输出：day-8 存活率、HP 分布（min/中位/max）、水/食物边际、失败种子清单。「tier1 加可搜床」这类改动**先跑 sweep 看边际再合入**，把 42→20→6→2 连环红变成可预期的数字。另补 survival-crafting 的核对清单：需求从满到告警/到空的分钟数（idle vs 赶路）对昼长打印。
- **预期收益**：平衡调整从「改一个数红三个测试」变成「sweep 报告显示边际还剩多少」；直接产出 CI 可挡的生存可行性门槛。
- **风险/成本**：200 种子 × 7 日模拟的测试时长（现有 sim 是 250ms 步进推进，可评估降步长或抽样）；无逻辑风险。
- **新依赖**：无。

### P3. 帧时间测量协议与 CI 门槛（对症短板①⑤）

- **针对文件/系统**：`e2e/`（现有 Playwright 链）+ `playwright.config.ts`；新 `tools/frame-stats` 脚本（可参照 `src/tests/bakeProbe.ts` 的 stub 思路在无 Phaser 环境下先测逻辑）。
- **借鉴自**：`performance-optimization` SKILL.md（Apache-2.0）的核心工作流：把抱怨变成数字（60fps=16.67ms 预算）→ **解 VSync/帧帽再测**（4ms 和 15ms 都显示 60fps）→ 读**帧时间 ms 不读 FPS** → 分 CPU/GPU 侧 → 修最大项 → 同机同场景 3 次复测 → 设预算并进 CI → 报告 avg/p95/p99。其 headless 脚本模式：`exit(1 if p95 > budget)` 直接做 CI 门槛。
- **具体做法**：本项目已有无头 Chromium FPS 观测（60→47-51fps），升级为：最差场景（相邻楼层满陈设）固定种子录屏回放式测量，输出 avg/p95/p99 ms，p95 > 16.67ms 即失败；E2E 时序抖动项改为「同种子 3 复跑方差报告」而不是单次观测。
- **预期收益**：性能回归可机器判定；「47-51fps」这类粗数字变成 p95 ms 可比对。
- **风险/成本**：无头环境测不到 GPU draw call 数（需另跑 spector/Phaser 调试或真机确认 draw calls）；测量协议本身零风险。
- **新依赖**：无（Playwright 已在）。

### P4. 陈设贴图图集化 + 消除批处理断点（对症短板①）

- **针对文件/系统**：`src/scenes/GameScene.ts`（`buildFloor` 一带 ~1844-1904：逐房间 `add.image` 造 tile_window/tile_door/furn_* + 多个 `add.graphics()`）+ `src/render/artpack.ts` / `src/render/pixelArt.ts`（贴图来源）。
- **借鉴自**：Phaser 4 Rendering Concepts 官方教程（「get objects batched together is texture choice」→ 图集 + 每贴图 1px padding；Image/TileSprite/Flat Graphics 是不同 family，混用即断批；滤镜/混合模式/光照/逐对象 roundPixels 都会断批）+ vibejam `rendering-and-performance.md` 的批处理断点清单与反模式。
- **具体做法**：① 把 `ENV_WALL/ENV_FLOOR/tile_*/furn_*` 分散贴图合并为少量图集（减少 texture bind）；② 同类陈设走同一 family（能 image 不 graphics）；③ 排查逐对象 roundPixels/混合模式差异；④ 静态陈设评估 dev log 240 的 static layer 或「整层画一次」路线；⑤ **先测量 draw call 数再动手**（P3 协议）。
- **预期收益**：直接针对 60→47-51fps 的根因（draw call 多）；预期回到 60fps 线。
- **风险/成本**：图集改动影响 `textureKeys.test.ts` 等贴图 key 测试与 `THIRD_PARTY_NOTICES` 流程；需重跑贴图相关单测；工作量中等。
- **新依赖**：无（TexturePacker 可用免费 CLI，也可用项目现有程序化生成思路自产图集——本项目 pixelArt.ts 本就是程序化烘焙）。

### P5. RenderTexture 烘焙 A/B 与正确用法（对症短板①）

- **针对文件/系统**：`src/tests/bakeProbe.ts`（已有烘焙探针雏形）+ GameScene 楼层构建路径。
- **借鉴自**：vibejam `rendering-and-performance.md`（「queued work is not the same as executed work. Call `render()` when the texture must update」）+ Phaser 4 Rendering Concepts（RenderTexture 是独立 family，与 Image/Graphics 批处理策略不同）。
- **具体做法**：针对已知「当前 Phaser 版本 RenderTexture.draw 丢 Graphics 之后批次」：做 A/B 测量——A：整层静态陈设一次性画进 RT 后 `render()`，场景只挂 1 个 RT；B：P4 图集路线。用 P3 帧时间协议裁决。若 RT 的批次丢失在当前版本无法绕过，则明确采用 B 并把结论写进 `docs/`（避免反复试错）。
- **预期收益**：把「烘焙方案未采用」从搁置变成有数据支撑的决策。
- **风险/成本**：RT 路线与像素清晰度/缩放交互需真机验证；低。
- **新依赖**：无。

### P6. B4 区段按需生成的种子派生与 sweep 验证（对症短板④）

- **针对文件/系统**：`src/core/rng.ts`（xorshift32 + deriveSeed，已符合「own the randomness」原则）、`src/core/tower.ts`、`src/systems/FloorSystem.ts`、`src/tests/rng.test.ts`。
- **借鉴自**：`procedural-gen` SKILL.md（Apache-2.0）：一个 seeded RNG 传给所有生成函数；**每区段/每系统派生 child stream**（「adding a decoration roll does not reshuffle the layout」）；生成进纯数据与渲染分离；**每次生成都验证**（连通性/出生点安全/出口可达）；200 种子 sweep + 跨进程 digest；**保存 seed + 生成器版本**（与 save-systems 联动）；「ship your own PRNG」——xorshift32 正是此路线的正确选择，把首组输出钉在测试里防重构漂移。
- **具体做法**：100 区段各自 `deriveSeed(parentSeed, sectionIndex)`；新区块只生成视口内区段（配合 P4/P5 的渲染成本）；sweep 200 种子验证确定性/连通/分布；存档 schema 加 generator version 字段（SaveSystem 已有版本校验结构可扩展）。
- **预期收益**：B4 规模化的确定性与性能同时可控；存档兼容有明确迁移点。
- **风险/成本**：派生方案一旦上线，旧存档的楼层复现路径变化——需 SaveSystem 版本迁移测试先行。
- **新依赖**：无。

### P7. juice 无障碍开关与「帧成本质量 dial」（对症短板②，附带着眼于①）

- **针对文件/系统**：`src/core/config.ts` / `config/game-balance.json`（juice 强度参数入配置）+ GameScene HUD/设置入口。
- **借鉴自**：game-feel SKILL 步骤 6（震屏强度 0-100% 默认 60-80%、reduce flashing 防光敏、reduce camera motion；大闪白 ≤3 次/秒 WCAG 2.3.1）+ riftbound-survivors 的「quality 是帧成本旋钮」：质量设置封顶**随规模膨胀的元素**（伤害数字、散射粒子、震屏幅度），低质量机真的能救命。
- **预期收益**：juice 可被玩家/测试调节；性能与体感从此是同一个旋钮，而不是两套系统。
- **风险/成本**：设置持久化（已有 localStorage 先例）；低。
- **新依赖**：无。

### P8. E2E flake 分级协议：--repeat N + --seed（对症短板⑤）

- **针对文件/系统**：`e2e/` + `playwright.config.ts`。
- **借鉴自**：Yakoub-ai/phaser4-gamedev 的 flake 检测设计（无 LICENSE，仅思路）：`--repeat N` 把失败分级 clean/intermittent/consistent；`--seed` 分离 RNG bug 与时序 bug。
- **具体做法**：给现有 E2E 加 repeat 变体：时序抖动类失败跑 N 次统计通过率，用固定 --seed 复跑——同 seed 稳定失败=逻辑 bug（要修）；同 seed 时好时坏=帧时序（维持观测项但留下证据链）。
- **预期收益**：「已降级为观测项」从主观判断变成可复现的分类规则；顺带能在 CI 里区分真回归与环境噪声。
- **风险/成本**：重复跑增加 CI 时长（可只对标记 flaky 的用例生效）；低。
- **新依赖**：无。

### P9. 生存成功指标成就化（对症短板③，低优先级）

- **针对文件/系统**：`src/tests/survivalSim.test.ts` 报告输出 + `src/systems/dailyGoals.ts`（已有每日目标系统可挂接）。
- **借鉴自**：danijar/crafter 的 22 项成就设计（MIT，2 年+ 未更新仅思路）：把「活到第 8 天」拆成可机器判定的子指标（首次获得净水的天数、饥饿告警次数、睡眠覆盖率等）。
- **预期收益**：平衡报告从单一 HP 数字变成多维曲线，数值调整的影响面更可读。
- **风险/成本**：低。
- **新依赖**：无。

---

## 3. 「不建议引入」清单及理由

| 对象 | 结论 | 理由（证据） |
| --- | --- | --- |
| Rex 插件（phaser4-rex-plugins） | **维持否决** | 历史结论（GHI-02 实测否决）：~10 个间接依赖 + 4.2.0↔4.2.1 版本偏差，收益不抵风险 |
| phaser.io/packs/feel | **不作为依赖**（设计可借鉴） | 账号门槛的闭源扩展包（free pack 但需 phaser.io 账户），无可审计 LICENSE/源码；其 trauma/addTrauma/hitstop/seeded jitter 的 API 设计已在 P1 中借鉴 |
| dmaslov/phaser-screen-shake | **不建议** | 2014-08-29 后停更（12 年），`game.plugins` 为 Phaser 2/3 API，Phaser 4 不存在；trauma² 思路已由 game-feel skill 与 m2-md 以现代方式覆盖 |
| vibejam-starter-pack / Yakoub-ai/phaser4-gamedev / OverclockedServerRoom / pirate-survival-beatemup-game（TheDarkSkyXD） | **不搬码，只读思路** | 均无 LICENSE 文件（API `license=None`；pirate-beatemup README 自称 MIT 与实际不符）；无许可证 = 默认保留所有权利，复制有法律风险 |
| notAnKy/riftbound-survivors | **不搬码，只借方法论** | GPL-3.0 copyleft：引入代码会要求本项目衍生部分同样开源；`balance.gd` 的数字与公式思路已在 P2 用自有代码重写 |
| EnclaveGames/Enclave-Phaser-Template | **不搬码** | CC BY-SA 3.0（署名 + 相同许可传染）；且方向为移动端/PWA 模板，与本项目场景结构重叠度低、收益小 |
| danijar/crafter | **不引入**（概念已吸收） | Python/pygame 技术栈不相关；2024-01-23 后 2 年+ 未更新（降权）；仅成就指标设计被 P9 吸收 |
| m2-md/game-feel-hitstop-juice | **不作为 npm 依赖** | 0 star、未经社区验证；但其 MIT 许可的实现思路（hitstop 累加器、seeded noise 震屏）已在 P1 自行实现，无需承担供应链风险 |
| Tiddybub/2d-assets 素材 | **维持 GHI-04 结论（本轮不引入）** | 历史结论：CC0 已核实但无像素画匹配 |

---

## 4. 方法论备注（结论的核实深度分级）

**A. 核验到源码/文件原文的（最强证据）：**
- `awesome-gamedev-agent-skills` 的 5 个 SKILL.md 全文（raw.githubusercontent 抓取）：`game-feel`（tier 表、trauma²、hitstop 重叠规则、无障碍、GDC 2016 出处）、`performance-optimization`（16.67ms 预算、p95 CI 门槛脚本、池化/断批/GC 清单）、`procedural-gen`（SplitMix64 钉输出、child seed、200 种子 sweep、跨进程 digest）、`survival-crafting`（需求模型/昼长配比/模拟测试清单）、`phaser-core`（锁 Phaser 4.2.1，v3→v4 API 差异清单，含 4.2.1 键盘 defaultPrevented 行为）。
- `riftbound-survivors` 的许可证原文（GPL-3.0 README 全文）与 balance.gd/balance_report.gd 的描述（README「For developers」节）。
- `inoita-game` 的 LICENSE 文件原文（MIT，© 2026 sunflower9264）与 README（素材版权声明）。
- `m2-md/game-feel-hitstop-juice` 的分层源码说明（README 逐文件描述）。
- `EnclaveGames/Enclave-Phaser-Template` 的许可证段（CC BY-SA 3.0）。

**B. 仅 README/页面层面的（中等证据）：**
- `OverclockedServerRoom`、`pirate-beatemup-game`、`vibejam-starter-pack` 的功能描述与目录结构（未逐文件读源码）。
- `crafter` 的机制描述（README）。
- phaser.io 四篇官方资料（教程/新闻/dev log/pack 页）为官方一手页面，非第三方转述。

**C. 实时 API 核验（元数据，非搜索摘要）：**
- 所有 star 数、`pushed_at`、`license.spdx_id` 均来自 GitHub REST API（`api.github.com/repos/...`）于 2026-11-17 抓取；star 为时点值（如 awesome-gamedev-agent-skills 组织页缓存显示 6.9k，API 实测 9,250，以 API 为准）。

**D. 未核实/存疑：**
- `vibejam-starter-pack` 的 LICENSE 文件：raw 链接两次抓取失败（503/404），API 显示 `license=None`——**按无许可处理**，若后续要复用其技能文本需再核实。
- `inoita-game` 的 API `license=None` 与仓库内实际 MIT LICENSE 文件不一致（GitHub 检测缺失），以文件原文为准。
- 未克隆任何仓库、未运行任何外部代码、未安装依赖；所有「可借鉴」均为阅读层面的结论。

**E. 与本项目现状的对照锚点（保证提案落地）：**
- `src/render/feedback.ts` 已确立「零 Phaser 依赖纯函数 + 读 `config/game-balance.json` 单一数据源」的先例，P1/P7 沿此模式。
- `src/tests/survivalSim.test.ts` / `survivalBalance.test.ts` 已有 7 日模拟与平衡规则测试，P2 是扩种子而非新写轮子。
- `src/tests/bakeProbe.ts` 已有烘焙记录探针，P5 有现成抓手。
- `src/core/rng.ts` 的 xorshift32 + deriveSeed 与 procedural-gen 的「own the randomness / child streams」完全同构，P6 主要是补 sweep 与存档版本字段。

---

## 5. 结论速览

- **一个仓库吃透四个短板**：`gamedev-skills/awesome-gamedev-agent-skills`（9,250★，Apache-2.0，2026-11-12 仍在推送，phaser-core 锁 4.2.1）——游戏感、性能方法、程序化生成、生存平衡的现代参考都在里面，且许可证干净。
- **一个方法论补最痛的平衡问题**：riftbound-survivors 的「单文件平衡 + 同公式报告」（GPL-3.0 只借思路）。
- **一个 Phaser 4.2.1 真实游戏参照**：inoita-game（9★，MIT 代码，当天仍在更新）。
- **零新依赖**：9 条提案全部用现有 Vitest/Playwright/Phaser 能力落地。

---

## 三句话总结

1. **最值得抄的 1 个**：`gamedev-skills/awesome-gamedev-agent-skills`（9,250★ / Apache-2.0 / 2026-11-12 仍在推送）——它的 `game-feel`（trauma² 震屏 + hitstop 重叠取最长 + 分级数值表）、`performance-optimization`（16.67ms 帧预算 + p95 CI 门槛）、`procedural-gen`（child seed 派生 + 200 种子 sweep）、`survival-crafting`（需求模拟测试清单）四个技能正好覆盖本项目 5 个短板中的 4 个，且 `phaser-core` 锁定 Phaser 4.2.1 与在库版本零偏差。
2. **最容易被忽略的 1 个**：`notAnKy/riftbound-survivors`（仅 2★，GPL-3.0 只借思路）的「单文件 balance.gd + 用同一公式走查全波次的 balance_report.gd」方法论——把 7 日生存模拟从 3 个固定种子升级成 200 种子 sweep 报告，直接对症「tier1 加可搜床导致 42→20→6→2 连环红」，这是本次调研中唯一直接命中平衡短板的可操作方法。
3. **明确不要碰的 1 个**：`phaser.io/packs/feel`（以及所有无 LICENSE 仓库如 vibejam-starter-pack / Yakoub-ai/phaser4-gamedev / OverclockedServerRoom / pirate-survival-beatemup 的代码）——前者是账号门槛的闭源包不可审计，后者无许可证默认保留所有权利；它们的 API 设计可以借鉴（P1 已吸收），但代码一律不搬、依赖一律不引。
