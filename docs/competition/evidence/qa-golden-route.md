# A9 QA / 红队报告 · 评委黄金路线实机走查

- **Agent**：A9 QA / 红队
- **日期**：2026-11-27（Asia/Shanghai）
- **基线 SHA**：`7297a37`（分支 `a9/qa-golden-route`，从 `deploy-ms-20261125` 当前 HEAD 切出）
- **公开地址**：`https://www.modelscope.cn/studios/a1578804454/floor-100000`
  （应用本体跑在门户挂出的 iframe `https://a1578804454-floor-100000.ms.show/…` 里）
- **本报告只描述实测到的现象**。没有跑通的地方一律写「未跑通 + 原始输出」。

---

## 0. 一句话结论

**最早阻断点不在「找不到人」，而在「阿林不接活」**：

> 当客户端把 AI 指向一个**可达的模型端口**、但那个模型**此刻答不上话**（超时 / 503 /
> Spark 到期 / 本机没起 Ollama）时，玩家在 2 楼把材料凑齐、信任刷到 78.2（门槛 70），
> 按下「维修门计划」，结果是 **什么都没发生**：门没开、材料没扣、状态没变，
> 而对话框只给出一句 **「校验拒绝｜未改变」**——这句话还���事实的（根本没有发生任何校验，
> 真实 outcome 是 `no_proposal`）。玩家在这个状态里**没有任何下一步可做**，
> 整条黄金路线（2 楼 → 3 楼 → 停电危机 → 小周 → 阿珍）从此走不下去。

这条阻断**同时影响公开部署**：线上是生产构建（代理模式），代理拿不到上游模型时
返回 503，客户端拿到的同样是 `null`，于是走同一条死路。
Spark 资源 11-30 到期这条时间线，正好落在提交之前。

线上**模型可达时**黄金路线是通的（见 §3）。

---

## 1. 环境与核验

| 项 | 值 | 核验方式 |
|---|---|---|
| 仓库 | `D:\ZYY_Inovation\game\wt-r2`，分支 `a9/qa-golden-route`，HEAD `7297a37` | `git rev-parse --short HEAD` |
| Node / Git 不在 PATH | 每条命令前 `$env:PATH = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;' + $env:PATH` | — |
| 本地跑法 | `npx vite --port 5181 --strictPort`（dev server），Playwright `channel: 'chrome'`（不下载浏览器） | `playwright.config.ts` |
| 线上产物 | `assets/index-WSEUTZFA.js`（1,713,844 bytes）。**注意：本次会话期间线上被重新部署过**——第一次探测时还是 `index-5z58eZk8.js`，后来变成 `index-WSEUTZFA.js`，两次都含第 1 章达成卡 | `https://a1578804454-floor-100000.ms.show/?seed=42&debug=1` 的 HTML |
| 入口形态 | 顶层访问 `.ms.show` 会 **302 到门户**；门户再把应用挂进 iframe（`…ms.show/?seed=42&debug=1&t=…&__theme=light&backend_url=/`） | 浏览器 `framenavigated` 日志 |
| AI 形态（本地 dev） | `.env.local` 存在 → `VITE_NPC_MODEL=npc-qwen:latest` → dev 非生产构建 → `proxyMode=false` → **`mode='ollama'`**（直连本机 11434，本机无 Ollama） | `src/ai/config.ts` `aiNpcConfig()` |
| AI 形态（线上） | 生产构建 → `proxyMode=true` → **`mode='proxy'`** → 同源 `/api/npc/decide` | 同上 |

### 关于「部署差距」的更正

任务书里写「线上跑的是 `assets/index-Dzve_6tz.js`，不含第 1 章达成卡」。
**实测已经不是这样**：

```
$ curl -s https://a1578804454-floor-100000.ms.show/?seed=42&debug=1 | grep -o 'assets/index-[^"]*'
assets/index-5z58eZk8.js
```

下载线上产物后逐串计数（对当时的 `index-5z58eZk8.js`；重新部署后的
`index-WSEUTZFA.js` 计数一致，只有 `接回主线` 从 1 变 2）：

```
第 1 章完成              count=2
继续游玩                count=1
维修门计划              count=3
接回主线                count=2
offline-fallback        count=17
模型未响应              count=1
校验拒绝                count=4
门已打开                count=2
还缺                    count=2
保险丝                  count=13
电线                    count=11
```

→ **线上已经包含 `ceb0f4b`（第 1 章达成卡）**；`src/` 自 `526cdb9` 之后没有再改过
（只有 docs 提交），所以线上产物与仓库 HEAD 的 `src/` 一致。
**「部署差距」这一项现在不成立**，不要在提交材料里再写它。

---

## 2. 最早阻断点

### 2.1 复现步骤（本地 dev server，seed 42）

```powershell
$env:PATH = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;' + $env:PATH
Set-Location D:\ZYY_Inovation\game\wt-r2
npx vite --port 5181 --strictPort
# 浏览器打开 http://localhost:5181/?seed=42
```

1. 标题菜单 `Enter` → 角色选择 `Enter` → 进游戏（**不需要登录、不开控制台**）。
2. 一路向左走到最左端的「↑ 上楼」（x=40），按 `E` → 到第 2 层。
3. 走到「维修材料箱」（x=160），按 `E` → 拿到 **木材×2、胶带×1**。
4. 走到「阿林」（x=480），按 `E` → 选「赠礼」→「赠送 净水×1（持有3）」，**重复三次**。
   信任 35 → 49.4 → 63.8 → **78.2**（门槛 70，材料齐备，净水已送完）。
