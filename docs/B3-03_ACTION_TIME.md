# B3-03 — 行动消耗时间：把「一天」变成预算

- 里程碑：M1 可玩原型
- 日期：2026-10-28
- 分支：`feat/tower-zoom-b2`

> **2026-10-28 实测更正**：本文 §4 / §5 / §7 的三个数字是估算，与真实试玩不符，已按 [`M1_PLAYTEST.md`](M1_PLAYTEST.md) 的实测数据修正。最关键的一条：原来声称「下到第 5 层共 41 游戏分」的那条 e2e **从未换过楼层**（见 §5 注）。修正后的结论是——行动时耗真实存在且玩家可见，但只把空闲窗口从 9.5 小时压到 8 小时（18%），离填满一天差得远。

## 1. 问题（来自 B3-02 §4.4）

一趟完整往返（06:00 出发 → 搜完 5 层 → 回家 → 做完三项升级）只消耗约 **4.5 游戏小时**，时钟到约 10:15，而入睡要等到 20:00。剩余 **9.75 游戏小时 = 195 真实秒**无事可做，玩家除「再跑一趟」外没有别的选择。

量化依据：全程约 7 km 位移 ≈ 54 真实秒；3 游戏分/真实秒 → 约 4.5 游戏小时。

## 2. 方案（项目负责人选定）

**行动消耗时间**。三个备选方向（提高时钟速率 / 抬高目标门槛 / 行动消耗时间）中选定本方案——它直接制造取舍，而不只是把等待变短或把前期变磨。

## 3. 实现

### 3.1 共用时钟引擎

`advanceTime` 原本把日滚转、衰减、死亡判定全写在函数体内，`spendTime` 无法复用。抽出 `advanceGameMinutes(state, gameMinutes)` 作为唯一引擎：

- `advanceTime(deltaMs)` → 换算成游戏分钟后调用引擎
- `spendTime(gameMinutes)` → 直接调用引擎

**为什么必须共用**：如果离散跳转绕过日滚转与衰减，玩家就能靠反复搜索容器刷掉夜晚，或跳过死亡判定。测试 `reports the same day rollover as an equivalent run of frames` 断言一次 150 游戏分的跳转与 200 帧逐帧推进落在同一天、同一时刻、同一口渴值。

### 3.2 行动时耗（config 驱动）

`config/game-balance.json` 新增 `actionCosts`，`src/core/config.ts` 补类型：

| 行动 | 游戏分钟 |
|---|---:|
| 搜索容器 | 20 |
| 拾取地面物品 | 5 |
| 制作 / 净化 | 30 |
| 交易 | 15 |

定价逻辑：容器要翻找 > 地上捡起就走的单件；打造 > 翻箱倒柜。

### 3.3 接入点（`GameScene`）

四个成功分支各调一次 `chargeTime(cost)`：`openContainer`、`autoPickup`、`activateCraftEntry`（配方与净化两条分支）、`activateDialogueOption` 的交易分支。**失败分支不计时**（没做成的事不花时间）。

`chargeTime` 把三件事绑在一起，避免「计了时却没存盘/没刷新 HUD/没判死」：

```ts
private chargeTime(gameMinutes: number): void {
  const state = getGame();
  const tick = spendTime(state, gameMinutes);
  this.refreshClock();
  this.refreshStats();
  this.applyNightLighting();
  saveToStorage(state);
  if (tick.died || tick.won || state.status !== 'playing') {
    saveToStorage(state);
    this.scene.start('End');
  }
}
```

### 3.4 玩家可见性

flash 文案带上时耗，例如「获得 净水x1 (-20 分钟)」「建造了 照明灯 (-30 分钟)」，让玩家能规划当天预算，而不是被隐形扣时间。

## 4. 效果

| 场景 | 改前 | 改后 |
|---|---|---|
| 搜 1 个容器 | 0（只有走路时间） | 20 游戏分 |
| 全搜 5 层 + 3 项升级 | ≈ 4.5 小时 | **5.97 小时**（实测） |
| 当天空闲窗口 | 9.5 小时 | **8.0 小时**（实测，全搜策略） |

**实测数据**（`?seed=42`，真实键盘跑完一整天，见 [`M1_PLAYTEST.md`](M1_PLAYTEST.md) §2）：

- 全搜策略：06:02 醒来 → 09:03 背包在第 5 个容器就满 → 10:26 回家 → **12:00 三项升级建成** → 干等到 20:00
- 其中行动时耗 200 游戏分（5 次搜索 + 2 次拾取 + 3 次制作），走路 158 游戏分
- 备水先行策略：06:00 → **11:18** 完工，空闲 8.7 小时

