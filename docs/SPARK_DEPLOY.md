# 在 DGX Spark 上跑模型：部署与验证

> 本文说明如何把项目自有的 DGX Spark 节点接到游戏里，作为**可选**的推理后端。
> 两种部署形态（本地直连 / 公网同源代理）用的是同一套裁决层，只是传输层不同。
> 本文所有命令与变量名都来自仓库真实代码，出处标注在每一节末尾。

---

## 0. 这套东西解决什么问题，不解决什么问题

| 它做什么 | 它不做什么 |
|---|---|
| 让居民的对白由真模型生成，而不是从固定的两三句里挑一句 | 不让模型直接改生存数值、库存、战斗结果 |
| 模型输出的动作经 Validator 裁决后才落库 | 不保证模型决策"更好"——只是更丰富 |
| 推理不可达时**自动降级**为确定性规则脑，玩家无感 | 不影响游戏可玩性：没有 Spark 也能完整通关 |

**硬边界**：模型只"提议"。`src/ai/rulesExecutor.ts` 与 `src/ai/competitionRules.ts`
拥有最终裁决权。模型说"我有木材"但报价表里没有木材，提案直接被拒并降级。

---

## 1. 两种部署形态，先选对

```
形态 A · 本地直连（开发用）
  Browser ──HTTP──▶ Ollama @ 127.0.0.1:11434 ──▶ npc-qwen
  前提：本机或 SSH 隧道能到 Spark 的 11434

形态 B · 同源代理（公开部署用）
  Browser ──同源──▶ server/npc-proxy.mjs @ :7860 ──▶ ModelScope API ──▶ Qwen3-8B
                    （Key 只在这一层）
```

怎么选：`aiNpcConfig()`（`src/ai/config.ts:69`）自动决定。

| 条件 | 结果 mode |
|---|---|
| 未设 `VITE_NPC_MODEL` 且非生产构建 | `offline`（确定性规则脑） |
| 设了 `VITE_NPC_MODEL`，非生产构建 | `ollama`（直连形态 A） |
| `vite build` 生产构建 | `proxy`（形态 B，默认） |
| `VITE_NPC_PROXY=off` 强制关闭代理 | 按 `VITE_NPC_MODEL` 决定 |

> **这个默认值是有代价的取舍**：生产构建默认走代理，是因为"公开部署唯一的正确
> 形态是 Key 在服务端"。代价是本地想看生产构建时也得起一个代理进程。
> 出处：`src/ai/config.ts:82-86`。

---

## 2. 形态 A：直连 Spark（开发 / 调试）

### 2.1 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| 网络 | 能访问 Spark 的 `11434` 端口 | 常用做法是 SSH 隧道，见下 |
| 模型 | `npc-qwen:latest`（约 17G） | 带思维链的 Qwen3.8 系微调合并版 |
| Ollama 版本 | 需支持 `/api/chat` 的 `think` 与 `format` 参数 | 原生 `/api/chat`，**不是** `/v1/chat/completions` |

**为什么必须用原生 `/api/chat`：** 这是本项目踩过的最大的一个坑，值得单独说。

`npc-qwen` 是带思维链的模型。`/v1/chat/completions` 接口**忽略 `think:false`**，
模型仍会先写完整 reasoning。一旦调用方限制了输出预算，返回就是
`HTTP 200` + `finish_reason: "length"` + **`content` 空串**——正文一个字都没开始
写。旧代码拿到 `''`，解析失败，于是"没有提案、没有校验、没有执行、没有状态变化"，
但 HTTP 是成功的。这个 bug 只能在真机上抓到，单测全绿。

实测对照（同一 prompt、同一模型，摘自 `docs/competition/IMPLEMENTATION_STATUS.md`）：

| 接口 / 参数 | reasoning 长度 | completion_tokens | 耗时 | content |
|---|---:|---:|---:|---|
| `/v1/chat/completions`，`max_tokens=64` | 194 字符 | 64（截断） | — | **空串** |
| `/v1/chat/completions`，`think:false`（被忽略） | 2706 字符 | 797 | ~10s | 正常但极慢 |
| `/api/chat` + `think:false` | **0** | 51 | **2.98s** | 正常合法 JSON |
| `/api/chat` + `think:false` + `format:json` | **0** | 45–79 | **2.45–3.46s** | 正常合法 JSON |

现方案：`/api/chat` + `think:false` + `format:'json'`。
出处：`src/ai/brains/ollamaBrain.ts:7-12`、`:145-157`。

### 2.2 建立隧道

在开发机上（Spark 在局域网内可直接访问时跳过）：

```bash
ssh -N -L 11434:127.0.0.1:11434 <user>@<spark-host>
```

保持这个终端开着。验证隧道通不通：

```bash
curl -s http://127.0.0.1:11434/api/tags
```

应当返回 JSON，其中 `models[].name` 包含 `npc-qwen:latest`。
**这一步失败就不要往下走**——后面所有"模型没响应"都会长得一模一样。

### 2.3 配置环境变量

复制模板，改成本地值：

```bash
cp .env.example .env.local
```

`.env.local` 已被 `.gitignore` 忽略。关键四项：

