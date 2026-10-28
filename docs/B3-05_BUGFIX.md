# B3-05 — M1 试玩发现的两个 bug 修复

- 里程碑：M1 可玩原型
- 日期：2026-10-28
- 分支：`feat/tower-zoom-b2`
- 来源：[`M1_PLAYTEST.md`](M1_PLAYTEST.md) §5
- 方法：TDD（先写失败测试，确认失败原因是行为缺失而非笔误，再实现）

---

## 1. B3-05.1 喝满时照样消耗物品

### 问题

`InventorySystem.useConsumable` 先把效果加上（被上限截断），再无条件 `removeItem`：

```ts
p[item.effect.stat] = Math.min(max, before + item.effect.amount);
removeItem(state.player.inventory, itemId, 1);   // 效果为 0 时也删
```

M1 试玩「备水先行」轮实测：开局口渴 80，连按 3 次 Enter 喝光 3 瓶起始净水，flash 依次是

```
使用 净水 · 水分 +20.004491
使用 净水 · 水分 +0
使用 净水 · 水分 +0
```

第一瓶 80→100 只生效 10 点，后两瓶完全无效，**3 瓶换 +20，白烧 70 点口渴 ≈ 1.2 天生存**。而 `survivalBalance.test.ts` 自己算过，整座五层塔的水余量只有 0.7 天——这个浪费量级足以把「刚好活到第 8 天」变成「第 6 天渴死」。

### 规则

**目标属性已满时拒绝使用，物品留在包里。** 部分截断仍然允许。

区分的理由：口渴 85 时喝一瓶，85+30 被截到 100，浪费 10 点——但这是玩家主动选的，而且 flash 会报真实获得量（`+15`），信息是透明的。只有**完全无效**的使用才是静默损失，那才需要拦住。

### 实现

[`src/systems/InventorySystem.ts`](../src/systems/InventorySystem.ts)：

```ts
if (before >= max) {
  return { ok: false, reason: `${item.displayName}现在不需要（${STAT_LABEL[item.effect.stat]}已满）` };
}
```

顺带把 `STAT_LABEL`（四项属性的中文名）从 `GameScene` 搬到 `InventorySystem`，挨着 `STAT_MAX`——两者都是属性元数据，而拒绝理由必须点名是哪个属性满了。`GameScene` 改为 import，删掉自己那份，消掉一处重复。

### 测试

新增 `describe('useConsumable refuses a wasted item')` 5 条：

| 测试 | 断言 |
|---|---|
| 满值时不消耗物品 | `ok === false`、`amount` 为 undefined、背包数量不变、属性不变 |
| 理由点名属性 | `reason` 含「生命」和「医疗包」，拒绝读起来是理由而不是死键 |
| 未满时照常消耗（含部分截断） | 口渴 85 → `ok`、`amount === 15`、背包少一瓶 |
| 覆盖所有可恢复属性，不止口渴 | 饱食/精力满值时用口粮同样被拒 |
| 拒绝时不碰其他属性 | 口渴满、饱食 40，拒绝后饱食/精力/HP 均不变 |

同时**删除**了旧的 `never overflows a stat (boundary)`——它断言 `r.amount === 0`，在新规则下这个调用会被拒绝、`amount` 为 undefined，会因错误原因失败。两个边界（满→拒、部分→截断）由新 describe 覆盖。

**RED 证据**：3 条失败，全部是 `expected true to be false`，即旧实现确实会执行并返回成功。

---

## 2. B3-05.2 净化 flash 写死「1 瓶」

### 问题

`purifyWater` 一次转换**全部**脏水并返回 `{ ok: true, converted: n }`，但 `GameScene.activateCraftEntry` 的 flash 把数量写死了：

```ts
this.flash(`净化了 1 瓶净水（-${ACTION_COSTS.craft} 分钟）`);
```

M1 试玩「备水先行」轮实测 flash 是「净化了 1 瓶净水」，而背包脏水 6→0、净水 +6。玩家按 1 瓶规划当天的水，实际拿到 6 瓶——**反馈数字是错的**，而且错的方向是让玩家低估资源。

### 实现

```ts
this.flash(`净化了 ${result.converted} 瓶净水（-${ACTION_COSTS.craft} 分钟）`);
```

### 测试

扩展 `e2e/crafting.spec.ts` 的 `the purifier converts dirty water to clean water`（注入 2 瓶脏水、真实按 C/↓/Enter 操作），断言 flash：

- `toContain('2 瓶')`
- `not.toContain('1 瓶')`

旧文案「净化了 1 瓶净水」不含「2 瓶」，所以第一条断言在修复前必然失败。截图 `e2e/screenshots/b3-05-2-purify-flash.png`。

---

## 3. 验证

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `npx vitest run` | 23 文件 / **290 passed**（原 286：新增 5、删除 1） |
| `npx playwright test --workers=1` | **57 passed**（7.5m，原 57 passed + 2 failed 修复后同数） |
| `npm run build` | 通过，1,453.33 kB（gzip 383.55 kB） |

**未改变玩法数值**：两个修复都只改「什么时候算成功」和「文案报什么数」，没有动任何掉落、时耗、衰减或配方。

---

