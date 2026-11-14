# 四条成长线接口契约（GROWTH_INTERFACES）

**日期**：2026-11-15
**范围**：`docs/GAME_DESIGN_LOCK.md` §4「四条互相影响的成长路线」的落地数据结构与纯函数层
**状态**：已实现（AG-01），待各消费方系统接入
**分支**：`agent/2026-11-15/ag-01-lead`

---

## 1. 这份文档给谁看

给后续所有要碰成长的 Agent：**AG-05（经济/贸易）、AG-06（NPC/关系）**，以及任何要给玩家发经验、读跨线加成的系统。本文是唯一权威；与代码冲突时以 `src/core/growth.ts` 的行为和 `src/tests/growth.test.ts` 的断言为准。

三句话契约：

1. **写成长**只能调 `grantGrowthXp(state, line, amount)`（`src/core/growth.ts`）。它是唯一被允许改 `state.growth` 的公开函数。
2. **读跨线影响**只能调 `growth.ts` 里 export 的对应函数（§4 表格）。不允许在场景里手写 `profile.connections.level * 0.03` 这类公式——四条线的平衡必须只有一个出处。
3. **读存档里的 growth** 之前先过 `ensureGrowth(state)`（§6）。旧存档没有这个字段，直接读会拿到 `undefined`。

## 2. 数据结构（`src/core/gameTypes.ts`）

```typescript
export type GrowthLineId = 'survival' | 'wealth' | 'connections' | 'power';

export interface GrowthLine {
  level: number;   // 1..GROWTH_MAX_LEVEL(10)
  xp: number;      // 当前等级内经验 0..xpToNext(level)；满级恒 0
  totalXp: number; // 终生累计，只增不减；满级后也只进这里
}

export interface GrowthProfile {
  survival: GrowthLine;      // 生存能力：体温/饥渴/伤势/抗寒耐饿
  wealth: GrowthLine;        // 财富与产业（现钱在 player.gold，不在这里）
  connections: GrowthLine;   // 人脉与声望（逐 NPC 细节在 npcStates，不在这里）
  power: GrowthLine;         // 权力与影响力
  intel: number;             // 情报 0..100 —— 暂无生产者
  controlledSegments: number[]; // 已控制可玩段 id(1..6) —— 暂无生产者
  investedGold: number;      // 沉在产业里的资本 —— AG-05 写
  ventures: string[];        // 已投资产业/商路 id —— AG-05 写
}
```

**为什么四条线都用 level/xp，而不是各自一条 0..100 进度**：

1. 四条线分属四个 Owner，一套曲线、一个写入入口、一种存档形状，漂移面最小；0..100 自由进度会让每个系统各自发明阈值语义（「70 算高还是 80 算高」）。
2. 设计锁定的跨线影响是离散判断（「权力解锁高层配方」「人脉降低交易价格」），读等级比读连续值干净；等级内的细腻度由 `xp / xpToNext(level)` 保留，等效 0..100，只是显示层的事。
3. 与既有词汇一致：通行凭证链是离散档位、每日目标 target 是整数，等级制是玩家已经读得懂的语言。

## 3. 等级曲线与经验语义

| 规则 | 值 |
| --- | --- |
| 等级上限 | `GROWTH_MAX_LEVEL = 10` |
| 升级所需 | `xpToNext(level) = 100 × level`（1→2 需 100，9→10 需 900，满级共 4500） |
| 一次授予 | 可连升多级，逐级扣除 |
| 满级后 | `xp` 恒 0，经验只进 `totalXp`（满级的 xp 没有「下一级」可指） |
| 负值/NaN/Infinity | 静默按 0 处理（场景循环里抛异常会杀帧循环，GHI-03 m5 的教训） |
| 掉级 | 不存在。经验只增不减 |
| 手改档越界值 | `ensureGrowth` 收敛：level 99→10、level 0→1、intel 500→100、investedGold -20→0 |

## 4. 跨线影响函数（`src/core/growth.ts`，全部纯函数）

| 函数 | 读哪条线 | 效果 | 登记的消费方 |
| --- | --- | --- | --- |
| `carryCapacityBonus(profile)` | survival | 背包额外格数 = `level-1`（1 级 +0，满级 +9） | 背包 UI / `addItem` 容量展示（与 `player.inventory.slotCount` 相加） |
| `statDrainMultiplier(profile)` | survival | 饥渴/体温等消耗倍率，`1-0.04×(level-1)`，下限 0.6 | SurvivalSystem / EnvironmentSystem / SicknessSystem 乘各自的小时消耗 |
| `tradePriceMultiplier(profile)` | connections | 交易价格倍率，`1-0.03×(level-1)`，下限 0.7 | TradeSystem / shop（AG-05） |
| `recipeAccessTier(profile)` | power | 可解锁配方档位 = `min(6, level)` | CraftingSystem——**配方目前没有 tier 字段，此函数暂无消费方**，等 AG-05 给 `Recipe` 加 `tier` 后接入 |
| `favorRate(seed, day)` | — | 当日疏通汇率 0.8..1.2，由 `(runSeed, day)` 决定（禁 Math.random，同 seed 同天必然同值） | AG-05/AG-06 的送礼/打点流程 |
| `goldToFavorXp(gold, profile, seed, day)` | wealth | 金币→人脉经验换算；财富每级效率 +10%（批量打点有批发价） | AG-05/AG-06：扣完 gold 后 `grantGrowthXp(state, 'connections', goldToFavorXp(...))` |
| `credentialRungs(homeUpgrades)` | （读既有状态） | `homeUpgrades` 里的凭证档数 0..5 | 发权力经验的一方按档位差发奖；HUD 显示凭证链进度 |
| `lineLevel(profile, line)` | 任意 | 安全读某线等级（容忍残缺 profile，热路径免 ensureGrowth） | 各系统门禁判断 |