```bash
VITE_NPC_ENABLED=true
VITE_OLLAMA_URL=http://127.0.0.1:11434
VITE_NPC_MODEL=npc-qwen:latest
VITE_NPC_THINK=off          # ← 必须 off，理由见 2.1
```

其余可选（默认值来自 `src/ai/config.ts:87-104`）：

| 变量 | 默认 | 含义 |
|---|---|---|
| `VITE_NPC_TIMEOUT_MS` | `45000`（直连）/ `20000`（代理） | 单次推理超时。45s 是给冷启动留的，不是给思维链 |
| `VITE_NPC_MAX_TOKENS` | `192` | 输出上限；被截断会自动放宽重试一次 |
| `VITE_NPC_ENABLED` | `true` | `false` 时不发任何请求 |

> **45 秒超时看起来离谱，但它是对的。** Spark 上 `npc-qwen`(17G) 冷启约 33s，
> 热推理关掉思维链后只要 2.5–3.5s。保留长超时是为了冷启动那一次加载。
> UI 不会卡：降级句先显示，结果到了再替换；对话已关则丢弃。
> 出处：`src/ai/config.ts:93-97`。

### 2.4 启动与验证

```bash
npm run dev
```

打开页面，走到第 2 层接近阿林按 **E**。预期行为：

1. **立刻**看到降级句（阿林的第一句问候，与改造前逐字节一致）
2. 数秒后该句被 AI 台词**替换**，右上角来源标为模型
3. 若模型不可达，第 1 步的句子**一直留着**，不报错、不卡住

### 2.5 一次性验证：真机推理记录

这是给评审看的证据采集器，产出的 JSON 不含地址与凭据：

```bash
SPARK_URL=http://127.0.0.1:11434 \
SPARK_MODEL=npc-qwen:latest \
SPARK_RUNS=3 \
node tools/spark-run-record.mjs
```

输出：`artifacts/spark-runs/<model>-<utc>.json`

它记录的是**传输层事实**：HTTP 状态、耗时、`eval_count`、thinking 长度、
正文长度、是否被截断、以及解析出的动作。仓库里已有一份真实记录：

```bash
cat artifacts/spark-runs/npc-qwen_latest-2026-11-25T09-52-05-090Z.json
```

已知结论（该文件 `summary` 段）：6 次全部返回合法提案、空正文 0 条、
中位数 **3830ms**、P95 **4175ms**。

### 2.6 联调测试（默认跳过，需显式开启）

```bash
SPARK_LIVE=1 npx vitest run src/ai/brains/ollamaBrain.spark.test.ts
```

不设 `SPARK_LIVE=1` 时这整个文件 `skip`——CI 上跑不了真机。
出处：`src/ai/brains/ollamaBrain.spark.test.ts:3,10-11`。

---

## 3. 形态 B：同源代理（公开部署）

### 3.1 为什么需要这一层

```
纯前端把 API Key 打进 dist   ===  把 Key 公开给每个访客
```

所以 Key 只存在于服务端进程的环境变量里。`server/npc-proxy.mjs` 同时做三件事：
静态托管 + NPC 决策代理 + 健康检查。一个容器，同源，没有 CORS。

**为什么一个容器而不是两个服务：** 代理和静态资源必须同源。跨源要么加 CORS、
要么再暴露一个域名。同源单容器也让 `GET /api/npc/decide` 这类误用自然落在 405 上。
出处：`Dockerfile:1-11`。

### 3.2 代理的三层防护

不是"显得有后端"，每一条对应一个具体攻击面（`server/npc-proxy.mjs:1-15`）：

| 防护 | 默认值 | 环境变量 | 作用 |
|---|---:|---|---|
| 字段白名单 | — | — | 只接受 NPC 观察对象；URL / model / max_tokens / system prompt 由服务端固定，请求体带了也**不读**。防止被当免费 OpenAI 代理 |
| 单会话限流 | 60s 内 12 次 | `NPC_SESSION_MAX_CALLS` / `NPC_SESSION_WINDOW_MS` | 按 clientId，防单人刷 |
| 每日全局预算 | 1800 次 | `NPC_DAILY_BUDGET` | 防被刷、防超魔搭免费额度 |
| 熔断 | 连续 5 次失败 → 冷却 60s | `NPC_BREAKER_THRESHOLD` / `NPC_BREAKER_COOLDOWN_MS` | 上游挂了就不再打扰它 |

### 3.3 环境变量（服务端）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `7860` | 魔搭 Docker 创空间硬要求 |
| `HOST` | `0.0.0.0` | 同上 |
| `NPC_UPSTREAM_URL` | `https://api-inference.modelscope.cn/v1` | OpenAI 兼容端点，可换成任何兼容服务 |
| `NPC_API_KEY` | 空 | **Key 只在这里。** 空 = 未配置，AI 走降级 |
| `NPC_MODEL_ID` | `Qwen/Qwen3-8B` | 服务端固定，请求体无法覆盖 |
| `NPC_MAX_TOKENS` | `320` | 服务端硬上限 |
| `NPC_REQUEST_TIMEOUT_MS` | `20000` | 上游超时 |
| `NPC_EXPOSE_ERRORS` | 未设 | 设 `1` 才向上游错误详情暴露给客户端；默认收敛成 503 + reason |

出处：`server/npc-proxy.mjs:31-54`。

### 3.4 本地起代理验证