5. 「返回」→「维修门计划」→ `Enter`。
6. **观察到**：对话正文变成 `校验拒绝｜未改变`，门没开，木材胶带还在，
   玩家被留在 2 楼，HUD 继续显示 `上层维修通道封锁 · 先协助阿林修复门禁`。

### 2.2 原始输出（本地，`tmp/a9/golden2.out.txt`）

```
-- gift #3 --
gift level options: ["赠送 净水×1（持有1）","赠送 压缩口粮×1（持有2）","返回",""]
message: "赠送净水×1成功｜信任78.2"
source: "offline-fallback · 场景规则提案"
state: {"floor":2,"day":1,"minute":462,"playerX":479,
        "inv":["ration_packx2","flashlightx1","woodx2","tapex1"],
        "npc":{"alin":{"trust":78.2,"mem":3,"inv":["clean_waterx3"]}}}

##### R5 2:00 维修门计划 (wood+tape in inventory)
options now: ["赠礼","维修门计划","交易","退出"]
message: "校验拒绝｜未改变"
text: [...,"阿林（维修工）","offline-fallback · 场景规则提案","校验拒绝｜未改变",
       "赠礼","维修门计划","交易","退出", ...]
state: {"floor":2,...,"inv":["ration_packx2","flashlightx1","woodx2","tapex1"], ...}
repairResult: {"status":"exhausted","attempts":2,"decisionSource":"offline-fallback",
               "proposal":null,"validation":null,"execution":null,
               "feedback":[{"attempt":1,"outcome":"no_proposal",...}], ...}
```

截图：`tmp/a9/golden2/06-repair-gate.png`（对话正文 `校验拒绝｜未改变`）、
`tmp/a9/golden2/07-floor3.png`（仍停在第 2 层，HUD `上层维修通道封锁 · 先协助阿林修复门禁`）。

> `tmp/` 与 `test-results/` 在 `.gitignore` 里，不进仓库。原始日志同时在
> §7 的复现命令里可以重新生成。

### 2.3 A/B 对照：把「模型可达性」这一个变量隔离出来

同一套脚本、同一台机器、同一份代码，只改 URL 上一个参数
（`?ainpc=0` → `aiNpcConfig().mode='off'` → 模型端口整体不接管）：

| 变体 | URL | 维修结果 | 对话正文 | gate flag |
|---|---|---|---|---|
| A（默认，本机 `.env.local` → mode `ollama`，模型不可达） | `/?seed=42` | `status: exhausted` `attempts: 2` `proposal: null` `validation: null` | `校验拒绝｜未改变` | 无 |
| B（AI 关，规则兜底接管） | `/?seed=42&ainpc=0` | `status: executed` `attempts: 1` `validation.accepted: true` | `门已打开｜已提交` | `story:alin-repair-gate: 1` |

原始输出 `tmp/a9/ab-A.out.txt` / `tmp/a9/ab-B.out.txt`：

```
=== VARIANT A (http://localhost:5177/?seed=42) ===
REPAIR message: "校验拒绝｜未改变"
REPAIR status: exhausted decisionSource: offline-fallback attempts: 2
REPAIR validation: null
REPAIR feedback outcomes: ["no_proposal", ...]
gate flag: {"autonomy:last-round-minute":430}

=== VARIANT B (http://localhost:5177/?seed=42&ainpc=0) ===
REPAIR message: "门已打开｜已提交"
REPAIR status: executed decisionSource: offline-fallback attempts: 1
REPAIR validation: {"accepted":true,"reason":"ok", ... "gateStatus":[{"gateId":"alin-repair-gate","from":"closed","to":"open"}]}
gate flag: {"autonomy:last-round-minute":430,"story:alin-repair-gate":1}
inv after repair: {"player":["ration_packx2","flashlightx1"], "alinTrust":78.2, "alinMem":3}
```

### 2.4 仓库自己的用例也一起红了（这是最强的一条证据）

`e2e/competitionAiNpc.spec.ts` 是仓库里覆盖这条路径的既有用例。

**默认环境（本机 `.env.local`，AI → 不可达的 Ollama）：**

```
Running 3 tests using 1 worker
  ok 1 … 玩家赠礼通过游戏对话改变双方库存、信任和 NPC 记忆 (7.1s)
  x  2 … 阿林维修门交互使用 offline-fallback，经校验安全拒绝低信任提案并可核验真实状态 (15.4s)
  x  3 … 第2层保底材料可实际拾取，赠礼不消耗预留物资，维修后实际进入第3层 (15.7s)

  1) … Expected: "blocked"
           Received: "exhausted"
     > 203 | await expect.poll(async () => (await readSceneResult(page))?.status).toBe('blocked');
```

**把 AI 形态强制成 offline（`$env:VITE_NPC_MODEL=' '; $env:VITE_NPC_PROXY='off'`）再跑：**

```
Running 3 tests using 1 worker
  x  1 … 玩家赠礼通过游戏对话改变双方库存、信任和 NPC 记忆 (10.0s)   ← 并发负载下偶发，见下
  ok 2 … 阿林维修门交互使用 offline-fallback，经校验安全拒绝低信任提案并可核验真实状态 (4.3s)
  ok 3 … 第2层保底材料可实际拾取，赠礼不消耗预留物资，维修后实际进入第3层 (5.0s)
```

