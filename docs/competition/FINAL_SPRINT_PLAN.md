# 今晚收尾计划（给 MiniMax）

> 整篇贴给执行者。目标是**提交即可用**，不是重写游戏。
> 写于 2026-11-26 20:19。工作目录 `/d/ZYY_Inovation/game/wt-r2`，
> HEAD `b694ddc`，本地=远端，领先 0 / 落后 0，工作区干净。

## 0. 开工前必做（3 分钟，不要跳）

```bash
git rev-parse --show-toplevel && git branch --show-current && git status --porcelain
npx tsc --noEmit && npx vitest run
```

基线：`deploy-ms-20261125` 分支，tsc 0 错，
vitest 84 passed / 2 skipped（86 文件）、1220 passed / 6 skipped（1226 用例）。

**硬约束：**
- 禁止 `git add -A`，只提交指定路径，用 `git commit -- <path>`，提交后 `git show --name-status` 核对。
- 不要用测试夹具、控制台注入、存档篡改冒充实机。
- **不要碰** `tools/verify-online-api.mjs`（已冻结）、`artifacts/online-verify/*.json`（唯一线上真证据）。
- 视频不归你（另一个模型做），真人试玩不归你（作者做）。**你只做下面三项。**

---

## 任务 1：加「阶段达成」结算卡，让评委玩到一次胜利（优先）

### 背景，先读懂再动手

- 正式胜利条件是抵达第 100000 层（`docs/GAME_DESIGN_LOCK.md` 最高设计权威）。
- 实际可玩范围只有第 1–5 层（`src/core/constants.ts` 的 `PLAYABLE_FLOORS_V01`）。
- 旧的第 8 天自动胜利已作废，只剩 `?devwin=1` 调试入口（`src/core/devMode.ts`）。
- 结果：**正常玩永远不会赢**。EndScene 在胜利分支写着「正式胜利条件为抵达第 100000 层」。

### 要做到什么

玩家走完现成的「材料箱 → 赠礼给阿林 → 维修门 → 走上 3 层」链路时，
弹出一张**阶段达成**卡（复用 EndScene 的视觉，不新画场景），
明确写「第 1 章完成：线路恢复，抵达第 3 层」，
并给出「继续游玩 / 重新开始」两个按钮。

**这不是改正式胜利条件**，不要动 `status='won'`、不要动 `isLegacyVictory`、
不要动 `GAME_DESIGN_LOCK.md`。这是新增一个**阶段里程碑**状态。

### 具体位置（已核实）

| 文件 | 位置 | 做什么 |
|---|---|---|
| `src/core/gameTypes.ts:127` | `GameStatus` | 不要改这个 type。新增一个独立 flag，见下一行 |
| `src/systems/WorldFlags.ts` | 新增 flag key | `chapter1Cleared`，一次性的 `once:` 语义 |
| `src/scenes/GameScene.ts` | `tryChangeFloor` 调用处（约 `:4765`）及楼梯交互处 | 当 `to === 3 && isAlinRepairGateOpen(state)` 且 flag 未设 → 设 flag → 弹卡 |
| `src/scenes/EndScene.ts` | 增加 `chapter` 渲染分支 | 复用现有 panel/文字绘制，标题用「第 1 章完成」，说明「正式胜利仍为抵达第 100000 层」 |
| `src/systems/FloorSystem.ts:118` | `tryChangeFloor` | **不要改**这个纯函数，阶段判定放场景层 |

### 验收（必须跑，贴输出）

```bash
npx tsc --noEmit
npx vitest run
```

再加一条测试（放 `src/scenarios/blackoutCrisis.test.ts` 末尾）：
从 `createNewGame(2026)` 起，走完赠礼→维修→上 3 层，
断言 `chapter1Cleared` flag 被置位且只置一次（再上一次楼不重复弹卡）。

**禁止**：把 `status` 改成 `won`；改 `GAME_DESIGN_LOCK.md`；让 `?devwin=1` 影响正常流程。

---

