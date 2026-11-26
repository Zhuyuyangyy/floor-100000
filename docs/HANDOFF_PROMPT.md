# 交接提示词：《第100000层：末日宿舍》R3 收尾

> 用法：把对应 agent 那一节的全文贴给新 agent，它就能接手。
> 写于 2026-11-26。`wt-r2` 工作区已全部提交推送，与 `origin/deploy-ms-20261125`
> 同在 `08a9fd1`，领先 0 / 落后 0，工作区（含未跟踪文件）全干净。

---

## 通用开场（每个新 agent 都要先做）

```
你在 /d/ZYY_Inovation/game/wt-r2（Git Bash；Windows）工作。
项目是《第100000层：末日宿舍》，Phaser 4 + TypeScript strict + Vite。

先做这三件事，不要跳过：
1. git rev-parse --show-toplevel && git branch --show-current && git status --porcelain
   确认仓库根、分支 deploy-ms-20261125、工作区干净。
2. npx tsc --noEmit && npx vitest run && npm run build && npm run test:collection
   基线：tsc 0 错；1203 passed / 6 skipped / 1209 项 / 86 文件；build 0；收集门禁 OK。
3. md5sum artifacts/online-verify/api-verify.json
   应为 cb827d5a957974ea382672f07469c804。这是唯一入库的线上真证据，任何操作都不能覆盖。
```

### 全队硬约束

- **禁止 `git add -A`**。仓库曾因预暂存文件被误提交（`4dcd5e6` 已作废）。
  只提交指定路径，用 `git commit -- <path>`，提交后 `git show --name-status` 核对。
- 不要用测试夹具冒充真实玩家体验，不要用规则 fallback 冒充真实推理。
- 不要为凑测试数量加测试；`tools/verify-online-api.mjs` 已冻结，不再加门控或改判据。
- 桩数据在 `tmp/`（已被 .gitignore），不能当线上证据。
- `artifacts/online-verify/` 与 `output/online-verify/` 六份 md5 必须始终一致。
- 配色遵循中国习惯：涨红跌绿；货币符号 ¥。

### 五个 agent 的结局

a1-ai-action / a2-gameplay / a3-visual / a5-qa-ci / a7-deliverables
在上一轮中断时已全部停止，尝试恢复报 `Not in a team`，**无法唤醒**。
下面各节是它们的完整交接，不等于它们还在运行。

---

## A1 — AI 行动与模型契约负责人

### 职责边界（原 assignment）

可改：`src/ai/competitionModelBridge.ts`、`src/ai/` 下新建文件、
`src/systems/NpcRuntime.ts` 及测试、新建测试文件。
禁改：`src/scenes/`、`src/render/`、`src/ui/`、`.github/`、`server/`、`docs/`、`README.md`、`package.json`。

实际后期它主要在做 `tools/verify-online-api.mjs`，`server/` 始终不归它。

### 已做到哪里

1. **模型行动接入正式游戏入口**：`executeCompetitionProposal` 是唯一提交入口，
   `decisionSource` 只在「模型产出提案 + 提交成功」时标 `model`。维修路径已接通，
   赠礼/交易仍在离线场景。
2. **`weight` 在直连链路丢失已修**（`00e93f9`）。根因不在 SparkBrain，在
   `src/ai/prompt.ts` 的 `fmtMemory`，它有 4 个生产调用点（Ollama 直连 2 处、
   retry 1 处、SparkBrain 1 处）。SparkBrain 实际零生产引用。四档强度词照搬代理链路。
3. **`tools/verify-online-api.mjs` 的整套验收修复**：7 条假绿判据降级为 SKIP、
   落盘门控（token / 位置 / 内容 / 覆盖六道）、路径穿越从 `fetch` 改 `node:http`
   原始 path、403 不再读成 SKIP、`/healthz` 非 JSON 容错。定版号一路推到 `9db9ec8`。
4. 最后一笔是 `9db9ec8`（路径穿越判据补「不存在路径」基线）。

### 没做完 / 新 agent 该做什么

**没有代码待办。** A1 自己反复承诺「tools 停手」又改了多次，
现在由我接手冻结；`tools/verify-online-api.mjs` 不再接受任何改动（含注释和文案）。

