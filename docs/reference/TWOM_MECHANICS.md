# 《This War of Mine》机制拆解 — 对《第100000层》的可借鉴项

> 来源：`C:\Users\联想\Downloads\base.apk`（562 MB，`com.elevenbitstudios.twomstoriesmobile` v1.0.7，byfen 壳打包版）
> 方法：jadx 1.5.1 反编译 Java 层（4563 个 .java）+ 自写 ELF 符号/字符串提取 native 层（14,930 个 `Kosovo*` 符号）
> 报告原件：[`RE_report_base.apk.md`](RE_report_base.apk.md)
> 证据分级：**seen**（符号/字符串里直接有）/ **inferred**（从命名与结构推断）

## 0. 先说结论：Java 层是空的

我扫了全部 4563 个反编译出来的 `.java`，`Kosovo` 命中 **0 个类**。玩法一行都不在 Java 里——那层只是 Google Play 服务壳（GameHelper / Cloud / Billing / Multiplayer）。

**游戏本体全在 `libAndroidGame.so`（13.1 MB，AArch64，未剥离，31,220 个 dynsym 符号）**。这对我们是好事：符号表比源码更密集，一个二进制直接把所有系统名列全了。

---

## 1. 日记分类法 —— 整个拆解里最有用的一件

引擎里有 **42 种 `KosovoDiaryEntry*` 类**（seen）。这不是日志格式，这是 **11 bit 对"什么值得记住"的正式回答**。每一条都是他们认定"玩家必须被告知"的状态变化：

| 类别 | 条目 |
|---|---|
| **生理** | `DwellerHungry` `GroupHungry` `DwellerSickness` `GroupSick` `DwellerWounded` `GroupWounded` `DwellerSicknessNoEffect` `StimulantShortage` |
| **精神** | `DwellerMorale` `DwellerAngry` `DwellerForceCheerUp` `TraumaEffect` `EndOfMourning` `TraumaDwellerLeftShelter` |
| **生死** | `DwellerDied` `CharacterKilled` `GroupCharacterKilled` `DwellerHistory` |
| **外出** | `ReturnedFromScavenge` `LateFromScavenge` `LocationVisited` `Combat` `ItemsStolen` `BeatAndItemsStolen` |
| **袭击** | `ShelterAttacked` `ShelterAttackedWithChildAlone` `ShelterHeatLevel` |
| **人际** | `Visitor` `ReturnFromVisit` `CharacterJoinShelter` `RequestFulfilled` `ChildLonely` `ChildLeftAlone` `ChildNewHome` `ChildWorkHard` |
| **元** | `WarEnded` `Quest` `Stamp` `PlainText` `PlainTextWithItems` `ConfigParamLevel` `CharacterEnterTrigger` |

**三条可直接抄的规律：**

1. **个体与群体双轨**。`DwellerHungry` 和 `GroupHungry` 同时存在——一个人饿是私事，一群人饿是事件。我们的饥饿/口渴目前只有 HUD 数字，缺"群体态"这一档。
2. **"没有效果"也是一条记录**。`DwellerSicknessNoEffect` —— 生病了但没恶化，仍然告知。它在告诉玩家"系统看在眼里，只是这次没事"。
3. **迟归单独成条**。`LateFromScavenge` —— 外出的人没按时回来，本身就是事件，不用等出事。

### 对我们的落地建议

`src/systems/` 加一个 `DiarySystem`，把现有散落的 `flash()` 文本升级成结构化事件。42 条不用全做，先做高价值的：

```
DwellerHungry / GroupHungry        ← 我们有饥饿，但没有群体态
DwellerMorale                      ← 对应心情系统（见 §2）
DwellerDied / DwellerWounded       ← 我们有死亡，缺受伤分级
LateFromScavenge                   ← 流浪者/外出归来的变体
ShelterAttacked                    ← 我们有夜间袭击，缺"宿舍被攻破"的专属记录
Visitor / RequestFulfilled         ← 对应邻居委托
```

---

## 2. 心情是"点数+衰减"，不是一条 0–100 的槽

`KosovoEmotionalComponent` 的方法面（seen）：

