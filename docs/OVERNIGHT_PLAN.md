# 通宵作战书 —— 打到逆向竞品的水平

**授权**：项目负责人 2026-10-29 23:54：「好好做全部大改一直达到你逆向的游戏的程度才能停下来，今晚别睡觉了做到明早8点」。
**达标定义**：`RE_COMPETITIVE.md` 里两款竞品的核心可玩要素全部落地且全量测试绿。逐项对账（✅=已落地）：

| 竞品要素 | 状态 |
|---|---|
| ALTACIMA 问号点遭遇 | ✅ B3-15 波 |
| ALTACIMA 每 10 层 Boss | ✅ 5 层守门人（单薄，Wave A 补战斗深度） |
| ALTACIMA 回合制战斗 攻/挡/逃 | ❌ **Wave A 核心** |
| ALTACIMA 可解锁角色 | ❌ **Wave B** |
| ALTACIMA 目标绑定遗物 | ❌ **Wave B** |
| ALTACIMA 三档模式 | ❌ **Wave B** |
| CENTUM 停留升级 | ✅ B3-15 波 |
| CENTUM 深度主导计分 | ✅ M1 波 |
| CENTUM 每日目标 | ✅ M1 波 |
| CENTUM 怪物行为多样性（37 只 9 行为） | ❌ **Wave A** |
| CENTUM 商店层 | ❌ **Wave C** |
| CENTUM 付费跳层 | ❌ **Wave C** |
| CENTUM 深度窗口物品权重 | ❌ **Wave C** |
| CENTUM 餐数式饥饿 | ❌ **Wave C**（小改大张力） |
| 两款都有：金币经济 | ❌ **Wave C** |

## Wave A —— 战斗深度（当前进行）

**A1 `src/systems/combat.ts`（新）** 回合制战斗引擎，纯函数+seeded：
- `Combatant { hp, maxHp, damage, accuracy, defense, evasion }`
- `CombatAction = 'attack' | 'guard' | 'flee'`
- `resolveRound(player, monster, action, rng): CombatRound`——`CombatRound { playerDamage, monsterDamage, fled, monsterDead, playerDead, messages[] }`
- 命中判定：`accuracy + rng(0..20) > defense + 10 + evasion`（写成可测公式）
- guard：本回合受到伤害减半 + 回 3 精力；flee：成功率 `0.45 + 0.01*dexterity`（失败=白挨一击）
- `playerCombatant(state)`：基础值 + 撬棍（damage+3）+ 医疗包计数（hp 相关注释说明）——从 inventory 读，不写死
- 测试 12+ 条：命中/未命中/暴击区间/guard 半伤/flee 成败/死亡判定/确定性

**A2 `src/systems/monsters.ts`（新）** 怪物名册+行为：
- `MonsterBehavior = 'normal'|'fast'|'slow'|'ranged'|'ambusher'|'coward'|'brute'`
- `MONSTERS: MonsterDef[]`——12–16 只覆盖 2–5 层 + 1 个 boss；字段 `{id,name,hp,damage,accuracy,defense,evasion,behavior,minFloor,weight}`
- `rollMonster(floor, rng)`：按 minFloor 过滤 + weight 加权
- `behaviorModifiers(behavior)`：fast=accuracy+3；brute=damage+2/accuracy-2；ranged=无视 guard 50%；ambusher=首轮 damage×1.5；coward=hp<40% 时战退（给半分赃物）；slow=accuracy-2/defense+2
- 测试 10+ 条：roll 范围/权重趋势（高层更强）/七种行为修饰符数值/名册完整性（每层至少 2 只可 roll）

**A3 `src/systems/encounters.ts`（扩展， additive only）**：
- 只加：`export const COMBAT_KINDS = ['ambush','boss'] as const;` 和 `export function isCombatKind(kind: Encounter['kind']): boolean`
- **不得改任何现有导出/逻辑**（24 条现有测试必须继续绿）
- 现有 `resolveEncounter` 对 ambush/boss 的旧路径保留（非战斗模式的 fallback）

**A4 Lead 集成**：GameState.combat 状态（core/gameTypes.ts，Lead 加）、GameScene 战斗面板与回合循环、存档校验、e2e。

## Wave B —— 元进度（A 完成后）
B1 可解锁角色：4 角色按 depthRecord 解锁（2/3/4/5 层），meta 持久化 localStorage，标题界面可选角色；B2 三档模式（快速/冒险/简单）；B3 遗物：每日目标种类绑定遗物（净水之心=喝水+50%、铁胃=饥饿减速等），局内生效。

## Wave C —— 经济（B 完成后）
C1 商店层：每第 3 次到第 2 层生成商人，买/卖（撬棍、净水、医疗包、遗物）；C2 付费跳层：`2×深度+90+次数×30`（CENTUM 公式），从楼梯口交互；C3 深度窗口物品权重（loot 表加 minDepth/maxDepth/weight）；C4 餐数式饥饿（satiation 3 格，吃饭回血，满了拒吃）。

## Wave D —— 评估 + 抛光
逐项对账本表 → 补齐 → 全量 tsc/vitest/playwright → 终报。

## 工流规则
- 只写本工单文件；跨文件需求 send_message 给 lead
- 禁 Math.random（makeRng/deriveSeed）；交付前自跑 tsc+本工单测试
- 中文注释解释为什么；纯逻辑可单测，Phaser 只在 GameScene
- 完成 send_message lead：文件清单+测试结果+导出签名