## 3.1 一个必须记录的后果：背包紧了一格

修 B3-05.1 之后，**玩家不能再靠喝满来腾背包格子**。这条副作用一开始打破了两个 e2e，值得写下来 because 它是设计变更而不是测试瑕疵：

- `bagFullWarning.spec.ts` 原本用「连按 3 次喝光 3 瓶水」来演示「腾出格子后警告消失」。新规则下那条路没了，测试改成走**工作台制作**——打造会消耗整堆材料，这才是游戏真正提供的腾格子方式。
- `survivalJourney.spec.ts` 原本在开局连喝 3 瓶，把水的那一格腾空，正好留给第 3 层地上那块布。新规则下瓶子留在包里，**那块布就带不走了**（实测：回家时背包正好 12 格，`g:cloth:1120` 不在 `lootedItems` 里）。

旅程测试的修法不是删断言，而是**把三瓶水分散到路上喝**（开局、第 3 层后、第 5 层）——这本来就是真实玩家会做的事，也自然把格子腾了出来。改动后旅程照旧通过，且比原来更真实：原来那三个 Enter 有两个是纯浪费。

**这对玩法意味着什么**：水从「可以随时处理掉的占格杂物」变成「必须一直带着的资源」。在第 1–5 层这种水极稀缺的环境里，这是对的方向——但它确实让 12 格背包更紧，和第 2 层货架、第 5 层补给架的取舍会更快撞上。布料没有任何配方用途，所以这一格的实际损失是零，但**如果再紧一格，玩家就会开始丢有用地东西**。这是 M1 试玩「内容是一次性的」之外，第二个指向「12 格可能偏小」的信号。

---

## 4. 修改文件

| 文件 | 改动 |
|---|---|
| `src/systems/InventorySystem.ts` | `useConsumable` 满值拒绝；新增导出 `STAT_LABEL` |
| `src/scenes/GameScene.ts` | 删本地 `STAT_LABEL` 改为 import；净化 flash 用 `result.converted` |
| `src/tests/inventorySystem.test.ts` | +5 条测试，删 1 条过时边界测试 |
| `e2e/crafting.spec.ts` | 净化测试加 flash 数量断言 + 截图 |
| `docs/M1_PLAYTEST.md` | §5 两个 bug 标记已修 |
| `docs/ROADMAP.md`、`docs/03_TASKS.md` | B3-05.1 / B3-05.2 标记已修 |

---

## 5. 遗留

M1 试玩提出的另外三项仍未处理，均不阻断：§4.5 第 2 层货箱 50% 可能全空、D7 装饰道具与可交互对象未区分、D8 `EndScene` 胜利分支不可达。见 [`M1_PLAYTEST.md`](M1_PLAYTEST.md) 与 `ROADMAP.md` 遗留表。

---

## 6. 顺带发现（未修，需项目负责人定夺）：HUD 反馈被面板盖住

给 B3-05.2 拍证据截图时发现：**制作面板开着的时候，flash 根本不在画面上**。

证据：[`b3-05-2-purify-flash.png`](../e2e/screenshots/b3-05-2-purify-flash.png)。flash 的文案是「净化了 2 瓶净水（-30 分钟）」（测试读到了 `feedbackText.text`，断言通过），但截图里制作面板上方什么都没有。

已知的结构性原因：`feedbackText` 深度 120，而 `PANEL_DEPTH.game` 最深是 `pause: 230`。制作面板 460×300 居中，跨度 y=30..330，flash 在 y=60——正好在面板矩形内部。

**为什么这条要紧**：它让三个「已验证」的反馈实际不可见——

| 反馈 | 深度 | 被谁盖 |
|---|---|---|
| flash（行动时耗、获得物、制作、交易、净化） | 120 | 所有面板 |
| 背包已满常驻警告 | 120 | 所有面板 |
| hint 行（按 E 打开 X / 上楼 / 睡觉） | 100 | 所有面板 |

而且 `bagFullWarning.spec.ts:155` 有一条断言是「打开背包后警告仍在」——它**通过**，但 `hasVisibleText` 读的是 GameObject 的 `visible` 属性，不是渲染结果。B3-02.1 的代码注释还专门写了「满包在背包面板开着时最要紧，那正是玩家找东西花的时候」，而那一刻它恰好被面板盖住。这正是 `CLAUDE.md` 质量门槛里「测试通过不等于玩法成立」的原型案例。

一个反证让我没直接下手：同一张截图里，深度 100/101 的时钟和状态条是可见的（时钟在 y=12，制造面板顶部在 y=30，所以它在面板上方；但状态条 y=40..85 应该被盖住却仍可见）。**Phaser 4 的合成顺序不完全遵循 depth**（`ARTPACK_INTEGRATION.md` §4.2 已经为 NineSlice 记过一条同类陷阱），所以我没有可靠的静态推理，只有「flash 不在画面上」这一条实测。

**最小修复提案（未实施）**：把 `feedbackText` / `bagFullText` / `hintText` 的深度抬到 300 以上（高于最深的 `pause: 230`），不动任何布局。但这是 HUD 层次决策，属于项目负责人主导的 UI 范围，所以只报告不动手。要我做的话说一声。
