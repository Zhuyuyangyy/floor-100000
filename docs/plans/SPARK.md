# Spark 本地大模型接入（AG-40）

《第100000层：末日宿舍》的 AI NPC 推理跑在 DGX Spark 的本地 Ollama 上
（`npc-qwen:latest` 等），本机通过 SSH 隧道连它。本文说明：隧道怎么一键起、
AI 台词在游戏里怎么流动、`allowedActions` 为什么第一阶段只通 dialogue、
Spark 挂起时玩家看到什么、以及这些行为的测试钉在哪。

设计全文见 `2026-11-11-ai-npc-spark-integration-rfc.md`；本文只记接线事实。

## 1. 一键接通：tools/spark-up.sh

```bash
tools/spark-up.sh            # 起隧道（端口已在听则跳过）+ 自检
tools/spark-up.sh --check    # 不起隧道，只自检当前状态
tools/spark-up.sh --stop     # 停掉本脚本拉起的隧道（含 ssh 子进程）
```

它做四件事，任何一步不通都明确报错、退出码 1，不静默放行：

1. **起隧道**：后台拉起 `spark-tunnel.sh`（主线仓库那份，掉线重连是它自己的
   while 循环，本脚本不碰它）。本地端口跟随 `.env.local` 的
   `VITE_OLLAMA_URL`（隧道脚本的 `LOCAL_PORT`），配 11435 就开 11435。
   端口已在听（隧道已在跑，或本机 Ollama 占着）则跳过启动。
2. **等端口**：轮询 `<URL>/api/tags`，默认等 40s（`SPARK_UP_WAIT` 可调）。
   curl 带 `--noproxy`——代理对死端口回的 502 错误页会被误判成「通了」。
3. **校验模型**：拿 `.env.local` 的 `VITE_NPC_MODEL` 去 `/api/tags` 的模型
   名单里逐字对；不在就列出当前在线的所有模型并退出。
4. **打印「可以开游戏了」**（`npm run dev`，找 2 层的阿林/小周对话）。

配置文件定位：`.env.local` 与 `spark-tunnel.sh` 都只认主线 checkout 那一份
（worktree 里用 `git rev-parse --git-common-dir` 精确定位，不猜层级）。
环境变量 `SPARK_UP_ENV` / `SPARK_UP_TUNNEL_SH` / `SPARK_UP_URL` 可覆盖
（测试与多环境用）。pidfile 在 `output/spark-up/tunnel.pid`（gitignored），
只覆写不删除——stale 的靠 `kill -0` 探活，`--stop` 对死 pid 明说「已经没了」。

**真实验证记录（2026-11-16，AG-40）**：用 ag-41 的 `.env.local`
（`VITE_OLLAMA_URL=http://127.0.0.1:11435`、`VITE_NPC_MODEL=npc-qwen:latest`）
实跑：隧道按 11435 起来 → `/api/tags` 通 → `npc-qwen:latest` 校验通过 →
打印「可以开游戏了」，退出码 0；`--stop` 后父子进程无残留。
当时 Spark 在线的模型：`qwen3:0.6b`、`npc-moe:latest`、`npc-qwen:latest`、
`qwen3.8:27b`、`qwen3-embedding:0.6b`、`qwen3.5:35b-a3b`。

## 2. AI 台词的流动路径

```
openDialogue(npc)                      src/scenes/GameScene.ts
  ├─ 画面立即显示 npc.greetings[0]      （改造前那一句，零延迟）
  └─ void enhanceOpeningLine(npc)       （异步，不阻塞交互）
        ├─ getAiRuntime(npc)           配置没开 → null，整条路径空转
        ├─ npcFactFor(state, npc)      AG-11：真实库存（已按天结算）喂执行器
        ├─ decideNpcAction(...)        src/systems/NpcRuntime.ts
        │     ├─ brain.health()        OllamaBrain 探 /api/tags（2s 超时）
        │     ├─ withTimeout(decide, 45s)   超时按「无意见」处理
        │     ├─ availableActions 检查      第一阶段只放 dialogue
        │     ├─ validateProposal           规则执行器裁决（src/ai/rulesExecutor.ts）
        │     └─ 任何一环失败 → OptionTreeBrain 降级（原句）
        └─ isDialogueFresh 保鲜检查     玩家关了对话/翻过选项 → 丢弃结果
```

- 超时不阻塞：45s 内模型没回来，画面就是改造前那一句；回来了且对话还没被
  操作过，才替换（P1-2 保鲜键：sessionId + revision 双键）。
- 配置门：`aiNpcConfig().enabled`（`VITE_NPC_MODEL` 非空）为 false 时
  `getAiRuntime` 第一个 return——不起请求、不建 brain、Map 恒空。
- 地址与模型名只走 `.env.local` / 环境变量，不入库（RFC §4 护栏 4）。

## 3. allowedActions：第一阶段为什么只通 dialogue

`GameScene.getAiRuntime` 里 `allowedActions: ['dialogue']`：模型提议
trade/gift/attack/flee 一律被运行时以「不在本阶段可用集」拒绝并降级。

**判断：第一阶段保持不变，不要扩。** 理由：

收益侧很清楚——模型能主动提议一笔交易会让 AI 从「会说话」变成「会做生意」，
这是 RFC 的终局形态。但代价现在是实的：