单独重跑第 1 条（去掉并发负载）：

```
Running 1 test using 1 worker
  ok 1 … 玩家赠礼通过游戏对话改变双方库存、信任和 NPC 记忆 (4.4s)
  1 passed (7.8s)
```

→ **两条维修用例的绿/红完全由「模型可达性」决定，不是功能没做完。**
（第 1 条赠礼用例在并发跑时偶发超时，单跑稳定通过——这是既有用例的脆弱点，
不是本次改动引入的。）

### 2.5 根因（代码位置）

三处契约互相打架，组合出一条死路：

| # | 位置 | 行为 |
|---|---|---|
| 1 | `src/scenes/GameScene.ts:4110-4112` | 模型端口对「**模型答不上话**」和「**模型明确拒绝**」返回**同一个 `null`**。注释写着「返回 null，让场景的 fallback 接管」。 |
| 2 | `src/scenarios/alinRepairDemo.ts:340-342` | 端口返回 `null` 时被读成「**模型明确表示不动**」→ `modelDeclinedToAct = true`。 |
| 3 | `src/scenarios/alinRepairDemo.ts:372` | `modelDeclinedToAct` 为真时，**规则兜底 `fallback` 直接返回 `null`**——兜底恰好在唯一需要它的时候被关掉。 |

结果：`proposal = null` → 没有校验 → `status = 'exhausted'` →
`reasonText(null, 'exhausted')` 落回 `没有可提交的动作；游戏状态未改变。`，
但 UI 上显示的是**另一句**「校验拒绝｜未改变」——
**这句文案把「根本没校验」说成了「校验拒绝」，是误导**。

### 2.6 最小修复建议（给 A1 / A3 的 owner，A9 未改 `src/**`）

1. **区分「不可达」与「拒绝」**：`buildRepairProposalPort` 在 `decideTask` 返回
   `null`（超时/不可达/降级）时**抛错**或返回一个带 tag 的结果（例如
   `{ kind: 'unavailable' }`），只有解析出明确意图 `refuse` / `observe` 时才返回
   `null`。`alinRepairDemo` 只在「模型明确拒绝」时设 `modelDeclinedToAct`。
   这样「模型挂了」就重新落到 `runCompetitionStep` 的 `fallback` 端口
   （规则兜底），玩家仍然能开门，来源标签照实写 `offline-fallback`。
2. **文案按真实 outcome 分类**：`no_proposal` / `exhausted` 不该显示成「校验拒绝」。
   建议按 `result.reason` 透出，并且给出下一步（缺什么 / 去哪找）。
   现成可用的指路函数已有：`blackoutSupplyHint()`（`src/scenarios/blackoutCrisis.ts:1525`），
   首章主线那条也能照抄它的口径。
3. **上线前先确认上游可达**：现在线上一次维修往返里出现了多次
   `net::ERR_CONNECTION_CLOSED` 与一条 `401 Unauthorized`（见 §3.4），
   说明代理到上游的连接并不稳。这一条会让 §0 的死路在评委手里随机触发。

---

## 3. 黄金路线逐步结果

两条腿都跑了：**线上公开部署**（评委真正会碰的那份）与**本地 dev server**。
种子都是 `42`，全程只按真实按键，无控制台注入、无夹具、无手改存档。

### 3.1 逐步对照表

| 计划表时间 | 普通玩家操作 | 线上实测 | 本地实测 | 证据 |
|---|---|---|---|---|
| 0:00–0:30 | 打开公开 URL → 开始 → 移动与拾取 | **通过**。菜单 → 角色选择 → 进游戏；HUD 有 `E 交互`、有 `主线：抵达第 100000 层 · 今日目标 搜刮 3 个容器 · 压力 20` | 同 | `tmp/a9/online2.out.txt` R1 |
| 0:30 | 上 2 楼 | **通过**。走到 x=40 按 `E` → 第 2 层；HUD 给出 `上层维修通道封锁 · 先协助阿林修复门禁`（有指引） | 同 | online2 R2 |
| 0:30–2:00 | 开维修材料箱 | **通过**。`获得 木材×2、胶带×1（-20 分钟）`，库存 `woodx2 tapex1` | 同 | online2 R3 |
| 0:30–2:00 | 与阿林对话 | **通过**。4 个选项 `赠礼 / 维修门计划 / 交易 / 退出` | 同 | online2 R4 |
| 0:30–2:00 | 赠礼 ×3 | **通过**。信任 35→49.4→63.8→78.2；记忆 1→2→3；玩家净水 3→2→1→0；阿林口袋 `clean_waterx1/x2/x3` | 同 | online2 R4 |
| 2:00–4:30 | 提出维修（材料齐备、信任 78.2 ≥ 70） | **通过**。`status: executed`，`decisionSource: **model**`，`validation.accepted: true`，`gateStatus: closed→open`，木材胶带正好扣光 | **阻断**。`status: exhausted`、`no_proposal`、`校验拒绝｜未改变`、门没开 | online2 R5 / golden2 R5 |
| 4:30–6:30 | 找小周交易 | **未走完**：危机链在小周之前就闭环了；小周的货已经进库存（`fusex1 wirex1`），但玩家没去换 | 未跑通 | §3.5 |
| 6:30–8:30 | 上 3 楼 / 5 楼找阿珍 | **部分通过**：3 楼、4 楼都到了（4 楼电箱拿到 `fuse×1 filter×1 wire×2`）；**5 楼阿珍未走到** | 未跑通 | §3.5 |
| 8:30–10:00 | 返回阿林或推进危机 | **通过**（线上）：回 2 楼找阿林，选项已从「维修门计划」变成「**接回主线**」，按下去 → `主线接回去了，整栋楼恢复供电。阿林信任 +4。`，`decisionSource: model`；危机 flag 走到 `stage=3`（resolved_repair）、`power=1` | 未跑通 | §3.5 |

