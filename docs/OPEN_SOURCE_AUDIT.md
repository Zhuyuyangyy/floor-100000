# 开源整合审计 / OPEN_SOURCE_AUDIT

- 任务：GHI-01（只读审计）
- 核验日期：2026-10-26
- 约束来源：`CLAUDE_INTEGRATION_PROMPT.md` + `GITHUB_INTEGRATION_PLAN.md`
- 范围：本轮**只读审计**。未安装依赖、未复制外部代码、未改业务代码 / lockfile / Electron·NSIS 配置、未提交推送。
- 说明：许可证均以仓库/包内 `LICENSE`/`package.json` 原文核验（见下），未仅凭搜索摘要判断；无法抓取处已标注「未核实」。

---

## 1. 当前实际技术栈与版本（已执行：读 package.json / lockfile / node_modules）

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Phaser | **4.2.1**（stable） | 2D 渲染；匹配 phaser4-gamedev 技能 |
| TypeScript | 7.0.2 | strict |
| Vite | 8.3.5 | dev/build |
| Vitest | 5.0.5 | 单元测试 |
| @playwright/test | 1.64.1 | E2E（Chromium） |
| Electron | 45.0.0 | 桌面便携 exe |
| electron-builder | 26.18.0 | NSIS 安装程序 |

脚本：`dev / typecheck / test / build / preview / test:e2e / electron / dist:win / dist:installer`。
外部图片/音频素材：**无**（`src/render/pixelArt.ts`、`src/render/audio.ts` 全部程序化生成）。

## 2. 现有功能实现摘要（已执行：以代码为准）

| 功能 | 纯逻辑模块 | 渲染/场景 | 测试 |
| --- | --- | --- | --- |
| 背包（12 格/堆叠/满包） | `src/systems/InventorySystem.ts` | `GameScene` 背包面板 | `inventorySystem.test.ts` |
| NPC 对话 + 原子交易 | `src/systems/TradeSystem.ts`、`src/data/npcs.ts` | `GameScene` 对话树 | `tradeSystem.test.ts` |
| 楼层生成（确定性） | `src/data/floorTemplates.ts`、`src/systems/FloorSystem.ts` | `GameScene` | `floorTemplates.test.ts` |
| 随机数 | `src/core/rng.ts`（xorshift32 + deriveSeed） | — | `rng.test.ts` |
| 存档 | `src/systems/SaveSystem.ts`（序列化/版本/范围校验） | Boot 续玩 | `save.test.ts` |
| 制作/升级 | `src/systems/CraftingSystem.ts`、`src/data/recipes.ts` | `GameScene` 工作台 | `craftingSystem.test.ts` |
| 生存/胜败 | `src/systems/SurvivalSystem.ts` | End 场景 | `survivalSystem.test.ts` |
| 夜间事件 | `src/systems/EventSystem.ts` | `GameScene` | `eventSystem.test.ts` |
| 战利品 | `src/systems/LootSystem.ts` | `GameScene` | `lootSystem.test.ts` |

结论：背包、对话、交易、提示、存档均已用**纯 Phaser Graphics/Text + 可测纯 TS** 实现且被 E2E/单测覆盖，UI 已键盘可操作、体积极轻。

## 3. 候选仓库对照与许可证/兼容性证据

分类键：`REFERENCE_ONLY`（仅参考）· `DEPENDENCY_CANDIDATE`（可评估依赖）· `CODE_PORT_CANDIDATE`（可评估移植）· `REJECT`（拒绝）。

### A. Phaser 官方示例库 — `REFERENCE_ONLY`
- URL：https://github.com/phaserjs/examples ；在线 https://labs.phaser.io/
- 许可证：Phaser 引擎为 MIT（`phaser` 包 package.json）；examples 仓库根 `LICENSE` 本次未抓取到（404），**代码复制前需再核实具体示例授权**。
- 兼容版本：与已装 Phaser **4.2.1** 匹配的示例。
- 拟借鉴：场景生命周期、键盘、相机、动画、Tilemap 的正确 API 用法（写功能前先查示例，不凭记忆）。
- 重叠：无（仅参考）。
- 风险/测试：不作为依赖；引用时记录示例链接。
- 建议：**REFERENCE_ONLY**。

### B. Rex 插件（`phaser4-rex-plugins`）— `DEPENDENCY_CANDIDATE`（暂不建议引入）
- URL：https://github.com/rexrainbow/phaser3-rex-notes ；npm `phaser4-rex-plugins`
- 许可证：**MIT**（npm 核验）。
- 兼容版本：包最新 **4.2.0**；当前引擎 **4.2.1**（存在小版本偏差，需实测）。
- 依赖树（核验）：`graphology / dagre / i18next(+http-backend) / mustache / papaparse / js-yaml / webfontloader / tinyqueue / eventemitter3` 等 ~10 个间接依赖 → 打包体积显著增加。
- 拟借鉴：对话框/文本框、背包网格、滚动列表、Toast。
- 重叠：**高**——现有对话树、12 格背包、`flash()` 提示已是稳定、键盘可操作、被测试覆盖的轻量实现。
- 风险/测试：体积膨胀 + 版本偏差 + 替换风险 > 收益。
- 建议：列为 `DEPENDENCY_CANDIDATE`，但**本轮不建议引入**；仅当后续出现现有 UI 确实难以实现的具体需求时，先在独立分支做**单个组件**的隔离原型，测量 bundle 变化并对比，明显更优才保留（见 GHI-02）。

