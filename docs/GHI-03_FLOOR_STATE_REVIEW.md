# GHI-03 — 楼层生成与状态系统审查

- 任务：GHI-03（**只读审查**，未改任何业务代码 / 依赖 / 配置）
- 核验日期：2026-10-26
- 范围：楼层生成（`data/floorTemplates.ts`、`core/rng.ts`、`systems/FloorSystem.ts`）、状态与存档（`core/gameState.ts`、`core/session.ts`、`systems/SaveSystem.ts`、`core/gameTypes.ts`）、GameScene 对上述系统的消费面（`scenes/GameScene.ts`、`systems/LootSystem.ts`）
- 方法：3 个并行审查 agent 分头深挖 + 主会话对每条关键结论**独立复现**（临时探针已全部删除，`git status` 仅剩 GHI-01 的未跟踪文档）
- 结论标注：**[实证]** = 主会话跑代码复现；**[e2e]** = 浏览器实测；**[推理]** = 仅代码推理

---

## 1. 结论概览

| # | 严重度 | 位置 | 问题 |
|---|---|---|---|
| C1 | CRITICAL | `SaveSystem.ts:30-67` | 存档可不校验 `visitedFloors`/`worldEvents`/`player.x`，通过校验后白屏 |
| C2 | CRITICAL | `SaveSystem.ts:43` | `currentFloor` 不限定可玩范围，坏档直接抛错白屏 |
| M1 | MAJOR **已修** | `floorTemplates.ts:182`、`LootSystem.ts:19` | loot 键是索引型，改模板即静默破坏既有存档 |
| M2 | MAJOR **已修** | `floorTemplates.ts:152` | loot 数据版本未进 seed 派生，同 seed 世界静默改变 |
| M3 | MAJOR **已修** | `GameScene.ts:912-971` | 时钟与属性衰减从不落盘，可回退刷消耗 |
| M4 | MAJOR | `MenuScene.ts:94-96` | 坏档静默无提示，违反「坏档提示用户」门槛 |
| M5 | MAJOR **已修** | `GameScene.ts:882`、`LootSystem.ts:78-94` | leak 事件与地面物资视图不同步 |
| m1 | minor | `FloorSystem.ts:40-42` | `not-adjacent` 分支不可达（死代码） |
| m2 | minor | `floorTemplates.ts:156` | guaranteed spec 静默忽略 `max` |
| m3 | minor | `SaveSystem.ts:52` | 属性上限 0..100 硬编码，与 config 耦合 |
| m4 | minor | `gameState.ts` / `FloorSystem.ts:49-53` | `player.x` 缺失 → `NaN` 且永不恢复 |
| m5 | minor | `SaveSystem.ts:85` | `saveToStorage` 无配额保护 |
| m6 | minor | `LootSystem.ts:97` | `nearestContainerId` 是死代码 |
| m7 | minor | `constants.ts:7` | 可玩楼层列表三处重复（JSON / constants / FLOOR_TEMPLATES） |
| m8 | minor | `config.ts:46` | `GAME_CONFIG` 是无校验强转，`schemaVersion` 从未检查 |
| n1 | nit | `LootSystem.ts:33` | 容器 key 内联拼接与 helper 重复 |
| n2 | nit | `GameScene.ts:837` | `attemptSleep` 不刷新 `floorView`（v0.1 不可达） |
| n3 | nit | `gameTypes.ts:60,88` | `equipped` / `npcStates` 零消费方、零校验 |
| m9 | minor | `MenuScene.ts:53-55` 等 | 突发键盘投递不可靠：会丢键，也会把一次 ↓ 重复投递（详见 §5） |

**合规通过项**（同为审查结论）：`src/` 无 `Math.random()`；`Date.now()` 仅 3 处新 run 取种子且可被 `?seed=` 覆盖；seed key 与 spec §3 要求的 `worldSeed + floorNumber + containerId` 一致；`MAX_FRAME_MS = 250` 的单帧钳制存在**且被测到**（`survivalSystem.test.ts:40`）；交易原子性成立；`visitedFloors` 有界（只被 loot 路径懒创建，最多 5 层）。

