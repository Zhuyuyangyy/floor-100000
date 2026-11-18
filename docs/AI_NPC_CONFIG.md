# AI NPC 配置说明

> 本文说明 AI NPC（B6 的 AI 先行实现）的**配置方式、默认关闭原因与降级行为**。
> 事实来源：`src/ai/config.ts`（配置解析）、`src/ai/brains/ollamaBrain.ts`（传输层）、
> `e2e/spark.spec.ts`（链路行为的 e2e 桩版本）、`docs/plans/2026-11-11-ai-npc-spark-integration-rfc.md`（设计与护栏）。
> 对应集成线 tip：`cc3059c`（2026-11-18）。

## 一、默认关闭是安全设计，不是缺失功能

AI NPC **默认关闭**。没有任何配置时，`src/ai/config.ts` 的 `aiNpcConfig()` 返回
`enabled: false`，游戏行为与改造前**逐字节一致**——AI 是显式 opt-in 的增量。

这是设计护栏（RFC §4 护栏 4「地址与模型名走配置，不入库」）的直接结果：

- **模型名为空 → `enabled=false`**。地址与模型名只从环境变量 / 查询参数读，不进 Git，
  发行包里没有任何 AI 配置，也就不可能「不小心」连上某个模型。
- **AI 只提议、规则只裁决、游戏才执行**。即使开启了 AI，模型输出也要过
  `src/ai/rulesExecutor.ts`（交易守恒 / 背包容量 / 攻击窗口门控）才生效，
  模型不能虚空造物、不能改任何生存/经济/战斗规则。
- **网络错误 / 超时 / 非契约回复一律降级**（`ollamaBrain.ts` 收敛为 `null`），
  绝不在半路抛错打断游戏循环。

## 二、怎么配

配置入口全部是**环境变量**（Vite 约定，浏览器构建由 Vite 序列化进 bundle；
Node/vitest 侧读 `process.env`）。三种开关：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `VITE_NPC_MODEL` | **主开关**：模型名，如 `npc-qwen:latest`、`qwen3:8b`。为空 = 关闭 | 空（关闭） |
| `VITE_OLLAMA_URL` | Ollama 服务地址（本机推理端点） | `http://127.0.0.1:11434` |
| `VITE_NPC_TIMEOUT_MS` | 单次推理超时（毫秒）。Spark 实测 `npc-qwen(17G)` 冷启约 33s、热推理 21–32s，故默认 45s；8B 以下小模型可调到 3s | `45000` |

另有**查询参数** `?ainpc=1`：强制开启 AI（仍需配好模型名），用于本地试玩，
例如 `http://localhost:5173/?seed=42&ainpc=1`。

配置步骤（本地）：

1. 装好 Ollama 并拉一个模型（Spark 实测用过 `npc-qwen:latest`，17G）。
2. 在仓库根目录建 `.env.local`（**不要提交**，`.gitignore` 已覆盖）：

   ```bash
   VITE_NPC_MODEL=npc-qwen:latest
   # 可选：VITE_OLLAMA_URL=http://127.0.0.1:11434
   # 可选：VITE_NPC_TIMEOUT_MS=45000
   ```

3. `npm run dev`，对话时 NPC 的开场白与交易记忆会走真实推理。

> 桌面版（Electron）同理：变量在跑 `npm run build` / 启动壳进程的环境里生效。
> 跑测试时的注意见第五节。

## 三、不配（或配了但推理不可用）时的降级行为

降级不是「NPC 变哑巴」，而是回到**选项树**：

- **开场白**：先显示静态问候（`data/npcs.ts` 的 `greetings[0]`），与改造前一致；
  若 AI 可用，模型句到达后再**替换**（异步设计，超时不阻塞交互）。
- **对话内容**：走规则执行器 + 静态报价表（易物守恒、背包容量、攻击窗口照常裁决），
  即「纯规则版 NPC」。
- **过期结果丢弃**：对话已关则丢弃模型返回，不弹过期台词。
- **网络/超时/非契约回复**：`OllamaBrain` 一律收敛为 `null`，调用方据此降级。

e2e 侧（`e2e/spark.spec.ts`）钉住了这条链：页内 fetch 桩接管 Ollama 的
health（`/api/tags`）与推理（`/v1/chat/completions`）两个端点，断言
「静态问候先显示 → 模型句到达后才替换 → 过期结果被丢弃」。CI checkout 没有
`.env.local`，`VITE_NPC_MODEL` 为空 → AI 整体关闭，两个 AI 测试**自动跳过**，
降级路径测试在任何环境都跑。

## 四、实现落点

| 关注点 | 文件 |
| --- | --- |
| 配置解析（三变量 + `?ainpc=1` + 安全默认） | `src/ai/config.ts` |
| 传输层（HTTP/JSON，错误收敛为 null） | `src/ai/brains/ollamaBrain.ts` |
| prompt 契约 | `src/ai/prompt.ts` |
| 规则裁决（护栏：AI 只提议） | `src/ai/rulesExecutor.ts` |
| 决策运行时（含 3s/45s 超时降级链） | `src/systems/NpcRuntime.ts` |
| 人格原型 / 有界记忆 / 日程 | `src/data/npcPersonalities.ts`、`src/systems/NpcMemory.ts`、`src/ai/npcSchedule.ts` |
| 场景接线（开场白 + 交易记忆积累） | `src/scenes/GameScene.ts`（`getAiRuntime` 等处，`aiNpcConfig().enabled` 门控） |

## 五、已知坑（开发者向）

- `.env.local` 里的 `VITE_NPC_MODEL` 会让 `src/ai/config.test.ts` 的「生产默认关闭」
  断言变红（该测试对本地环境文件敏感）。隔离写法：`VITE_NPC_MODEL= npx vitest run`。
- `npm test`（`tools/vitest-run.mjs`）会按环境指纹分缓存目录，带 `.env.local` 的
  worktree 里请用 `npm test` 而非裸 `npx vitest run`（详见 `docs/qa/TEST_ENV.md`）。