```bash
npm run build
NPC_API_KEY=<你的 key> node server/npc-proxy.mjs
```

三个探针：

```bash
# 1) 健康检查（不应泄露 Key）
curl -s http://127.0.0.1:7860/healthz
# 期望：{"ok":true,"aiConfigured":true,"breakerOpen":false,"dailyUsed":0,"dailyBudget":1800}

# 2) GET 必须被拒
curl -i http://127.0.0.1:7860/api/npc/decide
# 期望：HTTP 405

# 3) 端到端（脚本含基础段 32 条 + 记忆段；记忆段条数会变，用下方命令现算）
# 输出默认落在仓库根的 output/online-verify/（脚本用 import.meta.url 定位，与 cwd 无关）。
# 想改位置就设 SHOT_DIR（相对路径按当前 shell 的 cwd 解析）。
# 注意：无 MS_TOKEN 时脚本一律不落盘，设了 SHOT_DIR 也不写——见下方说明。
ONLINE_BASE=http://127.0.0.1:7860 node tools/verify-online-api.mjs
```

> **输出目录的定位方式（曾经确实是个坑，现已修好）。** 早期版本把默认值写成
> 作者机器上的绝对路径 `D:/...`，`mkdirSync(..., { recursive: true })` 又不报错，
> 于是评委会在自己的盘根造出一个 `D:` 目录——**静默跑偏，比崩溃更难发现**。
> 现在改为 `resolve(dirname(fileURLToPath(import.meta.url)), '..')`（`:29-30`），
> 即以脚本自身位置推仓库根，**与从哪个目录调用无关**。
> 脚本注释里也写明了为什么不用 `process.cwd()`：那只是把不确定性换个地方。
> 复核：`grep -n "SHOT_DIR" tools/verify-online-api.mjs` 应看到 `resolve(REPO_ROOT, ...)`。

> **「设 `SHOT_DIR` 就能强制留档」这句话曾经是假的，现在要两个一起给。**
> 落盘门控看的是 `MS_TOKEN`，不是 `SHOT_DIR`——**没 token 时设了 `SHOT_DIR` 也不会写**
> （实测：目录保持空）。这是有意的：401 空跑出来的文件名叫「证据」、内容一条样本
> 都没有，谁打开都会误以为「跑过并且失败了」。只想看判据条数的话有逃生口，
> 但必须显式声明这不是证据：
>
> ```bash
> FORCE_WRITE=1 SHOT_DIR=/tmp/probe node tools/verify-online-api.mjs
> # 落盘后 api-verify-meta.json 里 forceWrite: true
> ```
>
> 只给 `FORCE_WRITE` 不给 `SHOT_DIR` 会被拒绝（防止覆盖默认目录里的真产物）。
> 同理 `SHOT_DIR` 解出来等于默认目录或等于仓库根，也会被拒绝——实测这三条
> 都是「打印一句拒绝、目录里 0 个文件」，而 `EXIT` 在成功和拒绝两种情况下**都是 1**
> （无 token 时验收不完整，退出码本来就该是 1）。**别拿退出码判断有没有落盘，数文件。**
>
> 想做对照实验、改一份副本再跑的话，**副本要留在 `tools/` 下**。脚本按自身位置推仓库根，
> 位置一变，「仓库根」跟着变——把副本放到别处去测「`SHOT_DIR=<仓库根>` 该被拒」，
> 实测会算出错误的根，然后真把文件写进仓库。**实验装置会改掉被测对象**，
> 这类判据必须在原位测。