```
AddAngryPoints(unsigned)          RemoveAngryPoints()
GetDepressionChangeOnCheer(Item*, Item*)
GetDepressionModifierForEntry(DiaryEntry*)
ComputeOverallDepressionChange()          ← KosovoGlobalState
TickDepression()                           ← KosovoScene，每帧
```

配置项（seen，全是数据驱动的名字）：

```
DefaultDepression          DepressionLoss         DepressionThreshold
DepressionModifier         DepressionChangeOnCheer  DepressionChangeOnDayBegin
ImpactLevelMaxDepressionValues    EffectMoraleProbabilities
AvgDepressionChangeForCheerfulMusic
BackFromScavenge_CameBackHigherMorale / LowerMorale
GoodMorale  GoodMoraleDays  KosovoMoraleTraumaProbability
```

**推断出的模型（inferred）：**

- 主指标叫 **Depression**（抑郁值），不是 Morale。 Morale 是派生/标签（`GoodMorale`、`DwellerMorale` 是 diary 条目名）。
- **怒气是独立的点数池**（`AngryPoints`，有 `FadesInfoEntry`），会衰减，和 Depression 分开算。
- **物品能直接改心情**：`GetDepressionChangeOnCheer(Item*, Item*)` 签名说明"拿 A 对 B 使用"会产生心情变化——这是烟、酒、咖啡、书、收音机的统一入口。
- **音乐单独一条通道**：`AvgDepressionChangeForCheerfulMusic`。
- **外出归来改心情**，而且分"高士气回"和"低士气回"两个方向。
- **有概率模型**：`EffectMoraleProbabilities`、`KosovoMoraleTraumaProbability` —— 效果不是确定的，是按概率掷。

### 对我们的落地建议

我们的 `hunger/thirst/energy` 三条是纯消耗槽，缺"精神维"。加第四条 **morale**，模型照抄这四条：

| 机制 | 数据名 | 我们的实现 |
|---|---|---|
| 基线+每日变化 | `DefaultDepression` / `DepressionChangeOnDayBegin` | `game-balance.json` |
| 物品提振 | `DepressionChangeOnCheer` | 消耗品表加 `moraleDelta` |
| 概率生效 | `EffectMoraleProbabilities` | 用 seeded RNG，**不要 Math.random** |
| 创伤概率 | `KosovoMoraleTraumaProbability` | 目睹死亡/被袭击时掷 |
| 高/低士气归来 | `BackFromScavenge_*` | 搜刮满载 vs 空手而归 |

---

## 3. 生存主循环：一个 Scene 上挂一串 Tick

`KosovoScene` 的每帧/每时处理函数（seen，mangled 名还原后）：

```
TickHeaters             ProcessSleep           TickDepression
TickParameters          TickStimulants         ProcessSickness
TickTemperature         TickCombatSlowdown     TickNightJobsParameters
ProcessPrivateContainers
```

**这就是一个生存游戏该有的最小主循环集**（inferred）：取暖、睡眠、心情、通用参数、刺激品、疾病、温度、战斗减速、夜间工作参数、私人容器。

对比我们现在的 `SurvivalSystem.tick()`：只有饥饿/口渴/精力衰减 + 睡眠。**缺的三样最影响"活着"质感**：

1. **`TickTemperature`** —— 温度。我们有 5 层楼，完全没用"楼层冷热"做差异。
2. **`ProcessSickness`** —— 疾病。我们有"归零即失败"，没有中间的病态。
3. **`TickHeaters`** —— 取暖设备。我们有 candle/torch/brazier 三个光源，但都只是**照明**，没有"供暖"功能。

### 对我们的落地建议

把 5 层楼的差异从"换色调 + 换道具"升级到**环境参数**：

```
楼层   温度    湿度    危险    可取暖
1F    18°C    干      无      床
2F    16°C    干      低      蜡烛
3F    12°C    潮      低      无
4F    10°C    潮      中      火把（弱）
5F    14°C    漏水中   高      火盆（强）
```

`brazier` 已经有 90 帧动画了，给它加一个 `warmth` 半径——走近回温，走开降回去。这是**零新增美术**的收益。

---

## 4. 行为树：625 个任务类，命名即设计

从符号表（seen）：