---

## 2. CRITICAL — 存档校验不完整，坏档可白屏

### C1 缺字段存档通过校验，随后抛错

`validateGameState` 只校验 `schemaVersion`/`runSeed`/`day`/`gameMinuteOfDay`/`currentFloor`/`status`/`player.{hp,hunger,thirst,energy}`/`player.inventory`，**不校验** `visitedFloors`、`worldEvents`、`player.x`、`player.homeUpgrades`。

构造最小存档（其余全缺）：

```json
{ "schemaVersion": 1, "runSeed": 42, "day": 1, "gameMinuteOfDay": 360,
  "currentFloor": 100000, "status": "playing",
  "player": { "hp": 100, "hunger": 80, "thirst": 80, "energy": 80,
              "inventory": { "slotCount": 12, "slots": [] } } }
```

**[实证]** `validateGameState(...)` 返回 `[]`（判定合法），`deserialize` 返回 `ok: true`。
继续游戏 → `GameScene.create()` → `drawFloor()` → `getFloorView()` 抛：

```
TypeError: Cannot read properties of undefined (reading 'activeEvent')
```

该路径无 try/catch，`main.ts` 也没有 `window.onerror` 兜底 → 画布冻结即白屏。直接违反 CLAUDE.md「坏档提示用户，不能白屏」与 P0-01 验收「坏档有优雅错误路径」。

**修法**：`validateGameState` 补结构化校验（`visitedFloors`/`worldEvents` 为对象、`player.x` 为有限数、`homeUpgrades` 为字符串数组），或在 `deserialize` 成功分支对缺失字段做 normalize 补齐。

### C2 `currentFloor` 不限定在可玩范围

`SaveSystem.ts:43` 只校验「是整数」。**[实证]** `currentFloor: 5000` 通过校验，随后 `getFloorView` 抛：

```
Error: no floor template for floor 5000
```

同样白屏。`createNewGame`（`gameState.ts:46`）反而校验了起始楼层，说明这个约束是有意的，只是漏在存档侧。

**修法**：加 `PLAYABLE_FLOORS_V01.includes(s.currentFloor)`。

---

## 3. MAJOR

### M1 loot 键是索引型，改模板即破坏既有存档

`floorTemplates.ts:182` 的 ground key 是 `g:${i}`（位置索引），`LootSystem.ts:19` 的容器 key 是 `c:${containerId}:${index}`。键表示**位置**而非**身份**。

**[实证]** 存档里 `visitedFloors[99996].lootedItems = ['g:0']`（已捡走 bread）。在 99996 层 `ground` 数组**前插**一条 medkit 后重新生成：

```
before: g:0:bread
after:  g:0:medkit , g:1:bread
view:   g:1:bread        ← bread 复活
```

即：新物品永久捡不到（键被旧存档占用），旧物品复活。容器 loot 两条互换同理。

**修法**：key 改稳定身份，如 `g:${itemId}:${x}`。

### M2 loot 数据版本未进 seed 派生

`resolveLoot` 用 `deriveSeed(worldSeed, floorNumber, containerId)`，**不含数据/规格版本**。**[实证]** 同 seed 42、99998 层，把 `crate_wood` 概率 0.8 调成 0.5：

```
baseline: crate_wood:wood
tuned:    crate_wood:tape      ← 同 seed 世界静默改变
```

叠加 M1 即物品复制/丢失。`schemaVersion` 存在于 `GameState` 但没参与 seed 派生。

**修法**：`deriveSeed(LOOT_DATA_VERSION, worldSeed, floorNumber, containerId)`。

### M3 时钟与属性衰减从不落盘

`saveToStorage` 共 11 个调用点（`GameScene.ts:533/545/691/787/844/870/890/902/934/941`），**全部是离散动作**；`update()` 内只有 934/941 两条死亡/胜利路径。而连续时间推进 `advanceTime(state, delta)`（`:924`）改的是时钟、饥渴精力、HP，**完全不存**。