### 3.2 线上：维修真的走了模型

```
##### ONLINE R5 — 维修门计划
options: ["赠礼","维修门计划","交易","退出"]
message: "现在动手。\n门已打开｜已提交"
source: "offline-fallback · 场景规则提案"
repair status: executed decisionSource: model attempts: 1
repair validation: {"accepted":true,"reason":"ok",
  "expectedStateDelta":{ ... "inventory":[{"owner":"player","itemId":"wood","quantityDelta":-2},
                                          {"owner":"player","itemId":"tape","quantityDelta":-1}],
  "gateStatus":[{"gateId":"alin-repair-gate","from":"closed","to":"open"}], ...}}
repair feedback: ["executed"]
state: {"floor":2, "inv":["ration_packx2","flashlightx1"],
        "flags":{"story:alin-repair-gate":1},
        "npc":{"alin":{"trust":78.2,"mem":3}}}
```

- 模型真的参与了：正文第一行 `现在动手。` 是模型说的话；
  `decisionSource: model` 说明提案由模型产出**且真的被提交**。
- 状态差量完整：木 −2、胶带 −1、门 `closed→open`、flag 置 1。

### 3.3 线上：第 1 章达成卡确实会弹

```
##### ONLINE R6 — climb to floor 3 (chapter card?)
floor= 3
text: []
scenes: ["End"]
```

`End` 场景即 §1 提的章节结算卡（`ceb0f4b`），正文含 `第 1 章完成` / `继续游玩`。
**所以「第 1 章达成卡未部署」这个前提已经不成立。**

结算卡完整内容（线上实拍，`tmp/a9/online-crisis/01-chapter-card.png`）：

```
["第 1 章完成","第 1 章","线路恢复，抵达第 3 层","存活","1 天","最深","第 3 层",
 "得分","9","正式胜利条件为抵达第 100000 层","新纪录","继续游玩","重新开始"]
```

按 `Enter`（= 继续游玩）后回到第 3 层，危机同步启动：

```
state after chapter card:
{"floor":3, "flags":{"story:alin-repair-gate":1,
                     "story:blackout-tower-main:stage":1,
                     "story:blackout-tower-main:started-day":1,
                     "story:blackout-tower-main:stocked":1,
                     "once:chapter1-cleared":1},
 "npc":{"alin":{"trust":78.2,"mem":4},
        "xiaozhou":{"mem":0,"inv":["fusex1","wirex1"]},
        "azhen":{"mem":0,"inv":["breadx4"]}}}
```

即：**门一开，停电危机自动启动**（`stage=1` 调查中），
小周口袋里铺了 `保险丝×1 + 电线×1`，阿珍灶上铺了 `面包×4`，
阿林的记忆从 3 条涨到 4 条（多了一条「塔楼主线烧了，整层停电」）。

### 3.4 线上：危机闭环走通了（4 楼电箱 → 回 2 楼接回主线）

```
floor4 text: ["↑ 上楼","↓ 下楼","电箱","储水罐","行商","?","?","第4层",
              "D1 08:04",...,"按 E 上楼 · F 抄近路（108 金）"]
电箱 x= 640
after 电箱: [... "电箱（空）" ...]
  {"inv":["ration_packx2","flashlightx1","fusex1","filterx1","wirex2"], ...}
↓ 下楼 x= 1240
floor now: 2   alin x= 480
options: ["赠礼","接回主线","交易","退出"]          ← 标签已从「维修门计划」变成「接回主线」
CRISIS message: "主线接回去了，整栋楼恢复供电。阿林信任 +4。"
CRISIS source: "Ollama 本地模型"
CRISIS status: executed decisionSource: model attempts: 1
state after crisis:
  {"inv":["ration_packx2","flashlightx1","filterx1","wirex1"],
   "flags":{... "story:blackout-tower-main:stage":3,
                  "story:blackout-tower-main:power":1,
                  "story:blackout-tower-main:promise-day:alin":1},
   "npc":{"alin":{"trust":94.2,"mem":6}}}
```

读出来的几件事：

- **选项标签会跟着危机阶段变**：`维修门计划` → `接回主线`。玩家能看出主线换了。
- **危机闭环真的提交了**：保险丝被扣掉 1 个（`fusex1` 消失），电线扣掉 1 个（`wirex2→wirex1`，
  多余的留下），`stage` 从 1 走到 3（resolved_repair），`power=1`，
  阿林信任 78.2 → 94.2，记忆 4 → 6 条。