**唯一挂着的活：public 之后真跑线上。** 这不是 A1 独有的，见文末 P0。
> ✅ **2026-11-26 已完成**：空间本来就是 public，带 token 的正式验收已跑通
> （40 条判据，38 通过 / 2 FAIL），六份产物落 `artifacts/online-verify/`。
> 「路径穿越判据落在哪一档」也查实了：**线上拿到的是网关 400 错误页，不是源码**
> （逐字查过无 `NPC_API_KEY`），这条是**判据假阳性**。md5 已更新。见文末 P0。

**它犯过的错，新 agent 别重犯**（A1 自己列了 12 条，按重要性取三条）：
- 「修错的动作本身可以造出新错」：为消除 detail 歧义，删掉了某场景下唯一的救场证据。
- 「单向判据不能反着写」：成立能推出拿到 200，不成立什么都推不出来。
- 「中间态不是事实」：把改到一半的工作区值（6→7）写成了历史事实。

---

## A2 — 居民社会与玩法负责人

### 职责边界

可改：`src/data/`、`src/scenarios/`、`src/systems/` 下新建纯逻辑模块（**`NpcRuntime.ts` 归 A1**）、
新建测试文件。`src/core/GameState` 需先报备。
禁改：`src/scenes/`、`src/render/`、`src/ui/`、`src/ai/competitionModelBridge.ts`、`server/`、
`.github/`、`docs/`、`README.md`。

### 已做到哪里

1. **信任断点真根因已修**：`appendMemory`（`c202b98`）首次写记忆时用
   `baseline.relationship.player === undefined` 补 `COMPETITION_TRUST_BASE`，
   不再用 `?? 0` 把陌生人当 0。`:511` 那条 `observed`（权重 0）曾把 35 永久写成 0。
2. **失信负面路径**（`fe2fe79` + `ba18d26`）：35 → 3 件礼物 ×14.4 = 78.2 →
   接单 +12 = 90.2 → 失信 -4.8 = 85.4。85.4 仍高于 65 门槛，拦下玩家的是
   `materials_unverified` 程序性前置，不是分数；修好只 +2。五刀反证全红。
3. **`nextStep` 落地**：真增量是「去哪里拿」，扫 `FLOOR_TEMPLATES` + 查小周库存。
4. **`request_help` 接活**（`dedce0f`）：点维修即接单，连带使失信判定从死代码变可执行。
5. **阿珍负向记忆**：他实测了 6 个 seed 的 `48.2 / 43.8 / 30.6` 和两刀反证，
   但**测试没落地**（只有临时探针 `probe.azhen-negatives.ts`）。
   我已替他落地为 `blackoutCrisis.test.ts` 末尾 2 条断言（`b1395a5`），探针删除。

### 没做完 / 新 agent 该做什么

**`requestBlackoutHelp(game,'azhen')` 缺幂等守卫 —— 潜伏 bug。**

> ✅ **已于 2026-11-26 修完并合入主线（`e9fd25e`）**：承诺按人分键
> （alin/azhen/xiaozhou 各一把），幂等检查提到分支之外，过期判定逐人判，
> 旧存档单键保留为只读回退。实测阿珍连点 5 次信任恒为 46（修复前 46→57→68→79→90），
> 补了 8 条回归断言，阿林行为逐字不变。
> 下面保留原缺陷描述，作为「为什么当时没人发现它」的证据。

- 实测：阿珍连点 5 次，信任 46→57→68→79→90，每次 +11 并多写一条 help 记忆。
  对照阿林连点 3 次，第 2 次起 `already_requested`，信任不变。
- 根因：`blackoutCrisis.ts:643` 的 `promiseDay` 幂等检查写在
  `if (npcId === 'alin')` 分支内部（`:656-660`），阿珍/小周走 `:670` 起的公共
  `atomic` 分支，那里只有 `appendMemory`，没有已接单判断。函数注释 `:687-691`
  说「内部靠 promiseDay 幂等」，描述的只是阿林。
- **当前无 UI 入口**（`grep requestBlackoutHelp` 只有 `ensureBlackoutHelpRequested`
  写死 `'alin'` 和 GameScene `:4134`），所以是潜伏而非在跑的漏洞。
- **修法代价**：`promiseDay` 是单个全局 flag（`src/data/blackoutCrisis.ts:50`），
  阿珍/小周要各自独立就得按 npcId 分键，`BLACKOUT_FLAG` 加两个新键，
  `syncBlackoutCrisis` 的过期判定也要跟着分人。**不是一行能改完的，需产品拍板。**

