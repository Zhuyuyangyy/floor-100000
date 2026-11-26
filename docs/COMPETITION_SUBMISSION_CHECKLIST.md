# AI+∞第三期参赛准备清单

> **只记录仓库/官方页面可核验状态。** 每条已勾选的项目都附证据位置；
> 未勾选的不代表没做，只代表【当前材料里没有证据】。
> 最后核验：2026-11-26。
>
> 图例：`[x]` 有证据可查 · `[ ]` 无证据或未完成 · ⚠️ 有证据但存在限制

---

## 一、必交项与发布状态

| | 项 | 状态 | 证据 / 缺什么 |
|---|---|---|---|
| [x] | **最终公开试玩链接** | **已部署，公开可达（2026-11-26 匿名实测）** | 魔搭 Docker 创空间 **Running**，可见性 `visibility: "public"` / `private: false`（OpenAPI `GET https://modelscope.cn/openapi/v1/studios/a1578804454/floor-100000` 实证）。公开地址 `https://www.modelscope.cn/studios/a1578804454/floor-100000` —— **匿名浏览器实测 200，门户挂出的应用 iframe 里游戏完整启动（Menu 场景、1280×720 画布），同源代理返回 `decisionSource:"model"` 的真模型台词**。⚠️ 应用本体跑在门户 iframe 里：顶层访问 `https://a1578804454-floor-100000.ms.show/` 会被网关 **302** 到门户页，所有魔搭创空间都是这个形态 |
| [ ] | **演示视频公开链接** | 未录制 | 操作提纲已就绪：`docs/competition/DEMO_SCRIPT.md`。录完需上传并验证无需登录可看 |
| [ ] | **按官方六节模板发布创作手记** | 草稿完善，待发布 | `docs/COMPETITION_CREATOR_NOTE_DRAFT.md` 已按六节结构重写，事实性陈述均标出处。未完成的 6 处 `【待补】` 见下方第五节 |
| [ ] | **报名构想公开帖及报名入口提交记录** | 待作者确认 | 仓库无该记录 |
| ⚠️ | **公开链接与作品版本一致** | 部分完成 | 线上产物特征（JS 文件名 `assets/index-DUjl--OX.js`、六位居民名）在 2026-11-25 23:36 与 2026-11-26 两次验收中一致。⚠️ 但 commit sha 仍未写进验收结果，需补 |

---

## 二、评分项证据

### 可玩性（30 分）

- [x] **核心循环可玩**：第 1–5 层探索/搜刮/交易/制作/睡觉/存档。
  证据：`src/systems/` 32 个纯逻辑模块；`e2e/survivalJourney.spec.ts`（真实走过 1–5 层、返家、睡觉）。
- [x] **单测覆盖**：84 个文件（`src/`）+ 2 个（`server/`），2026-11-26 05:39 实测 **1201 通过 / 6 跳过 / 0 失败**（1207 项）。
  证据：`npx vitest run`（复现命令）；历史记录见 `docs/B3-20_RESIDENT_ROSTER.md` §6（该处为 937 的旧快照）。
- [x] **六个可对话居民，各有独立人格与体型**。
  证据：`src/tests/npcRoster.test.ts` 18 项断言；`e2e-live/residents.spec.ts` 3 项（跑真实构建产物）。
- [x] **竖屏与触控适配**。证据：`docs/B3-UI-07_MOBILE_PORTRAIT.md`；`e2e/portraitTouch.spec.ts`（4/4）。
- [x] **桌面版打包可用**。证据：`package.json` 的 `dist:win` / `dist:installer`。
- [ ] **作者真人试玩**：未做。需记录体验者、设备/浏览器、阻塞点、反馈、改动前后对比。
  ⚠️ 仓库明确把"好不好玩"留给人工判定（`README.md` 旧版、`docs/M1_PLAYTEST.md`）。