### C. Dungeon Crawler Now — `REFERENCE_ONLY`（架构参考）
- URL：https://github.com/JohnVonDrashek/dungeon-crawler-now
- 许可证：**MIT（© 2025 John VonDrashek）**（LICENSE 原文核验）。
- 兼容版本：Phaser 3 + TS + Vite；本项目为 Phaser 4，**场景代码不可直接移植**。
- 拟借鉴：`systems/` 分层、物品/背包/掉落/存档职责分离——与本项目「纯 TS 管规则、Phaser 只管渲染输入」一致。
- 重叠：中（思路一致，实现已独立）。
- 风险/测试：若真要复用某段代码，先核对该文件 MIT 与依赖，再小型独立提交并保留版权声明。
- 建议：**REFERENCE_ONLY**。

### D. math-dungeon-crawler — `REJECT`（代码）
- URL：https://github.com/TheBestNinja/math-dungeon-crawler
- 许可证：**仓库根未找到 LICENSE（main/master 均 404）→ 代码许可证不明确**；其 Kenney Tiny Dungeon 素材为 CC0（素材另论）。
- 兼容版本：Phaser 3；视角偏 3/4，与横版宿舍剖面不符。
- 拟借鉴：仅「规则与贴图映射分离」的设计思想（不复制代码）。
- 建议：**REJECT**（无明确许可证，不复制代码/素材）。

### E. Phaser 官方 Vite 模板 — `REFERENCE_ONLY`
- URL：https://github.com/phaserjs/template-vite （及 template-vite-ts）
- 许可证：Phaser 项目 MIT；用于对照官方脚手架。
- 建议：**REFERENCE_ONLY**；本项目已有 Electron/NSIS 与测试链，**不重新生成、不覆盖现有配置**。

### F. Tiddybub/2d-assets — `DEPENDENCY_CANDIDATE`（素材，逐个核验）
- URL：https://github.com/Tiddybub/2d-assets
- 许可证：**CC0 1.0（Public Domain Dedication）**（LICENSE 原文核验）；仍须逐包核对 `SOURCE.md` 的作者/视角/原生尺寸/再分发条件。
- 兼容版本：像素素材；需横版/正侧视、统一色板（`docs/05_ART_GUIDE.md`）。
- 拟借鉴：床、柜子、门、楼梯、瓶装水/食物图标（替换对应程序化占位）。
- 重叠：与 `pixelArt.ts` 程序化占位重叠。
- 风险/测试：画风/视角混搭；需游戏内截图审查；记录 `THIRD_PARTY_NOTICES.md`。
- 建议：`DEPENDENCY_CANDIDATE`；**一次只试 1 个素材包**，风格不符就继续用程序化占位。**GHI-04 已核实并结论为「本轮不引入」**，原因与后续触发条件见 `docs/GHI-04_ASSET_TRIAL.md`。

## 4. 结论与推荐
- **不引入任何运行时依赖**：现有背包/对话/交易/提示 UI 已稳定、键盘可操作、被 23 项 E2E + 单测覆盖且体积极轻；Rex 的 ~10 个间接依赖与 4.2.0↔4.2.1 版本偏差，收益不抵风险。
- 官方示例仅作 API 参考；Dungeon Crawler Now 仅作架构参考；math-dungeon-crawler 代码**拒绝**；Tiddybub 素材的授权已由 GHI-04 三级核实为 CC0 1.0（可商用、无需署名），但因**审计原定的床/柜子/门/楼梯在 1101 个包里没有像素画匹配**、覆盖面最广的 `generic-items` 实测为平滑矢量风，GHI-04 结论为**本轮不引入**，详见 `docs/GHI-04_ASSET_TRIAL.md`。

## 5. 唯一下一步任务（GHI-02）
**GHI-02：做一个隔离的 Rex UI 原型（可选，分支试验）**——在独立分支对「NPC 对话框」或「背包物品格」其一引入 `phaser4-rex-plugins` 做小型原型，验证键盘导航/换行/缩放/像素清晰/关闭返回，测量生产 bundle 体积变化，与现有实现对比；**只有体验/维护成本明显更优才保留依赖，否则丢弃并维持现状**。若倾向零依赖，则 GHI-02 改为「用现有纯 Phaser 方式打磨一处 UI（如交易确认框或物品 tooltip）」。

## 6. 本轮改动与测试状态
- 改动文件：`docs/OPEN_SOURCE_AUDIT.md`（新增）。GHI-01 当轮受「不提交」约束保持未暂存；后由 GHI-04 一并提交（见 `docs/GHI-04_ASSET_TRIAL.md` §7）。
- `git diff --stat`：空（无已跟踪文件改动；审计文档为未跟踪新文件）。
- 测试状态：本轮**未运行回归测试**（未改任何业务代码/依赖）；上方版本与文件清单为只读核验结果。
- **后续进展**：§3.B 的 Rex 插件已由 GHI-02 实测否决（证据 `docs/GHI-02_REX_EVALUATION.md`）；§3.F 的 Tiddybub 素材已由 GHI-04 核实授权并结论「本轮不引入」（证据 `docs/GHI-04_ASSET_TRIAL.md`）。