## 任务 2：材料口径改成「垂直切片」，删掉自曝短板的话

### 背景

现在材料里还写着实例 private、演示视频未录制、
「自动化测试不能代替好不好玩」这类自己举牌认输的话。
但实例已 public，线上可玩，验收 39/40。**这些话必须删或改。**

### 逐处修改（行号是写这份文件时的值，先 grep 再改）

| 文件 | 定位方式 | 改成什么 |
|---|---|---|
| `README.md` | 搜 `演示视频` | 视频链接由作者填，先把「未录制」改成「见 `docs/competition/VIDEO_BRIEF_FOR_OPUS.md`」 |
| `README.md` | 搜 `自动化测试不能代替` | **整句删除**，不留替代句 |
| `docs/COMPETITION_SUBMISSION_CHECKLIST.md` | 搜 `private` | 改成「实例 public，公开地址 https://a1578804454-floor-100000.ms.show 已验证可访问」 |
| 同上 | 搜 `公开构建验证与失败恢复` | `[ ]` 改 `[x]`，写明已验证 |
| 同上 | 搜 `自动化测试不能代替` | **整句删除** |
| 同上 | 搜 `演示视频公开链接` | 保留 `[ ]`，等作者填链接，不要自己编 |
| `docs/COMPETITION_CREATOR_NOTE_DRAFT.md` | 搜 `private` / `未部署` | 改成 public 已部署 |
| `docs/GAME_DESIGN_LOCK.md` | **不要改** | 它是最高设计权威 |

### 加一段「交付范围」说明（放 README 显眼处）

> 本次交付为**可玩垂直切片**：第 1–5 层的完整生存循环、居民社会与 AI 决策闭环。
> 第 100000 层是设计长期目标（`docs/GAME_DESIGN_LOCK.md`），不在本次切片内。
> 第 1 章阶段达成后有明确的结算反馈。

**禁止**：写「完整游戏」「已通关 100000 层」「所有居民都有完整 Agent 闭环」——
后者只有阿林一条完整闭环，写了就是假话。

---

## 任务 3：把三句引用口径写对

搜这些文件里的 `Qwen3-8B`、`40 条全过`、`双向驱动`、`本来就绿`，逐处改：

| 错的说法 | 改成 |
|---|---|
| `Qwen3-8B` | `Qwen/Qwen3.8-Flash-Next` |
| `40 条全过` | `40 条判据 39 通过 + 1 条注明红因`（路径穿越判据假阳性：网关 400 错误页，无源码无密钥） |
| `weight 双向驱动` | `weight 的负面档能把态度从回报推向戒备`（差异全部来自负向档，正向与中性档无差异） |
| `记忆段本来就绿` | `第一次线上跑 6 条红 → 定位到产品 → 改产品 → 重跑 8/8 全绿` |

---

## 收尾（三件全做完才做）

```bash
npx tsc --noEmit && npx vitest run && npm run build && npm run test:collection
git status --porcelain --untracked-files=all
```

注意：`npm run build` 在本机可能被安全策略拦（Vite 清 `dist/assets` 超过 50 文件阈值）。
若报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，改用
`npx vite build --outDir /tmp/build-check --emptyOutDir` 验证产物，
**不要**为此改 gitignore 或删 dist 里的内容。

只提交任务 1、2、3 涉及的文件。提交信息写清楚改了哪些路径。
推送：`git push origin deploy-ms-20261125`。
推完报给我：commit hash、领先数、门禁输出。

---

## 明确不做（别自作主张扩大范围）

- 不做演示视频（另一个模型做，brief 在 `docs/competition/VIDEO_BRIEF_FOR_OPUS.md`）
- 不做真人试玩（作者做）
- 不加测试数量凑数
- 不改 `tools/verify-online-api.mjs`、`artifacts/online-verify/*.json`
- 不改 `docs/GAME_DESIGN_LOCK.md`
- 不重置令牌（作者自己做）
- 不碰 `LICENSE`（已定稿）