> **门不止一道，而且最后一道和你拿没拿 token 无关。**
> 下表按**判据**分行，共八行，分属六个提交。**八行不等于现在生效八道**——
> 有两行已被后来的提交收严掉，当前真正在挡的是**六道**。把两个数字混着读，
> 会得出「八道门」或「六行」这种在任何一版代码里都对不上的结论：
>
> | 提交 | 判据 | 判据式 | 挡的是 | 现在还生效 |
> |---|---|---|---|---|
> | `600c450` | 基础三份无凭证不落盘 | `if (!meta.hasToken)` | 401 空跑覆盖 `api-verify`/`notes`/`meta` | 是（形态未变）|
> | `600c450` | `real-model-runs` 无凭证不落盘 | `if (TOKEN.length > 0)` | 同上，但这份当时单独判 | **已被取代** |
> | `d2b2f79` | 记忆两份也无凭证不落盘 | `if (TOKEN.length > 0)` ×2 | 401 空跑覆盖记忆证据 | **已被取代** |
> | `a2918b3` | `FORCE_WRITE` 必须配 `SHOT_DIR` | `FORCE_WRITE && !SHOT_DIR` | 只给开关不给目录 | 是 |
> | `215b210` | 不得解回默认目录 | `FORCE_WRITE && SHOT_DIR && resolve(SHOT_DIR) === DEFAULT_OUT` | `SHOT_DIR=output/online-verify` | 是 |
> | `3609d16` | 不得解回仓库根 | `FORCE_WRITE && SHOT_DIR && resolve(SHOT_DIR) === REPO_ROOT` | `SHOT_DIR=.` | 是 |
> | `3609d16` | **采样内容要有样本才写** | `CAN_WRITE_CHECKLIST && sampleCount > 0` | 无效 token 写出「三组全 `complete:false`」的假记忆证据 | 是 |
> | `4290c43` | **目标目录已有 `api-verify.json` 且本轮 0 样本 → 拒绝** | `OUT_HAS_EVIDENCE && modelSamplesObserved === 0` | 任何指向已有证据目录的写法 | 是 |
>
> **为什么 `600c450` 占两行：** 它在同一笔里用了**两种**写法，末尾那组是
> `if (!meta.hasToken) { 不写 } else { 写三份 }`，而 `real-model-runs.json` 外面
> 是 `if (TOKEN.length > 0)`。写成一行「基础四份」会掩盖一件事：这两种写法
> 后来是**分别**被处理的——`!meta.hasToken` 至今原样保留，`TOKEN.length > 0`
> 那三处在 `3609d16` 被统一换成了 `samplingWritable(...)`。
>
> **三道位置门都带 `FORCE_WRITE &&` 前缀，只有最后一道不带。** 这一点常被读漏：
> 没开 `FORCE_WRITE` 时那三道恒为 `false`，它们不是「位置检查」，是
> 「**强制留档时**的位置检查」。而 `4290c43` 那道没有前缀，所以它能挡住
> 「带（无效）token 走错目录」——那条路径压根不开 `FORCE_WRITE`。
> 判据式里省掉前缀，读者会以为「只要 `SHOT_DIR` 指错就拦」，实测不是。
>
> **`600c450` 不是一次就补全的。** 它只盖住六份落盘文件里的四份；两份记忆证据
> 当时是裸 `writeFileSync`，守卫是 `d2b2f79`（同日 02:56，晚 8 分钟）才补上的。
> 实测 `600c450` + JSON 401 桩 + 无 token：`api-verify` / `notes` / `meta` /
> `real-model-runs` 四份未动，`memory-evidence`（30B → 2564B）与
> `memory-weight-evidence`（37B → 405B）**被覆盖**。
> 这提醒的是：**一道门只覆盖「当时想到的那几份文件」，而文件清单会变。**
>
> **上面这个结论只对 JSON 体的 401 成立。** 若 401 的 body 是 `text/plain`
> （平台层当时就是），`600c450` 的 `/healthz` 是 `await r.json()` 没有兜底，
> 脚本直接抛 `SyntaxError` 崩掉，**一份都不写**——不是「保住了四份」，
> 是根本没走到落盘那一段。所以那句话要读成「JSON 体下保住四份」。
>
> **但 `d2b2f79` 那道现在已经不在代码里了**——`3609d16` 把它换成了
> `samplingWritable(sampleCount)`，门槛从「填了字符串」收紧到「真的采到样本」。
> 当前生效的六道就是上表最后一列写着「是」的那六行，`if (TOKEN.length > 0)`
> 在现行版本里出现 **0 次**。`d2b2f79` 占一行是为了留住
> 「这个洞真的被利用过」这件事，不是因为它现在还在挡。
>
> **`4290c43` 那条是无条件的，不在 `FORCE_WRITE` 分支里。** 它挡的是这样一条路径：
>
> ```bash
> MS_TOKEN=<拼错的> SHOT_DIR=artifacts/online-verify node tools/verify-online-api.mjs
> # → 拒绝覆盖：...api-verify.json 已经存在，而这一轮采样段 0 次模型回复
> ```
>
> `TOKEN.length > 0` 会把所有 `FORCE_WRITE &&` 判据短路掉，所以这条**连开关都不用开**；
> 而写出来的产物自述是 `hasToken: true / forceWrite: false`——这是「带凭证的正式运行」
> 那个模样，与不带 token 强制留档的 `forceWrite: true` 正好相反。
> **「有 token 就可信」在这里恰好反了**——带 token 走错的后果比不带 token 更隐蔽。
>
> 说清楚限度：`hasToken: true` 本身**不是**证据标记，它只证明「有人填了个字符串」。
> 但也不是「整份 meta 无法分辨」——那几轮无效 token 的产物里
> `modelSamplesObserved: 0`、清单是 `PASS 0 / FAIL 26 / SKIP 14`，一读内容就露馅。
> 危险在于**得先读内容才知道文件名骗了你**，而 `hasToken: true` 已经先把人劝住了。
>
> 「位置」的那三条是黑名单（枚举「要保护哪个目录」），`4290c43` 才换成白名单
> （只问「这里已有证据吗」）。黑名单永远漏——`artifacts/online-verify` 就是这么漏过去的，
> 它是唯一入库的权威源。`4290c43` 的判据式里没有目录名，只有
> `OUT_HAS_EVIDENCE && modelSamplesObserved === 0` 两问，这就是它不用枚举的原因。
>
> **但更要紧的是「内容」这一轴：** 前面全过了也只证明「允许写」，不证明「有东西可写」。
> 一份「允许写 + 什么都没测到」的文件结构合法、字段齐全，是最容易冒充证据的一种——
> 所以 `samplingWritable()` 包住了三处采样落盘，没有样本就不写。
> 复核要看**形状，不要看行数**（注释里点一次这个名字，裸计数就会 +1）。
> **按参数名数调用，不要按「行首 `if (`」数**——后者要求 `if (` 和 `samplingWritable(`
> 同行，一旦有人把它折开就少数（我实测过：折行后 `node --check` 通过、判据没变，
> 而「行首」口径从 3 掉到 2）：
>
> ```bash
> grep -cE '^function samplingWritable' tools/verify-online-api.mjs                                                  # 应为 1
> grep -cE 'samplingWritable\((weightSamples|contrastSamples|measuredRuns\.length)\)' tools/verify-online-api.mjs    # 应为 3
> ```
>
> 只剩定义、没有调用，就说明这道判据被摘了。**这两条在折行、加空行、加注释三种排版下
> 都是 1 / 3**，因为它们不依赖 `if` 和调用落在同一行。