如果决定修：先在 `src/data/blackoutCrisis.ts` 加 `promiseDay:alin/azhen/xiaozhou`
三个键，再改 `requestBlackoutHelp` 的幂等检查为按 npcId 取键，
最后补一条「阿珍连点 3 次只 +1 条 help 记忆」的断言。别复用单个 flag，
否则阿珍和小周会互相顶掉。

---

## A3 — 美术与 UI 产品负责人

### 职责边界

可改：`src/ui/` 下新建视觉规范文档与常量、`docs/` 下新建审查文档、
`src/render/` 里纯视觉常量（改动要极小且有理由，`walkcycle.ts` 不要碰）、新建截图目录。
禁改：`src/scenes/GameScene.ts`（A0 独占）、`src/data/`、`src/ai/`、`src/scenarios/`、
`server/`、`.github/`、`package.json`、`README.md`。

### 已做到哪里

1. `eadb7af` 画布分辨率 640x360 → 1280x720（D-1/D-2），复核全部派生结论。
2. `fe4d2bd` UI/视觉审查 R3（912 行），14 处中文换行逐条实测，修 B-1，
   62 张证据图；`src/scenes/MetaSelectScene.ts` 面板 470x300 → 520x360，
   说明文字开 `useAdvancedWrap: true`，遗物列起点 +140 → +160。
3. `489189d` 补齐 UI_AUDIT_R3 引用的 9 个只读探针。
4. `docs/VISUAL_SPEC.md`（553 行）+ `src/ui/visualTokens.ts`（230 行，零引用，
   定位是索引文档不是运行时代码）。
5. 三门禁全绿：tsc 0 错、vitest 全绿、Playwright audit **41 passed**（2026-11-26 补完
   360×900 那条 7 行路径后由 40 变 41；audit 套件不在 CI 里，也没有写死的条数门禁）。
6. `docs/VISUAL_SPEC.md` 的视口推导更正已由我提交（`918c733`）。

### 没做完 / 新 agent 该做什么

**四项 UI 缺陷在 2026-11-26 全部修完并合入主线：**

| 优先级 | 缺陷 | 位置 | 修法 | 提交 |
|---|---|---|---|---|
| **P0** | `invDetailBody` 空槽文案横向冲出面板 | `src/scenes/GameScene.ts` | 开 `useAdvancedWrap`（中文没有空格，默认折行只在空格处断，整句被当成一个词）；详情井 130→150、面板 236→250、正文槽 76→68，按钮同步下移 20px | `1c37270` |
| P1 | 夜宿压力行把第三行整句截掉 | `src/scenes/GameScene.ts` | 开 `useAdvancedWrap`；`maxLines` 2→3（原来那行是**静默删掉**第三行，不是折行）；压力井 44→72，行起点 80→110 | `1c37270` |
| P2 | 塔楼总览下半屏 53% 空着 | `src/systems/TowerNav.ts` | `VIEW_H` 改读 `DESIGN_HEIGHT`（720）；行高 3→6、顶部内缩 36→66 → 100 行占画布高 41.7%→**83.3%**；`e2e/tower.spec.ts` 旧断言 `content<=360` 换成 `content<=view.height` + 填充率 ≥0.8 + 「nav 视野必须等于相机 worldView」 | `875ae1e` |
| P3 | 折行探针碰不到 7 行路径 | `e2e-audit/dialogue-fit-probe.spec.ts` | 补 `[360,900]`（面板 264、折行宽 220），**量 Phaser 真画出来的行数**（单行基准高 ÷ 满额台词总高），断言正好 7 行、`maxLines=0`、正文不压选项 | `3cc21e7` |

**回归护栏**：`e2e/uiTextFit.spec.ts`（P0/P1）——断言「每一折行都真的画出来」「绘制行数不得少于折行数」
「折行后不能丢字」「正文右沿不得越过面板右沿」。

**顺带查出的一处口径不一致（非产品缺陷）**：`e2e-audit/dialogue-fit-probe.spec.ts` 里
原有的常量 `MAX_UTTERANCE_LINE` 实为 **64 字**（名字与注释却写「60 字上限」），
而产品真上限是 `src/ai/rulesExecutor.ts` 的 `MAX_UTTERANCE = 60`。
因为 `sanitizeUtterance` 会先截到 60，所以线上永远到不了 64 字；但探针若拿 64 字去量
360×900，会算出 8 行、溢出底板上下各约 8px——**那是探针常量超上限，不是破版**。
新增的 360×900 用例已改用真上限 60 字，既有常量与断言未动。

