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

> **门不止一道，而且最后一道和你拿没拿 token 无关。**
> 判据共六条，`3609d16` 一个提交里加了两条（它标题写的那件 + message 里自称「顺带」的那件），
> 所以下表同一提交出现两次——**漏掉一行会让人以为「采样内容」只有一道保护**：
>
> | 提交 | 判据 | 挡的是 |
> |---|---|---|
> | `600c450` | 无凭证不落盘 | 401 空跑冒充证据 |
> | `a2918b3` | `FORCE_WRITE` 必须配 `SHOT_DIR` | 只给开关不给目录 |
> | `215b210` | 不得解回默认目录 | `SHOT_DIR=output/online-verify` |
> | `3609d16` | 不得解回仓库根 | `SHOT_DIR=.` |
> | `3609d16` | **采样内容要有样本才写** | 无效 token 写出「三组全 `complete:false`」的假记忆证据 |
> | `4290c43` | **目标目录已有 `api-verify.json` 且本轮 0 样本 → 拒绝** | 任何指向已有证据目录的写法 |
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
> 复核：`grep -n 'samplingWritable(' tools/verify-online-api.mjs`
> ——应命中 4 行：一处 `function` 定义 + 三处调用点。只剩定义就说明这道判据被摘了。

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

它按段落标题定位，不认行号，所以脚本重排也不会失效。

脚本写到本地输出目录 `output/online-verify/*.json`
（该目录被 `.gitignore` 忽略；仓库留档在 `artifacts/online-verify/`）。
地址走环境变量 `ONLINE_BASE`（默认是已部署的创空间 API 域名）；私有创空间需要
`MS_TOKEN` 才能访问网关。

**仓库里留档的是基础段 32 项**（`artifacts/online-verify/api-verify.json`，
数组 32 条、逐条 `ok: true`，md5 `cb827d5a957974ea382672f07469c804`），
其中真实模型推理 3/3、均值 5316ms
（`artifacts/online-verify/real-model-runs.json` → `avgMs`，单次 3932 / 3713 / 8302 ms）。

> **这 32 项覆盖什么：** 静态产物完整性、同源代理、密钥不泄漏、维修任务契约、
> 真实模型决策、注入防护、限流与熔断、路径穿越。
> **不覆盖什么：** 任何记忆相关判据。32 项里没有一条能证明「记忆改变了决策」——
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

---

## 4. 已知边界（诚实清单）

| 事项 | 现状 |
|---|---|
| 游戏内 NPC 运行时动作 | **只允许 `dialogue`**（`src/scenes/GameScene.ts` 的 `getAiRuntime()` 里 `allowedActions: ['dialogue']`）。模型提议交易/赠礼/维修会被运行时拒绝并降级 |
| 赠礼 / 维修入口 | 走离线场景函数 `runAlinGiftScenario` / `runAlinRepairScenario`，不是模型决策 |
| 模型质量 | 已证明"能拿到合法提案且状态真会变"，**未统计**多 seed 成功率、非法动作率、重规划率 |
| 第二 NPC | 目前闭环只覆盖阿林一条线 |
| 跨天记忆影响决策 | 记忆已持久化且有导出，但"次日决策因记忆改变"无端到端证据。`weight` 的提示词渲染**代码已支持（`7d2e02c`，只动了 `server/npc-proxy.mjs`）、线上未验证**：留档的 32 项证据跑于 2026-11-25 23:36，早于该提交的 00:01，所以那份证据里不可能含此修复；此后线上是否已重新部署**无法判断**——`/healthz`（`server/npc-proxy.mjs:581-590`）只返回 `ok/aiConfigured/breakerOpen/dailyUsed/dailyBudget`，不暴露版本或提交号 |
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