- **来源标签有一处措辞问题**：对话来源写的是 `Ollama 本地模型`，
  但这次决策实际来自**远端 Spark 模型经同源代理**返回（`decisionSource: model`）。
  来源二分（model / offline-fallback）是对的，但**把 transport 说成「本地 Ollama」是错的**，
  评委看到会以为模型跑在玩家机器上。建议 A1/A3 改成「远端模型 · 代理」之类的中性措辞。
- **没观察到「缺料拒绝 + 指路」**：这一跑是先拿到保险丝/电线才去找阿林，
  所以走的是成功分支。缺料分支（`还缺保险丝、电线。4 层电箱能凑齐` 这类文案）
  只在仓库单测 `src/scenarios/blackoutCrisis.test.ts` 里覆盖，**实机未验证**（见 §6）。

### 3.5 线上控制台噪声（需要 owner 处理）

一次完整线上跑批里出现 **40+ 条** `net::ERR_CONNECTION_CLOSED` 与 1 条
`401 Unauthorized`（`tmp/a9/online2.out.txt` 末尾 ERRORS 段）。
同一批里维修仍然成功（`decisionSource: model`），说明这些失败是**部分请求**失败、
不是全挂。但按 §0 的链路，**只要失败的那一次恰好是维修提案**，玩家就会吃到
「校验拒绝｜未改变」这条死路。**这是提交前必须收敛的风险，不是美观问题。**

---

## 4. QA-01 交付：浏览器 E2E

新增三个 spec + 一个共享夹具（全部只改 `e2e/**`）：

| 文件 | 作用 |
|---|---|
| `e2e/goldenRouteHarness.ts` | 共享夹具：只读状态读取、真实按键行走、对话选项光标、读存档快照、**公开部署 iframe 接入** |
| `e2e/goldenRoute.spec.ts` | **QA-01** 本地黄金路线 4 条 |
| `e2e/adversarialMatrix.spec.ts` | **QA-02** 对抗与异常矩阵 7 条 |
| `e2e/onlineGoldenRoute.spec.ts` | **QA-01/02** 打真实公开部署 2 条（`PUBLIC_BASE` 未设则整体 skip） |

### 4.1 本地 QA-01 覆盖

1. 新开无存档会话：标题菜单**没有**「继续游戏」；进游戏后 HUD 有 `E 交互` 与 `主线`。
2. 黄金路线 0:30–2:00：上 2 楼 → 开维修材料箱 → 给阿林赠礼，
   **断言库存 / 关系 / 记忆三处真的变了**，且来源标签落在 `offline-fallback` 一侧、**不是 model**。
3. 存档与刷新恢复：刷新后菜单出现「继续游戏」→ 选它 → 断言回到第 2 层、
   材料还在、送出去的水没回来、信任与记忆条数不变。
4. fallback 路线：把 `/api/npc/decide` 掐掉（`page.route(...).abort()`），
   断言来源标签**不是 model** 且必须显示降级来源，且降级路径下赠礼仍然真的生效。

### 4.2 运行命令与真实输出

```powershell
$env:PATH = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;' + $env:PATH
Set-Location D:\ZYY_Inovation\game\wt-r2
$env:E2E_PORT='5182'
npx playwright test -c playwright.config.ts e2e/goldenRoute.spec.ts e2e/adversarialMatrix.spec.ts --workers=1 --timeout=180000 --reporter=list
```

```
Running 11 tests using 1 worker

  ok 1 … QA-02 · 无物资 + 信任不足：维修门必须被拒绝，材料与信任都不能被吃掉 (27.5s)
  ok 2 … QA-02 · 重复交互：连续按两次维修门计划，材料只能被扣一次、门只能开一次 (42.3s)
  ok 3 … QA-02 · 跨楼层：维修门没开时上 3 楼必须被拒绝，并且给出为什么 (19.2s)
  ok 4 … QA-02 · 非法动作：修门材料不允许当礼物送掉（赠礼清单必须排除保留材料） (25.8s)
  ok 5 … QA-02 · 买不起的交易：脏水换净水必须被拒绝，库存不能出现负数或半笔成交 (33.1s)
  ok 6 … QA-02 · 请求超时：模型请求卡住时，游戏仍然能操作且不冒充 model (29.0s)
  ok 7 … QA-02 · 网络断开：断网时对话仍要能开，来源标签不能冒充 model (27.4s)
  ok 8 … QA-01 · 新开无存档会话：第一屏有操作说明与目标，且没有「继续游戏」的假存档 (3.7s)
  ok 9 … QA-01 · 黄金路线 0:30–2:00：上 2 楼、开维修材料箱、给阿林赠礼，三处状态都真的变了 (28.0s)
  ok 10 … QA-01 · 存档与刷新恢复：刷新后「继续游戏」能回到第 2 层并保住库存与关系 (32.5s)
  ok 11 … QA-01 · fallback 路线：模型不可用时来源标签必须是 offline-fallback，且游戏仍然可玩 (27.4s)

11 passed (5.0m)
```

