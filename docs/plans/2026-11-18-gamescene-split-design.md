# GameScene 拆分设计（RC-03 预研，总控出品）

- 日期：2026-11-18（外部审查 P1 项：「GameScene 已膨胀到 10,447 行，增加并行开发冲突概率」）
- 状态：**设计文档，未实施**。审查明确「大规模拆分暂时由总控单独规划，避免几个 Agent 同时改它」——本文就是那份规划。实施属 RC-03，每步一个分支+门禁+无头复验，不并进 RC-01。

## 一、现状盘点（2026-11-18 cc3059c 实测）

`src/scenes/GameScene.ts`：**10,446 行 / 236 个方法**。按分区注释与方法聚类，实际有 31 个逻辑区：

| 区 | 行段（约） | 内容 |
|---|---|---|
| 常量区 | 308–988 | 战斗脚注契约/HUD layout/点击·背包平衡/NPC 散步平衡/成就几何（多为模块级常量） |
| 成就 | 988–1019, 5966–6707 | AG-77 解锁 toast+队列+跨 run 持久化 |
| 教程 | 1019–1065, 5100–5344 | AG-73 新手教程 |
| 角色卡+自言自语 | 1065–1305, 5344–5966 | AG-67 状态卡+处境台词 ticker |
| 底部导航条 | 1305–1815, 4931–5100 | AG-71 六槽铆钉板 |
| 楼层构建+爬梯相机 | 1600–2116 | drawFloor/drawCorridor/爬梯相机与目标（M1-1/AG-52） |
| 遭遇点 | 2116–2267 | OVERHAUL W1 |
| 行商 | 2267–2480 | Wave C1 |
| 产业面板 | 2480–2727 | AG-20 |
| **战斗** | 2727–3850 | 回合制+AG-70 舞台（最大单簇，~1,100 行） |
| 楼层装饰 | 3850–4700 | AG-65 洞/中梯 |
| HUD+背包 UI | 4700–4931 | 数值文本/背包格/详情 |
| NPC 对话 | 6897–7238 | 对话树/交易 |
| AI NPC | 7238–7557 | Spark/Ollama 大脑+降级（默认关） |
| 输入/鼠标 | 7557–8251 | 键盘+点击操控 |
| 付费捷径 | 8251–8362 | Wave C2 |
| 床铺交互 | 8362–8598 | AG-51 搜刮/拆解 |
| 墙饰特写 | 8598–8766 | L 键档案 |
| 入夜二选一 | 8766–9065 | AG-64 |
| 2s 搜刮/挖掘 | 9065–9126 | AG-66 |
| 阻碍物 | 9126–9548 | AG-66 |
| juice | 9548–9666 | AG-91 打击感 |
| 性能层 | 9666–9788 | AG-80 池/守卫/F3 |
| frame/update | 9788–末 | 主循环 |

## 二、拆分目标（验收标准）

1. GameScene.ts 降到 **<2,000 行**，只留：场景生命周期（create/update）、楼层世界核心（构建/爬梯/遭遇）、跨控制器编排
2. 每个控制器是**不 import Phaser 场景类型的 plain TS 类**（可单测），通过构造函数拿 scene 引用与需要的系统；显示器（HUD/面板）各自持有并管理自己的 GameObjects
3. **零行为变更**：每步拆分后 tsc 0 + vitest 全绿 + 冻结截图像素 diff 达噪声底（用 tools/png-diff.mjs 协议）
4. 每步独立分支+独立门禁+独立回滚，禁止「大爆炸重写」

## 三、拟议控制器与边界

| 控制器 | 新文件 | 迁入区域 | GameScene 残留面 |
|---|---|---|---|
| StatsPanelController | src/scenes/controllers/StatsPanelController.ts | 6707–6897 | openStatsPanel 一行委托 |
| MonologueController | .../MonologueController.ts | 1065–1305, 5344–5966 | tick 调用+queueMonologue 委托 |
| TutorialController | .../TutorialController.ts | 1019–1065, 5100–5344 | init/tick 两处委托 |
| AchievementController | .../AchievementController.ts | 988–1019, 5966–6707, 308–382 常量 | hook 点保留，逻辑迁出 |
| HudController | .../HudController.ts | 612–786, 4700–5471（含背包格/数值文本/状态卡） | create 里 buildHud() 一次调用 |
| NavBarController | .../NavBarController.ts | 1305–1815, 4931–5100 | contextual 分支保留钩子 |
| CombatController | .../CombatController.ts | 2727–3850, 481–612, 9548–9666 | 回合入口/结果回写委托 |
| DialogueController | .../DialogueController.ts | 2267–2480, 2480–2727, 6897–7557 | 打开/关闭/结果回写 |
| InteractionController | .../InteractionController.ts | 7557–9548（输入/鼠标/床/捷径/特写/入夜/搜刮/阻碍） | 输入分发保留在场景 |
| PerfController | .../PerfController.ts | 9666–9788 | update 里 tick 一行 |
| GameScene（残留） | src/scenes/GameScene.ts | 生命周期+1600–2116 楼层世界+遭遇点+3850–4700 装饰+编排 | — |

注意：区段行号有交叠（导航条 1305–1815 里含着 drawFloor 1600–2116 的一部分），**实施时以方法级 grep 精确定界，不按行号硬切**。

## 四、迁移顺序（风险从低到高）

1. StatsPanelController（190 行，自包含只读面板，QA-01 修过知根知底）
2. MonologueController（~900 行但纯展示，无战斗/存档交互）
3. TutorialController（~450 行，AG-73 独立）
4. PerfController（~120 行，AG-80 刚做完有测试）
5. AchievementController（~750 行，存储键独立）
6. NavBarController（~1,100 行，先冻结 contextual 钩子行为）
7. CombatController（~1,700 行含 juice——本轮战斗大改的成果，必须有冻结截图全套）
8. DialogueController（~1,100 行含行商/AI NPC）
9. HudController（最大，~1,600 行，背包/数值/状态卡）
10. InteractionController（~2,000 行最杂，输入分发最后动）

每步：新分支 → 迁一个控制器 → tsc+vitest 全绿 → 冻结协议像素 diff → 无头冒烟（该控制器功能可玩）→ 合入 → 下一步。

## 五、风险与控制

- **最大风险不是技术是回归**：控制在于每步的门禁+冻结 diff+无头冒烟三件套，任不过即回滚该步
- **并行开发冲突**：拆分会期间控制器各自独立，反而是并行 agent 的冲突解药——但迁移期间仍需「一次一个控制器」的纪律
- **场景间共享状态**（stats/achievements/records 的独立存储键）：控制器只通过既有系统纯函数读写，不私藏状态
- **测试镜像**：控制器单测从场景测试里抽（记录型假场景模式，参考 renderPerf.test.ts/perf.test.ts 路数）

## 六、与 RC-01/02 的关系

- RC-01（当前）：不碰拆分。E2E 验收/日记触发器统一/确定性/文档四线并行中
- RC-02：人工试玩协议（seed 1/42/2026 三轮）——拆分会改变代码组织但不改行为，试玩结论对拆分仍然有效
- RC-03：按本文执行拆分，预计 10 步 × 每步半天量级
