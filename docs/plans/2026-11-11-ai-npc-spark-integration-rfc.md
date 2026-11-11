# AI NPC 接入 RFC

**日期**：2026-11-11
**范围**：M2/B6「NPC 与关系网络」的 AI 先行实现；DGX Spark 作为本地推理中心接入游戏研发体系
**状态**：待项目负责人批准
**分支**：`feat/ai-npc-spark-integration`（切自 `feat/tower-zoom-b2` @ `a266d04922`，即当前默认分支最新整合点）

---

## 1. 背景与动因

项目路线图（`ROADMAP.md`）中 **B6「NPC 与关系网络：居民有身份、需求和记忆」是 M2 的首要未开始项**。现有实现（`src/data/npcs.ts`）的注释明确写着「No LLM — fixed, keyboard-navigable option trees」：阿林和小周是写死的选项树，没有身份演进、没有记忆、没有关系变化。

项目负责人决定让 DGX Spark 正式进入游戏研发体系，作为 AI 研发与推理中心。本 RFC 申请在受控范围内解除三项治理文档对 LLM NPC 的禁止，并以「规则校验的 AI 决策」替代被禁的「AI 自由聊天」。

## 2. 与治理文档的冲突及处理

| 文档 | 条款 | 与本计划的冲突 | 处理方式 |
| --- | --- | --- | --- |
| `GAME_DESIGN_LOCK.md` 非目标清单 | 「AI 自由聊天 NPC」 | 字面冲突 | 本 RFC 批准的**不是**自由聊天 NPC，而是§4 护栏下的规则校验 AI 决策 NPC；获批后修订非目标条款措辞，明确边界 |
| `02_TECH_SPEC.md` §1 | 「不使用服务器、实时后端、外部 AI/模型 API」 | 引入本地推理服务 | 仅使用**本项目自有的 DGX Spark 本地推理**（Ollama / DeepSeek Harness，局域网 HTTP）。无云 API、无账号系统、无付费服务、无联机依赖 |
| `CLAUDE.md` 范围边界 | 「不接入 LLM NPC……除非项目负责人另行明确批准」 | 需要负责人批准 | 批准记录见 §3，本文件即批准凭证 |

## 3. 批准记录（ADR-001）

- **批准人**：项目负责人（汐）
- **批准时间**：2026-11-11
- **批准范围**：仅限 `feat/ai-npc-spark-integration` 分支内的 B6 AI 先行实现；合并回主分支前需重新确认
- **批准条件**：必须满足 §4 全部护栏；违反任一条即自动失效
- **生效对象**：本分支后续所有自动化开发 Agent 轮次（`CLAUDE.md` 禁令在本分支范围内豁免）

## 4. 设计原则（护栏，违反任一条即审批失效）

1. **AI 只提议，规则只裁决，游戏才执行。** AI 输出永远是「行动建议」（advisory），必须经游戏规则执行器校验合法后才能生效。AI 无权直接修改 `GameState`、无权改数值、无权绕过生存/经济/战斗规则。
2. **推理不可用时游戏必须完全可玩。** Spark 不可达时 NPC 自动降级为现有选项树行为；玩家无感知差异（仅行为丰富度下降）。AI 层是严格增量，不是依赖。
3. **不动已有规则。** 生存、物品、战斗、宿舍、数值规则一行不改；AI NPC 是新增能力。
4. **模型与密钥不进 Git。** 模型权重、推理缓存、运行日志、API Key 全部留在 Spark 本地；仓库只保存代码、接口契约和必要配置（本地地址走环境变量/配置文件，不入库的具体值）。
5. **纯逻辑可测。** NPC 大脑是可在测试中替换的确定性接口（mock brain），核心决策逻辑用 Vitest 覆盖；不允许把测试绑定在真实推理服务上。

## 5. 架构

```
┌──────────────────────── DGX Spark（本地推理中心）────────────────────────┐
│  Ollama / DeepSeek Harness · 模型路由 · NPC 独立记忆存储                    │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ 局域网 HTTP（无云、无账号）
┌───────────────┴──────────────────────────────────────────────────────────┐
│  游戏（floor-100000）                                                     │
│                                                                          │
│  GameScene ──▶ NpcRuntime ──▶ NpcBrain(接口) ──▶ 规则执行器 ──▶ GameState │
│   游戏事件      生命周期/调度    本地推理客户端      合法性校验             │
│                                                                          │
│  规则执行器复用现有系统：TradeSystem（交易守恒）、InventorySystem（背包）、  │
│  combat（战斗规则）、SurvivalSystem（时间/消耗）。校验失败 → 拒绝或降级。     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 接口契约（TypeScript 草案）

```typescript
// 出站：游戏 → AI（观察快照，只读）
interface NpcObservation {
  npcId: string;                  // 'alin' | 'xiaozhou' | 'wanderer' | ...
  personality: PersonalityTraits; // 人格向量
  memory: MemoryEntry[];          // 检索后的相关记忆（有预算上限）
  relationships: Record<string, number>; // 对玩家/其他 NPC 的关系值
  goal: string;                   // 当前独立目标
  world: { day: number; floor: number; gameMinute: number };
  self: { floor: number; x: number; inventory: ItemId[]; hp: number };
  recentEvents: GameEvent[];      // 近期相关事件
}