**仍然待修（不是这一轮的范围）**：顶部标题与状态行互相压字、右侧「终点 第100000层」标签超画布被裁。

> **竖屏那条也补掉了**（`cc30d43`）：竖屏（360×900）下背包详情正文 13px、自然宽 260px、
> 折行盒只有 224px，不开按字符折行就整行冲出详情井右沿 **28px**（实测：正文 x[32..292]
> vs 井 x[24..264]）。改法：竖屏也开 `useAdvancedWrap`，详情井 66→80（放得下两行）。
> 修后实测：折行 2 行、**2 行都画出来**、渲染最宽行 221 ≤ 折行盒 224、正文右沿 253 ≤ 井 264、
> 正文底 405 ≤ 井底 412、井底 412 ≤ 按钮带 450。回归用例：`e2e/uiTextFit.spec.ts`
> 的「竖屏 360×900」那条（桌面那条绿了不代表竖屏绿，两种视口必须各测一遍）。

**A3 自查推翻过的两条错误结论，别再采信**：
- 「消息锚点从 0.5/0.5 改 top 是根治」——代码一直是 `setOrigin(0.5)`，真正起作用的是井高。
- 「390x844 是 7 行」——它是 6 行；7 行只在 360x900。

---

## A5 — QA 与工程集成负责人

### 职责边界

可改：`server/npc-proxy.test.mts`、`.github/workflows/ci.yml`、`src/scenes/GameScene.ts`
的调试句柄部分（需先报备 A0）、`src/main.ts`、`e2e/` 与 `e2e-live/` 下新建修复、新建测试。
禁改：`src/ai/`、`src/render/`、`src/ui/`、`src/data/`、`docs/`、`README.md`、
`package.json` dependencies、`src/scenarios/`。

### 已做到哪里

1. **CI 修复**（`eb4112a` + `900b522`）：`test:ci` 用 json reporter 写
   `output/vitest-report.json`（**不是** `test-results/`，那是 Playwright 每次跑都清的目录），
   `test:collection` 卡下限 86 文件 / 1204 用例。CI 顺序：Build 必须先于单测
   （代理测试真 spawn 服务，静态根固定是仓库根的 `dist/`）。
2. **401 论证**（**2026-11-26 已更正**）：当时写「创空间是 private，401 拦在平台网关」——
   现在看，**空间一直是 public**；401 只出现在 **API 专用地址**
   （`studio-…api-inference.modelscope.net`，平台设计要求 SDK token），与公开性无关。
   原始观察（`GET /`、`GET /healthz`、不存在的路径都 401，`X-Studio-Token` 明写在允许头里）
   仍然成立，只是**归因错了**：不是「私有空间挡门」，是「这个地址要凭证」。
   真正理由不变：即便凭证有效，也只证明持证人能访问。
3. **7 条假绿判据的发现**：同一 401 响应上「维修回复是结构化 intent」判 FAIL、
   「维修契约没退回旧 action.type」判 PASS，两条读同一个 `{}`（空对象 truthy）。
4. **一批真 bug 的发现**（A5 只复核不动代码）：
   - `GET /%` 打死服务进程 —— 已由我修复（`0914cc1`）。
   - 路径穿越判据用 `fetch` 导致 `/../` 在客户端被折叠，服务端即使零防护也 PASS —— 已修（`4831b28`/`9db9ec8`）。
   - 403 被读成「没测到」而服务端其实正确拒绝 —— 已修（`9db9ec8`）。
   - `tools/` 复核循环「标识符非零 ≠ 门还活着」—— 文档已改口径。
5. 它自己的错：TS6196 行号归因错（`e6eae3b^` 第 16 行是空行，符号在第 9 行）；
   清理脚本 `&& echo || rmdir` 恒真导致一个没删；`/%2e%2e/` 在 fetch 下也会折叠
   （必须 `/%2e%2e%2f`）。

### 没做完 / 新 agent 该做什么

**A5 没有代码产出，全部是复核报告，全部已处理完。**

它反复提的三条待裁决，我的决定：