**[e2e]** 先开箱造出存档，再静立 4 秒：内存时钟 373→385、hunger 79.56→79.16，localStorage 仍是 minute 372 / hunger 79.6。

**后果**：站着 decay → 关标签页 → 继续游戏，时钟与消耗回退到最后一次动作的存档值，可反复利用刷掉消耗。巡游体扣血（`:994`）同理不落盘。

**修法**：`update()` 里节流存档，例如记录 `lastSaveMinute`，`Math.floor(gameMinuteOfDay)` 变化时 `saveToStorage(state)`（顺带覆盖 `:994`）。

### M4 坏档静默无提示

`hasSave()`（`SaveSystem.ts:99`）只判断 key 存在，菜单照显「继续游戏」；`tryContinue()` 对坏档返回 `null`；`MenuScene.ts:95-96` 是 `if (!state) return;` —— **[实证]** 用户按 Enter 毫无反应，看不到「存档损坏，无法继续」。违反 spec §6「遇到坏档：显示"存档损坏，无法继续"，保留新游戏入口」与 04_ACCEPTANCE C「损坏存档提示清楚并可开始新游戏」。

**修法**：`continueRun()` 取 `loadFromStorage()` 的错误信息，`flash()` 提示，并提供清除存档入口。

### M5 leak 事件与地面物资视图不同步

`this.floorView` 只在 create / 换层 / 开箱 / 拾取成功时重算（`GameScene.ts:142/871/888`），**事件变化时不重算**；且 `lootGround`（`LootSystem.ts:78-94`）读 `generateFloor` 原始数据、**无 leak 过滤**（不同于 `getFloorView:35`）。

**[实证]** 在 99998 注入 leak 后 `lootGround(state, 99998, 'g:1')` 仍返回 `{took: {itemId:'cloth',quantity:1}}` 并成功入包，而 `getFloorView(...).groundItems` 为 `[]`。**[e2e]** 游戏中走向地面棉布确实能捡起来，同时 HUD 提示「此地漏水，地面物资受潮」。

**镜像症状 [推理]**：leak 结束后（睡醒 `SurvivalSystem.ts:93` / 天数翻转 `:64`）物资继续消失，直到离开再回该层；leak 期间开箱会重算 view 却不清理 `groundObjs` 矩形（`openContainer` 只调 `setContainerEmptyVisual`），留下不可拾取的死图形。

**修法**：`update()` 记录 activeEvent 引用，变化时重算 `this.floorView` 并剪掉不在 view 里的 `groundObjs`；`lootGround` 内按当前层 leak 直接拒绝作兜底。

---

## 4. MINOR / NIT