- [x] **公开部署后的新设备冒烟测试**：已做（2026-11-26）。
  证据：`e2e-public/public-smoke.spec.ts` + `playwright.public.config.ts`——
  匿名浏览器打开公开地址 → 门户挂出应用 iframe → Menu 场景起来 → 走进第 2 层四个人在场 →
  同源代理在浏览器里返回 `decisionSource:"model"` 的台词。
  复现：`PUBLIC_BASE=https://www.modelscope.cn/studios/a1578804454/floor-100000 npx playwright test -c playwright.public.config.ts`。
- [ ] **手机范围说明要精确**：首层触控有 E2E；**完整五层旅程的 E2E 使用键盘**；
      移动中旋转不动态重排；地图没有竖屏适配。不得宣传"完整手机通关已验证"。

### AI 运用（25 分）

- [x] **三层闭环代码完整**：契约 / 裁决 / 执行 / 记忆 / 可审计导出。
  证据：`src/ai/competition-contract.ts`、`competitionRules.ts`、`competitionExecutor.ts`、
  `competitionRuntime.ts`、`competitionTrace.ts`、`competitionRunExport.ts`。
- [x] **规则层拥有唯一否决权，模型不能造物**。
  证据：`src/ai/config.ts:131` 的 `npcInventoryFromDef()` 从报价表推导持有物；
  七条拒绝原因枚举在 `competition-contract.ts:186-194`。
- [x] **赠礼改变真实库存、信任与记忆**。
  证据：`src/scenarios/alinGiftDemo.test.ts`；`e2e/competitionAiNpc.spec.ts`。
  ⚠️ 部分 E2E 使用测试物资注入，不能算作自然搜刮流程。
- [x] **维修门闭环**：信任 70 + 木材×2 + 胶带×1 → 材料消耗 + 门禁开启。
  证据：`src/scenarios/alinRepairDemo.test.ts`；`src/data/floorGates.test.ts`；
  `e2e/competitionAiNpc.spec.ts`「第2层保底材料可实际拾取…维修后实际进入第3层」。
  ⚠️ 浏览器测试会设置玩家位置。
- [x] **软锁防护**：第 2 层保底材料箱；`CraftingSystem` 预留维修材料。
  证据：`src/data/floorTemplates.ts` 的 `alin_repair_cache`；`src/tests/craftingSystem.test.ts`。
- [x] **离线回放确定性：9/9 逐位一致**。
  证据：`artifacts/benchmark/competition-replay-default-seeds.json`
  （3 seed × 3 场景，含 `contentSha256` 逐位比对）。
- [x] **真实模型推理跑过（DGX Spark 真机）**。
  证据：`artifacts/spark-runs/npc-qwen_latest-2026-11-25T09-52-05-090Z.json`
  —— **6/6 合法提案、空正文 0、中位 3830ms、P95 4175ms、thinking 全为 0**。
- [x] **线上真实模型推理跑过**。
  证据：`artifacts/online-verify/real-model-runs.json` —— 3/3 成功，
  4668 / 5289 / 6702 ms，`avgMs` 字段为 5553，`decisionSource: "model"`。
- [x] **同源代理安全边界**：Key 在服务端、单会话限流、每日预算、熔断。
  证据：`server/npc-proxy.mjs`；`server/npc-proxy.test.mts`；
  线上验收 **40 条判据，38 条通过、2 条 FAIL**（`artifacts/online-verify/api-verify.json`，
  数组 40 条、md5 `7bbdc073085d1368fc4bf92cbe07613e`，**2026-11-26 11:14 带 token 那次**）。
  ⚠️ 两条 FAIL **都已查实为判据侧问题，不是产品泄漏**：
  ①「路径穿越读不到源码」——线上拿到的是**网关自己的 400 错误页**（225B，Tengine），
  逐字查过**不含 `NPC_API_KEY`、不含源码**；判据只比「与基线不同」，
  把「400 错误页 vs 200 首页」读成了「命中源码」；
  ②「记忆权重影响决策」——正向极性在「无库存」条件下无可达动作（负向方向清楚：`neg` 全 `refuse`）。
  ⚠️ **上一版留档（2026-11-25 23:36）是 32 条基础段、md5 `cb827d5a…`、不含记忆段**——
  两份不能并列引用。详见 `docs/BENCHMARK_REPORT.md` §2.5 与 `artifacts/online-verify/README.md`。
  ⚠️ **畸形 URL 打死服务那条已修**（`0914cc1`，本次部署已含），不再是已知缺口。
