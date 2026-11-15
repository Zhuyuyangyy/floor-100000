# AG-41：Spark 端到端验证报告（NPC 对话走模型，不走降级脑）

- 验证人：AG-41（general-purpose-2）
- 日期：2026-11-16
- 分支：`agent/2026-11-16/ag-41-spark-verify`（基线 `068f1d3`）
- 结论：**链路通；玩家看到的第二句确实是 Spark 上 `npc-qwen:latest` 生成的，且随游戏状态变化；降级路径行为符合设计。**

## 1. 验证环境与方法

| 项 | 值 |
|---|---|
| worktree | `agent-worktrees/ag-41-spark-verify` |
| SSH 隧道 | `spark-tunnel.sh LOCAL_PORT=11435`（本机 127.0.0.1:11435 → Spark 127.0.0.1:11434，避开别人的 11434） |
| dev server | `npm run dev -- --port 5430 --strictPort`（避开 5199/5396/5382） |
| 配置 | worktree 内 `.env.local`（gitignore，未提交）：`VITE_NPC_MODEL=npc-qwen:latest` / `VITE_OLLAMA_URL=http://127.0.0.1:11435` / `VITE_NPC_TIMEOUT_MS=45000` |
| 驱动 | Playwright（chromium，`--no-proxy-server` 绕过本机代理），脚本读 `scene.dialogue.message` 实时取值 |
| Spark 初始状态 | `ollama ps` 为空——第一发对话即真·冷启 |

链路：浏览器 `fetch(${VITE_OLLAMA_URL}/v1/chat/completions)` → 本机 11435 → SSH 隧道 → Spark Ollama。
`OllamaBrain.decide()` 前先 `health()` 打 `/api/tags`（2s 超时），失败直接降级（NpcRuntime.ts:118）。

## 2. 链路通不通：通，且证据是硬扎的

Playwright 真机走完：进游戏 → 爬到 2 层 → 站在阿林/小周身前按 E → 等 AI 句替换静态问候。5 次对话全部走通，每次对话都真实发出两个请求（抓包记录）：

- `GET /api/tags` → 200，62–113ms（健康检查）
- `POST /v1/chat/completions` → 200，请求体 `model` 字段 = `npc-qwen:latest`

抓到的真实响应体（`chatcmpl-273`）节选——模型名、契约 JSON、还有模型的内心独白（reasoning 字段，它在认真扮演 alin）：

```json
{"id":"chatcmpl-273","model":"npc-qwen:latest","choices":[{"message":{"content":
 "{\"utterance\":\"你好，我是alin。刚认识，先不聊太多。这层线路我盯着呢，你要是手头有电线或保险丝，能匀我点不？\",\"action\":{\"type\":\"dialogue\",\"text\":\"...\"},\"confidence\":0.72}",
 "reasoning":"The user wants me to roleplay as \"alin\" in a post-apocalyptic dormitory game..."}}]}
```

**判定：走的是真模型，不是降级脑。**（降级脑的句子来自 `npc.greetings[0]` 静态表，不可能带 `chatcmpl-273` 和 reasoning。）

## 3. AI 句 vs 降级句：原文对比

| 场景 | 玩家第一眼看到（降级脑原句，静态） | AI 替换后（模型生成） | 耗时 |
|---|---|---|---|
| 阿林·初见 | 来了？先别站门口，帮我扶一下梯子。 | 你好，我是alin，守这层楼的线路。正缺电线和保险丝，你要是有多余的，咱们可以聊聊。 | 36.4s（冷启） |
| 小周·初见 | 你来得巧，我刚把面包数完第二遍。 | 你好，我叫小周。第一天，想找个能换口粮和净水的搭子。你手头有富余的吗？ | 17.5s |

AI 句与静态句在措辞、信息量、人格化程度上区别明显；且每次生成都不同（temperature 0.7 采样）。

## 4. "真的走了模型"的状态相关性证明

