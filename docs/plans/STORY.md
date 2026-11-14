# 首章剧情与任务链（STORY）

- 负责：AG-10（剧情与任务设计）
- 日期：2026-11-15
- 数据源：`src/data/quests.ts`（本文件与它是同一份设计的两个视图；测试见 `src/tests/quests.test.ts`）
- 权威依据：`docs/18_TIER_PROGRESSION.md`（六阶层 / 五可玩段 / 六故事节点 / 凭证链 / 18 条纸条）、`docs/GAME_DESIGN_LOCK.md`（设计锁定，未改动）

---

## 1. 主线与首章定位

> 塔里没有灾难，只有管理。每上一层，你离「谁在管」更近一步。到顶层你会发现：停电、配给、巡逻队、生物兵器，是同一套东西的四张面孔。

首章把这句话拆成玩家**亲手做过的六个选择**：

| 阶层 | 玩家学到的事 | 付出的代价 |
|---|---|---|
| 1 底层贫民区 | 停电不是事故，是按表执行的配给 | 公开它，或者把它变成筹码 |
| 2 工人宿舍区 | 保安队不是防你，是防你上去 | 一块工牌：仿的、换的、偷的 |
| 3 工业与交易区 | 军队防的不是人 | 一张通行贴：接的、买的、混的 |
| 4 中产与商业区 | 实验室在造生物兵器，第一批是「志愿者」 | 一张许可证：买的、签的、逼的 |
| 5 富人特权区 | 富人不只知道，他们买单 | 一张贵宾卡：钱、人情、后门 |
| 6 统治核心 | 你就是下一批志愿者 | 终局四选一 |

设计原则（从 18 号文件继承并具体化）：

1. **向上的动力不是打赢谁，而是拿到下一张凭证。** 每条段际主线任务的每个分支都发放该段准入凭证（`validateQuests` 强制：漏发一个分支 = 数据错误），这是「无软锁」的数据层保证（`GAME_DESIGN_LOCK.md` §5）。
2. **每条分支都是一次记账。** 分支不只要「给东西」，要写一个别的任务读得到的 flag。Q1 选 `keep` 的人才能在 Q2 走交易路；Q1 选 `expose` 的人才能在 Q3 摸换班空档；Q4 签过字的人才有椅子坐；SQ1 掺着卖过脏水的人，顶层递不出证据。
3. **纸条是证据，不是设定集。** 18 条纸条（每阶层 3 条）全部被任务链引用为「目标证据」：任务在段际货梯口把上一段的传闻摆给你，你在目标段的地层上读到同一句话——先有人提醒，再被现场证实。

---

## 2. 任务链总览

段际主线任务在**前一段顶层的货梯口**触发（`anchorFloor` = 前一段顶层），守的是下一段。段内任务/终局锚在自己段里。

| # | 任务 id | 标题 | 阶层/段 | 触发 | 前置 | 分支（每条发放本段凭证） | 主要后果 |
|---|---|---|---|---|---|---|---|
| 1 | `blackout-schedule` | 周三与周五 | 1（1–10） | 到达 2 层 | — | `expose` 公开停电表 / `keep` 留着签字页 | `slum.knows-schedule` / `slum.holds-evidence` |
| 2 | `work-badge` | 工牌与脸 | 2（100–110） | 到达 10 层 | Q1 | `forge` 仿制（废金属1+布料1+胶带1）/ `trade-evidence` 签字页换真工牌（需 `slum.holds-evidence`）/ `pry-wall` 撬棍撬墙上那块 | `work_badge` + `badge.forged` / `badge.traded-with-foreman` / `badge.pried-off-wall` |
| 3 | `pass-sticker` | 通行贴 | 3（1000–1010） | 到达 110 层 | Q2 | `short-circuit` 短接（电线2+胶带1+电池1）/ `bribe-guard` 两块电池打点 / `slipped-shift` 照停电表摸换班空档（需 `slum.knows-schedule`） | `pass_sticker` + `sticker.*` |
| 4 | `permit` | 许可证 | 4（10000–10010） | 到达 1010 层 | Q3 | `buy-identity` 黑市买身份（电池2+滤芯1+布料1）/ `sign-up` 签志愿者名单（需读过名单+「为了所有人」）/ `blackmail-gate` 攥名单要挟（需名单+箱子记录） | `permit` + `permit.bought-identity` / `permit.volunteered` / `permit.blackmailed-gate` |
| 5 | `vip-card` | 贵宾卡 | 5（50000–50010） | 到达 10010 层 | Q4 | `bought-in` 体面+礼物（废金属1+布料2+电池1）/ `handler-invite` 监护人的请柬（需 `permit.volunteered`）/ `back-door` 被要挟出来的后门（需 `permit.blackmailed-gate`） | `vip_card` + `vip.*` |
| 6 | `same-pen` | 同一支笔 | 6（100000） | 到达 100000 层 | Q5 | `shutdown` 关上它 / `hand-over` 证据交底层（需 `feast.has-evidence` 且**非** `tap.exploited-outlet`）/ `throne` 坐上它（需 `permit.volunteered` 或 `vip.handler-invite`）/ `walk-away` 转身下楼 | `ending.*` |
| 支1 | `tap-water` | 净水口 | 1（1–10） | 到达 3 层 | — | `warn` 告诉邻居并修接水箱 / `exploit` 掺着卖脏水 | `tap.warned-neighbors`（+净水×2）/ `tap.exploited-outlet`（+脏水×2） |
| 支2 | `feast-ledger` | 盛宴之夜 | 5（50000–50010） | 到达 50000 层且 Q5 完成 | Q5 | `record` 电池续电录账本 / `decline` 不录 | `feast.has-evidence` / `feast.no-evidence` |