- [x] **名场面 A「记忆改变行动」线上验证——已完成，但过程必须一起写。**
  证据：`artifacts/online-verify/memory-evidence.json` + `api-verify.json`（2026-11-26 11:14 那次，
  40 条判据 38 通过 / 2 FAIL）。记忆段 8 条里 **7 PASS / 1 FAIL**：
  三组对照全部成立（极性总增益 2.00 ≥ 1.50）、锚点回响命中 4 次、对照组零锚点成立
  （对照 0 次 / 治疗 4 次 → 锚点确实有区分力）。
  ⚠️ **必须同时写清过程，否则就是把一次修复说成一次发现：**
  ① **11:07 第一次线上跑这段是红的**（6 FAIL / 1 SKIP / 1 PASS）——模型读到了记忆，
  却十几次采样全选 `dialogue`；根因是提示词只把记忆当背景读物；
  ② 修法是**改产品不改判据**（`server/npc-proxy.mjs` 的 `buildMessages` 增加「记忆决策」契约：
  记忆必须影响选择，但仍然只能从「可用行动」里选、规则层照样能否决）；
  ③ **重新部署后重跑**才全绿。
  ⚠️ **仍红的 1 条是 weight 专项**：同文本只翻 `weight` 要求正向差 ≥1.0 档，
  但**本次观察没有库存**，正向动作 `gift/trade` 需真有物品才能合法表达，模型最多给 `dialogue`(0)；
  负向方向是清楚的（`neg` 4/4 全 `refuse`）。**不是接线问题**（强度词在提示词里逐字可查）。
  ⚠️ **不得用「真实模型决策 3/3、返回合法提案结构、提案是 dialogue、台词非空」去支撑记忆结论**——
  那五条证明的是「模型能产出合法提案」，不是「记忆改变了决策」。把前者当后者是偷换命题。
- ⚠️ | **模型决策接入正式游戏入口** | **进行中，未完成** | `src/scenes/GameScene.ts` 的 `getAiRuntime()` 里
  `allowedActions: ['dialogue']` 只放开对话。赠礼/维修入口走离线场景函数
  `runAlinGiftScenario` / `runAlinRepairScenario`。A1/A0 正在修。
  **不得声称"生成式模型已驱动全部 NPC 行为"**。
- [ ] **开发期实际使用的 AI 工具记录**：需补工具/模型/版本、日期、具体任务、
  输入输出或 diff。
- [ ] **Qoder / ModelScope API Inference / DGX Spark 逐项核实**：
  - 魔搭 API Inference：**已有真实调用证据**（`server/npc-proxy.mjs` 的默认上游 +
    线上验收 3/3），可直接引用，但建议补一张调用截图。
  - DGX Spark：**已有运行记录**（`artifacts/spark-runs/`），需作者确认该记录属于投稿版本。
  - Qoder：【待补：用/未用】
- [ ] **工具使用截图或记录**：游戏截图只能证明游戏画面，不足以证明用了某个 AI 工具。

### 完成度（20 分）

- [x] **可玩范围明确**：第 1–5 层。证据：`config/game-balance.json` 的 `playableFloorsV01: [1,2,3,4,5]`。
- [x] **十万层是设定不是内容**：README 已明确「第 100000 层是设定目标，当前可玩 1–5 层」。
- [x] **类型检查零错（本地）**。证据：`npm run typecheck`。
- [x] **构建通过**。证据：`npm run build`。⚠️ 主 JS chunk > 500 kB 有非阻断警告（既有）。
- ⚠️ | **CI 状态** | **修复中** | `verify` job（typecheck + 单测 + build）为确定性门槛。
  **当前 CI 上有 2 项代理静态资源测试失败，A5 正在修。不得写"CI 全绿"。**