- **m1** `FloorSystem.ts:40-42`：`to = from ± 1` 恒成立且 `:37` 已先返回，`not-adjacent` 联合成员是死代码。[推理] 建议删除。
- **m2** `floorTemplates.ts:156`：guaranteed 分支直接 `quantity: spec.min`，静默忽略 `max`。**[实证]** `{min:1,max:3,guaranteed:true}` 实际给 1。当前 5 层 `min===max` 无影响，但是个陷阱。建议改 `rng.nextInt(min,max)` 或断言相等。
- **m3** `SaveSystem.ts:52`：hp/hunger/thirst/energy 上限硬编码 `0..100`，而真实上限取自 `GAME_CONFIG.player.*Max`（`InventorySystem.ts:82-87`、`SurvivalSystem.ts:39-43`）。**[实证]** 今天 `hpMax === 100` 所以行为正确，但一旦调参（如 `hpMax: 150`），治疗/回复会把属性推到 150 而校验器拒收合法存档。`day` 也无上界。
- **m4** `player.x` 缺失时 `movePlayerX` 产出 `NaN` 且**永不恢复**（`Math.max(8, Math.min(1272, NaN))` = NaN），交互判定恒 false，`GameScene.ts:154` `add.sprite(NaN, …)`。**[实证]** 不崩但角色消失。
- **m5** `saveToStorage`（`SaveSystem.ts:85`）无 try/catch。**[实证]** 配额满时 `QuotaExceededError` 直接抛出，未被捕获。spec §6 要求保存时严格验证，这里连写盘失败都没有处理。
- **m6** `LootSystem.ts:97` `nearestContainerId` 全仓库**零调用方**（GameScene 有自己的 `nearestContainer()`，`:850`，判定完全一致）。[实证：grep 全库仅定义处一处] 建议删一个。
- **m7** 可玩楼层列表三处重复：`config/game-balance.json` `world.playableFloorsV01`、`constants.ts:7` `PLAYABLE_FLOORS_V01`（注释还声明以 JSON 为准）、`FLOOR_TEMPLATES` 的键。`gameState.ts:46` 用的是 constants 而非 config。现有 `config.test.ts:10` 把 JSON 和同一字面量互相断言，算一根绊线而非根治。
- **m8** `config.ts:46` `GAME_CONFIG = balance as unknown as GameBalanceConfig` 是无校验强转，`schemaVersion` 声明了却从不检查。JSON 字段拼错只会让 `createNewGame` 产出 `undefined` 属性。
- **n1** `LootSystem.ts:33` 内联拼 `c:${c.id}:${idx}`，与 `:19` 的 `containerKey` helper 重复。当前**安全**（两边索引都来自同一 `generateFloor` 输出，顺序长度一致，容器 id 每层唯一），但易漂移，建议提取。
- **n2** `GameScene.ts:837` `attemptSleep` 不刷新 `floorView`。v0.1 不可达（床在 100000，而 100000 永不是事件目标），属潜在坑。
- **n3** `gameTypes.ts:60` `equipped` 与 `:88` `npcStates` 在 `src/` 中**零消费方**，`equipped:'unobtainium'`、`npcStates:'garbage'` 均通过校验。[实证] 当前无害但是雷。

---

## 5. 键盘突发投递不可靠（含对审查分叉结论的一处修正）

### 5.1 分叉结论不成立

某分叉报告了一条 MAJOR：「键盘事件队列被重启场景二次处理，暂停菜单执行错误选项（ESC+↓+Enter 同一游戏步内，预期『重新开始』实际『返回标题』）」，并归因于 Phaser 在场景重启后重排同一键盘队列。

**该症状与机理均未复现，判定为不成立。** 主会话用 5 轮浏览器探针（合成 `KeyboardEvent`，已先验证合成事件确实驱动 Phaser）得到的是另一类规律。关键反证：`↓ + Enter` 在**完全不涉及场景重启**时，Enter 照样被丢，因此「场景重启导致队列重排」的机理被排除。**不建议**按该分叉建议的 pendingScene 方案改 `activatePause()`——治的不是这个病。

### 5.2 实测规律：突发投发既会丢键、也会重复投递

| 投递方式 | 实测结果 |
|---|---|
| 单个 JS 任务内只派 1 个键 | 正常生效 |
| 同一任务内派 N 个键 | **前 N-1 个生效，最后一个被丢** |
| `keyboard.press()` 背靠背（↓ 后立刻 Enter） | **一次 ↓ 被重复投递，选中项前进 2** —— 6/6 复现 |
| 每次按键间隔一帧（≥120ms） | 6/6 完全正常 |

「重复投递」这条是修复 C1/C2/M4 期间新测到的，比原先记录的「只丢最后一个键」更严重也更好复现：在标题屏（3 项菜单）按一次 ↓ 再立刻按 Enter，6/6 的情况下选中项从「继续游戏」跳到「操作说明」，Enter 于是打开帮助而不是读档。

**该行为是既有的**：把本轮全部源码改动 stash 掉、在未改动的 `1be6afa` 上跑同一探针，同样 5/6 出现重复投递。

### 5.3 为什么既有测试一直没发现

`e2e/ui.spec.ts` 的「title menu is keyboard-navigable」只按一次 ↓，而当时菜单**只有 2 项**（无存档），↓ 落在最后一项——重复投递被 `Phaser.Math.Clamp` 吃掉了，所以断言照样通过。一旦菜单有 3 项（有存档时），中间的「继续游戏」就会被跳过。