| 它提的 | 决定 |
|---|---|
| 7 条假绿复盘进不进参赛材料 | **进，但只写一条可复现的假结论 + 一条判断标准，不列举条数**。理由：条数会被下次复核推翻，证据链的方法论不会 |
| `api-verify.json` 无 `gated` 字段 | **关闭**。32 条全 PASS，本来没有未执行项，`undefined` 读作 false 不影响结论；全库无文档要求读该字段 |
| 定版号 | 已冻结，见 A1 节 |

新 agent 若要做 QA，唯一有价值的是 **public 之后真跑线上**（见文末 P0）。
不要再起桩复核已经验过的东西。

---

## A7 — 参赛材料与开源负责人

### 职责边界

可改：`docs/` 下文档、`README.md`、`LICENSE`、`THIRD_PARTY_NOTICES.md`、
`examples/` 或 `docs/npc-sdk-example/` 下的文档和示例代码。
禁改：`src/`、`server/`、`.github/`、`package.json`、`vite.config.ts`、`e2e/`、`e2e-live/`。

### 已做到哪里

1. `artifacts/online-verify/README.md`（约 350 行）：线上验收口径、桩对比实验、
   7 条假绿读法、六道落盘判据表、探针复核命令。
2. `docs/BENCHMARK_REPORT.md`、`docs/COMPETITION_CREATOR_NOTE_DRAFT.md`、
   `docs/COMPETITION_SUBMISSION_CHECKLIST.md`、`docs/SPARK_DEPLOY.md`。
3. `LICENSE` 草稿（`PENDING OWNER CONFIRMATION`）、
   `THIRD_PARTY_NOTICES.md` 核实表、`docs/npc-sdk-example/ADD_A_RESIDENT.md`。
4. 证据溯源：32 条产出于 `b9ffd0b`（11-25 23:36），记忆段是 `e18667b`（23:59）
   才加的，晚 23 分钟——所以证据里没有记忆段输出不是遗漏。
   区分力在**第 16 条 detail 的 `itemId:"tape", quantity:1`**，不是断言名（两版 32/32 全等）。
5. 两个数字口径：`137 = 122 注释 + 9 console + 6 串续行`（`d03043→a78795c`），
   后来随区间变为 `174 = 151 + 13 + 10`（`d0304d3→692b358`）。
6. 定版号最终推到 `9db9ec8` 之后，文档已由我统一提交（`918c733`）。

### 没做完 / 新 agent 该做什么

**唯一没做完的是 `LICENSE` 定稿，卡在版权方（用户本人）。**

当前 `LICENSE` 末尾标着 `STATUS — PENDING OWNER CONFIRMATION`，需要用户决定：

1. **是否采用 MIT，著作权人署名填什么**。现在是占位符
   `The "第100000层：末日宿舍 / Floor 100000" project authors`。
2. **美术资源是否排除在 MIT 之外**。`public/assets/artpack/`、
   `ui/frame-*.png`、`ui/slot.png`、`env/`、`title/`、`weapons/` 是 owner 提供的，
   条款未声明。
3. **第三方是否各自保留原许可**。Phaser MIT / 方舟像素字体 OFL 1.1 /
   Kenney CC0 / pixelfx MIT，`THIRD_PARTY_NOTICES.md` 已查清。

**不要替用户填**——填了就是伪造法律声明。用户答复后，去掉
`PENDING OWNER CONFIRMATION` 标记，按答复改署名和美术条款，提交推送。

**A7 犯过的错，新 agent 别重犯**：
- 把 `git log --before`（严格小于）当溯源方法，返回的永远是上一版；
  `b9ffd0b` 的 commit 时间 23:37 晚于产物 23:36，结构性被排除。
- 把「删一道防线」当成「防线失效」：`safePath` 有两道，`normalize()` 先吃掉前导
  `..`，只删越界比对不漏。a5 先犯，A7 第二个犯。
- 把脚本复制到子目录跑，脚本按自身位置推 `REPO_ROOT`，根跟着挪，
  误读成「门失效」。**门没坏，是实验装置坏了。**

---

## 真正的全局待办（按优先级）

### P0 — 「改 public」这一步**已经不需要做了**（2026-11-26 实测推翻）

**旧结论（错的）：** 「创空间仍为 private，只有用户本人能改；401 拦在平台网关。」