改游戏状态再开对话，AI 句随之变化（两次都成功替换，非降级）：

| 注入的状态（`state.npcStates['alin']`） | AI 生成的句子 | 耗时 |
|---|---|---|
| 关系 **-80** + 记忆「玩家夜袭了阿林，抢走了他的扳手」 | **昨晚那扳手，我记着。**这楼梯我守着，你最好别动。再往前一步，别怪我不客气。 | 25.0s |
| 关系 **+80** + 记忆「玩家送给阿林一瓶水和一条面包」 | **那瓶水和面包我记着呢**，兄弟。这末日里你肯分我一口吃的，我就当你自家人。有啥需要，尽管说。 | 15.6s |

敌对态直接引用注入的「扳手」记忆并转变语气；友好态引用「水和面包」并称兄道弟。**状态→观察快照→prompt→台词 的链路是通的**，这只有走模型才可能发生（降级脑永远返回同一句静态问候）。

## 5. 延迟分层（三个数字）

curl 口径（复刻游戏真实载荷，经隧道直打 Spark）与浏览器口径（Playwright 实测，含健康检查与页面轮询）：

| 场景 | curl 实测 | 浏览器实测 |
|---|---|---|
| **冷启**（模型未驻留） | 29.0s（`keep_alive=0` 卸载后重载） | **36.4s**（Spark 上无任何模型驻留时的首启，含磁盘冷读） |
| **热推理**（模型驻留 GPU） | 17.0 / 17.3 / 21.3 / 21.6s（中位 ≈19s） | 15.6 / 17.5 / 25.0s |
| **qwen3:0.6b 对照** | 冷 3.4s；热 0.9 / 1.1s | — |

健康检查 `/api/tags` 62–113ms，可忽略。

**对 `VITE_NPC_TIMEOUT_MS=45000` 的评估：合理，但余量不厚。**
- 热推理 15–25s、冷启 29–36s 都在 45s 内；
- 但 Spark 上同时跑着 23.9GB 级模型时（实测期间观察到热推理从 15.6s 劣化到 30.6s），45s 可能被击穿；
- 好在异步设计下超时不阻塞交互：降级句先显示，模型句到了再替换，对话已关则丢弃（`isDialogueFresh`）。超时只是"少一句人格化"，不会卡死玩家。
- **建议（不阻塞）**：给玩家一个「AI 正在想……」的轻提示（或让静态问候句以"思考中"的视觉态出现），把 15–36s 的等待从"怀疑卡住了"变成"它在组织语言"。

**qwen3:0.6b 对照的结论：不能用来换速度。** 它快 20 倍，但不守输出契约——该输出 `dialogue` 却塞了 `give/get`、`text` 放错层级，`parseProposal` 直接返回 null（→ 走降级）。`npc-qwen` 的微调（稳定输出契约 JSON）是必要的。

## 6. 降级路径：符合设计

断开我的隧道后开对话：

- 玩家立即看到静态原句「来了？先别站门口，帮我扶一下梯子。」，等 6s 不变——**降级脑原句，不崩不白屏**；
- 健康检查快速失败（`net::ERR_CONNECTION_REFUSED`，毫秒级），不会傻等 45s 超时；
- 交互不卡：E 开关对话、菜单导航全部正常；
- 全程无 `pageerror`（浏览器控制台只有既有的 favicon 404，与 AI 无关，见 §7）。

## 7. 发现的问题

### P2-1 `prompt.ts` 的 `fmtMinute` 不对小数分钟取整（新发现，建议修）

`fmtMinute(state.gameMinuteOfDay)` 直接把浮点游戏分钟塞进 prompt：实测抓包看到 prompt 里出现 `第1天 06:4.696540000000255`。模型能凑合理解，但这是每次请求都带的脏数据。修法：`Math.floor(minute % 60)` 或整体 `Math.round`。位置：`src/ai/prompt.ts:70-73`。

