# M1 暴改作战书（OVERHAUL）

**授权**：项目负责人 2026-10-29：「整个游戏我现在一点想玩的游戏都没有」+「往你逆向的游戏上面靠」。
**配方来源**（全部实证，见 [`RE_COMPETITIVE.md`](RE_COMPETITIVE.md)）：

- **ALTACIMA**（最接近对标）：每层小地图 + **问号点**（敌人/赃物/商人/宝藏/纸条四选一）· 饥饿与精力决定能走多远 · **每 10 层一个 Boss** · 目标绑定的遗物 · 回合制攻/挡/逃
- **CENTUM**（源码级）：**停留升级**（已落地 B3-15）· 深度主导计分（`2×深度+宝藏`）· 深度窗口物品 · 餐数式饥饿（本轮不动，避免推翻 B3-16）

**总原则**：不动六条原则与技术基线（Phaser+TS+Electron、seeded RNG、12 格背包、向上攀升终局）；**只把"第一天到通关好不好玩"对齐两款已验证配方**。每条改动必须治一个实测问题，禁止"感觉会更好"。

## 目标体验（改完后玩家说的话）

1. **「每层都有东西在等我」**——楼层出现问号点，踩上去是敌人/赃物/商人/纸条（ALTACIMA 核心循环）
2. **「第 5 层有个必须面对的东西」**——首个 Boss 守上楼口，给 run 一个形状（ALTACIMA 每 10 层 Boss 的 M1 版）
3. **「昨天最深 3 层，今天破纪录」**——深度纪录 + `2×深度+宝藏` 计分（CENTUM）
4. **「那东西盯上我的时候我知道」**——预警 + 追击，站着必死、走路看操作（W2）
5. **「没事干就睡，晚上去有好处但更危险」**——随时入睡 + 夜间加成（治 8 小时空窗/夜间零收益）

## 工单（文件所有权互斥）

### W1 问号点遭遇系统（Agent A）——本暴改的核心

**治**：楼层是空走廊，探索无期待（试玩原话“取完即无”）。

新 `src/systems/encounters.ts`（纯逻辑 + seeded，禁 Math.random）：

- `ENCOUNTER_TABLE`：按楼层权重表——`loot`（赃物）/ `ambush`（敌人）/ `trader`（商人）/ `note`（纸条）/ `cache`（宝藏）。第 5 层固定含 `boss`（守门人，高攻、需特定应对）
- `rollEncounter(state, floor, spotId): Encounter`——`deriveSeed(runSeed, day, floor, spotId, 'encounter')`
- `resolveEncounter(state, encounter, choice): EncounterResult`——选择与后果：
  - `ambush`：`fight`（有撬棍加成，掉 HP 换赃物）/ `flee`（掉 1 格时间，无损失）
  - `trader`：`trade`（脏水×2→净水×1 等 2-3 笔固定交换）/ `leave`
  - `loot`/`cache`/`note`：`take`（note 给氛围文案 + 小加成）
  - `boss`：`fight`（需撬棍或医疗包在场，否则大败）/ `flee`（Boss 守楼，逃了但上不去）
- 测试 `src/tests/encounters.test.ts`：确定性、逐类至少一成一败路径、奖励不重复发、Boss 门槛

### W2 威胁 AI（Agent B）

**治**：巡游体无威胁感（B3-06 实测：只杀不动的人）。

- 新 `src/systems/wandererAI.ts`：纯状态机 `stepWandererAI(ai, playerX, playerVx, dtMs)`：`stalking → lunge → cooldown`；玩家在 `overhaul.lungeRange` 内且 1.5s 位移 < 40px → lunge（速度 ×2.2，2s）；lunge 中命中掉血加倍
- `dwellPressure.ts` 第 4 行后加 `'scout'` 结局：不出怪，下次 prowler 概率 +0.1（封顶 0.85）
- 测试：新 `wandererAI.test.ts`（迁移/边界/速度）、`dwellPressure.test.ts` 补 scout 断言

### W3 进展与计分（Agent C）

**治**：无每日理由、无可炫耀进展。

- 新 `src/systems/dailyGoals.ts`：每天 06:00 懒生成 1 个目标（带回 N 瓶净水/搜刮 N 容器/建成 1 升级/到达 N 层，seeded）；完成判定纯函数；完成给 `overhaul.dailyGoalRewardScore` 分 + 1 口粮，只发一次
- 新 `src/systems/progress.ts`：`depthRecord(state)`（读 `state.records.deepestFloor`，纯函数）；`runScore(state)` = **`2×depth + 宝藏分 + 目标分`**（抄 CENTUM 公式）
- 测试：新 `dailyGoals.test.ts`、`progress.test.ts`

### W4 反馈与精力预算（Agent D）

**治**：界面无紧迫感；精力不构成预算（ALTACIMA：饥饿+精力决定能走多远）。

- 新 `src/render/feedback.ts`：`lowHpPulse(hp, hpMax, now)` 0..1 红晕强度（<30% 起脉冲）；`mostUrgentStat(stats)`；**`moveSpeedFactor(stats)`**：energy<20 → ×0.75（精力见底走不动）
- `src/render/audio.ts`：加 `chest`/`alert`/`goal` 三音效（现有合成方式，不加资产）
- 测试：新 `feedback.test.ts`

### W5 集成（Lead）

`gameTypes.ts`/`config.ts`/`game-balance.json` 全部新字段 **Lead 先声明**（契约见下）；`GameScene.ts` 全部接线（问号点精灵、遭遇面板、Boss 守楼、HUD 目标/分数/纪录、精力减速、红晕）；全量验证；文档；提交。

## 接口契约（Lead 已预置，agent 直接 import，**不得改 core/ 与 GameScene**）

```ts
// gameTypes.ts（已添加）
worldEvents: { ...; dwell?: DwellState }
state.dailyGoal?: { day: number; kind: GoalKind; target: number; done: boolean }
state.records?: { deepestFloor: number; bestScore: number }
state.encounters?: Record<string, string>   // spotId -> 已解决的结果 key
// config/game-balance.json（已添加）
dwellPressure: { rollIntervalGameMinutes: 60 }
overhaul: {
  sleepAnytime: true, nightLootBonusCount: 1,
  lungeSpeedMultiplier: 2.2, lungeRange: 220, lungeStillnessMs: 1500,
  lowHpPulseThreshold: 0.3, dailyGoalRewardScore: 80,
  lowEnergySpeedFactor: 0.75, lowEnergyThreshold: 20
}
```

## 工流规则

- 只写本工单列出的文件；要动别处 → `send_message` 给 lead
- 交付前自跑 `npx tsc --noEmit` + 本工单单测
- 禁 `Math.random`；禁改 `GAME_DESIGN_LOCK.md`；禁碰上个会话未审查文件
- 完成 → `send_message` lead：文件清单 + 测试结果 + 已知问题
