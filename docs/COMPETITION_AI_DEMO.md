# 评委试玩：NPC 离线行为 AI

## 怎么体验

无需登录、模型下载或网络服务。开始新游戏后，通过楼梯到第 2 层，靠近阿林或小周并按 **E**。对话框右上角会显示回应来源；默认试玩应显示“本地行为 AI · 规则驱动”。

离线人格脑会依据角色类型、当前昼夜、玩家关系与已记录记忆选择一条短回应。成功交易会写入 NPC 记忆，之后的对白可以提及“上次那笔交易”；输出是确定性的规则选择，**不是大模型现场生成，也不是自由聊天**。

## AI 与游戏规则如何分工

`LocalPersonaBrain` 只提出一个 `dialogue` 行动，随后仍经过既有 `rulesExecutor` 校验。它不执行交易，不写入生存数值，也不能绕开背包、战斗或经济规则；交易菜单与物品变化仍由游戏原有系统处理。即使 AI 部分不可用，原有选项对白仍可继续游戏。

开发者若已经运行项目自有的本地 Ollama，可以显式设置 `VITE_NPC_MODEL`（以及可选的 `VITE_OLLAMA_URL`）切到本地大模型回应。未设置时不会发起任何模型请求。`VITE_NPC_ENABLED=false` 或试玩链接添加 `?ainpc=0` 可关闭 NPC AI。没有云端模型 API、账号、密钥或联网要求。

## 历史阶段验收记录

> 以下测试数字、失败记录和临时截图属于此前阶段的版本，不是当前赛事整改分支的验收结果。当前分支验证以 [`docs/competition/IMPLEMENTATION_STATUS.md`](competition/IMPLEMENTATION_STATUS.md) 为准。

- `npm run typecheck`：通过。
- `VITE_NPC_MODEL= VITE_NPC_ENABLED= npm test`：58 个测试文件、756 个用例全部通过。
- `VITE_NPC_MODEL= VITE_NPC_ENABLED= npm run build`：生产构建成功。构建器提示主 JS chunk 超过 500 kB（产物约 1.60 MB，gzip 约 434 kB）；构建未失败。
- `VITE_NPC_MODEL= VITE_NPC_ENABLED= npm run test:e2e -- e2e/npc.spec.ts --workers=1`：此前一次真实 Chromium 运行 5/5 通过；本轮复跑为 4/5，新加的离线 AI 对话用例通过，唯一失败是旧的 `back and exit do not get stuck` 用例未能打开对话。
- 该失败截图落在第 3 层；失败调用栈位于旧测试辅助函数 `pressEUntil`。该函数会在检查不到目标时最多重复发送 4 次 E。单独重跑旧用例通过。另做隔离观测：从第 1 层的楼梯位置仅发送一次 fresh E，随后 6 秒不再按键，实测只到第 2 层，并通过“最多前进一层”断言。现有证据更支持测试辅助函数重复按键与时序造成的偶发红灯；失败时实际发送次数未被记录，故不能断言其唯一成因。本轮没有修改游戏输入或楼梯逻辑。
- 浏览器截图为 1280×800，可见对话来源标签及回应；临时产物在 `test-results/local-ai-dialogue.png`。

## 仍需注意

公开试玩默认展示的是规则驱动的离线行为 AI，不应在参赛材料中称它为大模型生成对白。若赛事评审要求评委现场体验生成式模型，还需单独确认可用的公开推理方案和网络/数据边界；本轮没有接入云 API，也没有部署或发布游戏。
