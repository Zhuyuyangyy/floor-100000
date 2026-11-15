# 终局演出：Endgame 场景与入口契约（FINALE_UX）

- 负责：AG-21（终局演出工程师）
- 日期：2026-11-15
- 分支：`agent/2026-11-15/ag-21-finale-ux`（自 `origin/integrate/sprint-01` 出发）
- 权威依据：`docs/plans/STORY.md` §5/§6/§7（Q6 详卡、核心终端台词、集成契约）、`docs/plans/FINALE.md`（AG-16 的 100000 层三容器）、`docs/GAME_DESIGN_LOCK.md` §6（四条终局路线）、`src/data/quests.ts` 的 `same-pen`

---

## 0. 一句话

100000 层的三个容器从「物资点」变成终局演出的入口：**终端台交付 Q6 的四选一抉择，档案柜可读三张表，配电箱是 shutdown 的物理动作点**。演出、落地、结算全部在 `src/scenes/EndgameScene.ts`（场景 key `'Endgame'`）内完成，`GameScene.ts` 只负责在正确的交互点 `scene.start('Endgame', { from })`。

设计基调（最高权威）：

> 「钥匙在你手里。现在你也是这套系统的一部分。」
> 「停电表、配给表、处决名单，是同一支笔写的。」
> 「你要么关上它，要么坐上它。」

## 1. 场景注册（AG-21 已完成）

`src/main.ts`：

```ts
import { EndgameScene } from './scenes/EndgameScene';
// ...
game.scene.add('Endgame', EndgameScene);
```

与 `QuestPanel` 同款理由：`core/gameConfig.ts` 是共享启动契约（冻结，不属本任务），`scene.add` 把场景 parked 在 SceneManager 里 dormant，`scene.start('Endgame')` 从任何地方都能解析。

## 2. 入口契约（AG-20 的唯一职责）

### 2.1 场景 key 与启动参数

| 项 | 值 |
| --- | --- |
| 场景 key | `'Endgame'` |
| 启动方式 | `this.scene.start('Endgame', { from })`（handoff：GameScene 被 stop，终局结束后场景自己 `scene.start('Game')` 回来） |
| 参数 `from` | `'terminal'`（默认，可省略）\| `'archive'` \| `'fuse'` |
| 落点 | 100000 层三个容器，按下表 |

### 2.2 100000 层三容器 → 入口映射

| 容器 id | label | x | 第一次按 E | 已开过后再按 E |
| --- | --- | --- | --- | --- |
| `counter` | 终端台 | 320 | 既有搜刮（净水×1、口粮×1 guaranteed） | `scene.start('Endgame', { from: 'terminal' })` —— Q6 抉择 |
| `security_safe` | 档案柜 | 960 | 既有搜刮（医疗包/滤芯概率掉落） | `scene.start('Endgame', { from: 'archive' })` —— 读三张表 |
| `fuse_box` | 配电箱 | 640 | 既有搜刮（保险丝/电线，`core_key` 的配方成本） | `scene.start('Endgame', { from: 'fuse' })` —— 电源总闸 |

**为什么是二段式**：容器同时是物资点（100000 层的 guaranteed 水食在终端台里，是生存必需品）。第一次 E 必须能拿到东西，叙事入口放在「开过之后」——既不动 `openContainer` 的既有行为，也让「读表/拉闸」成为玩家主动的第二动作。判据用楼层访问记录里的 `openedContainers`（`LootSystem.lootContainer` 自己维护，无需新 flag）。

### 2.3 AG-20 接线点与示例代码

接线点在 `GameScene.onInteract()` 的容器分支（现约 `src/scenes/GameScene.ts:4694`），在 `openContainer` **之前**插入判断：