**选择网（后果如何跨任务流动）：**

```
Q1 expose ──► slum.knows-schedule ──► Q3 slipped-shift（唯一不花材料的通行贴路线）
Q1 keep ────► slum.holds-evidence ──► Q2 trade-evidence（唯一不花材料的工牌路线）
Q2 三个分支 ► badge.*（记录用；pry-wall 建议由遭遇系统加查脸，见 §7）
Q4 sign-up ► permit.volunteered ──► Q5 handler-invite ──► Q6 throne
Q4 blackmail ► permit.blackmailed-gate ──► Q5 back-door
SQ1 exploit ► tap.exploited-outlet ──✗► Q6 hand-over（底层不信你）
SQ2 record ► feast.has-evidence ──► Q6 hand-over
```

---

## 3. 逐任务详卡

### Q1 `blackout-schedule`「周三与周五」（段 1，发布者：阿林）

- **触发**：`currentFloor ≥ 2`（阿林在 2 层，见 `src/data/npcs.ts`）。
- **目标**：① 抄 4 层配电房的停电表（纸条 T1-1「停电表贴在配电房。周三、周五。有人签字。」）；② 记住「水要烧开。别信楼下的净水口。」（T1-2，同时是 SQ1 的钩子）；③ 看 5 层食堂墙上被划掉的名字（T1-3「第七批人走了一半」——为 Q2 的「招工」埋伏笔）。
- **分支**：
  - `expose` 抄在食堂墙上 → `slum.knows-schedule` + 25 分。代价：签字页没了，Q2 的交易路关闭。
  - `keep` 留着签字页 → `slum.holds-evidence` + 25 分。代价：底层仍蒙在鼓里，Q3 的换班空档关闭。
- **后果性质**：本任务没有「错」选项，只有**不同的筹码**。两条 flag 在 Q2/Q3 各自兑换一条免材料路线。

### SQ1 `tap-water`「净水口」（段 1，发布者：阿林）

- **触发**：`currentFloor ≥ 3`。**目标**：从 3 层净水口接一瓶水（纸条 T1-2 即墙上的警告）。
- **分支**：`warn`（告诉小周和邻居，阿林把净水口改接维修层水箱）→ `tap.warned-neighbors` + 净水×2；`exploit`（不声张，接满脏水掺着卖）→ `tap.exploited-outlet` + 脏水×2。
- **设计意图**：这是全链最早的一次「品行记账」，惩罚不在当下，在 Q6——`hand-over` 明确要求 `flagsNone: [tap.exploited-outlet]`。底层人民记得你卖过他们的水。

### Q2 `work-badge`「工牌与脸」（段 2，发布者：招工员）

- **触发**：`currentFloor ≥ 10`，前置 Q1 完成。**目标**：三条纸条全部来自阶层 2（T2-1 墙上工牌 / T2-2 保安认脸 / T2-3 工头收消息）。
- **分支**：
  - `forge` 仿制（材料与 `recipes.work_badge` 成本一致）→ `work_badge` + `badge.forged`。
  - `trade-evidence` 把 Q1 的签字页交给工头 → `work_badge` + `badge.traded-with-foreman`，**清除** `slum.holds-evidence`。
  - `pry-wall` 撬棍撬下墙上那块 → `work_badge` + `badge.pried-off-wall`。