**实测事实：**

| 项 | 实测 |
|---|---|
| 空间可见性 | `GET https://modelscope.cn/openapi/v1/studios/a1578804454/floor-100000` → `"visibility":"public"`、`"private":false`、`"status":"Running"` |
| 公开地址 | `https://www.modelscope.cn/studios/a1578804454/floor-100000` → 匿名 **200** |
| 游戏是否真的起来 | 是。门户挂出应用 iframe，iframe 里 **canvas 1280×720、Menu 场景 active**（见 `e2e-public/public-smoke.spec.ts`） |
| 真模型链路 | 浏览器里 `POST /api/npc/decide` → `decisionSource:"model"`，真台词 |
| 401 出现在哪 | **只在 API 专用地址** `studio-…api-inference.modelscope.net`。该地址按平台设计**必须带 SDK token**，与空间是否公开无关 |
| 顶层访问 `.ms.show` | **302** 到门户页，游戏跑在门户 iframe 里（所有魔搭创空间都这样，不是故障） |

**所以「评委免登录可访问」这条已经满足。** 不需要用户去改任何开关。

### P0 — 已完成：带凭证的线上验收跑通了，记忆段从 6 红变 7 绿

**时间线（每一行都有出处）：**

| 时间 | 做了什么 | 结果 |
|---|---|---|
| 11:07 | 第一次线上跑记忆段（无 token，走公开 host + UA 垫片，脚本一行未改） | 记忆段 **6 FAIL / 1 SKIP / 1 PASS**；基础段 32 条全 PASS |
| 11:07 | 定位根因：提示词只把记忆当背景读物 | 模型读到了记忆（提示词逐字可查），但十几次采样全选 `dialogue` |
| 11:0x | 修法（`7a9b486`）：`buildMessages` 加「记忆决策」契约 + 守护测试 | **改产品，不改判据**；规则层照样能否决 |
| 11:07–11:08 | git 同步到创空间仓库 → `POST .../deploy` → 盯 build/run 日志 | `status=Running`；`[npc-proxy] listening on 0.0.0.0:7860`，模型 `Qwen/Qwen3.8-Flash-Next` |
| 11:14 | 带 token 跑 API 专用地址，**六份产物落 `artifacts/online-verify/`** | **40 条判据，38 通过 / 2 FAIL**；记忆段 **7 PASS / 1 FAIL** |

**证据级产物**（`hasToken:true` / `forceWrite:false` / `modelSamplesObserved:3`）：

| 文件 | md5 |
|---|---|
| `api-verify.json`（40 条） | `7bbdc073085d1368fc4bf92cbe07613e` |
| `api-verify-meta.json` | `55bb7e8cce868e4e357b7f4f8d539387` |
| `api-verify-notes.json` | `76dea28c6d8da550370c1568a59db2d8` |
| `real-model-runs.json` | `df4a9e1cfec2b1728aaf26f7c1856f94` |
| `memory-evidence.json` | `45de0ccdd08cee28f7a3d7995755dcbc` |
| `memory-weight-evidence.json` | `1b02d07e75b684f0512811a43ec881cf` |

**上一版（2026-11-25 23:36）**是 32 条基础段、md5 `cb827d5a…`、**不含记忆段**——
那份 md5 仍然出现在 `tools/verify-online-api.mjs` 的注释里，那是它记的
「一次 token 拼错把权威产物覆盖成假产物」那次事故的**历史现场**，不是当前值。
**脚本是冻结的，不接受任何改动**，所以由 `artifacts/online-verify/README.md` 解释。

**两条 FAIL 都在判据侧，都已查实：**

1. **路径穿越**：线上拿到的是**网关自己的 400 错误页**（225B，Tengine），
   逐字查过**不含 `NPC_API_KEY`、不含源码**；判据只比「与基线不同」，
   把「400 错误页 vs 200 首页」读成了「命中源码」。**产品没有泄漏。**
2. **weight 专项**：正向极性在「无库存」条件下**无可达动作**
   （`gift/trade` 需真有物品才能合法表达）；负向方向清楚（`neg` 4/4 全 `refuse`）。

### P0.7 — 主线浏览器回归的实测状态（2026-11-26 复跑）