- [ ] **公开构建验证与失败恢复**：受限于 private，未做。

### 创意与呈现（15 分）

- [ ] **录屏**：未做。操作提纲 `docs/competition/DEMO_SCRIPT.md` 已就绪。
- [ ] **录屏质量检查**：分辨率、字幕、音量、横屏可读性、链接访问。
- [ ] **参赛资格核实**：首发时间、原创声明、是否参加过其他赛事。仓库不能证明这些事实。
- [x] **截图素材齐备**：`docs/img/` 下 13 张，含标题/选人/宿舍/2 层四人/食堂/搜刮/背包/漏水/死亡。

### 创作手记质量（10 分）

- [x] **六节结构完整**：`docs/COMPETITION_CREATOR_NOTE_DRAFT.md` 已按官方模板重写。
- [x] **事实性陈述均标出处**：文末附「所有可核对的数字」表，每个数字指向具体文件。
- [x] **边界诚实标注**：专门有一节「明显还没解决的问题」，列了 7 项未完成。
- [x] **素材来源逐项列出**：见 `THIRD_PARTY_NOTICES.md`，分「已核实 / 声称 / 查不到」三档。
- [ ] **作者署名与 AI 分工**：`【待补】`，见下方第五节。

---

## 三、本轮新增/更新的材料（2026-11-25）

| 文件 | 状态 | 说明 |
|---|---|---|
| `README.md` | **重写** | 从开发记录改为作品页。含 Mermaid 三层闭环图、六人表、已完成/进行中两栏 |
| `LICENSE` | **新建** | MIT 草稿。**顶部与底部均标注「待权利人确认」**，并列出三项需权利人决定的事 |
| `THIRD_PARTY_NOTICES.md` | **大幅扩充** | 新增依赖表（9 个包的真实 `package.json` license 字段）、资源核查状态表、待决项清单 |
| `docs/AI_ARCHITECTURE.md` | **新建** | 三张 Mermaid 图：三层闭环 / 含代理层数据流 / 三种部署形态 |
| `docs/BENCHMARK_REPORT.md` | **新建** | 指标表 + 已填实测值（标来源文件）+ 大量 `【待实测】` |
| `docs/SPARK_DEPLOY.md` | **新建** | 两种部署形态、环境变量、验证命令、排障顺序、已知边界 |
| `docs/npc-sdk-example/ADD_A_RESIDENT.md` | **新建** | 加居民的 4 文件示例 + bulk 实测对照表 |
| `docs/COMPETITION_CREATOR_NOTE_DRAFT.md` | **重写** | 六节完整，含 7 项未解决问题、数字出处表 |
| `docs/COMPETITION_SUBMISSION_CHECKLIST.md` | **重写** | 本文件。每条附证据或明确缺什么 |

---

## 四、事实性冲突记录（核实时发现）

写材料时发现的、文档与代码不一致处。这些已在新材料中按**代码为准**修正：