这四条显式影响构成设计锁定要求的互相牵制：**生存 → 携带量 → 能带多少补给去更远 → 财富积累 → 换人脉 → 交易价格 → 反过来供养生存；权力 → 配方档位 → 上层物资 → 全部四条线**。人脉不影响生存消耗、财富不影响配方档位——跨线是显式登记的，不是全局光环。

## 5. 字段所有权（谁读哪个字段、谁负责写入）

| 字段 | 写 | 读 |
| --- | --- | --- |
| `growth.*.level/xp/totalXp` | **只能** `grantGrowthXp` | 各系统经 `lineLevel` / §4 函数；HUD 进度条 |
| `growth.survival` 经验来源 | 生存系统：喝净水、进食、安睡、治病、熬过寒冷夜 | §4 |
| `growth.wealth` 经验来源 | AG-05：交易达成、搜刮出售、产业投资 | §4 |
| `growth.connections` 经验来源 | AG-06：完成委托、送礼（走 `goldToFavorXp`）、照顾邻居 | §4 |
| `growth.power` 经验来源 | 凭证链（CraftingSystem 打造凭证时按 `credentialRungs` 档位差发奖）、情报、区域控制 | §4 |
| `growth.intel` | **暂无生产者**（预留给情报/探索系统） | — |
| `growth.controlledSegments` | **暂无生产者**（预留给区域控制系统） | — |
| `growth.investedGold` / `growth.ventures` | **暂无生产者，AG-05 经济系统负责写入** | AG-05 产业收益结算 |
| `player.gold` | 既有经济系统（不动） | — |
| `npcStates` | AG-06（逐 NPC 关系留在原处，不搬进 profile） | AG-06 |

**各线经验建议基准**（统一刻度，避免四个系统各自发明量级；最终数值归各 Owner 调整）：

| 线 | 行为 → 经验 |
| --- | --- |
| survival | 喝净水 +5 / 吃口粮 +5 / 安睡一晚 +10 / 治好一个病症 +15 / 在寒冷楼层熬到早上 +20 |
| wealth | 交易达成 +10 / 搜刮出售 +5 / 完成一笔产业投资 +50 |
| connections | 完成 NPC 委托 +30 / 送礼打点按 `goldToFavorXp` / 照顾邻居 +10 |
| power | 拿到新凭证 +100×档位 / 收集一条情报 +5 / 控制一个新段 +200 |

## 6. 旧存档兼容（硬规则）

- `GameState.growth` 是**可选字段**。`src/systems/SaveSystem.ts` 只读不改、也不知道这个字段：缺 `growth` 的旧存档能通过校验正常加载，加载后 `state.growth === undefined`。
- **不升 `schemaVersion`**（仍是 2）。为一个新增块升版本会让所有旧存档变成「版本不支持」被拒——那才是真的弄坏老存档。
- 任何读 `state.growth` 的代码必须先调 `ensureGrowth(state)`：整块缺失（旧存档）补全新默认值；缺半边/越界（手改档）收敛成合法值；已完整则原样返回同一引用（幂等，可每帧调用）。
- 新档由 `createNewGame` 直接带 `growth: createGrowthProfile()`。
- 存档迁移的唯一收口是 `growth.ts` 的 `normalizeGrowth`；**不要**在 SaveSystem 或各系统里各写一份「缺字段补默认」。

## 7. 确定性规则

- `growth.ts` 不 import Phaser、不读 DOM、不碰 `Math.random`。
- 唯一涉及随机的是 `favorRate(seed, day)`，走 `deriveSeed(runSeed, day, 'growth-favor')`（同 `dailyGoals.ts` 的模式）：同 seed 同一天必然同汇率，测试与存档复现都依赖这一点。
- 全部函数是输入的纯函数：同输入同输出，可单测（`src/tests/growth.test.ts`，26 例）。

## 8. 测试契约

`src/tests/growth.test.ts` 已覆盖：四条线各自独立升级、阈值精确判定、一次连升多级、输入不被修改、满级钳制（巨额经验/满级后只进 totalXp）、负值 NaN Infinity 静默忽略、越界存档自愈、五条跨线影响、`favorRate` 区间与跨天波动、同 seed 同输入可复现、`credentialRungs` 只数凭证、旧存档（整块缺失/残缺越界/缺字段授予）兼容。

消费方接入时的最低要求：**在自己的测试文件里**断言你调用的那个跨线函数在你的场景里真的生效（例如 AG-05 的 shop 测试应断言满级人脉结账价 = 标价 × `tradePriceMultiplier`），不要改 `growth.test.ts` 的既有断言强度。

## 9. 终局路线的衔接（GAME_DESIGN_LOCK §6）

四条终局路线由四条线的长期行为自然形成，本结构不替终局系统做判定，只提供刻度：A 权贵代理人（power+connections）、B 独立商人与产业领袖（wealth，`investedGold/ventures` 是它的账本）、C 底层起义（connections+survival）、D 夺取统治权（四线汇总 + `intel/controlledSegments`）。终局判定系统落地时读这些字段即可，无需再改存档结构。
