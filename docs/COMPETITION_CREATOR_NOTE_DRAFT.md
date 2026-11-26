# 《第100000层：末日宿舍》创作手记

> **提交前状态。** 方括号 `【待补：…】` 标记的是**必须有真实记录才能填**的内容——
> 工具使用截图、真人试玩反馈、公开链接、作者署名。这些不能由代码仓库推导，
> 也不能由任何人生成，只能由作者本人补齐。
>
> 除此之外的事实性陈述都标了出处文件，可以逐条核对。
>
> 模板依据：[魔搭官方创作手记模板](https://modelscope.cn/posts/437860)。
> 比赛入口：[AI+∞开发者创作大赛第三期](https://modelscope.cn/events/394/)。

| 项目 | 内容 |
|---|---|
| 作品名称 | 《第100000层：末日宿舍》（Floor 100000） |
| 作者 | 【待补：真实署名。仓库 `package.json` 无 author 字段，`LICENSE` 待权利人确认】 |
| 参赛方向 | AI 游戏作品 |
| 作品试玩链接 | `https://a1578804454-floor-100000.ms.show` —— **实例已公开，匿名访问已验证**（2026-11-26：门户页 200，应用 iframe 里游戏完整启动、真模型台词）。【待补：访问截图与设备】 |
| 演示视频 | 【待补：录制并上传后填写公开链接】 |
| 代码仓库 | [Zhuyuyangyy/floor-100000](https://github.com/Zhuyuyangyy/floor-100000) |

---

## 1. 创意与玩法

### 一句话

一座看不见底的十万层末日塔楼，玩家从最底层的一张床醒来，往上爬；楼上住着人，
而这些人由大模型"提议"、由游戏规则"裁决"来决定信不信你、给不给你东西、开不开门。

### 它不是什么

- 不是像素生存游戏加个聊天框。NPC 的对白不是装饰，它的**决策会改变库存、信任和门禁状态**。
- 不是"AI 自由生成的开放世界"。模型说的每句话都要过规则层，它**不能凭空造物资**。
- 不是已完成的十万层游戏。**当前可玩范围是第 1–5 层**（`config/game-balance.json` 的
  `playableFloorsV01: [1,2,3,4,5]`）。"第 100000 层"是设定目标，不是已实现的内容量。

### 一昼夜的循环

```
06:00 醒来 → 看补给与状态 → 决定今天上到第几层
      → 走路 / 搜刮容器 / 开问号点 / 打遭遇战 / 和邻居做交易
      → 东西装不下就得取舍，天黑前赶回宿舍
      → 喝水、吃饭、在工作台制作、升级家具
      → 20:00 后睡觉 → 新一天，资源更紧，目标重 roll
```

**核心取舍**：背包 12 格（`InventorySystem`），口渴每小时掉 3 点、饥饿掉 2 点
（`config/game-balance.json`），而搜刮要花 20 游戏分钟、制作 30、交易 15
（`ACTION_COSTS`）。所以"多搜一个箱子"和"天黑前回得去"是冲突的。

### 六位居民

不是两个商店老板，是一栋还有人住的楼。分散在玩家真正会走的三层
（`src/data/npcs.ts`）：

| 居民 | 楼层 | 身份 | 人格原型 | 他在意什么 |
|---|---:|---|---|---|
| 老陈 | 2 | 门房，坐了十几年 | neutral | 守住楼门，把还能住人的楼层记下来 |
| 阿林 | 2 | 维修工 | ally | 守住这层楼的线路，换维修材料 |
| 小周 | 2 | 门边收货的 | neutral | 换到口粮和净水，安稳过天 |
| 大刘 | 2 | 搬货的 | neutral | 把剩下的货搬完，换够吃的 |
| 小满 | 3 | 半大孩子 | neutral | 在三层捡够东西，等家里人回来 |
| 阿珍 | 5 | 食堂厨娘 | ally | 让食堂的灶别熄，来的人都有口热的 |

第 4 层（维修层）**故意没有居民**：那层是漆黑区域，加人前要先处理光照，
否则只是在黑暗里多几个看不见的名字。

【待补：作者用自己的话描述一次真实的试玩——最有趣的取舍是什么、希望玩家感受到什么主题。

---

## 2. 创作过程

### 起点与边界

项目用 **Phaser 4.2.1 + TypeScript（strict）+ Vite**。规则与渲染彻底分开：
`src/systems/` 是 32 个纯逻辑模块，**不 import Phaser**；场景层只负责输入与绘制。
所以 84 个单测文件能在毫秒级跑完，不需要浏览器。

另一个刻意的决定：**全项目禁用 `Math.random()`**，一律用
`deriveSeed(seed, day, 用途)` 派生（`src/core/rng.ts`）。同种子必然同结果——
这是离线回放基准能工作的前提。

### NPC 系统是怎么长出来的

分三代，每一代都是被上一代的问题逼出来的：

**第一代 · 确定性规则脑（当前默认）。**
`LocalPersonaBrain` 依据人格原型、昼夜、关系、记忆从固定句子中选一条。
玩家看到标签「本地行为 AI · 规则驱动」。它是**确定性的**，不是模型生成。
这一代的价值是：**没有模型配置时游戏完全可玩**，且行为可测试。

**第二代 · 单 NPC 闭环（阿林线）。**
模型提议 → `rulesExecutor` 裁决 → executor 落库。这一步确立了三层铁律，
但只覆盖一个人。

**第三代 · 统一契约（当前）。**
`competition-contract.ts` 定义 `CompetitionActionProposal`（8 种动作），
`competitionRules.ts` 拥有唯一否决权，`competitionRuntime.ts` 编排重规划循环。
`competitionModelBridge.ts` 把模型输出翻译成白名单提案——**翻译失败一律返回 `null`**，
绝不伪造动作。

### 加人时踩到的四个静默缺陷（真实记录）

把楼里从 2 人扩到 6 人时，出现四个**不报错**的缺陷
（完整记录见 `docs/B3-20_RESIDENT_ROSTER.md` §3）：

| 缺陷 | 表现 | 为什么危险 |
|---|---|---|
| `drawNpcs()` 用 `id === 'alin' ? 'npc_alin' : 'npc_xiaozhou'` 三元 | 第 3 个人起全部被画成小周 | 不报错，看起来"人加了但没生效" |
| `SOCIAL_NPC_IDS` 写死 `['alin','xiaozhou']` | 新居民赠礼时快照里没有自己 → **赠礼静默失败** | 玩家点了赠礼，东西没给，也没有报错信息 |
| `npcFactFromDef()` 里 `floor: 2` 写死 | 小满和阿珍的"不在同一层"距离校验永远算错 | AI 会对着 3 层的人说"你离我太远" |
| `ARCHETYPES` 是 `Record<NpcArchetype, …>`，每种原型只能挂一个 npcId | 六人里四个静默落到 `neutral` 兜底，五个人一种语气 | 玩家感觉"这些人说话都一样"，但代码看不出异常 |

**这四个的共同点：没有一个是崩溃或报错。** 它们只能被"专门为此写的测试"抓到，
所以后来加了 `src/tests/npcRoster.test.ts`（18 项断言）。

### 体型分配：一个可以量化的审美问题

六个人共享**一套骨骼**。区别只有调色板和体型系数 `bulk`。
初版把老陈和大刘都设成"壮"，两人剪影的 **IoU 到 0.975–0.991**——
一眼看过去是同一个人换了件衣服。

解决办法不是"再调调看"，而是把这个判断变成一个测试阈值：
把 `drawPose(cv, idlePose(0), colors, 0)` 的不透明像素做掩码，两两算交并比，
**同层任何两人必须 < 0.96**（`src/tests/npcRoster.test.ts:110`）。

最终分配（第 2 层四人，两两最大重叠 **0.925**，本仓库实测）：

| 居民 | bulk |
|---|---:|
| 老陈 | 0.60 |
| 小周 | 0.82 |
| 大刘 | 1.05 |
| 阿林 | 1.30 |

### AI 与个人分别完成了什么

**可以核实的：** 仓库里有真实的模型调用代码（`ollamaBrain.ts`、`server/npc-proxy.mjs`）、
真实的运行记录（`artifacts/spark-runs/*.json`，含 HTTP 状态、耗时、token 数）、
真实的线上验收结果（`artifacts/online-verify/api-verify.json`，**32 条里 31 条已验证通过**——
**2026-11-25 23:36 带 token 那一次的快照**；覆盖静态产物、
同源代理、密钥隔离、维修任务契约、真实模型决策、注入防护、限流熔断，
**不含记忆判据**；另一条「路径穿越」经复核为无效判据、不计入，
原因是我发现它的载荷在客户端就被 URL 规范化了，服务端从未收到 `..`——
这条已作为已知限制如实记录，见 `docs/SPARK_DEPLOY.md`。
（验收脚本本身已在 `4831b28` 修好：载荷原样发送，四档服务端实测里
「两道防线都删 → FAIL」能验出来、「只删一道 → 仍 PASS/SKIP」也如实写了；
（线上实例已公开，2026-11-26 重跑过一次：40 条判据 39 通过 + 1 条注明红因，见 `artifacts/online-verify/`。）
这些证明了"运行过"，但**不能证明用了哪个 AI 编程工具**。

【待补：作者真实使用的 AI 工具清单——工具名、版本、具体任务、日期、可核验记录
（截图 / 会话链接 / diff）。未使用就写"未使用"。不要把规则脑写成生成式模型，
也不要把"代码里有模型接口"写成"用模型开发了这个项目"。】

---

## 3. 工具应用与体验

### 可核实的部分

| 工具 | 用途 | 证据 |
|---|---|---|
| Phaser 4.2.1 | 渲染与输入 | `package.json` |
| TypeScript 7.0.2 (strict) | 全项目类型 | `tsconfig.json` |
| Vite 8.3.5 | 开发与构建 | `vite.config.ts` |
| Vitest 5.0.5 | 86 个文件 / 1229 项单测（1223 通过 / 6 跳过） | `npx vitest run` |
| Playwright 1.64.1 | 34 个 E2E spec + 2 个 live spec | `npm run test:e2e` |
| DGX Spark + Ollama | 本地推理（可选） | `artifacts/spark-runs/npc-qwen_latest-2026-11-25T09-52-05-090Z.json` |
| 魔搭 Docker 创空间 | 公开部署（同源代理） | `Dockerfile`、`ms_deploy.json`、`artifacts/online-verify/api-verify.json` |

### 模型接入的关键教训：`HTTP 200` 不等于成功

这是本项目最值得写进手记的一次真实排障。

**症状**：`npc-qwen` 返回成功，但 NPC 一个字不说，也没有任何动作。

**误判方向**：先怀疑网络、再怀疑 prompt、再怀疑规则层。都不是。

**真相**：`npc-qwen` 是带思维链的模型。`/v1/chat/completions` **忽略 `think:false`**，
模型仍先写完整 reasoning。一旦调用方限制了输出预算，返回就是
`HTTP 200` + `finish_reason: "length"` + **`content` 空串**。
旧代码拿到 `''`，解析失败，于是"没有提案、没有校验、没有执行、没有状态变化"——
但 HTTP 是成功的。

**实测对照**（同一 prompt、同一模型）：

| 接口 / 参数 | reasoning | completion_tokens | 耗时 | content |
|---|---:|---:|---:|---|
| `/v1/chat/completions`，`max_tokens=64` | 194 字符 | 64（截断） | — | **空串** |
| `/v1/chat/completions`，`think:false`（被忽略） | 2706 字符 | 797 | ~10s | 正常但极慢 |
| `/api/chat` + `think:false` | **0** | 51 | **2.98s** | 合法 JSON |
| `/api/chat` + `think:false` + `format:json`（现方案） | **0** | 45–79 | **2.45–3.46s** | 合法 JSON |

**修法**：改走原生 `/api/chat`，默认 `think:false` + `format:'json'`；
正文为空时**先判 `done_reason`**，被截断才放宽预算重试一次，其余一律返回 `null`
交给规则降级。**绝不把 `reasoning` 当正文**——思维链里常含半截 JSON，
直接解析会产出错误动作。

这次修复的完整记录在 `docs/competition/IMPLEMENTATION_STATUS.md`。

### 只有真机能抓到的第二个坑

代理模式下 `health()` 打的是代理的 `/healthz`，不是 Ollama 原生的 `/api/tags`。
写错的话 `/api/tags` 在同源代理上返回 404，于是"模型可用"被永久误判成"不可用"——
UI 永远显示降级文案，一次请求都发不出去。**三层单测全绿，只有构建产物 + 真浏览器能看见。**

### 工具使用记录（需作者补充）

- **Qoder：**【待补：实际功能、任务、体验，附截图。未使用写"未使用"。】
- **魔搭 API Inference：**【待补：核实是否调用。当前公开部署的代理确实调用
  `api-inference.modelscope.cn`（见 `server/npc-proxy.mjs:37`），可作为一条真实记录，
  但需补调用截图或日志。】
- **DGX Spark：**【待补：节点来源、部署模型、用途、日期。已有
  `artifacts/spark-runs/` 的运行记录可作为证据，但需作者确认该记录属于投稿版本。】
- **其他 AI 工具 / 算力：**【待补】

---

## 4. 问题与解决

### 4.1 已解决的问题（各附证据）

**① 模型空正文（见 §3）** —— 传输层改 `/api/chat` + `think:false` + `format:json`。

**② 竖屏适配** —— 把横屏游戏缩进手机竖屏会让可操作区域过窄。采用 Phaser 的
ENVELOP 显示方式，相机调整为居中窄视口；菜单、HUD、背包、触控按钮按窄屏布局。
触控移动在松手、取消、失焦、切后台时清除方向，避免角色持续移动。
证据：`docs/B3-UI-07_MOBILE_PORTRAIT.md`。

**③ 交易报价构成无限刷取环** —— 初版给了老陈「木材→电池」、大刘「电池→木材×2」，
玩家可以拿一块电池永远换下去。被 `survivalBalance.test.ts` 当场拦住
（报错 `fuse loops back through battery`）。修法：所有报价必须落在"汇点"上，
即消费世界供给且无任何报价把它还回来。现在有专门的断言
（`npcRoster.test.ts`「barter offers stay sinks, not fountains」）。

**④ 两个人长得一样** —— 见 §2 的 IoU 阈值方案。

**⑤ 六人同层时 E 键被抢占** —— 两个可交互物距离 ≤ `INTERACT_DISTANCE`(44px) 时，
按 E 只会打开数组里靠前的那个，另一个永远打不开。现在测试会扫同层每个居民与
每个容器、地面物品、上下楼出口的距离，以及 seed 1/42/2026 下问号点与商人的位置。

### 4.2 明显还没解决的问题（诚实列出）

| 问题 | 现状 | 影响 |
|---|---|---|
| **游戏内 NPC 运行时只允许 `dialogue`** | `src/scenes/GameScene.ts` 的 `getAiRuntime()` 里 `allowedActions: ['dialogue']` | 模型提议赠礼/维修/交易会被运行时拒绝并降级。**生成式决策尚未在正式游戏入口接通** |
| **赠礼/维修入口走离线场景** | `runAlinGiftScenario` / `runAlinRepairScenario` 是确定性函数 | 玩家点"赠礼"看到的是规则执行，不是模型决策 |
| 第二 NPC 未接入闭环 | 只覆盖阿林一条线 | 泛化性未证明 |
| 记忆影响决策：线上已验（过程要一起写） | **名场面 A「记忆改变行动」已在线上跑通**：记忆段 8 条判据全绿——三组对照全部成立（极性总增益 2.00 ≥ 1.50）、锚点回响命中 4 次、对照组零锚点成立、weight 专项极性差 1.50 ≥ 1.00 且单调成立 | 第一次线上跑是 **6 条红** → 定位到**产品**（提示词没把记忆写成决策因子、weight 渲染不对称）→ 改产品 → 重新部署 → 8/8 全绿。**weight 专项的差异全部来自负向档**：它证明「weight 的负面档能把态度从回报推向戒备」，正向档与中性档没有可观测差异。证据：`artifacts/online-verify/memory-evidence.json` |
| 模型质量未评估 | 只证明"能拿到合法提案且状态真会变" | 详见 `docs/BENCHMARK_REPORT.md` |
| 真人试玩 | 作者试玩记录见 `docs/COMPETITION_SUBMISSION_CHECKLIST.md` 的真人试玩条目 | — |
| 一天里约 8 小时无事可做 | `docs/M1_PLAYTEST.md` 实测 | 节奏问题，不是 bug |

【待补：如做过真人试玩，记录设备/浏览器、参与人数、实际反馈、修正前后对比。
没做过就不要声称做过。】

---

## 5. 经验总结

**① 把"模型不可信"当成设计前提，而不是异常处理。**
`competitionRules.ts` 不是 try/catch 外面的兜底，它是**主路径上的一道关**。
模型输出和玩家输入被同等对待：都只当"提议"看待。这个决定带来一个意外好处——
测试变得容易，因为裁决层是纯函数，不吃模型。

**② 能变成断言的审美判断，就应该变成断言。**
"两个人看起来像不像"听起来无法量化。但一旦定义了"剪影 IoU < 0.96"，
它就变成了一条测试，加人时自动检查，而不是等玩家说"这两个怎么长得一样"。
同理适用于"报价不能构成环""可交互物不能靠太近"。

**③ 静默失败比崩溃危险得多。**
扩到 6 人时的四个缺陷没有一个是异常。它们让代码"看起来在工作"。
对付它们的唯一办法是**专门为"看起来正常但其实错了"写测试**。

**④ 只有在真机上才能发现的 bug，必须在真机上验证。**
`HTTP 200 + 空正文` 和 `/healthz` vs `/api/tags` 这两个 bug，单测全绿，
只有真实模型 + 真浏览器能暴露。所以项目里有 `e2e-live/`（跑真实构建产物）
和 `artifacts/spark-runs/`（跑真实模型）。

**⑤ 诚实标注边界会提高而不是降低可信度。**
"当前只允许 `dialogue` 动作"这句话写在 README 里看起来是减分项。
但它让"我们实现了三层闭环"这句话变得可信——因为读者知道你没有把没做的说成做了。

### 下一步优先级

1. 把模型决策接进正式游戏入口（当前只接了离线场景）
2. 补齐多 seed 的 benchmark（`docs/BENCHMARK_REPORT.md` 里的 `【待实测】`）
3. 真人试玩与录屏
4. 公开部署已完成（实例已公开，公开地址已验证）

---

## 6. 工具与素材来源

### 源代码

- 仓库：[Zhuyuyangyy/floor-100000](https://github.com/Zhuyuyangyy/floor-100000)
- 许可证：**待定。** `LICENSE` 是草稿，`package.json` 无 `license` 字段。
  代码此前被描述为 "MIT-shaped original work"，但那是描述不是授权。
  详见 [`LICENSE`](../LICENSE) 与 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。

### 开发与测试框架

Phaser（MIT，运行时唯一依赖）、TypeScript（Apache-2.0）、Vite（MIT）、
Vitest（MIT）、Playwright（Apache-2.0）、Electron（MIT）。
逐项版本与许可证出处见 `THIRD_PARTY_NOTICES.md` §Build and test dependencies。

### NPC 规则实现

- 契约：`src/ai/competition-contract.ts`
- 裁决：`src/ai/competitionRules.ts`
- 执行：`src/ai/competitionExecutor.ts`
- 传输：`src/ai/brains/ollamaBrain.ts`
- 降级：`src/ai/brains/localPersonaBrain.ts`、`optionTreeBrain.ts`
- **默认规则脑不是外部模型或 API。**

### 模型 / 推理服务

| 用途 | 模型 | 位置 | 证据 |
|---|---|---|---|
| 本地真机验证 | `npc-qwen:latest`（17G，Qwen3.8 系微调） | DGX Spark + Ollama | `artifacts/spark-runs/npc-qwen_latest-2026-11-25T09-52-05-090Z.json` |
| 线上部署 | `Qwen/Qwen3.8-Flash-Next`（实例实配，见部署运行日志；服务端由 `NPC_MODEL_ID` 固定，请求体无法覆盖） | ModelScope API Inference | `artifacts/online-verify/api-verify.json` |

【待补：作者确认这两个模型是否都属于投稿版本的实际使用；若某一项未用于投稿版本，
应删除或明确标注为"开发期实验"。】

### 图片、音效、字体、动画

逐项核查结论（完整表格见 `THIRD_PARTY_NOTICES.md`）：

| 类别 | 来源 | 许可证 | 核查状态 |
|---|---|---|---|
| 字体 | Ark Pixel Font（TakWolf） | SIL OFL 1.1，`public/assets/fonts/OFL.txt` 有全文 | **已核实** |
| 选择箭头 | Kenney Pixel UI Pack | CC0 1.0 | **上游 URL 未离线复核** |
| 特效图集 | pixelfx（Patch Pixel / Hugo Duprez） | MIT | **哪些图来自 pixelfx 未逐文件记录** |
| 角色 / 家具 / 物品图标 / 环境 / 标题背景 | 项目负责人提供 | **权利人未声明** | **待作者确认** |
| 音效 | 无文件，全部 Web Audio 运行时合成（`src/render/audio.ts`） | — | **已核实（构建产物中无音频文件）** |
| 角色骨架与动画 | `art-src/rigs/*.svg` + `*.anim.json`，项目代码生成 | — | 版权人未记录 |

【待补：作者对 `public/assets/artpack/`、`env/`、`title/`、`weapons/` 的授权条款做出明确声明。
这一项直接影响能否公开仓库——公开仓库会授予访问者一份权利人可能并不想给的使用权。】

---

## 附：本文中所有可核对的数字

| 数字 | 含义 | 出处 |
|---|---|---|
| 1–5 | 可玩楼层范围 | `config/game-balance.json` → `playableFloorsV01` |
| 6 | 楼内居民数 | `src/data/npcs.ts` → `NPCS.length` |
| 84 | 单测文件数（`src/`） | `find src -name "*.test.ts" \| wc -l` |
| 34 / 2 | E2E spec / live spec 数 | `e2e/`、`e2e-live/` |
| 12 | 背包格数 | `InventorySystem` 常量 |
| 44 | 交互距离（px） | `src/core/constants.ts:157` |
| 0.96 | 同层剪影 IoU 上限 | `src/tests/npcRoster.test.ts:110` |
| 0.925 | 第 2 层四人最大 IoU（实测） | 本仓库用 `drawPose` 直接计算 |
| 32 | 线上 API 验收通过数（覆盖静态产物/代理/密钥/维修契约/模型决策/安全边界，**不含记忆**） | `artifacts/online-verify/api-verify.json`（数组 32 条，逐条 `ok: true`） |
| 3/3 | 线上真实模型推理成功数 | `artifacts/online-verify/real-model-runs.json` |
| 5316 | 线上均值延迟（ms，N=3） | 同上 → `avgMs`（单次 3932 / 3713 / 8302） |
| 6/6 | Spark 合法提案（N=6） | `artifacts/spark-runs/…json` → `summary` |
| 3830 / 4175 | Spark 中位 / P95 延迟（ms，N=6） | 同上 → `medianMs` / `p95Ms` |
| 9/9 | 离线回放一致（3 seed × 3 场景） | `artifacts/benchmark/competition-replay-default-seeds.json` |

**样本量提醒：** 延迟与成功率数字来自 N=3 和 N=6 的小样本。
它们证明链路可用，不构成稳定的性能估计。