| 冲突 | 旧说法 | 实际 | 处理 |
|---|---|---|---|
| R2 单测数字 | `IMPLEMENTATION_STATUS.md` 写「71 文件 / 887 项」 | 当前 84 个 `src/` 测试文件 + 2 个 `server/`；2026-11-26 05:39 实测 1207 项 / 1201 通过 | README 与手记统一用 **1201 通过 / 1207 项 / 86 文件**，不再沿用 887 或 937 |
| README 单测数字 | 「58 个文件 / 757 个用例」 | 已过时（是 M1 阶段的数字） | 已改为 86 文件 / 1207 项 |
| 线上验收通过数 | 旧材料写「25/25」 | `artifacts/online-verify/api-verify.json` 现为 **40 条 / 38 通过 / 2 FAIL**（md5 `7bbdc073…`，2026-11-26 11:14 带 token 那次，**含记忆段**）；上一版是 32 条 / 31 项已验 + 1 项无效（md5 `cb827d5a…`，11-25 那次） | 统一为 **「40 条判据，38 条通过，2 条 FAIL（均已查实为判据侧问题）」**，逐组写明覆盖范围（含记忆段）；**不再使用「32 项全过」或「40 项全过」** |
| 线上真实模型延迟 | 旧材料写「5359ms，5207/4636/6235」 | 当前文件 `avgMs` 为 **5553**，单次 **4668 / 5289 / 6702**；线上模型是 `Qwen/Qwen3.8-Flash-Next`（部署日志实测），不是文档里写的 `Qwen/Qwen3-8B` | 统一为当前文件值 + 当前模型名，出处指向 `real-model-runs.json` 与部署日志 |
| `docs/competition/RUBRIC_MAP.md` | 「ModelScope 尚未部署」「代码许可证未选定」 | 创空间**已部署 Running 且公开可达**（`visibility:"public"`）；**LICENSE 已定稿**（MIT，署名 Zhuyuyangyy，美术纳入同一授权，第三方逐项保留） | 两项均已更新 |
| `docs/competition/IMPLEMENTATION_STATUS.md` | 「ModelScope：尚未部署」 | 已部署 | 属于历史文档的时间点快照，未改（避免影响他人），在新材料中标注当前状态 |
| `docs/02_TECH_SPEC.md` §1 | 「不使用服务器、实时后端、外部 AI/模型 API」 | 线上部署形态**就是**服务器 + 外部 AI API | 该条的解除依据是 `docs/plans/2026-11-11-ai-npc-spark-integration-rfc.md`（仅限自有推理）。**当前线上部署用的是魔搭 API Inference，与 RFC 授予的范围不完全一致**，需作者确认合规性 |
| `THIRD_PARTY_NOTICES.md` 引言 | 「Third-party assets bundled」 | 实际也包含构建依赖，且代码许可证未定 | 已重写引言，并新增依赖表与待决项 |
| `README.md` 旧版 | 「757 个单测用例」「58 个文件」 | 83 / 1142 | 已修正 |
| AI 工具章节 | 旧草稿用 `src/ai/personalities.ts`（实际路径 `src/data/npcPersonalities.ts`） | 实际路径是 `src/data/npcPersonalities.ts` | `B3-20` §3 表格里的路径是错的，已在新建文档中避免 |

---

## 五、所有 `【待补】` 占位汇总

**这些只能由作者本人提供，无法从代码推导。**

### 5.1 创作手记（`docs/COMPETITION_CREATOR_NOTE_DRAFT.md`）

| # | 位置 | 要补什么 |
|---|---|---|
| 1 | 头部表格「作者」 | 真实署名。`package.json` 无 author 字段，LICENSE 待权利人确认 |
| 2 | 头部表格「演示视频」 | 录制并上传后的公开链接 |
| 3 | 头部表格「作品试玩链接」 | 改为公开后的访问截图与设备 |
| 4 | §1 末 | 作者自己的试玩描述：最有趣的取舍、希望传达的主题、真人反馈 |
| 5 | §2 「AI 与个人分别完成了什么」 | 真实使用的 AI 工具：名称、版本、具体任务、日期、可核验记录。未用写"未使用" |
| 6 | §3「工具使用记录」 | Qoder / 魔搭 API Inference / DGX Spark 逐项截图或日志 |
| 7 | §4.2 末 | 真人试玩记录（设备、人数、反馈、改动前后对比） |
| 8 | §6「模型 / 推理服务」 | 确认两个模型是否都属于投稿版本 |
| 9 | §6「图片、音效、字体、动画」 | 作者对 `artpack/`、`env/`、`title/`、`weapons/` 的授权条款声明 |

### 5.2 Benchmark 报告（`docs/BENCHMARK_REPORT.md`）

`【待实测】` 出现在以下指标（均需真机多 seed 采样）：