// 入站：AI → 游戏（行动建议，advisory）
interface NpcActionProposal {
  utterance?: string;             // 说的话（可选）
  action:
    | { type: 'dialogue'; options: DialogueOption[] }
    | { type: 'trade'; give: ItemId; get: ItemId }   // 仍需过交易守恒校验
    | { type: 'gift'; item: ItemId }
    | { type: 'refuse' }
    | { type: 'move'; target: string }
    | { type: 'ally'; target: string }
    | { type: 'betray'; target: string }
    | { type: 'attack' } | { type: 'flee' };
  confidence: number;             // 低置信度时倾向降级
}
```

### 关键决策

- **异步决策 + 超时降级**：NPC 决策不阻塞游戏循环；推理请求带超时（如 3s），超时/失败即降级为选项树，避免拖慢生存循环。
- **记忆有界**：每次观察只携带检索后的 top-k 记忆，控制 token 与存档体积；完整经历日志可截断归档。
- **存档兼容**：`GameState.npcStates`（`02_TECH_SPEC.md` §4 已预留）承载 NPC 状态；存档 schemaVersion 递增，坏档路径不变。

## 6. 第一阶段范围（三个差异化原型）

| 原型 | 映射现有角色 | 差异化配置 |
| --- | --- | --- |
| **ALLY 合作型** | 阿林（维修工） | 高利他倾向；会主动给予/换fair交易；记住玩家的帮助并回报 |
| **NEUTRAL 中立型** | 小周（邻居） | 务实计算；关系与利益驱动；不主动结盟也不主动为敌 |
| **HOSTILE 敌对型** | 流浪者（夜行追逐者） | 夜间活跃；威胁评估驱动；会伏击、会撤退；与玩家敌对度累积 |

三者共享底层推理服务与接口，但人格、记忆、资源与生存目标、关系判断、决策历史、行为偏好各自独立。**本阶段明确不做**：玩家睡觉时 NPC 自主交易/结盟/背叛的模拟循环（列入后续阶段）、语音、云同步、联机。

## 7. 验收标准

- [ ] `NpcBrain` 接口与 mock 实现落地，纯逻辑单测覆盖：出站观察构造、入站建议校验、降级路径
- [ ] 规则执行器拒绝非法建议（如交易不守恒、给不存在的物品）并有单测证明
- [ ] Spark 不可达时三个 NPC 行为与改造前等价（E2E 回归）
- [ ] 三个原型的人格/记忆差异有可观察的行为差异（测试或人工试玩记录）
- [ ] typecheck、单测、构建全绿；不新增 E2E 失败（存量红灯单独跟踪，见 §8）
- [ ] 模型权重、缓存、日志、Key 未被提交进仓库

## 8. 已知风险与存量问题

- **存量 E2E flaky（已定性）**：`feat/tower-zoom-b2` @ `a266d04922` 的 CI 中 Playwright E2E smoke 失败。Spark 本地实测（snap Chromium 157，全套 22 个 spec）：**基线提交与本分支各跑两轮全套，每轮挂不同的测试**（基线：hudFeedback/survivalJourney；本分支：survival 漏水补给），且每个失败测试单独跑均通过。结论：**并行负载下的 flaky，存量问题，与本分支无关**。CI 绿灯需先解决该 flakiness（降并行度或修时序假设）。
- **推理延迟（已实测）**：Spark 上 `npc-qwen`（17G，Qwen3.8 系微调合并版）冷启 ~33s、热推理 21-32s/次（输出 200-360 字）。因此运行时默认超时从 3s 校准为 **45s**；异步设计下超时不阻塞交互（降级句先显示，结果到了再替换，对话已关则丢弃）。若需亚秒级响应，需换更小模型或启用投机解码（该模型 modelfile 已带 draft 参数）。
- **小模型不可用（已实测）**：`qwen3:0.6b` 输出缺 `confidence`、物品 ID 用中文——被规则执行器正确拒绝并降级。契约遵守需要 17G 级模型。
- **记忆膨胀**：见 §5 有界记忆；需在存档体积测试中监控。

## 9. Spark 实测记录（2026-11-11）

- Ollama 服务已修复并托管 systemd（`snap.ollama.listener`，开机自启）。
- `npc-qwen` 端到端验证通过：给定「第 2 天获赠电池」记忆，阿林回应「**那节电池我收下了，谢了**。线路那边还缺维修材料，你那边方便匀我一些吗？」——**记忆→行为的可观察差异达成**（验收标准第 4 条）。
- 管线行为符合设计：0.6b 的越界输出被拒并降级，17G 模型的合法建议被采纳。

## 10. 未决事项（需项目负责人确认）

1. 模型选型：`npc-qwen` 已验证可用但延迟 21-32s。是否接受「降级句先显示、AI 句后到」的体验，或换更小模型/开投机解码求速度。
2. 记忆存储位置：Spark 本地文件 vs 游戏存档内嵌（影响跨设备连续性）。
3. 合并策略：本分支合回主分支的时机与评审人。
4. E2E flaky 的修复归属：先修 flakiness 再合 AI 分支，还是并行推进。