```ts
const container = this.nearestContainer();
if (container) {
  // 100000 层：统治核心。三个容器是终局演出入口（docs/plans/FINALE_UX.md）。
  const visit = getGame().visitedFloors[getGame().currentFloor];
  const opened = visit?.openedContainers.includes(container.id) ?? false;
  const from =
    container.id === 'counter' ? 'terminal'
    : container.id === 'security_safe' ? 'archive'
    : container.id === 'fuse_box' ? 'fuse'
    : null;
  if (opened && from && getGame().currentFloor === 100000) {
    this.scene.start('Endgame', { from });
    return;
  }
  this.openContainer(container.id);
  return;
}
```

要求：

- 只在 `currentFloor === 100000` 生效（其它层的同名容器 id 不受影响——`counter` 在食堂类模板里也存在）。
- `from` 缺省视为 `'terminal'`，省略参数启动等价于 `{ from: 'terminal' }`。
- 不要 pause Game：本场景是 handoff 语义，`scene.start` 已经停掉 GameScene，终局结束由本场景负责 `scene.start('Game')`（AG-20 无需写任何回来的逻辑）。

### 2.4 关闭契约

场景在四种出口一律 `this.scene.start('Game')`：

- `archive` 读完三张表（或 Esc）；
- `fuse` 离开总闸（Esc，未拉闸）；
- `epilogue` 结算画面按 Enter；
- `settled`（终局已定）按 Esc。

`Game.create()` 对同一份模块级 GameState 重跑，落地过的 flag/分数/物品自然被读回——与 `TowerOverviewScene` 的 handoff 语义相同。**AG-20 不需要为 Endgame 写任何 resume/close 分支。**

## 3. 场景结构（AG-21 实现）

`src/scenes/EndgameScene.ts`，键位沿用 QuestPanel 的 ↑/↓/Enter/Esc + 每帧一次去抖（GHI-03 m9）。模式机：

```
prologue ──Enter──▶ choice ──Enter(可得分支)──▶ confirm ──Enter──▶ ending ──Enter──▶ epilogue ──Enter──▶ (start 'Game')
   │                   │                        ▲                     │
   │                   └──Enter(阻塞分支)──▶ 瞬态 blockers 消息        │（每个结局自己的演出画面 + 调子）
   │                                                                  │
archive ──读三张表──▶ (start 'Game')                    settled（终局已定后的任何入口：显示已选结局 + Esc 回塔）
fuse ──Enter 拉闸──▶ confirm(shutdown) ──Enter──▶ ending(shutdown)
```

- `prologue`：核心终端三幕独白（STORY.md §5 台词），第三幕点名三张表后进入 `choice`。
- `choice`：`evaluateAllQuests(state)` 取 `same-pen`，四个分支逐条呈现；**可得性完全来自 `evaluateBranch` 的真实条件**（`QuestCondition` 的 flagsAll/flagsNone/flagsAny/minFloor/items/passes），阻塞分支以 `BranchEvaluation.blockers`（中文，danger 色）置灰，Enter 打在阻塞行上把 blockers 拼成一行瞬态消息——与 QuestPanel 的拒绝语义一致，不存在「硬编码 throne 一定可选」。
- `confirm`：终局不可回头，多一层确认（分支 text + detail + 「Enter 确认，不可回头 · Esc 返回」）。
- `ending`：每个结局自己的收尾画面（见 §4），落地在此发生（见 §5）。
- `epilogue`：结算（结局名、路线映射、本结局得分、`records.bestScore`、最深楼层、存活天数），Enter 回塔楼。
- `settled`：任一 `story:ending.*` flag 已落时，任何入口都只显示「终局已定」+ 已选结局标题与一句收尾，不重复演出、不重复落地。

### 3.1 目标（objective）doneFlag 的写入

按 STORY.md §7「doneFlag 由集成层（玩法过程）写入」：

| objective | 写入时机 |
| --- | --- |
| `key`（钥匙在你手里） | 终端 prologue 第一幕 / fuse 总闸界面呈现时 |
| `pen`（三张表并排看） | prologue 第三幕点名三张表 / archive 读毕三张表 / fuse 界面文案列出三张表 |
| `door`（关上它或坐上它） | `choice` 呈现四分支 / fuse 拉闸提示 |