```
BTTaskKosovoEntityGoTo            BTTaskKosovoEntitySpeak
BTTaskKosovoEntityPlayAnimation   BTTaskKosovoEntityFindRandomRoom
BTTaskKosovoEntitySensorConditionDecorator
BTTaskKosovoDwellerIsControlledWithGamepad
BTTaskKosovoDwellerIsForcedGoToDestinationPresentDecorator
BTTaskKosovoDwellerIsForcedTargetPresentDecorator
BTTaskKosovoDwellerAnyShootTargetsDecorator
```

**规律（inferred）：**

- **GoTo / Speak / PlayAnimation 三个原子任务**撑起全部表现。NPC 的所有行为都是这三样的编排。
- **`Sensor*Decorator`** 是感知条件装饰器——AI 不直接问世界状态，而是通过"sensor"这个抽象层。
- **`Forced*Decorator`** 是强制打断——玩家指令 > AI 自主。
- **实体模板里有 `BEHAVIOUR_TREE`、`TRIGGER`、`FLAG` 三种**（seen，20 种 ENTITY_* 之一），说明行为树是**可挂在任意实体上的组件**，不是 NPC 专属。

### 对我们的落地建议

我们现在的 NPC 是**脚本化位置 + 固定对话**，流浪者是 `stepWandererAI` 状态机。要升级的话：

- 不必上完整行为树。先抽 `GoTo / Speak / PlayAnimation` 三个原子，让 NPC 的巡逻、走向玩家、说话都走这三条。
- **`TRIGGER` 和 `FLAG` 立刻可抄**：`src/systems/` 加一个 flag 表，任务/对话/遭遇都按 flag 查询，而不是散落的布尔字段。我们现在 `worldEvents.activeEvent`、`dailyGoal`、`combat` 各管各的，已经是这个问题的早期症状。

---

## 5. 资产格式（备查，非优先）

`assets/*.dat` 是 **gzip 多成员串联容器**，成员间用 `BTYPE=3` 保留值做分隔标记（inferred，见 RE 报告 §4）：

```
scenes.dat    54.5 MB   94 成员，[TOC → LAYERS → DPL] 三件套循环
sounds.dat    236 MB    WAV/OGG
textures.dat  97 MB     DDS
animations.dat           含 ojciec / beingm 等动画名
videos.dat               OGG/Theora
```

**这条暂时不用管**——我们的美术是程序化生成 + 你的手绘图，不走它的 VFS。记在这里是为了如果以后要参考它的场景结构，知道怎么取。

---

## 6. 一份优先级清单

按"对《第100000层》当前阶段的价值 ÷ 工作量"排：

| # | 机制 | 工作量 | 价值 | 说明 |
|---|---|---|---|---|
| 1 | **Flag/Trigger 系统** | 小 | 高 | 纯逻辑，零美术。立刻能让任务/对话/遭遇解耦 |
| 2 | **楼层环境参数**（温度/湿度） | 小 | 高 | 5 层楼立刻有差异，纯数据 |
| 3 | **brazier 供暖** | 小 | 高 | 动画已有，加一个半径判定 |
| 4 | **morale 第四条维** | 中 | 高 | 照 §2 的五条机制 |
| 5 | **日记系统** | 中 | 高 | 把 flash 文本升级成结构化事件，42 类取 6 类 |
| 6 | **疾病中间态** | 中 | 中 | 现在只有 hp 归零，缺"病了但还能动" |
| 7 | **NPC 三原子** | 大 | 中 | GoTo/Speak/PlayAnimation |
| 8 | 完整行为树 | 大 | 低 | 现在规模不需要 |

**建议先做 1+2+3**：三项都是纯逻辑/纯数据，不动渲染，一轮内能完成并验证，但能让"五层楼"从五个色调变成五种处境。

---

## 附：本次提取的产物

```
re/twom/libAndroidGame.so        13.1 MB  native 引擎
re/twom/kosovo-symbols.txt       14,930 个 Kosovo* 符号
re/twom/systems.txt              18 个系统的分类清单
re/twom/diary.txt                42 种日记条目 + 心情 API + 主循环
re/base-jadx/                    4,563 个反编译 .java（仅 Google Play 壳）
```

全部在 `.gitignore` 的 `re/` 下，不进仓库。仓库里只保留本文件和 `RE_report_base.apk.md`。