- **后果性质**：三条路都发凭证（无软锁），差别在**谁记住了你**：工头见过签字页上的名字（`badge.traded`）、保安明天起挨个核对脸（`badge.pried`）、仿的终究是仿的（`badge.forged`）。这些 flag 给终局路线与遭遇系统读（§7）。

### Q3 `pass-sticker`「通行贴」（段 3，发布者：黑市贩子）

- **触发**：`currentFloor ≥ 110`，前置 Q2 完成。**目标**：阶层 3 三条纸条（T3-1 三号货梯 / T3-2 军队守向上的门 / T3-3 管道里的声音）——以贩子口述的「楼上的传闻」形式出现。
- **分支**：`short-circuit`（电线2+胶带1+电池1，同 `recipes.pass_sticker`）/ `bribe-guard`（电池×2，对应 18 号文件物品表「电池→贿赂保安」）/ `slipped-shift`（需 `slum.knows-schedule`，不花材料）。
- **后果性质**：Q1 的 `expose` 在此处兑现为「知识也是资本」。选 `keep` 的玩家不是被惩罚，只是少一条路——他们早在 Q2 就把签字页用掉了。

### Q4 `permit`「许可证」（段 4，发布者：实验室文员）

- **触发**：`currentFloor ≥ 1010`，前置 Q3 完成。**目标**：阶层 4 三条纸条（T4-1 志愿者名单 / T4-2 不写内容的箱子 / T4-3「为了所有人」）。目标完成写 `quest:permit:obj:<id>` flag，分支门控在它们上面。
- **分支**：
  - `buy-identity`（电池2+滤芯1+布料1，同 `recipes.permit`）→ `permit.bought-identity`。
  - `sign-up`（需完成「名单」+「为了所有人」两个目标）→ `permit.volunteered`。**你签的是自己的名字。**
  - `blackmail-gate`（需「名单」+「箱子」）→ `permit.blackmailed-gate`。
- **后果性质**：本任务是全链的**人品分水岭**。`permit.volunteered` 是 Q6 `throne` 的钥匙之一（系统早就把你算进去了）；`permit.blackmailed-gate` 是 Q5 后门的钥匙；`permit.bought-identity` 是唯一「干净但无味」的路。

### Q5 `vip-card`「贵宾卡」（段 5，发布者：宴席侍者）

- **触发**：`currentFloor ≥ 10010`，前置 Q4 完成。**目标**：阶层 5 三条纸条（T5-1 楼上养着它 / T5-2 花钱买通行 / T5-3 盛宴那天的安静）。
- **分支**：`bought-in`（废金属1+布料2+电池1，同 `recipes.vip_card`）/ `handler-invite`（需 `permit.volunteered`——「你是我们的志愿者」，请柬烫金）/ `back-door`（需 `permit.blackmailed-gate`）。
- **后果性质**：三种「体面」——买的、给的、逼来的。富人区不问你从哪来，只要你付得起的时候。

### SQ2 `feast-ledger`「盛宴之夜」（段 5，发布者：宴席侍者）

- **触发**：`currentFloor ≥ 50000` 且 Q5 完成（`flagsAll: [quest:vip-card:done]`）。**目标**：混进盛宴；找到账本。
- **分支**：`record`（需电池×1 给录音笔续电）→ `feast.has-evidence` + 50 分；`decline` → `feast.no-evidence`。
- **后果性质**：全链唯一「只为终局存在」的任务。没有它，Q6 的 `hand-over` 永远锁着——但 `shutdown`/`walk-away`/`throne` 不受影响，终局永不软锁。

### Q6 `same-pen`「同一支笔」（段 6，发布者：核心终端）

- **触发**：`currentFloor ≥ 100000`，前置 Q5 完成。**目标**：阶层 6 三条纸条（T6-1 钥匙在你手里 / T6-2 同一支笔 / T6-3 关上它或坐上它）。
- **分支**（对应 `GAME_DESIGN_LOCK.md` §6 四条终局路线的入口 flag）：