commit 时三者必齐（三条入口都写齐），`same-pen` 的 `done` flag 随之收口——与 GameScene 的 `quests:changed` handler 同一套生命周期旗。

## 4. 四结局演出（各自调子，STORY.md §5 + Q6 详卡）

每个结局是独立画面：自己的标题、自己的正文段落、自己的色调与节奏，**不是同一个界面换行字**。

| 结局 | 标题 | 调子 | 画面 |
| --- | --- | --- | --- |
| `shutdown` 关上它 | 「关上它」 | 决绝、黑 | 屏幕渐黑（tween 压暗），标题与文字在黑暗里亮起；「配电房的灯一颗颗灭掉。从一楼开始。」 |
| `hand-over` 证据交底层 | 「交回底层」 | 交付、托付 | 青（cloth 系）wash；文字一行行交出，「拿到笔的人换成了他们」 |
| `throne` 坐上它 | 「坐上它」 | 冰冷、加冕 | 金（light 系）wash；「椅子是空的，也是为你留的」「从明天起，停电表由你来签」 |
| `walk-away` 转身下楼 | 「转身下楼」 | 安静、虚无 | 石灰（stone 系）wash；「塔还是塔。你不再是你了。」 |

演出正文取自 `branch.detail` 与 STORY.md §5 的核心终端台词，逐行 fade-in（delayCall + sfx），末行后出现「Enter 继续」。epilogue 显示路线映射（GAME_DESIGN_LOCK §6）：shutdown→C/D、hand-over→C、throne→A/D、walk-away→B。

## 5. 后果落地（AG-21 自己完成，不需要 AG-20）

玩家确认后由 EndgameScene 按 `src/data/quests.ts` 的 `QuestConsequence` **逐类**落地（STORY.md §7 契约，与 GameScene 的 `quests:changed` handler 逐字同义，不发明新后果类型）：

| kind | 落地 |
| --- | --- |
| `setFlag` / `clearFlag` | `WorldFlags.setFlag` / `clearFlag` |
| `giveItem` / `takeItem` | `InventorySystem.addItem` / `removeItem` |
| `grantPass` | `player.homeUpgrades.push(pass)`（与 `craft()` 同一落点，不额外写 `upg:` flag） |
| `score` | `state.records.bestScore += delta`（records 缺省时创建） |

外加生命周期旗：`QUEST_FLAG.accepted`、`QUEST_FLAG.branch(questId, branchId)`、三目标齐后的 `QUEST_FLAG.done`，最后 `saveToStorage(state)`。幂等：`story:ending.*` 任一已落 → `settled`，不重复落地。

**与 QuestPanel 的边界**：玩家也可以从任务面板（QuestPanel）对 Q6 分支按 Enter——那时走既有 `quests:changed` 路径由 GameScene 落地（ending flag 直接落盘）。之后再进终端，Endgame 看到 ending flag → `settled` 显示历史结局。两条入口互斥且自洽，AG-20 无需特殊处理。

## 6. dev 句柄（Playwright / e2e）

`import.meta.env.DEV` 下挂在 `window.__PHASER_ENDGAME__`：

```ts
{
  getMode: () => EndgameMode;        // prologue/tables/switch/choice/confirm/ending/epilogue/settled
  getEntry: () => 'terminal' | 'archive' | 'fuse';
  getEnding: () => 'shutdown' | 'hand-over' | 'throne' | 'walk-away' | null; // 已确认的结局
  getSelection: () => number;        // choice 模式下的分支索引
  getMessage: () => string;          // 瞬态消息（阻塞原因等）
}
```

与 `__PHASER_QUESTS__` 同款：断言真实模式机与求值结果，不断言像素。

## 7. 验收口径

- `npx tsc --noEmit` 干净；`VITE_NPC_MODEL= npx vitest run` 全量通过（基线 1176，`src/tests/endgame.test.ts` 新增断言只增不减）。
- 每张演出画面 Playwright 实测（端口 5402+）：截图 + 关键文本 + `__PHASER_ENDGAME__` 读数。
- 四结局可得性断言：同一 state 下 `hand-over`/`throne` 的阻塞来自真实 flag 条件；`shutdown`/`walk-away` 无条件（任何人都有终局，STORY.md §6 的承诺）。