`tools/verify-online-api.mjs` 是本项目的线上验收脚本，分两段：
**基础段 32 条**（无条件执行）+ **记忆段**（同样无条件执行）。
记忆段一直是无条件裸块，但**它内部的断言条数会随脚本演进变化**——
这一晚就在 7 和 8 之间来回变过几次（删一条、加一条都算改判据）。

**别把任何具体条数当常量抄走。** 行号和条数都随提交变化——这个文件在
2026-11-26 凌晨被重写过多次（我写这一段的两小时内，记忆段起点从 `:265`
走到 `:497`，条数在 7/8 之间变过）。抄数字的那一刻它就可能已经过期。
**要引用条数就现算，用这条不依赖行号的命令：**

```bash
node -e "const L=require('fs').readFileSync('tools/verify-online-api.mjs','utf8').split('\n');let f=0,r=[];for(let i=0;i<L.length;i++){if(/2\.6 记忆影响决策/.test(L[i]))f=1;if(f&&/── 3\. 真实模型决策/.test(L[i]))break;if(f&&/^\s*(check|checkIfMeasured|checkSkipped)\(/.test(L[i]))r.push({n:i+1,ind:(L[i].match(/^\s*/)||[''])[0].length});}console.log(r.map(x=>x.n+'@'+x.ind).join(' '));console.log('条数 =',r.reduce((s,x)=>s+(x.ind>=6?3:1),0));"
# 原理：以「2.6 记忆影响决策」到「3. 真实模型决策」为区间，
# 数区间内的 check( / checkIfMeasured( / checkSkipped( 三类；
# 缩进 ≥6 层的在 CONTRASTS 循环内，按 3 条算。
```

> **只数 `check(` 会少数。** 这条命令早期版本只匹配 `/^\s*check\(/`，
> 而 `checkIfMeasured(` 和 `checkSkipped(` 的写法都不含 `check(` 这个子串——
> 于是「先断言前提、否则记 SKIP」的那几条被漏掉，命令少报一条，
> 和运行时输出（数 `^PASS`/`^FAIL`/`^SKIP` 前缀）对不上。
> 三个函数名都要数。
>
> **核对方式只对记忆段有效：** 记忆段内静态条数 == 该段运行时三个前缀之和
> （实测 8 == 8）。**全局不适用**——全局静态 47、运行时 40。
> 这 7 条差额**不只是互斥分支**：`−3` 是三个包装函数体内的转发调用（不产生独立记录）、
> `−4` 是首页段 `else` 支的 4 条 `checkSkipped`、`−2` 是提案段 `if/else` 的一支，
> 而 `+2` 是记忆段 `记忆改变决策：…` 在 3 元循环里展开成 3 条。
> `47 − 3 − 4 − 2 + 2 = 40`。拿全局去校验必然对不上。
>
> **`47` 是调用点数，别当成「断言名有 47 个」。** 47 = 行首 `check(` 32 + `checkSkipped(` 7
> + `checkIfMeasured(` 8。首参是单引号字面量的是 **43** 处（另 4 处传的是 `name` 变量或
> 模板字符串，名字在运行期才定），其中 6 组名字各出现两次（`JS 资源 200`、
> `前端产物无密钥/上游地址`、`前端走同源代理`、`产物含六位楼内居民`、`提案是 dialogue`、
> `台词非空`——都是 `if/else` 两支各一份），去重后是 **37** 个不同的名字。
> 拿 47 去对 `api-verify.json` 里的 40 条只会得到「对不上」，因为两者量的不是一回事。

它按段落标题定位，不认行号，所以脚本重排也不会失效。

脚本写到本地输出目录 `output/online-verify/*.json`
（该目录被 `.gitignore` 忽略；仓库留档在 `artifacts/online-verify/`）。
地址走环境变量 `ONLINE_BASE`（默认是已部署的创空间 API 域名）；私有创空间需要
`MS_TOKEN` 才能访问网关。

**仓库里留档的是基础段 32 条**（`artifacts/online-verify/api-verify.json`，
数组 32 条、逐条 `ok: true`，md5 `cb827d5a957974ea382672f07469c804`），
其中真实模型推理 3/3、均值 5316ms
（`artifacts/online-verify/real-model-runs.json` → `avgMs`，单次 3932 / 3713 / 8302 ms）。

