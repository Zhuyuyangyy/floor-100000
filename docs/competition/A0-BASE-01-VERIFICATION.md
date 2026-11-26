# BASE-01 核验记录（A0）

> 写于 2026-11-26 深夜。**所有结论都来自当夜在真实仓库与线上实例上的实测**，
> 不引用上一轮的口头结论。核验对象：总控计划 `docs/competition/MASTER_SPRINT_PLAN_20261126.md`
> 的 §12「总控今日立刻执行」第 1 条。

## 1. 基线对齐

| 项 | 实测值 | 说明 |
|---|---|---|
| 仓库 | `https://github.com/Zhuyuyangyy/floor-100000` | — |
| 分支 | `deploy-ms-20261125` | 唯一发布线 |
| 本地 HEAD | `9bb4a7c`（核验当时 `526cdb9`） | 与计划给的基线 `526cdb9` 一致 |
| 与 origin 差异 | 领先 0 / 落后 0 | 核验时点工作区干净 |
| 工作目录 | `D:\ZYY_Inovation\game\wt-r2` | Windows；node 在 `C:\Program Files\nodejs`、git 在 `C:\Program Files\Git\cmd`，两者都不在 PATH |
| **共享工作区** | ⚠️ 是 | 本轮有多个 agent 在同一目录并行提交，**提交必须按路径**（`git commit -- <path>`），禁止 `git add -A` |

## 2. 线上状态（实测，非推断）

| 项 | 实测 |
|---|---|
| 创空间 | `a1578804454/floor-100000`，`status: Running` |
| 可见性 | `visibility: "public"` / `private: false`（OpenAPI `GET /openapi/v1/studios/a1578804454/floor-100000`） |
| 公开地址 | `https://www.modelscope.cn/studios/a1578804454/floor-100000` → 匿名 **200** |
| 应用本体 | 顶层访问 `.ms.show` 会 **302** 到门户页；游戏跑在门户挂出的 **iframe** 里（iframe 内 canvas 1280×720、Menu 场景 active） |
| 上游模型 | `Qwen/Qwen3.8-Flash-Next`（部署运行日志实测） |
| 线上验收 | **40 条判据 39 通过 / 1 FAIL**；记忆段 **8 条全绿**；证据 `artifacts/online-verify/`（md5 见 `docs/competition/evidence/`） |
| 唯一 FAIL | 路径穿越判据**假阳性**：线上返回网关 400 错误页（225B，Tengine），逐字查过无源码、无密钥 |

**部署差距（当夜遗留，必须在发布前消除）**：线上产物是 `assets/index-Dzve_6tz.js`，
**不含**仓库里的「第 1 章达成卡」提交（`ceb0f4b`）——那笔提交之后没有重新部署。
下次部署必须把主线整体同步过去，否则评委看到的不是仓库里的版本。

## 3. 关键功能是否存在（逐条 grep/读码核验，不采信口头结论）

| 总控计划要求 | 实测 | 结论 |
|---|---|---|
| Judge Mode（AI-08） | `GameScene.ts` 有 Judge Mode 面板，标题实时显示 `Judge Mode · offline-fallback · seed N` | **已有** |
| 决策来源区分（model / fallback / scripted） | `BlackoutDecisionSource = 'model' \| 'offline-fallback'`，且只在「模型提案 + 提交成功」同时成立时写 `'model'` | **已有**（两档；`scripted` 未使用，计划允许「以现有枚举为准」） |
| 小周交易走真实模型（AI-02） | 危机期间 `runXiaozhouTrade(state, { proposeWithModel })`，由模型**挑价目表里的一笔**再由规则复核 | **已有** |
| 阿珍交换走真实模型（AI-03） | 危机期间 `runAzhenExchange(state, { proposeWithModel })` | **已有** |
| 阿林维修走真实模型（AI-01） | `runAlinRepairScenario` + 模型端口 | **已有** |
| 记忆影响动作（AI-04） | 线上三组对照全成立（极性总增益 2.00 ≥ 1.50）+ 锚点回响命中 4 次 | **已有线上证据** |
| **NPC 自主行为，不由按 E 触发（AI-06）** | 全仓库 `world_tick` **出现 0 次**；居民只在玩家按 E 时行动 | **真缺口 → 已派 A3** |
| 规则拒绝 / 重规划（AI-05） | `runAlinRepairScenario` 等已有 `attempts` 与拒绝原因 | **已有**（本轮复核范围） |
| 第一章闭环与章节结算（GAME-01 / UX-03） | `ceb0f4b` 新增「第 1 章达成卡」（`src/systems/chapters.ts` + `EndScene` chapter 分支），**未部署** | 代码已有、线上还没有 |
| 公开构建验证（REL-01） | 匿名窗口实测：门户 200 → iframe 内游戏启动 → `/healthz` ok → 同源代理返回 `decisionSource:"model"` | **已有**（本轮补记进参赛清单） |

## 4. 当夜结论

1. **计划的前提「实例是 private、公开可访问还没满足」是错的**，已按实测改口径（材料里搜不到
   `private` / `Qwen3-8B` / `双向驱动` / `40 条全过` / `自动化测试不能代替`）。
2. **可玩垂直切片范围（1–5 层）已冻结**，`docs/GAME_DESIGN_LOCK.md` 未动，正式胜利条件未动。
3. **第 1 章达成卡已进主线**（`ceb0f4b`），给评委一个「做完了」的时刻，不改胜利条件。
4. **唯一确认的 P0 功能缺口是 AI-06 自主行为**，已派 A3；并行还有 A9（黄金路线实机与阻断清单）
   与 A10（证据包）。
5. **下一件必须做的事**：A3/A9/A10 合并后**重新部署**一次，让线上包含章节卡与自主行为；
   部署后重跑一遍线上冒烟与验收，把 SHA 对齐进 manifest。

## 5. 未完成 / 风险

- 线上尚未包含 `ceb0f4b` 之后的任何提交（章节卡未上线）。
- 演示视频、真人试玩、多 seed benchmark **没有证据**，材料里只能写「待补」，不许填数。
- 本机较慢：Playwright 需给足 timeout（`--timeout=120000`）并用 `--workers=1`，
  否则会出现「超时但不是断言失败」的假红。