> 中途踩过的两个坑（都是**测试自己写错**，不是产品缺陷，列出来是为了让复现的人别再踩）：
> 1. 「请求超时」那条一开始红了——对话打开时方向键归**对话光标**，不归玩家移动，
>    断言「玩家坐标变小」当然不成立。改成先 `E` 关对话框（这一步本身就是
>    「界面没被卡死」的断言），再断言玩家能移动。
> 2. 赠礼选项印的是**当前持有量**（`赠送 净水×1（持有3）`），第二次赠礼就变成
>    `（持有2）`。硬编码标签会让第 2、3 次赠礼静默失败（连带把「重复交互」那条
>    用例的强度削掉了：三次赠礼其实只发生了一次）。已改成按前缀找选项
>    （`pickOptionLike`）。
>
> **注意：本地这 11 条全绿，不等于黄金路线是通的。**
> 它们断言的是「与模型可达性无关的不变量」——因为本机 `.env.local` 把 AI 指向
> 了一个**不可达**的 Ollama，真正的「维修门能打开」这一步在本地根本走不到（§2）。
> 走通它的是线上那条（§3.2、§4.3）。

### 4.3 线上 spec 的运行方式与真实输出

```powershell
$env:PUBLIC_BASE='https://www.modelscope.cn/studios/a1578804454/floor-100000'
npx playwright test -c playwright.config.ts e2e/onlineGoldenRoute.spec.ts --workers=1 --timeout=300000
```

未设 `PUBLIC_BASE` 时两条用例整体 skip（线上空间临时不可用不该让 CI 红，
但也不能因此把「没跑过」写成「跑过且通过」）。

**实测（2026-11-27，对线上 `index-WSEUTZFA.js`）：**

```
Running 2 tests using 1 worker

  ok 1 … 线上 · 黄金路线 0:00–10:00：开局 → 2 楼送礼 → 修门 → 上 3 楼出第 1 章结算卡 (1.7m)
  x  2 … 线上 · BLOCKER-01：模型不可用时修门不能变成一条没有下一步的死路 (1.5m)

  1) … BLOCKER-01
    Error: 修门被拒时必须告诉玩家下一步怎么做（当前原文："校验拒绝｜未改变"）
    Expected pattern: /材料|木材|胶带|保险丝|电线|第\s*\d\s*层|信任/
    Received string:  "校验拒绝｜未改变"
      224 |     ).toMatch(/材料|木材|胶带|保险丝|电线|第\s*\d\s*层|信任/);

  1 failed
  1 passed (3.4m)
```

**这条红灯是本次交付里最重要的一件东西**：

- 第 1 条**绿**：线上公开部署的黄金路线（开局 → 2 楼送礼 → 修门 → 上 3 楼出第 1 章
  达成卡）**真的能走通**，评委照着走不会卡住。
- 第 2 条**红，而且红得很具体**：把同源模型代理掐掉（模拟「模型不可用」，
  = Spark 到期 / 上游 503 / 网络抖动），玩家按下「维修门计划」后只看到
  `校验拒绝｜未改变`——**没有一个字告诉他下一步该干什么**。
  这条用例**在公开部署上确定性地复现了 §0 的阻断**，不是本地环境特有现象。

修好之后这条必须转绿；它转绿之前，§2.6 的契约冲突还在。

> **总控已修 §2.6 的契约冲突**（模型不可达改为抛异常 → 规则脑接管 → 门照开，
> 来源如实标 `offline-fallback`）。本报告与本分支的所有实测数据都是
> **修复之前**在 `7297a37` / 线上 `index-WSEUTZFA.js` 上取得的。
> 修复后重跑这条用例，预期落在**「门开了、`status==='executed'`」**那一支，
> 而不是本报告记录的这一支。**请以修复后重跑的结果为准**，本报告保留原始观测
> 作为缺陷留档。

### 4.4 公共 smoke

`e2e-public/public-smoke.spec.ts` 是仓库既有文件，**不在 A9 的文件域内，未改动**。
它的 3 条用例正是「公开链接匿名可达 / 新设备进游戏 / 同源代理拿到的台词来自模型」，
与本次交付互补，**建议 A11 在提交前跑一次**：

```powershell
$env:PUBLIC_BASE='https://www.modelscope.cn/studios/a1578804454/floor-100000'
npx playwright test -c playwright.public.config.ts --workers=1
```

**本次 A9 未跑这条命令**（时间预算给了黄金路线本身），
所以报告里**不写**它的通过/失败结论——不虚构。

---

## 5. QA-02 对抗与异常矩阵（实测结果）

每一项都写**实际观察到的结果**，不写「应该没问题」。

| 攻击面 | 构造 | 实测结果 | 状态 |
|---|---|---|---|
| **无物资** | 不开材料箱，信任只有 49.4（<70），按「维修门计划」 | 门**没开**（`story:alin-repair-gate` 未设置）；木材/胶带**没被扣**；信任**没跳**；对话给出一句 `校验拒绝｜未改变` | 守恒 ✅ / 文案 ❌（见 §2.6-2） |
| **重复交互** | 连按两次 `Enter` 触发「维修门计划」 | 木材消耗 ∈ {0, 2}、胶带 ∈ {0, 1}，**没有扣两份**；门 flag ∈ {未设置, 1}，**没有开两次** | ✅ |
| **跨楼层** | 门没修好就在 2 楼楼梯按 `E` 想上 3 楼 | 楼层**没变**（仍是 2）；HUD 给出 `上层维修通道封锁 · 先协助阿林修复门禁`，玩家知道该先做什么 | ✅ |
| **非法动作** | 阿林有木材×2/胶带×1，尝试把它们当礼物送掉 | 赠礼清单里**没有** `赠送 木材` / `赠送 胶带`（游戏主动保留修门材料） | ✅ |
| **买不起的交易** | 小周「用 脏水×1 换 净水×1」，玩家开局没有脏水 | 交易**没成交**：脏水仍是 0、净水仍是 3、**没有任何库存出现负数**；对话给出失败说明 | ✅ |
| **请求超时** | 把 `/api/npc/decide` 挂住 30 秒不回 | 对话框**能正常打开**；来源标签**不是 model**；请求挂着时玩家仍能 `E` 关掉对话框并继续移动；**无 page error** | ✅ |
| **网络断开** | `context.setOffline(true)` | 对话仍能打开；来源标签显示降级来源（**不是 model**）；断网下规则赠礼**仍然真的生效**（净水 3→2）；恢复网络后无 page error | ✅ |
| **模型不可达（AI 端口活着但模型答不上话）** | 本地：`mode='ollama'` 指向本机没起的 Ollama。线上：把同源 `/api/npc/decide` 掐掉 | **死路**：维修 `status: exhausted`、`no_proposal`、`proposal/validation` 全空、门不开、材料不扣，玩家只看到 `校验拒绝｜未改变`，**没有任何下一步** | ❌ **这是本次唯一阻断**，见 §2 |