> **⚠️ 32 条里有 1 条经复核不成立，实际可用的口径是「31 条已验 + 1 条未验证」。**
>
> 第 32 条「路径穿越读不到源码」记录的是 `ok: true / detail: "HTTP 200"`。但：
>
> 1. `HTTP 200` 不是「穿越被挡住」，是 `serveStatic` 对不存在路径回退 `index.html`
>    的 SPA 常规行为；
> 2. **载荷根本没发到服务端**：脚本用 `get('/../server/npc-proxy.mjs')`，
>    内部是 `fetch(\`${BASE}${path}\`)`，而 WHATWG URL 在**客户端**就把 `/../` 规范化成
>    `/server/npc-proxy.mjs`。用只记 `req.url` 的桩可验：服务端收到的是 `/server/...`。
>
> 我做过对照实验：把 `dist/` 挂在一个**完全不做检查**的朴素静态服务器后面
> （不 `normalize`、不验前缀），脚本那条判据**照样 PASS**（200 + 1716B 兜底页）。
> 换成 `http.request({ path })` 直发，同一个无防护服务端返回 **28513B 含 `NPC_API_KEY`**
> ——那才是真源码。所以这条判据对「穿越有没有被挡住」**零区分力**。
>
> **所以：不要在任何材料里写「32 项全过」。** 写「31 项已验证通过，
> 路径穿越一项的判据经复核无效、已记入已知限制」。
> 这不影响其余 31 条——它们是各自独立的判据。但它确实意味着
> **原来那句「32 项全过」里，有一条的通过理由不成立**，而且这一条从 `492eab0`
> 起就这样，不是这轮引入的。
>
> 修法（已给 a1）：把载荷换成 `fetch` 不折叠的写法（实测 `/..%2fserver/...` 能送到），
> 或改用 `http.request({ path })`；并补一条「服务端确实收到了含 `..` 的原始路径」
> 的旁证。在补上之前，这条不能算通过。
>
> **进展（2026-11-26）：脚本侧已修，`4831b28`。** 改用 `node:http` 的 `request({ path })`，
> 载荷原样上线，`detail` 写出客户端发的原始 path。**判据名一条没增没删**
> （47 个调用点、43 个字面量名、md5 `c7bb10f4…` 三版同值）。
> **但线上 public 实例仍未观测**（实例还是 private，没人能跑），
> 所以材料口径**不变**：仍是「31 项已验 + 1 项线上未观测」。
> **「脚本修好了」不等于「这条通过了」**——两者之间隔着一次还没发生的线上重跑。
>
> **修好之后它能证伪什么，我实测过，说准一点：** 我搭了四档服务端接这条判据
> （载荷固定 `/../server/npc-proxy.mjs`，用 `rawGet` 直发）：
>
> | 服务端实现 | 响应 | 判据 |
> |---|---|---|
> | 线上原样（`normalize` + 越界比对） | 200 / 28B | PASS |
> | **只删越界比对**，保留 `normalize` | 200 / 28B | **PASS** ← |
> | 只删 `normalize`，保留越界比对 | 403 / 9B | SKIP（前置不满足） |
> | 两道都删（真·无防护） | 200 / 47B **含源码** | **FAIL** |
>
> **第三行那个 PASS 是这一节的要害。** `safePath` 有两道独立防线：
> `normalize()` 先把前导 `..` 吃掉（`normalize('/../x')` → `'\x'`），
> 越界比对是第二道。**所以「删掉越界比对」不会让这条 FAIL**——
> 我先前写成「删越界比对 → FAIL」，那是错的，和 a5 最早「只删越界比对就漏」是同一个误判。
> 这条判据真正证伪的是「**能被 `/../` 读出 dist 外的源码**」，
> 不是「`safePath` 的越界比对还在」。后者只能读代码或做双删对照。
>
> 第二行 403 那格也有个坑（a1 后来补的）：403 被旧判据读成「鉴权层挡住了，没测到」，
> 可这个服务端**没有鉴权层**——401 在 `server/npc-proxy.mjs` 里出现 0 次。
> **「防护生效」和「没测到」必须是两个不同的结论。**

### ⚠️ 另一个更该说的问题：畸形 URL 能把服务打死

**这一条不在 32 项里，也不影响那 32 条的数据，但它比路径穿越更严重。**

对 `server/npc-proxy.mjs` 发 `GET /%`（或 `/%2`、`/%zz`、`/index.html%`、
`/%E0%A4%A`、`HEAD /%`），`safePath` 里的 `decodeURIComponent` 抛 `URIError`，
而 `serveStatic` 和 `createServer` 的回调**都没有 try/catch**，全文件也没有
`process.on('unhandledRejection')`——Node 15 起未处理的 rejection 默认让进程退出。

实测（2026-11-26，12 个载荷，每个都是新起进程再用 `/healthz` 复查）：

```
GET  /             活   200
GET  /healthz      活   200
GET  /%            死   ECONNRESET   URIError: URI malformed
GET  /%2           死   ECONNRESET
GET  /%zz          死   ECONNRESET
GET  /index.html%  死   ECONNRESET
GET  /%E0%A4%A     死   ECONNRESET
HEAD /%            死   ECONNRESET
GET  /a?b=%        活   200      ← 坏编码在查询串里，走不到 decode
GET  /%25          活   200      ← 合法编码
GET  /api/npc/decide 活 405
GET  /%00          活   200      ← 合法编码（NUL），死在后面不是这里
```

**6/12 能打死。** `GET /healthz` 前后从 200 变成连不上，是本轮唯一一条
「不用信我的推理、你自己一条 `curl` 就能复现」的结论。