### 5.4 实际影响

- **真人几乎不可达**：需要两次按键落在同一帧（<16ms），人手做不到。
- **低帧率下可达**：切后台 / 慢机器单帧可达 200ms+，间隔 100ms 的两次按键会同帧，第二次被重复或丢弃。
- **主要价值是 e2e 编写警戒**：背靠背派发按键会静默改变语义。本轮新增的坏档测试就因此先红后绿，改为每键间隔 120ms 后 4/4 稳定。
- 若要彻底修，方向是给菜单输入加「同一帧内只接受一次导航」的去抖，而不是改场景启动时机。

---

## 6. 测试盲区

1. **`save.test.ts` 全部用例从 `createNewGame()` 派生** —— 只覆盖 round-trip + 4 个拒绝路径，**没有「最小合法存档」用例**，所以 C1/C2 这类字段缺失/越界从未被测到。
2. 没有覆盖「通过校验的状态必能被 `getFloorView` 消费」这条不变量（正是 C1/C2 的防线）。
3. 没有覆盖 `tryContinue()` → `continueRun()` 的坏档链路（需 DOM），即 M4。
4. 没有 ground key 稳定性测试（正是能抓 M1 的那条）。
5. 无概率分布 / `nextInt` 边界测试；guaranteed loot 只测了 99997/fuse_box 一个容器。
6. **整个 e2e 没有 localStorage 断言** —— 没有任何测试验证时钟与属性能跨刷新存活，正是 M3。
7. `gameplay.spec.ts` 未覆盖：上楼与边界层、暂停菜单的「重新开始/返回标题」、leak 事件、跨层 `visitedFloors` 累积（开箱/拾取由 `inventory.spec.ts` 补上，所以存档空洞比看起来窄）。

---

## 7. 建议修复顺序

1. **C1 + C2 + M4**（一次改动，同一处文件）：补全 `validateGameState` 结构化校验 + `currentFloor` 范围 + 坏档在菜单给提示。直接关掉「白屏」与「静默」两个验收违背，且可被单测覆盖。
2. **M3**：`update()` 内按游戏分钟节流存档。修掉时间回退利用。
3. **M5**：事件变化时重算 `floorView` 并清理 `groundObjs`；`lootGround` 加 leak 兜底。
4. **M1 + M2**：loot key 改稳定身份 + seed 派生加数据版本。改模板前必须先做，否则一改就静默污染存档。
5. m1–m8 / n1–n3 随带清理。

> 建议 1–3 各自配一个失败测试先行（本项目已有 98 单测 + 24 e2e 的回归网，TDD 成本很低）。

---

## 8. 修复进度与测试状态

**2026-10-26 当日追加：§7 建议 1（C1 + C2 + M4）已按 TDD 实现。**

改动文件：
- `src/systems/SaveSystem.ts` —— `validateGameState` 补全结构校验：`visitedFloors`（含每条 `FloorVisit` 的 4 个字符串数组）、`worldEvents.history`/`activeEvent`（type/message/floor）、`npcStates`、`player.x`（有限数）、`player.equipped`（`isItemId`）、`player.homeUpgrades`（字符串数组）；`currentFloor` 限定到 `PLAYABLE_FLOORS_V01`。新增 `isRecord` / `isStringArray` / `validateVisit` / `validateActiveEvent` 辅助函数。
- `src/core/session.ts` —— `tryContinue(storage?)` 改为返回 `{ok:true,state} | {ok:false,error}`，把「为什么不能用」交出去（storage 参数与 SaveSystem 既有约定一致）。
- `src/scenes/MenuScene.ts` —— `continueRun()` 失败时 `showMessage()` 显示存档错误（3.2s 自动消失，移动/激活即清除），不再静默 return。
- `src/tests/save.test.ts` —— 新增 19 条单测：完整样板存档被接受（防误杀）、各字段缺失/越界被拒、每个可玩楼层都 accepted、**「通过校验的存档必能被 `getFloorView` 消费」这条不变量**、`tryContinue` 的三种返回。
- `e2e/ui.spec.ts` —— 新增「a corrupt save is reported instead of silently doing nothing」。