**所以「一天 14 清醒小时只够一趟半」这个说法不成立**——实测是「6 小时干活 + 8 小时干等」。行动时耗只吃掉了原 9.75 小时空窗里的 1.75 小时（18%）。要真填满一天，需要的不是 20/5/30/15 这套单价，而是大约两倍的内容量或两倍的单价。

时耗带来的真实收益不在时长而在**可见性**：flash 会写「（-20 分钟）」，玩家据此规划「今天还来不来得及再跑一趟」。这个取舍是成立的，只是它的粒度是 6 小时对 8 小时，不是 10 小时对 4 小时。

## 5. 验证证据

- **RED**：先写 9 条失败单测（`spendTime` 不存在 / `ACTION_COSTS` 不存在），确认失败原因是 API 缺失而非笔误。
- **GREEN 单测**：`npm test` → 23 files / **286 passed**（原 276，+10）
  - 精确推进、衰减计费、午夜滚转、结束后 no-op、非正值 no-op、可致死、与逐帧等价
  - 时耗为正、排序合理、与 config 一致
- **e2e**：`npx playwright test` → **57 passed**（原 54，+3）
  - `searching a container costs game time`：时钟推进 ≥ 20 且 < 45 游戏分
  - `the action cost is visible to the player`：flash 含「分钟」
  - `a climb from floor 1 to floor 5 costs a real slice of the day`：真实走到每个楼梯口按 E 爬到第 5 层
  - **完整生存旅程（3.6m）通过**——证明时耗没有破坏既有闭环

> **这条 e2e 原来名不副实，已修。** 它原本叫 `a full sweep of five floors now costs a meaningful part of the day`，做法是把 `player.x` 直接设成 1240 再按 E，并声称「实测下到第 5 层 41 游戏分」。但第 1 层右端没有下楼口——`hasDownExit(1)` 是 `PLAYABLE_FLOORS_V01.includes(0)`，为 false——所以**楼层从未变化**，那 41 分钟是「走到储物柜 + 搜一次 + 等 2.9 秒」。已改成走到 x=40 的上楼口逐层真实爬楼。违反的正是 `CLAUDE.md` 质量门槛里「不得用直接修改生产状态伪造完整旅程」那条。
- **构建**：`npm run build` 通过，1,453.23 kB（gzip 383.49 kB）
- **截图**：`e2e/screenshots/b3-03-01-before.png`、`b3-03-02-cost.png`（真实运行，非概念图）

## 6. 修改文件

| 文件 | 改动 |
|---|---|
| `src/systems/SurvivalSystem.ts` | 抽出 `advanceGameMinutes`；新增 `spendTime`、`ACTION_COSTS` |
| `config/game-balance.json` | 新增 `actionCosts` 块 |
| `src/core/config.ts` | `GameBalanceConfig` 补 `actionCosts` 类型 |
| `src/scenes/GameScene.ts` | 新增 `chargeTime`；四个行动接入；flash 文案带时耗 |
| `src/tests/survivalSystem.test.ts` | +10 条单测 |
| `e2e/actionCosts.spec.ts` | 新增，3 条 e2e |
| `docs/ROADMAP.md` | B3-03 标记完成 |

## 7. 遗留问题

1. **未解决「玩家彻底无事可做时的干等」**：若玩家当天已做完想做的事，仍需等到 20:00。实测时空窗从 9.5 小时压到 **8.0 小时**（原文档写「约 5 小时」，是估算，偏乐观），**没有归零**。彻底解决要么允许提前入睡（放弃剩余白天），要么引入委托/建造队列——属 B5 范围。
2. **§4.5 第 2 层货箱 50% 可能全空**：未处理（不影响通关，但该层收益不稳定）。
3. **D7 装饰道具与可交互对象未区分**：未处理。
4. **D8 `EndScene` 胜利分支在现有规则下不可达**：未处理（已由 `?devwin=1` 夹具覆盖）。
5. **未做真实人工试玩**：本轮只验证了机制与回归，B3 验收标准里的「好不好玩」仍需人工试玩确认。

## 8. 下一步

B3-03 完成。按 `ROADMAP.md`，下一步是**真实试玩**确认第 1–5 层生存循环有动力、有取舍，通过后进入 **M1 可玩原型验收**，再进 B4。