| 分支 | 条件 | 写的 ending flag | 路线映射 |
|---|---|---|---|
| `shutdown` 关上它 | 无条件 | `ending.shutdown` | C/D：掀桌子，塔黑掉 |
| `hand-over` 证据交底层 | `feast.has-evidence` 且非 `tap.exploited-outlet` | `ending.hand-over` | C：底层起义的物质基础 |
| `throne` 坐上它 | `permit.volunteered` 或 `vip.handler-invite` | `ending.throne` | A/D：你本就是系统的一部分 |
| `walk-away` 转身下楼 | 无条件 | `ending.walk-away` | B：独立者不坐这把椅子 |

- **后果性质**：终局不是四个按钮，是六个阶层攒出来的账。`throne` 只给在 Q4 签过字或拿过监护人请柬的人；`hand-over` 只给录了账且没卖过脏水的人。两个无条件分支保证任何人都有终局。

---

## 4. 纸条咬合核对（18/18）

核对方法：`NOTE_TEXTS_BY_TIER`（`src/systems/encounters.ts:292`，未改动）每阶层 3 条，逐条找任务链引用点。测试 `quests.test.ts` 的「references all 18 tier notes」把这张表钉死。

| 纸条 | 引用任务 / 目标 | 呈现方式 | 状态 |
|---|---|---|---|
| T1-1 停电表贴在配电房。周三、周五。有人签字。 | Q1 obj `schedule` | 4 层配电房现场读到；分支 `keep` 把签字页变成 Q2 的筹码 | 咬合 |
| T1-2 水要烧开。别信楼下的净水口。 | Q1 obj `boil-water` + SQ1 obj `sample` | 墙上警告 → SQ1 的怀疑对象 | 咬合（两任务共用） |
| T1-3 第七批人走了一半。名字划在食堂墙上。 | Q1 obj `names` | 5 层食堂墙；为 Q2「招工」与 Q4「志愿者名单」埋伏笔 | 咬合 |
| T2-1 工牌要交回。别问为什么。——上一块还挂在墙上 | Q2 obj `return` | 招工员口述 + 100 层现场；`pry-wall` 分支的直接对象 | 咬合 |
| T2-2 三号楼梯口的保安认得脸。换个班次走。 | Q2 obj `face` | 招工员口述；三条分支都在回答「怎么过这张脸」 | 咬合 |
| T2-3 工头收饭票，也收消息。 | Q2 obj `foreman` | `trade-evidence` 的交易规则 | 咬合 |
| T3-1 三号货梯别开。里面有东西在撞门。 | Q3 obj `cargo-lift` | 黑市贩子口述；1000 层现场证实（与 Q4 的箱子是同一批货） | 咬合 |
| T3-2 军队不是来救人的。他们守的是往上的门。 | Q3 obj `army-gate` | 贩子口述；`short-circuit`/`slipped-shift` 都是绕过「门」而非打败军队 | 咬合 |
| T3-3 管道里有声音。不像是水。 | Q3 obj `pipes` | `slipped-shift` 的路径描写（贴着管道的声摸上去） | 咬合 |
| T4-1 志愿者名单上有我弟弟。他签的时候以为是招工。 | Q4 obj `volunteer-list` | 1010 层门禁室；`sign-up` 分支的镜像（你知道自己签的是什么） | 咬合 |
| T4-2 实验室送出来的箱子，从来不写里面是什么。 | Q4 obj `unmarked-boxes` | `blackmail-gate` 的筹码；与 T3-1 的货梯对得上 | 咬合 |
| T4-3 他们说这是为了所有人。我不信，但我不敢说。 | Q4 obj `for-everyone` | 文员的原话；`sign-up` 的解锁条件之一 | 咬合 |
| T5-1 他们在楼上养着它，像养一条看门狗。 | Q5 obj `pet` | 楼上来的人口述；为段 5 的 boss（守段者）提供叙事 | 咬合 |
| T5-2 花钱能买到通行。买不到下楼的理由。 | Q5 obj `money` | `bought-in` 分支的注脚 | 咬合 |
| T5-3 盛宴那天，整个塔都安静得不对。 | Q5 obj `banquet` + SQ2 引子 | Q5 记住日子 → SQ2 当晚行动 | 咬合（两任务共用） |
| T6-1 钥匙在你手里。现在你也是这套系统的一部分。 | Q6 obj `key` | 终端交付权限；`throne` 的台词 | 咬合 |
| T6-2 停电表、配给表、处决名单，是同一支笔写的。 | Q6 obj `pen` | 三张表并排看；Q1 的签字页是这套证据链的起点 | 咬合 |
| T6-3 你要么关上它，要么坐上它。 | Q6 obj `door` | `shutdown` / `throne` 两个分支 | 咬合 |