1. **没有执行路径**。交易执行在场景侧（`dialogueOffers` / `executeBarter`，
   静态报价表 + 信誉定价：trusted 双倍货、hostile 拒交易）。模型的 trade
   提议是 give/get 结构，要落地得新写一条执行路径或改造 `executeBarter`——
   那是 `src/systems` + `src/scenes` 的活，与经济系统（AG-05/AG-14）所有权重叠。
2. **没有接受 UI**。交易菜单是选项树四行 + 光标 + 赠礼层窗口化。模型在开场白
   里提议「用废金属换电线」，玩家点哪里接受？没有入口就是「说了没处做」——
   正是第一阶段注释里要避免的错位。
3. **绕过定价体系**。dialogue 只动一句 60 字内的话；trade 直接动双方背包。
   执行器校验（NPC 库存 / 玩家持有 / 堆叠上限 / 背包空间）能兜底「虚空交易」，
   但兜不住「报价表外的一口价」——那会绕开 `npcEconomy` 的信誉定价。

要扩的最小充分条件（供总控裁决时参考）：(a) 先有「模型提议 → 玩家确认 →
执行」的 UI 与执行接线；(b) 提议限制在报价表子集内（give/get 必须匹配某条
offer，价格仍由 npcEconomy 定，模型只决定提不提、何时提、怎么说）；
(c) 降级路径不变。这三件都在场景/经济系统层，不在 AI 传输层。

## 4. 降级体验三点检查

1. **45s 超时合理吗？** 合理。Spark 实测 `npc-qwen`(17.7G) 冷启 ~33s、热推理
   21–32s（RFC §8），45s 对冷启动有 ~35% 余量；且异步设计下超时不阻塞交互
   （原句先显示，结果到了按保鲜键替换）。3s 只适用于 8B 以下小模型。
   超时值走 `VITE_NPC_TIMEOUT_MS`，可按模型现场调。
2. **超时后有「刚才那句是降级的」提示吗？** 没有——这是有意为之：
   `OptionTreeBrain` 复现「改造前」的全部行为，设计目标就是玩家感知不到差异
   （除了人格/记忆驱动的变化消失）。代价是 Spark 挂起时玩家可能以为「AI 就这
   水平」。可选改进（未实现，待裁决）：降级时给台词加一个轻量视觉标记
   （如句尾「……」或角标），但这会打破「与改造前无差异」的护栏 2 初衷，
   且要动场景渲染。建议：保持不可感知，靠 spark-up 的自检在开发侧暴露。
   另外每次开对话 `health()` 会探活一次（2s 超时）——Spark 挂起时每次开对话
   多一次快速失败，成本可接受，但值得知道。
3. **`VITE_NPC_MODEL` 没配时空转真的零成本吗？** 是。`getAiRuntime` 第一行
   `if (!cfg.enabled) return null`，在 `aiRuntimes.get` / `new OllamaBrain`
   之前；`enhanceOpeningLine` 拿到 null 直接 return。已由
   `src/tests/sparkWiring.test.ts` 的「零请求」用例钉住（fetch spy 零调用）。

## 5. 测试钉在哪

- `src/tests/sparkWiring.test.ts`（10 例，全部 mock fetch，不连 Spark）：
  模型可达走通并返回 utterance / 提议交易被可用集拒绝降级 / decide 挂起超时
  → 原句且不卡 / 网络错 → 原句 / HTTP 500 → 原句 / 未配模型 → 零请求 /
  空串同样关闭 / 配置值透传 brain / 库存抽干后交易被执行器拒绝降级 /
  库存足够时交易放行（对照）。
- `tools/spark-up.sh` 的冒烟测试在 `output/spark-up-selftest/`（gitignored 的
  一次性验证工具，23 断言：成功路径 / --stop 父子收尾 / stale pidfile /
  LOCAL_PORT 跟随 / 模型不在 / 端口不通 / 模型未配 / env 缺失 / --check /
  已在听跳过启动 / --help / 未知参数）。假 Ollama + 假隧道，不碰 Spark。
- 相邻既有 coverage：`src/ai/brains/ollamaBrain.test.ts`（transport 单体）、
  `src/systems/NpcRuntime.test.ts`（降级链单体）、`src/tests/wiring.test.ts`
  （npcFactFor 与交易后的真实库存）。

## 6. 已知边界 / 没处理干净的

- `.env.local` 是 `*.local`（不入库）。当前只有 ag-41 的 worktree 里有一份
  （端口 11435）；主线 checkout 与其它 worktree 要跑游戏/跑 spark-up 需自己
  复制一份（`floor-100000-hud-local/.env.local` 有同内容参考）。
- 本机装着 Ollama 桌面版（PATH 里有 `AppData/Local/Programs/Ollama`）。它若
  在跑会占住 11434，spark-up 会按「已在监听」跳过起隧道、直接校验该端口上
  的模型——功能上等价（同为 Ollama API），但想强制走 Spark 需先停本机
  Ollama 或把 `.env.local` 指到别的端口。
- AI 目前只增强「开场白」这一句；菜单交互（询问/交易/赠礼/退出）全走原路径。
- 降级视觉标记未做（见 §4.2）。
- `enhanceOpeningLine` 的保鲜丢弃没有用户侧反馈（结果到了但对话已变 → 静默
  丢弃），这是正确行为，只是提一句。