溯源：`6cef682`（2026-11-25 20:13）引入，**早于产出证据的 `b9ffd0b`（23:37）3 小时 24 分**。
所以那份证据是在一个「一个请求就能打死」的服务上跑出来的——不是造假，是范围没覆盖。

修法（3 行，已在桩上验证）：

```js
function safePath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); }
  catch { return null; }      // 复用既有的 403 分支，不新增路径
  ...
```

`server/` 不归我，**没代改**。改完请告我，我把这段改成「曾存在、已于 X 修复」。

> **这 32 条覆盖什么：** 静态产物完整性、同源代理、密钥不泄漏、维修任务契约、
> 真实模型决策、注入防护、限流与熔断（路径穿越那条见上，不计入）。
> **不覆盖什么：** 任何记忆相关判据，以及**任何 URL 解析相关的畸形输入**
> （`GET /%` 那条就是缺口，见上）。32 项里没有一条能证明「记忆改变了决策」——
> 第 19–23 条（真实模型决策 3/3、合法提案结构、是 `dialogue`、台词非空、响应时间）
> 证明的是「模型能产出合法提案」，不是「记忆起作用」。

> **记忆段为什么没有线上结果：** 该段已实现（`tools/verify-online-api.mjs` 的
> 「2.6 记忆影响决策」段落，按标题定位不按行号），**从未在线上执行过**。
> 但原因不是「本机没配 token」——线上实例仍是 **private**，平台层直接把请求挡了：
> 实测 `GET <api 域名>/` 与 `/healthz` 均 **401**、`GET <门户>.ms.show/` **403**，
> **连静态首页都要身份**。这是创空间访问控制，不是 `server/npc-proxy.mjs` 的鉴权
> （那个只护 `/api/npc/decide`）。
>
> **所以「补个 `MS_TOKEN`」不是补齐路径。** 一个能过网关的凭证只证明「我能访问」，
> 证明不了「评委无需登录也能访问」——而后者才是参赛要求。补齐要两步：
> **① 把创空间转为公开；② 再跑**
> `MS_TOKEN=... node tools/verify-online-api.mjs`
> 产出 `memory-evidence.json` 与 `memory-weight-evidence.json`。
> 现有记忆证据仅来自离线桩，用于验证判据有效性，不构成线上行为证据。

> **`artifacts/` 与 `output/` 是同一个文件。** `artifacts/online-verify/*.json`
> 是 `d73ec0b` 里从 `output/online-verify/` 复制过来的副本，md5 完全一致
> （`api-verify.json` 均为 `cb827d5a957974ea382672f07469c804`，4111 字节）。
> 之所以复制，是因为 `output/` 在 `.gitignore:17` 被忽略、评审 clone 后看不到。
> 要复现：`node tools/verify-online-api.mjs`（默认就写到 `<repo>/output/online-verify/`），
> 然后把新结果复制回 `artifacts/online-verify/`。

### 3.5 魔搭创空间部署

仓库已配置好 `ms_deploy.json`：

```json
{
  "sdk_type": "docker",
  "resource_configuration": "platform/2v-cpu-16g-mem",
  "port": 7860
}
```

Dockerfile 是三段式（build → runtime），要点：

- `npm ci` 时跳过 electron / playwright 的二进制下载（构建阶段一个都用不到，
  但各自的 postinstall 会拉上百 MB，拉不动就整次构建失败）
- 运行镜像里**没有 `src/`、没有 devDependencies**，只有 `dist/` + 一个 `.mjs`
- 非 root 用户运行
- `HEALTHCHECK` 打 `/healthz`，平台能判断容器真可用而不只是进程活着

出处：`Dockerfile:12-64`。

**Key 的注入方式**：创空间的密文环境变量 `NPC_API_KEY`。它在构建期**从未被引用**，
所以 `--build-arg` 也拿不到它。

#### 3.6 改完代码之后：重新部署 → 重跑验收（2026-11-26 实测流程）

> **这一步以前没人跑通过**，因为上一轮认定「实例是 private、只有本人能访问」。
> 2026-11-26 实测推翻了它：空间可见性是 `visibility: "public"` / `private: false`，
> 公开地址匿名可达，游戏在门户 iframe 里完整启动。**所以重新部署 + 重跑是可以做的，
> 只是要分清两条路。**

**两条访问路径不是一回事，别混：**

| 路径 | 用途 | 要什么 |
|---|---|---|
| `https://www.modelscope.cn/studios/<ns>/<name>` | **给评委的链接**。门户页 → iframe 里跑游戏 | 什么都不用 |
| `https://studio-<ns>-<name>.api-inference.modelscope.net` | **验收脚本要打的口** | **必须带 SDK token**（平台设计，与空间是否公开无关） |
| `https://<ns>-<name>.ms.show` | 应用本体 | 顶层访问会 **302** 到门户页；游戏实际跑在门户挂出的 iframe 里 |

**重新部署（改了 `server/` 或前端产物之后）：**

```bash
# 1. 仓库根目录（ms_deploy.json 在这里）
# 2. 同步代码并重新部署（用魔搭官方 SDK/CLI，账号 token 从环境变量 MODELSCOPE_API_KEY 读）
#    具体命令见官方 Skill：https://www.modelscope.cn/skills/modelscope/modelscope-studio
# 3. 等平台把容器跑起来：/healthz 返 {"ok":true,...} 且 status=Running
```

