# AI 竞赛集成：实现状态

> **R2（2026-11-25）**：在 R1 `63ba491` 之上打通真实模型决策链。DGX Spark（GB10，`npc-qwen`）真机实测 **6/6 返回合法提案、空正文 0 条、中位数 3830ms、P95 4175ms**；真实模型的提案经 Validator 裁决后实际改变玩家库存与门禁。单元测试 **71 文件／887 项全绿**，类型检查 0 错，构建通过，离线回放基准 contentSha256 与 R1 逐位相同。

## R2 修掉的核心缺陷：模型「成功但内容为空」

R1 的失败症状是 `npc-qwen` 返回成功却不产生任何动作。根因不在网络，也不在规则，而在传输层选错了接口：

- `npc-qwen` 是**带思维链的模型**（Modelfile 里 `RENDERER qwen3.8`）。
- 旧实现走 `/v1/chat/completions`，该接口**忽略 `think:false`**，模型仍先写完整 reasoning。
- 一旦调用方限制输出预算（或模型自己写满），返回就是 `HTTP 200` + `finish_reason: "length"` + **`content` 空串**，正文一个字都没开始写。
- 旧代码取值后得到 `''`，`parseProposal` 返回 null，于是「没有提案、没有校验、没有执行、没有状态变化」——但 HTTP 是成功的。

实测对照（同一 prompt、同一模型）：

| 接口 / 参数 | reasoning 长度 | completion_tokens | 耗时 | content |
|---|---:|---:|---:|---|
| `/v1/chat/completions`，`max_tokens=64` | 194 字符 | 64（被截断） | — | **空串**，`finish_reason=length` |
| `/v1/chat/completions`，`think:false`（被忽略） | 2706 字符 | 797 | ~10s | 正常但极慢 |
| `/api/chat` + `think:false` | **0** | 51 | **2.98s** | 正常合法 JSON |
| `/api/chat` + `think:false` + `format:json`（现方案） | **0** | 45–79 | **2.45–3.46s** | 正常合法 JSON |

修复落在 `src/ai/brains/ollamaBrain.ts`：改走原生 `/api/chat`，默认 `think:false` + `format:'json'`；正文为空时**先判 `done_reason`**，被截断才放宽 `num_predict` 重试一次，其余一律 `null` 交给规则降级。绝不把 `reasoning` 当正文——思维链里常含半截 JSON，直接解析会产出错误动作。

## 已实现

- **真实模型进入决策链**：`src/ai/competitionModelBridge.ts` 把 `CompetitionObservationSnapshot` 摊成 prompt（信任、双方背包、门禁状态、可用动作、合法物品 ID），再把模型动作翻译成白名单提案。翻译规则明确：对话→`observe`；提到修门且配方已配置→`repair_gate`（材料由规则层给，模型不能自造）；点名玩家持有的物品→`give`（方向固定 player→npc）；`attack`/`flee` 与「NPC 送物给玩家」一律 `null`。
- **模型无法越权开门**：`repair_gate` 必须同时满足信任门槛、材料齐备、同层且距离内、门禁可修。模型只能「发起申请」，材料清单来自 `ALIN_REPAIR_MATERIALS`，不由模型生成。
- **受规则约束的 NPC 行动**：赠礼与维修都先产生结构化提案、跑 Validator，再由 executor 提交；拒绝路径不提交库存、关系、记忆或门禁变化。
- **赠礼—维修—门禁闭环**：赠礼改变玩家与 NPC 库存、信任及持久记忆；低信任拒绝。信任达 70 且材料齐备后，维修实际消耗材料、打开门禁，可从第 2 层进第 3 层。
- **避免软锁**：第 2 层有独立 ID 的保证材料箱（木材×2、胶带×1）；制作入口保留该配方材料到门禁打开；旧存档只按本局旗标/楼层/访问记录兼容。
- **可审计导出**：Judge Mode 可展示运行结果并导出只含允许字段的 JSON。

## 自动化验证（R2 实测）

- **类型检查**：`npx tsc --noEmit` **0 错**。
- **单元测试**：`npx vitest run` → **71 文件 / 887 项通过，6 项跳过（Spark live 用例默认跳过），0 失败**。R1 基线为 70/865；新增 `competitionModelBridge.test.ts` 18 项、`ollamaBrain.test.ts` 扩到 10 项、Spark 联调 3 项与闭环 3 项（默认 skip）。
- **DGX Spark 真机**：
  - 传输层联调 `SPARK_LIVE=1` 3/3 通过，单次决策 **3470ms** 返回合法提案。
  - 三段式闭环验收 3/3 通过：
    - **低信任（35）**：模型提议 `repair_gate`，Validator 返回 `low_trust` 拒绝，世界不变。
    - **高信任（75）**：同一模型、同一配方，Validator `ok`，executor `executed`，玩家 **木材 -2、胶带 -1**，门禁 **closed → open**。
    - **离线对照**：不连模型时低信任仍被拒（原因确为「信任不足：当前 35，门槛 70」），beforeHash === afterHash。
  - 运行记录：`artifacts/spark-runs/npc-qwen_latest-*.json`（`tools/spark-run-record.mjs` 生成，含 HTTP、耗时、eval_count、thinking 长度、是否空正文；不含地址与凭据）。
- **浏览器内真实推理**：Playwright 页面内直连 Ollama，`thinking=0`、正文非空、`pageerror` 0 条（该探针为一次性验证，未入库）。
- **浏览器 E2E**：`competitionAiNpc.spec.ts` + `competitionJudgeMode.spec.ts` **4/4 通过**（22.7s，单 worker）。
- **离线回放基准**：`npm run competition:benchmark` → 9/9 一致，`contentSha256 = 2d652fa8d6b612b9b565fdc52112dcb5097ca753db2f4127e950c002d34061b3`，**与 R1 逐位相同**，证明本次改动未影响离线确定性。
- **构建**：`npm run build` 通过；主 JS chunk > 500 kB 为非阻断提示（既有问题）。

## 尚未验证／未决定

- **完整 E2E 套件（106 项）本轮未重跑**：只跑了 AI NPC / Judge Mode 定向 4/4。全量单 worker 约 25 分钟，需在冻版前补跑。
- **模型质量未评估**：真机证明的是「传输层能拿到合法提案且状态真的会变」，不是模型决策好坏。多 seed 的成功率、非法动作率、重规划率尚未统计。
- **第二 NPC（小周）未接入**：当前闭环只覆盖阿林一条线。
- **故障注入后重规划**：离线路径有测试覆盖（`competitionRuntime.test.ts`），但真实模型下的重规划行为未实测。
- **跨天记忆对次日决策的影响**：记忆已持久化且有导出，但「次日决策真的因记忆改变」尚无端到端证据。
- **赛事与许可**：赛事资格及旧赛史尚未核实；代码许可证未选定。美术素材的再分发许可不代表代码许可已定。
- **演示**：`docs/competition/DEMO_SCRIPT.md` 尚未录制。
- **ModelScope**：尚未部署。
- **审阅状态**：PR #21 保持 Open/Draft（head `e86457c1`），本分支另开独立 Draft PR。