- 测试环境元信息：commit sha、量化、硬件、网络、日期、样本量、场景数
- 截断率
- **动作被接受率**、**非法动作拦截率**、按拒绝原因分布
- 赠礼完成率、维修开门完成率、说-做一致率
- 首次提案成功率、重规划成功率、重规划耗尽率、平均尝试次数
- 记忆中提及率、**记忆改变行动比例**、跨天记忆生效
- 降级次数、降级率、超时率

### 5.3 提交清单本身

- 演示视频链接
- 报名公开帖链接
- 真人试玩记录
- 参赛资格（首发/原创/旧赛史）确认
- 公开部署后的冒烟测试

---

## 六、许可证与第三方素材核查结论

### 6.1 已核实（有本地文件可读）

| 项 | 结论 | 依据 |
|---|---|---|
| Phaser 4.2.1 | **MIT** | `node_modules/phaser/LICENSE.md`，"Copyright (c) 2026 Richard Davey, Phaser Studio Inc." |
| Ark Pixel Font | **SIL OFL 1.1** | `public/assets/fonts/OFL.txt` 全文，"Copyright (c) 2021, TakWolf" |
| 音效 | **无音频文件**，全部 Web Audio 运行时合成 | `find public -name "*.mp3" …` 返回空；`src/render/audio.ts` |
| 9 个直接依赖的 license 字段 | 见下表 | 逐个读 `node_modules/<pkg>/package.json` |

| 包 | 版本 | License |
|---|---|---|
| `phaser` | 4.2.1 | MIT（**唯一进运行时的**） |
| `typescript` | 7.0.2 | Apache-2.0 |
| `vite` | 8.3.5 | MIT |
| `vitest` | 5.0.5 | MIT |
| `@playwright/test` | 1.64.1 | Apache-2.0 |
| `electron` | 45.0.0 | MIT |
| `electron-builder` | 26.18.0 | MIT |
| `@electron/packager` | 20.3.0 | BSD-2-Clause |
| `@types/node` | 26.6.5 | MIT |

### 6.2 只有声称、未离线复核

| 项 | 声称 | 为什么没核实 |
|---|---|---|
| Kenney 选择箭头 | CC0 1.0 | 文件在（`public/assets/ui/marker.png`），但上游 URL 与裁剪坐标无法离线复核 |
| pixelfx 特效图集 | MIT | `public/assets/fx/` 有 27 张 PNG，但**哪几张来自 pixelfx、哪几张项目自绘没有逐文件记录** |

### 6.3 查不到 / 权利人未声明

| 项 | 状态 | 影响 |
|---|---|---|
| **源代码许可证** | **未定。** `LICENSE` 是草稿，`package.json` 无 `license` 字段 | 公开仓库默认保留所有权利，他人不能合法复用 |
| **美术素材再分发** | **权利人未声明** | `public/assets/artpack/`（30 个文件）、`env/`、`title/`、`weapons/`、`ui/frame-*.png`、`ui/slot.png`。公开仓库会授予访问者一份权利人可能不想给的许可 |
| 角色骨架版权人 | `art-src/rigs/` 为项目生成，但版权人姓名未记录 | 影响 LICENSE 的 copyright 行 |
| `素材库/` 内容 | 该目录 README 自有记录，本次未审计 | 可能含第三方素材 |

### 6.4 结论

**公开仓库之前必须先解决 6.3 的前两项。** 代码许可证至少可以"暂用 MIT 待确认"，
但**美术素材的再分发条款是完全未知的**——这一项如果不明确，公开仓库就是把
权利人的图授权给了全世界。这不是文书工作，是法律后果。

---

## 七、官方参考

- [官方赛事介绍](https://modelscope.cn/events/394/)
- [官方创作手记模板](https://modelscope.cn/posts/437860)
- [比赛详细说明（第三方赛事信息页）](https://www.aibetas.com/aigc_events/ai-infinity-game-developer-competition-3)

**截止时间**：官方活动页显示报名截止 **2026-12-01 10:00**；
详细说明页所述时间与之有出入。**以魔搭报名/作品提交页面的最新通知为准**，
不要仅依赖本清单。