| 范围 | 结果 |
|---|---|
| `e2e/tower.spec.ts` + `e2e/uiTextFit.spec.ts`（主线，`--workers=2 --timeout=120000`） | **11/12 通过**。唯一失败是 `?devfloor=100000 starts the retired dev dorm scene and nothing else`：**Test timeout of 120000ms exceeded**（超时，不是断言失败） |
| 该失败是否本次引入 | **否**。ui-tower 那条线做过 A/B：把 `GameScene.ts` 还原到基线 `0e67eaa` 后，**同一条断言仍然超时**；它是「一次要起三次游戏」的退役夹具用例，与塔楼/文案改动无关 |
| 单独再跑（`--timeout=300000`） | 本机仍未跑完（该用例在负载下就是慢）。**CI 里 `e2e` 作业本来就是 `continue-on-error` 的观测项**，不是合并门禁（`docs/03_TASKS.md` B6-AI-09 记着同一类时序抖动） |
| `e2e-audit/wrap-overflow-evidence.spec.ts` | 翻转成回归防线后**待终验**（翻转本身已提交；断言改为「折行后拼回来的字与原文逐字相同」） |
| 关键实测（夜宿压力行） | `wrap=452 maxLines=3 自然宽=600 渲染最宽行=440 折行=3 行 绘制=3 行 已画=true,true,true`，行 x[414..854]、井 x[402..878] → 三行**都真的画出来了**，且没有冲出井 |

**结论**：本轮改动的两条 UI 缺陷在主线复跑里都被断言咬住了（折行数、绘制行数、逐行墨带、
右沿/底沿）；唯一的红是既有的慢用例，与改动无关。

### P0.5 — 记忆段现在的口径（**可以写了，但必须带上过程**）
> **记忆改变了模型的行为，而不只是它说的话。**
> 三组对照全部成立（极性总增益 2.00 ≥ 1.50）、锚点回响命中 4 次、
> 对照组零锚点成立（对照 0 次 / 治疗 4 次 → 锚点确实有区分力）。

**但这句话必须配上过程**：第一次线上跑是 6 条红 → 定位到提示词没把记忆写成决策因子 →
改产品 → 重新部署 → 7 条绿。**不说这层过程，就把一次修复说成了一次发现。**
逐条数字见 `docs/BENCHMARK_REPORT.md` §2.5 与 `artifacts/online-verify/README.md`。

**仍然待处理的一条**：weight 专项（正向极性在无库存条件下不可达）。
要让它绿，得动 `tools/verify-online-api.mjs`（给 weight 段补一件真有的物品，
让 `gift` 成为合法表达）——**但那份脚本是冻结的**，动它需要先解冻并改口径。

### P1 — LICENSE 定稿（**已完成**，权利人 2026-11-26 拍板）

MIT，署名 **Zhuyuyangyy**；**美术纳入同一份 MIT**（artpack/frame-*.png/slot.png/
env/title/weapons 全部覆盖）；第三方**逐项保留原许可**。
`package.json` 补了 `"license": "MIT"`。见 A7 节与 `LICENSE` §Adoption record。

### P2 — 参赛材料方法论补强（**已完成**）

`docs/BENCHMARK_REPORT.md` §5 已加一条判断标准（「能重跑的才算结论，数出来的只能算线索」）
+ 一条可复现的假结论（限流段 15 次成功 vs 本轮 0 次模型回复，同一屏互相打脸）。
**没有**列举「我们审出了 N 处瑕疵」。

### P3 — 明确不做的技术债

| 项 | 现状 | 为什么不现在做 |
|---|---|---|
| `weight` 词表 | 直连链路已修，但 `flee`/`observed` 仍落兜底「相遇」 | 改词表是语义决策 |
| `recentEvents` 接线 | 生成 3 处消费 0 处，已标注释 | 要改 `server/` 白名单并扩大线上验证面 |
| `isDecisionFresh` | 生产零调用，已登记已知限制 | 不影响赛前演示 |
| `dialogue-fit-probe` 补 360x900 | 见 A3 节 P3 | 低优先级 |

> **`requestBlackoutHelp('azhen')` 幂等已修**（`e9fd25e`）：承诺按人分键
> （alin/azhen/xiaozhou），幂等检查提到分支之外，过期判定逐人判，
> 旧存档单键保留为只读回退。实测阿珍连点 5 次信任恒为 46（修复前 46→57→68→79→90），
> 补了 8 条回归断言。阿林行为逐字不变。