测试状态（全部实跑）：`npm run typecheck` 无错误；`npm test` **117 passed**（98 → 117）；`npx playwright test` **25 passed**。

**仍未修**：m1–m8、n1–n3、§5 的键盘突发投递，以及 §8.3 记录的一次性存档迁移后果（是否 bump `SCHEMA_VERSION` 待定）。

> 本轮实测中另发现一处**既有的**输入问题并记入 §5：背靠背派发按键时一次 ↓ 会被重复投递（6/6 复现，stash 掉本轮改动后在 `1be6afa` 上同样复现）。为此新增的坏档 e2e 每键之间须间隔 ≥120ms。

### 8.1 追加修复：M3（时钟与衰减落盘）

2026-10-26 当日按 TDD 完成 §7 建议 2。改动：
- `src/systems/SurvivalSystem.ts` —— 新增 `AUTOSAVE_EVERY_GAME_MINUTES = 5` 与纯函数 `absoluteMinute(state)`（`day * 1440 + floor(minute)`，跨天单调，避免午夜翻转被误判成「时间没走」而跳过存档）。
- `src/scenes/GameScene.ts` —— `update()` 里按游戏分钟节流存档；`lastSavedAbsoluteMinute` 字段在 `create()` 中重置（Phaser 不重跑字段初始化器，否则「重新开始」会继承上一轮的值，让新局的时钟看起来没动）。
- `src/tests/survivalSystem.test.ts` —— 4 条单测覆盖 `absoluteMinute` 的单调性/取整/跨天。
- `e2e/survival.spec.ts` —— 新增「standing still persists the clock and decay into the save」：完全无输入，等时钟走过 10 游戏分钟后，localStorage 里必须存在存档、且其 `gameMinuteOfDay`/`thirst` 与实时状态相差不超过一个节流间隔（修复前 `saved` 为 `null`）。

**为什么是 5 游戏分钟而不是文档原先建议的「每个整分钟」**：时钟是 `gameMinutesPerRealSecond = 3`，按整分钟存等于每秒写 3 次。5 游戏分钟 ≈ 1.7 秒真实时间、约 0.6 次写入/秒，最坏回退量（5 游戏分钟 ≈ 饥饿 -0.5 / 口渴 -0.75）小到无法利用。

**残留（未修）**：巡游体扣血（`GameScene.ts:1004` 附近）发生在两次节流存档之间，若在受伤后立刻关标签页，这 8 点 HP 损失不会落盘。死亡路径本身仍会存档，所以只影响这一种极窄的中间态。

### 8.2 追加修复：M5（leak 与地面物资视图不同步）

2026-10-26 当日按 TDD 完成 §7 建议 3。两处改动，各治一半：

- **`src/systems/LootSystem.ts`** —— `lootGround()` 原先读 `generateFloor()` 的原始布局，绕过了 `getFloorView()` 的 leak 过滤，于是 HUD 写着「地面物资受潮」而物品照样进包。改为**直接读 view**（`getFloorView(state, floor).groundItems`），从根上消掉这份重复的过滤逻辑——以后 view 加任何新规则，拾取自动跟随。
- **`src/scenes/GameScene.ts`** —— `floorView` 原先只在进层 / 开箱 / 拾取成功时重算，玩家站在原地时事件开始或结束都不会刷新。现在 `update()` 里比对 `worldEvents.activeEvent` 引用，变化时重算 view 并 `rebuildGround()`（销毁旧矩形、从 `floorObjects` 摘掉、按新 view 重建）。这同时修掉两个镜像症状：leak 结束后物资不再「继续消失」，leak 期间开箱也不会留下不可拾取的死图形。`lastActiveEvent` 同样在 `create()` 里重置。