## 8. 实测记录（2026-11-15，dev server :5402，`?devfloor=100000&seed=42`）

驱动方式：Playwright（Chrome）起真局，从页面上下文调 `scene.start('Endgame', { from })`
——正是 §2 契约里 AG-20 将要发的那一发，因此同时验证了入口契约本身。每屏记录
`__PHASER_ENDGAME__` 读数 + 场景内真实 Text 对象 + `story:*` flag/分数落盘。

截图在 worktree 的 `.verify-shots/`（**未跟踪、未提交**，仅作证据）：

| # | 画面 | 模式 | 关键读数 |
| --- | --- | --- | --- |
| 01 | 终端独白 | prologue | 「权限已移交。」+ ▍ 光标位 |
| 02 | 四分支（裸 state） | choice | hand-over/throne 置灰，blockers 逐行印出；Enter 打阻塞行 → 瞬态消息「尚不知道「story:feast.has-evidence」」 |
| 03 | 单分支确认 | confirm | 分支 text + detail + 红色「终局不可回头」 |
| 04/05 | 交回底层演出（早/全） | ending | 逐行揭晓；全 4 行无重复（修掉 revealAll 重刷首行的缺陷后复测） |
| 06 | 终局结算 | epilogue | 结局=交回底层 · 路线 C · +100 · 纪录 100 · 第 1 层 · 1 天 |
| 07 | 终局已定 | settled | 显示历史结局 + 一句收尾，不重复落地 |
| 08 | 坐上它 | ending | 金调 wash + 5 行；`story:ending.throne` +100 |
| 09 | 关上它 | ending | 黑调 wash 渐黑 + 5 行；`story:ending.shutdown` +100 |
| 10 | 转身下楼 | ending | 石灰 wash + 4 行；`story:ending.walk-away` +50 |
| 11–13 | 档案柜三张表 | tables | 停电表/配给表/处决名单逐页；读毕写 `story:quest:same-pen:obj:pen` |
| 14 | 配电箱总闸 | switch | 总闸图形（把手压进底座）+ 四行文案；写 key/pen |
| 15 | 拉闸 → 关上它 | ending | `story:ending.shutdown` +100（物理动作点与终端路径同落地） |

终局落地全部经 `__PHASER_SESSION__` 核验：`story:quest:same-pen:accepted` /
`:branch:<id>` / `story:ending.*` / `:done` 五类旗 + `records.bestScore` 增量
（+100 / +100 / +100 / +50）逐一致。回塔楼后 Game scene 恢复 active，重进终端
走 settled，无黑屏。

实测中发现并修复的缺陷：演出文字 `revealLine` 不更新 `revealed` 计数器，
`revealAll`（Enter 提前揭完）会从第 0 行重刷，把第一行画两遍——已修为逐行
更新，05 号截图复测确认。

## 9. 没处理干净的地方

1. **GameScene 接线未合入**：本分支只写契约（§2）与场景；AG-20 的
   `onInteract()` 改动落地前，游戏内只能靠任务面板（quests:changed）或 dev
   句柄触发终局。入口契约已用 Playwright 以完全相同的方式验证过。
2. **`最深楼层` 在 dev 直达局里是「第 1 层」**：`?devfloor=` 不改
   `records.deepestFloor`（那是爬塔过程的记录），真实通关局显示的是 100000。
   非缺陷，记录在此免得误读。
3. **终局后不进 EndScene**：四个结局都以「回到塔楼」收束（§2.4），没有单独的
   通关死亡/胜利画面——STORY.md §6 的终局是选择不是结算，塔在结局后继续存在
   （玩家还能带着结局 flag 在塔里走）。若后续要「通关即结束 run」的语义，
   那是 GameScene/EndScene 属主的范围。