**核对结论：18/18 全部咬合，无孤立纸条，无冲突。** 唯一需要说明的呈现口径：T2–T5 的纸条在游戏里由「段际发布者口述 + 目标段现场」两段呈现——任务触发时玩家在前一段顶层，还读不到目标阶层的纸条；这正是设计意图（先有人提醒，再被现场证实），不是遗漏。

---

## 5. NPC 对话稿（内容规格，本轮不改 `src/data/npcs.ts`）

现有两位（`npcs.ts`）按 questStatus 增加选项树挂点；新发布者为内容规格，供后续 NPC/对话系统落地。

### 阿林（alin，维修工，2 层，ALLY）

- **常态问候**（现有两条不变）。
- **Q1 可接时**新增选项：「你来得正好。走廊停电固定周三、周五，像值班表一样准。去 4 层配电房帮我抄张表？」→ 接 `blackout-schedule`。
- **Q1 进行中**：「表抄到了吗？……有人签字？先别声张。」
- **Q1 完成后**（按分支）：`expose`「食堂墙上那张表……是我漏的口风，但我不后悔。」/ `keep`「签字页收好。楼上的人收消息，出得起价。」
- **SQ1 挂点**：「3 层那个净水口，我越看越不对。接一瓶试试，回来告诉我颜色。」

### 小周（xiaozhou，邻居，2 层，NEUTRAL）

- **Q1 分支 `expose` 后**新增问候：「食堂墙上那张表……是真的？周三周五从来不亮灯，原来是有人排的班。」（为 `slum.knows-schedule` 提供民间回声）
- **SQ1 分支 `warn` 后**：「水的事谢了。以后你的脏水我照收，价钱好说。」

### 招工员（recruiter，10 层货梯口，新 NPC，NEUTRAL）

- 「100 层？电梯认这个。」（亮出读头）「脸它记不住。它认牌子。」
- 选项树：`forge`「我这儿有块仿的图纸，阿林那儿搞得到料。」/ `trade-evidence`（仅 `slum.holds-evidence`）「你这张纸……给我看看。……明天这时候来，我给你块真的。」/ `pry-wall`「墙上那块？它主人没来取。夜里自己去拿，别让人瞧见。」

### 黑市贩子（blackmarket，110 层，新 NPC，NEUTRAL）

- 「通行贴，三百块电池——开个玩笑，两块。军队的把守，明码标价。」
- `slipped-shift`（仅 `slum.knows-schedule`）「你连停电表都摸过？……按那个钟点走，三号货梯的换班你随便进。这张贴当我送的。」

### 实验室文员（lab_clerk，1010 层门禁室，新 NPC，ALLY→视分支）

- 「许可证三种拿法。买的、签的、……」（压低声音）「攥着什么的。」
- `sign-up`「签这里。他签的时候以为是招工——你知道自己签的是什么，对吧？」/ `blackmail-gate`「……名单我找。箱子的事我也知道。你给我许可，我把这两样都咽回去。」

### 宴席侍者（banquet_staff，10010 层 / 50000 层，新 NPC，NEUTRAL）

- 「贵宾卡只认体面。不过……」（打量）「有些人不刷卡也进来，您是哪一种？」
- `handler-invite`「实验室的监护人让我给您送请柬。他说，您是『我们的志愿者』。」/ `back-door`「后门在这边。……您来过的，我记得。不敢拦。」
- SQ2：「盛宴那天的账本……您只是来吃东西，还是想带走点什么？带走它，得有一块还够电的电池。」

### 核心终端（core_terminal，100000 层，新 NPC，SYSTEM）

- 「权限已移交。停电表、配给表、处决名单，同一支笔。钥匙在你手里——现在你也是这套系统的一部分。」
- 四个分支各一句（见 Q6 详卡）。`throne` 仅对签过字/拿过请柬者出现；`hand-over` 仅对录了账且未卖脏水者出现。

---

## 6. Flag 清单（全部经 `WorldFlags.flagKey`，无第二套命名空间）