补充观测（不是断言，但值得 owner 看）：

- **赠礼路径根本不问模型**：`src/scenarios/alinGiftDemo.ts` 没有模型端口，
  所以线上赠礼的来源标签也是 `offline-fallback · 场景规则提案`。
  → 「NPC 用真实模型做出不同类型行动」这条评分点目前只有**维修**一条腿撑着。
- **对话打开时方向键归光标**：玩家在对话里按 ←/→ 不会移动。
  这不是 bug，但**超时用例要按这个前提写**（§4.2 第 6 条踩过）。

---

## 6. 没跑通 / 未完成的部分（如实写）

| 项 | 状态 | 原因 |
|---|---|---|
| 线上「停电危机 → 接回主线 → 4 层电箱 → 回 2 楼接回主线」闭环 | **跑通了** | §3.4；含 `decisionSource: model` 与完整状态差量 |
| 线上「**缺料**拒绝并指路」这一分支 | **未实机验证** | 跑闭环那一趟是先拿到保险丝/电线才去找阿林，走的是成功分支。缺料文案（`还缺保险丝、电线。…4 层电箱…`）只在仓库单测里覆盖 |
| 线上「小周交易」与「5 楼阿珍」 | **未实机验证** | 危机在小周之前就闭环了；小周的货已进库存（`fusex1 wirex1`）但没去换 |
| 二次观察是否引用新记忆 | **未验证** | 危机闭环后阿林记忆从 4 涨到 6 条，但**没有再对话一次**去观察引用 |
| NPC 自主行为（世界 tick 触发） | **未验证** | 需要等世界 tick 触发；另注：`src/systems/NpcWorldTick.ts` 是 A3 正在写的新文件，本轮没纳入 |
| `e2e-public/public-smoke.spec.ts` | **未跑** | 时间预算；它是仓库既有文件，不在 A9 文件域 |
| 真人试玩反馈（QA-03） | **未做，也未伪造** | 见 §7，交给作者 |

---

## 7. QA-03：试玩主持人脚本（**不是**反馈本身）

**QA-03 要的是真人试玩。A9 没有做真人试玩，也没有编造任何反馈。**
下面是交给作者的主持人脚本：照着走一遍，把四项记录填进提交清单的对应条目。

### 7.1 给作者的话（可直接转给试玩者）

> 请用你自己平时玩游戏的方式玩下面这个链接，**不要看任何说明文档**：
> `https://www.modelscope.cn/studios/a1578804454/floor-100000`
>
> 遇到不知道该按哪个键的时候，**先停下来**，把「你当时以为该做什么」说出来，
> 不用管对不对——你卡住的地方正是我们要修的地方。

### 7.2 八步流程（按顺序走，正常玩，别跳）

| 步 | 主持人交代 | 主持人要盯的事 |
|---|---|---|
| 1 | 打开链接 → 「开始新游戏」 → 角色随便选 | 有没有登录？第一屏看不看得懂要干什么？ |
| 2 | 走到最左边的楼梯按 `E` 上楼 | 走到楼梯花了多久？需不需要问人？ |
| 3 | 找写着「维修材料箱」的东西，按 `E` | 找得到吗？拿到东西有提示吗？ |
| 4 | 找「阿林」，按 `E`，选「赠礼」，送一次净水，**送三次** | 送完三次他知道你是谁吗？对话里有没有解释他为什么需要？ |
| 5 | 回主菜单选「维修门计划」 | **这一步最关键**：他答应了吗？如果拒绝，他有没有告诉你下一步该干什么？（拒绝文案只写「校验拒绝｜未改变」的话，记下来） |
| 6 | 上 3 楼（会弹一张「第 1 章完成」的卡，按 `Enter` 继续），再上 4 楼找「电箱」，按 `E` | 结算卡看得懂吗？4 楼黑不黑？找不找得到电箱？ |
| 7 | 回到 2 楼找阿林（他的选项现在应该变成「接回主线」），按下去 | 他有没有说出主线怎么了？要不要你先跑腿？ |
| 8 | 再找一次阿林聊；然后找「小周」换一次东西 | 第二次对话跟第一次**有没有不一样**？你有没有觉得你做过的某件事被记住了？ |