### P2-2 Playwright `page.route` + `trace: 'retain-on-failure'` 在本游戏页会挂死 teardown（环境/工具层面）

本机实测：spec 用 `page.route` mock Ollama 端点后，测试体 8 秒就全部通过，但 teardown（tracing.stop/context.close）挂死 120s 直到超时。干净环境探针复现不出，疑为 trace 网络录制与路由拦截相互等待。**本 spec 的规避**：mock 改用 `page.addInitScript` 页内 fetch 桩，完全不碰 Playwright 网络层，trace 开/关都确定性通过。其他 agent 若写带 `page.route` 的 e2e，建议同样规避或知悉此坑。

### P3-1 vitest 变换缓存会被 `.env.local` 污染，造成 2 个假失败（环境层面，非代码回归）

现象：本 worktree 跑全量 vitest 出现 `src/ai/config.test.ts` 两个「默认关闭」用例失败（`expected 'npc-qwen:latest' to be ''`）。根因：`node_modules/.vitest-cache`（junction 共享）里 `config.ts` 的**变换缓存把 `import.meta.env` 的值烙成了字面量**——生成于我创建 `.env.local` 期间；缓存键不含 .env 文件，**删掉 .env.local 也不会失效**。验证：`npx vitest run --fsModuleCachePath=<私有目录>` → **80 文件 / 1457 测试全绿**（与基线一致）。影响面：任何在本机建过带 `VITE_NPC_MODEL` 的 `.env.local` 的 checkout（含主工作区，它的 .env.local 还在）都会中招。处置：`npx vitest run --clearCache`（会清整个共享缓存，建议先知会其他 agent）或临时 `--fsModuleCachePath` 指别处。本次未动共享缓存，避免影响他人。

### P3-2 favicon 404（既有，与 AI 无关）

页面加载时浏览器自动请求 `/favicon.ico` 返回 404（仓库无 favicon）。每次加载都出现，非本次引入。

## 8. e2e spec（mock 版）说明

`e2e/spark.spec.ts`（新增，mock 版，CI 安全）：

1. **降级路径**：任何环境都跑。fetch 桩让 health 抛错 → 断言静态问候原句显示且 3s 不变、E 能关对话、无 pageerror。
2. **AI 路径**：页内动态 import `config.ts` 检测 AI 是否启用；未配置（CI 无 `.env.local`）自动 skip。mock 即时返回契约 JSON → 断言对话消息被替换、请求带的模型名与配置一致、无 pageerror。
3. **会话保鲜**：mock 延迟 1.5s 返回；开对话→立刻关→等结果迟到→重开 → 断言迟到结果被丢弃、新对话先显示静态句再被新结果替换、无 pageerror。

本机验证（默认 trace 配置、`--workers=1`、端口 5430）：**3/3 通过**。mock 打在页内，真连 Spark 的 17–36s 不会进 CI。

## 9. 测试数字

- **vitest 全量（干净变换缓存）：80 文件 / 1457 测试全绿**（与总控基线一致）。
- vitest 全量（默认共享缓存）：1455/1457，2 个失败为 §7 P3-1 的缓存污染假失败。
- e2e（`e2e/spark.spec.ts`，本机）：3/3 通过。
- 类型检查 `tsc --noEmit`：干净。

## 10. 没处理干净的地方

1. 共享的 `node_modules/.vitest-cache` 里的污染条目**未清**（怕影响其他 agent 正在跑的 vitest）；建议总控在无人跑测试时统一 `--clearCache`。
2. 真机截图与抓包 JSON 在 `test-results/`（spark-t1/t2a/t2b/t1b/t3 截图、spark-live-*.json、spark-payload.json），验证后按磁盘纪律清理，不提交。
3. `?ainpc=1` 查询参数强制开启路径未单独验（配置逻辑已有单测覆盖，端到端走的是 `.env.local` 正常开启路径）。