**重跑线上验收（拿一个有效 SDK token）：**

```bash
MS_TOKEN=<魔搭「设置 → 访问令牌」生成的那个> node tools/verify-online-api.mjs
# 六份产物落 output/online-verify/；脚本按自身位置推仓库根，与 cwd 无关
```

**只想看一眼判据条数、不落盘（诊断轮）：**

```bash
FORCE_WRITE=1 SHOT_DIR=tmp/probe node tools/verify-online-api.mjs
# 落盘后 api-verify-meta.json 里 forceWrite: true —— 这些文件不是证据，别引用
```

**不设 `MS_TOKEN` 时脚本打不到线上**：API 专用地址会返 401
（`Authentication failed, please make sure that a valid ModelScope token is supplied`）。

**公开地址冒烟（不需要 token，验评委视角）：**

```bash
PUBLIC_BASE=https://www.modelscope.cn/studios/<ns>/<name> \
  npx playwright test -c playwright.public.config.ts
```

> **别把「门户 200」当成「游戏起来了」。** 顶层访问会被 302 到门户页，
> 那一屏是门户 SPA，不是游戏。真正的判据是**门户挂出的 iframe 里有 1280×720 画布、
> Menu 场景 active**——`e2e-public/public-smoke.spec.ts` 正是这么断的。

---

## 4. 已知边界（诚实清单）

| 事项 | 现状 |
|---|---|
| 游戏内 NPC 运行时动作 | **只允许 `dialogue`**（`src/scenes/GameScene.ts` 的 `getAiRuntime()` 里 `allowedActions: ['dialogue']`）。模型提议交易/赠礼/维修会被运行时拒绝并降级 |
| 赠礼 / 维修入口 | 走离线场景函数 `runAlinGiftScenario` / `runAlinRepairScenario`，不是模型决策 |
| 模型质量 | 已证明"能拿到合法提案且状态真会变"，**未统计**多 seed 成功率、非法动作率、重规划率 |
| 第二 NPC | 目前闭环只覆盖阿林一条线 |
| 跨天记忆影响决策 | **已在线上跑过，结果是红的**（2026-11-26）：记忆段 8 条判据 6 FAIL / 1 SKIP / 1 PASS。模型**读到了**记忆（提示词逐字可查，回复会复述记忆内容），但动作类型十几次采样全是 `dialogue`——记忆只改了语气，没改选择。逐条结果与根因见 `docs/BENCHMARK_REPORT.md` §2.5。⚠️ 「线上是否已重新部署无法判断」这条限制已解除：`/healthz` 仍不暴露提交号，但线上产物特征（JS 文件名 `assets/index-DUjl--OX.js`、六位居民名）与 2026-11-25 那份一致 |
| `qwen3:0.6b` 等小模型 | 实测不可用：输出缺 `confidence`、物品 ID 用中文，被 Validator 正确拒绝。契约遵守需要 17G 级模型 |

---

## 5. 排障：按这个顺序查

| 现象 | 先查 | 再查 |
|---|---|---|
| NPC 永远只说第一句问候 | `curl /api/tags`（形态 A）或 `/healthz`（形态 B） | `VITE_NPC_MODEL` 是否为空 |
| 页面一直显示"离线 AI" | 浏览器 Console 是否有 CORS 报错 | `OLLAMA_ORIGINS` 未配 → Spark 上需 systemd drop-in 允许页面来源 |
| 代理返回 404 但服务活着 | 形态 B 下 `health()` 打的是 `/healthz`，**不是** `/api/tags` | 这两个写混会让"模型可用"被永久误判成不可用（`ollamaBrain.ts:118-136` 记录了这个坑） |
| 模型响应 200 但没台词 | 看 `done_reason` 是不是 `length` | 是 → 输出预算太小，关掉思维链或调大 `VITE_NPC_MAX_TOKENS` |
| 首次请求要等 30 秒 | 正常，冷启动加载 17G 权重 | 想快就换更小模型或开投机解码 |
| 代理 429 | 单会话限流 | 或每日预算耗尽 |

---

## 6. 出处索引

| 内容 | 文件 |
|---|---|
| 配置读取与模式判定 | `src/ai/config.ts` |
| Ollama 传输层（`/api/chat`、空正文处理） | `src/ai/brains/ollamaBrain.ts` |
| 真机推理记录采集 | `tools/spark-run-record.mjs` |
| 线上验收脚本 | `tools/verify-online-api.mjs` |
| 代理安全边界与配置 | `server/npc-proxy.mjs` |
| 容器构建 | `Dockerfile`、`ms_deploy.json` |
| 环境变量模板 | `.env.example` |
| R2 修复记录与实测对照表 | `docs/competition/IMPLEMENTATION_STATUS.md` |
| 最初的设计与治理讨论 | `docs/plans/2026-11-11-ai-npc-spark-integration-rfc.md` |
| 已有真机运行记录 | `artifacts/spark-runs/npc-qwen_latest-2026-11-25T09-52-05-090Z.json` |
| 已有线上验收结果 | `artifacts/online-verify/api-verify.json`、`artifacts/online-verify/real-model-runs.json` |