> 主持人提示：第 7 步在实测里是最容易「看不懂」的一步（选项名从「维修门计划」变成
> 「接回主线」，且要玩家自己跑 4 楼拿零件）。**如果试玩者卡在这里，
> 那不是他们笨，是设计没交代清楚**——照实记下来。

### 7.3 每位试玩者要记的四项（就这四项，别的不用记）

1. **设备 / 浏览器**：机型、系统、浏览器、是否全屏、屏幕分辨率、网络（WiFi / 4G）。
2. **卡点**：卡在第几步？当时**以为**该做什么？实际按了什么？屏幕上出现了什么字？
   （卡点原文照抄，不要改写。）
3. **一句反馈**：让试玩者用一句话说「这游戏好玩/不好玩的地方是什么」。
   **照录，不要润色、不要替他总结、不要替他解释。**
4. **改动前后**：如果这轮根据反馈改了东西，改完再让**同一个人**重走第 5、7 步，
   拍一段同样的操作，对比两段的差异。

### 7.4 填到提交清单的哪个条目

`docs/COMPETITION_SUBMISSION_CHECKLIST.md`：

| 试玩产出 | 填到哪一条 |
|---|---|
| 上面四项（设备 / 卡点 / 一句反馈 / 改动前后） | 第 35 行 `- [ ] **作者真人试玩**：未做。需记录体验者、设备/浏览器、阻塞点、反馈、改动前后对比。` —— 把 `[ ]` 改成 `[x]`，并把四项填进去 |
| 一句反馈 + 试玩描述 | 第 191 行 §1 末「作者自己的试玩描述：最有趣的取舍、希望传达的主题、真人反馈」 |
| 改动前后对比（配截图/录屏时间码） | 第 194 行 §4.2 末「真人试玩记录（设备、人数、反馈、改动前后对比）」 |
| 公开试玩链接的访问截图与设备 | 第 190 行 头部表格「作品试玩链接」 |

**目标 ≥3 次独立试玩**（不同的人、各自带自己的设备），不要一个人自己玩三遍。

---

## 8. 交付清单 / 回滚

| 项 | 值 |
|---|---|
| 分支 | `a9/qa-golden-route`（从 `deploy-ms-20261125` 的 `7297a37` 切出，**没有动别人的分支指针**） |
| 新增文件 | `e2e/goldenRouteHarness.ts`、`e2e/goldenRoute.spec.ts`、`e2e/adversarialMatrix.spec.ts`、`e2e/onlineGoldenRoute.spec.ts`、`docs/competition/evidence/qa-golden-route.md` |
| 修改文件 | 无（没有碰 `src/**`、`e2e-public/**`、`tools/verify-online-api.mjs`、`artifacts/online-verify/**`、`docs/GAME_DESIGN_LOCK.md`、`LICENSE`） |
| 类型检查 | `npx tsc --noEmit` → **exit 0** |
| 本地 E2E | `npx playwright test -c playwright.config.ts e2e/goldenRoute.spec.ts e2e/adversarialMatrix.spec.ts --workers=1 --timeout=180000` → **11 passed (5.0m)** |
| 线上 E2E | `PUBLIC_BASE=… npx playwright test -c playwright.config.ts e2e/onlineGoldenRoute.spec.ts --workers=1 --timeout=300000` → **1 passed（黄金路线绿）, 1 failed（BLOCKER-01 红，正是本次缺陷）** |
| 既有用例回归 | `npx playwright test -c playwright.config.ts e2e/competitionAiNpc.spec.ts --workers=1` → 默认环境 **2 failed**（模型不可达）；`$env:VITE_NPC_MODEL=' '; $env:VITE_NPC_PROXY='off'` 下 **2 passed** + 赠礼那条单跑 **1 passed** |
| 回滚 | `git branch -D a9/qa-golden-route`（只新增文件与分支，删分支即回滚；主干未受影响） |

---

## 9. 给总控的 5 条行动建议（按优先级）

1. **立刻派单修 §2.6 的契约冲突**（`buildRepairProposalPort` 区分「不可达」与「拒绝」）。
   这是唯一的「玩家走不下去」的点，修完请让 A9 重跑
   `e2e/onlineGoldenRoute.spec.ts` 的 BLOCKER-01 与 §2.4 的两条既有用例。
2. **上线前收敛代理到上游的连接稳定性**（§3.5 的 40+ 条 `ERR_CONNECTION_CLOSED` 与 1 条 401）。
   Spark 11-30 到期后，这条死路会变成常态。
3. **别再在提交材料里写「第 1 章达成卡未部署」**（§1）：线上已经是
   `index-WSEUTZFA.js`，含 `第 1 章完成` / `继续游玩`，结算卡线上实测会弹（§3.3）。
4. **把「赠礼不算模型行动」这件事说清楚**（§5 补充观测）：目前只有维修与危机主线
   两条腿是真模型，若要让「不同类型行动都有模型参与」成立，需要 owner 决定是否给赠礼/交易接模型。
5. **把对话来源标签的措辞改掉**（§3.4）：远端 Spark 决策被标成 `Ollama 本地模型`，
   会被评委理解成「模型跑在玩家机器上」。二分（model / offline-fallback）是对的，措辞要中性。
6. **QA-03 请作者本人去做**（§7 脚本已就绪）：A9 不代替作者编反馈。