| Flag | 写入方 | 读取方 |
|---|---|---|
| `story:quest:<id>:accepted` / `:done` / `:branch:<b>` / `:obj:<o>` | 集成层（接取/完成/分支/目标） | `questStatus`、分支门控、UI |
| `once:quest-reward:<id>` | 集成层结算奖励时 | 防重复发奖（语义同 `dailyGoals` 的 `goal-paid`） |
| `story:slum.knows-schedule` | Q1 `expose` | Q3 `slipped-shift`；小周回声 |
| `story:slum.holds-evidence` | Q1 `keep` | Q2 `trade-evidence`（用完即清） |
| `story:tap.warned-neighbors` / `tap.exploited-outlet` | SQ1 | Q6 `hand-over`（后者为 `flagsNone`） |
| `story:badge.forged` / `badge.traded-with-foreman` / `badge.pried-off-wall` | Q2 三分支 | 终局画像；建议遭遇系统（§7） |
| `story:sticker.short-circuited` / `sticker.bribed-guard` / `sticker.slipped-shift` | Q3 三分支 | 终局画像 |
| `story:permit.bought-identity` / `permit.volunteered` / `permit.blackmailed-gate` | Q4 三分支 | Q5 `handler-invite`/`back-door`；Q6 `throne` |
| `story:vip.bought-in` / `vip.handler-invite` / `vip.back-door` | Q5 三分支 | 终局画像 |
| `story:feast.has-evidence` / `feast.no-evidence` | SQ2 | Q6 `hand-over` |
| `story:ending.shutdown` / `ending.throne` / `ending.hand-over` / `ending.walk-away` | Q6 | 终局系统（路线 A/B/C/D 的入口，`GAME_DESIGN_LOCK.md` §6） |

规则：任务链只写 `story:` 与 `once:` 两个既有命名空间；凭证不进 flag（沿用 `player.homeUpgrades`，与 `CraftingSystem.craft()` 同一落点）；遭遇/容器/升级 flag 仍归各自系统。

---

## 7. 集成接口契约（需要其它 Agent 配合的部分）

`quests.ts` 只做数据与纯函数求值。落地按 kind 分派，全部调用既有 API，不需要新系统：

| 后果 kind | 落地方式（集成层） |
|---|---|
| `setFlag` / `clearFlag` | `WorldFlags.setFlag` / `clearFlag` |
| `giveItem` / `takeItem` | `InventorySystem.addItem` / `removeItem`（原子性参照 `encounters.trader` 的先收后发写法） |
| `grantPass` | `player.homeUpgrades.push(pass)`（**不要**额外写 `upg:` flag——`craft()` 也不写，两处必须一致） |
| `score` | `state.records.bestScore += delta` |

分支完成时集成层补写两个 flag：`story:quest:<id>:branch:<branchId>` 与 `story:quest:<id>:done`；奖励结算走 `once:quest-reward:<id>`。

**给各方的具体请求：**

1. **对话/场景侧**：任务面板按 `evaluateAllQuests(state)` 渲染；分支置灰文案用 `BranchEvaluation.blockers`（已含中文人类可读原因）。
2. **遭遇系统（`encounters.ts` 属主）**：Q2 `badge.pried-off-wall` 建议表现为 100–102 层 ambush 权重上浮（保安挨个核对脸）。这是**建议**，未写进数据层——需要遭遇系统属主确认后由他们改，我不动既有文件。
3. **NPC 系统（B6）**：`alin`/`xiaozhou` 的问候分叉可按 §5 挂 `questStatus`；新发布者（recruiter/blackmarket/lab_clerk/banquet_staff/core_terminal）需要楼层实体，属 B6/场景侧范围。
4. **终局系统**：读 `story:ending.*` 与 `GAME_DESIGN_LOCK.md` §6 四路线映射（Q6 表已给）。终局不在首章范围内落地，但 flag 已备好。
5. **存档**：`state.flags` 已是 `GameState` 既有可选字段，无 schema 变更。

---

## 8. 兼容性与边界

- 未改动任何既有文件；`quests.ts` 只 import 类型与纯函数（`WorldFlags` / `recipes` / `items` / `segments` / `gameTypes`），不 import Phaser，不在模块层做任何 I/O。
- 求值无 `Math.random`、无时钟、无 Date：同 seed 同 state → 逐字节相同的求值结果（测试断言 `JSON.stringify` 相等，且求值不写 state）。
- 与 `18_TIER_PROGRESSION.md` 的对应：六故事节点 = 六条 main/finale 任务；凭证链 = 每条段际主线任务的每个分支都发该段凭证（`validateQuests` 强制）；18 条纸条 = 18 个目标证据（测试强制全覆盖）。
- 首章**不做**：完整 NPC 实体与动画、任务追踪 UI、终局演出、遭遇权重的 flag 联动。这些在 §7 分派。