测试：
- `src/tests/lootSystem.test.ts` —— 3 条：漏水时拒绝拾取、leak 清除后可以拾取、别的楼层漏水不影响本层。
- `e2e/survival.spec.ts` —— 「a leak spoils the floor's ground supplies and they recover when it clears」：传送到 99998（唯一有地面物资的层），注入 leak → 站在 battery 上捡不到；清除 leak → 不用离开楼层就能捡到。修复前第一条断言即红（battery 被捡走）。

回归：`npm run typecheck` 无错误；`npm test` **124 passed**（121→124）；`npx playwright test` **27 passed**（26→27）。

### 8.3 追加修复：M1 + M2（loot 键稳定身份 + seed 数据版本）

2026-10-26 当日按 TDD 完成 §7 建议 4。这两条是**改 loot 配置前必须先做**的。

**M1 —— 键改为身份型**
- `src/data/floorTemplates.ts` 新增并导出两个键构造函数：`groundItemKey(itemId, x)` → `g:${itemId}:${x}`，`containerItemKey(containerId, itemId)` → `c:${containerId}:${itemId}`。原先 ground 用 `g:${i}`、容器用 `c:${containerId}:${index}`（index 还是**解析后**数组的下标，概率一改就漂移）。
- `generateFloor()` 用 `groundItemKey` 生成 ground key；`LootSystem` 的 `getFloorView()` 与 `lootContainer()` 都用 `containerItemKey`，并删掉原先内联拼字符串的 `containerKey` helper（顺带消掉 n1  nit 指的重复）。
- 键方案依赖一个不变量：**同一容器内同一 itemId 只出现一条、同一层同一 (itemId, x) 只出现一条**。已加两条单测把这个不变量钉住，将来加数据时若违反会立刻红。

**M2 —— seed 派生折叠数据版本**
- `LOOT_DATA_VERSION = 1` + `containerLootSeed(worldSeed, floorNumber, containerId)` = `deriveSeed(LOOT_DATA_VERSION, worldSeed, floorNumber, containerId)`，`resolveLoot()` 改走它。世界的身份从此是 `(LOOT_DATA_VERSION, runSeed)` 而非 `runSeed`  alone；调 loot 表时 bump 这个常量，改动会显式出现在 diff 里，而不是静默换掉一个已有世界。
- 注意这是**手动**版本号，忘了 bump 就退回 M2 的静默状态。若要免维护，可改为对 loot 表做内容哈希（`deriveSeed(hash(JSON.stringify(loot specs)), ...)`），本次未做。

**一次性迁移后果（重要，未处理）**：键格式与 seed 派生同时变了，因此**本次提交之前产生的存档会失效**——旧格式的 `lootedItems` 键（`g:0`、`c:crate_wood:0`）匹配不上新键，已搜刮的物资会重新出现，且容器内容按新种子重滚。项目尚未发布、无真实玩家存档，故按可接受处理。若要干净拒绝而非静默错乱，应把 `SCHEMA_VERSION` 提到 2——坏档会走 C1/M4 修好的提示路径（「存档损坏，无法继续」+ 保留新游戏入口）。**这一条留给你决定。**

测试（`src/tests/floorTemplates.test.ts` + `src/tests/lootSystem.test.ts`，共 12 条新增）：
- 键构造函数本身；`generateFloor(42, 99996)` 的 ground key 为 `g:bread:160`；往 99996 层 ground 前插一条后键变为 `['g:medkit:200', 'g:bread:160']`（bread 的键不变）。
- **行为不变量**：存档里标记 `c:crate_metal:scrap_metal` 已拿 → 往 crate_metal 的 loot 前插一条 wood 后，scrap_metal 仍然不在 view 里、wood 照常可拿（旧代码下 scrap_metal 会复活、wood 会永久捡不到）。
- ground 同理：标记 `g:bread:160` 已拿 → 前插 medkit 后 view 只剩 `g:medkit:200`。
- `lootContainer` / `lootGround` 记录的是身份键。
- `containerLootSeed` 折叠了版本（`≠ deriveSeed(42, ...)`）且对同输入稳定。

回归：`npm run typecheck` 无错误；`npm test` **136 passed**（124→136）；`npx playwright test` **27 passed**。
