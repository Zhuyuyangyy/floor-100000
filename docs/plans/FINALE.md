# 终局：统治核心（100000）创作（FINALE）

- 负责：AG-16（终局内容工程师）
- 日期：2026-11-15
- 分支：`agent/2026-11-15/ag-16-finale`（自 `integrate/sprint-01` 出发）
- 权威依据：`docs/18_TIER_PROGRESSION.md` §3（故事节点 6「你就是下一批志愿者」）、`docs/plans/STORY.md`（AG-10 的 Q6 终局任务，四个结局）、`docs/GAME_DESIGN_LOCK.md`

---

## 1. 定位与基调

> 「钥匙在你手里。现在你也是这套系统的一部分。」
> 「停电表、配给表、处决名单，是同一支笔写的。」
> 「你要么关上它，要么坐上它。」

阶层 6 是全塔最后一段，也是唯一一段只有一层（`segments.ts` 第 6 段 100000–100000，`requiresPass: 'core_key'`）。停电、配给、巡逻队、生物兵器是同一套东西的四张面孔——爬到顶层，玩家看到的是签字的笔，而不是怪物。**这一层不做战斗高潮，做选择。**

终端（Q6「同一支笔」的发布者，STORY.md §5 的 `core_terminal`）在这里交付权限，四个结局（shutdown / hand-over / throne / walk-away）都是对话分支，不是战斗结果。楼层设计的一切都服务这一条：容器少而重，物资是「系统自己的」，遭遇是「安保体系在巡逻」，而**没有 boss**。

## 2. 100000 层模板（`src/data/floorTemplates.ts`）

三件容器，一件一幕：

| 容器 id | label | x | 内容 | 叙事 |
|---|---|---|---|---|
| `counter` | 终端台 | 320 | 净水×1 **guaranteed**、压缩口粮×1 **guaranteed**、电池×1-2（0.45） | 核心终端所在，Q6 的抉择发生地；统治核心从来不执行配给表，它只签文件——所以核心自己的补给是满的 |
| `fuse_box` | 配电箱 | 640 | 保险丝×1（0.4）、电线×1-2（0.5） | shutdown 要关掉的就是它——塔的电源总闸在这一层 |
| `security_safe` | 档案柜 | 960 | 医疗包×1（0.5）、滤芯×1（0.35） | 停电表、配给表、处决名单，同一支笔写的三张表（纸条 T6-2，Q6 目标 `pen`） |

- **生存规矩与前五段逐字相同**：恰好 1 份 guaranteed 净水 + 1 份 guaranteed 口粮（都在终端台）。worldgen 的 survival contract 全塔扫描按每层一瓶水记账，多一瓶水（哪怕是概率掉落的）都会踩穿 `survivalBalance` 的「分层盈余」上限。
- 容器 id 全部落在 `containerTextureKey` 认识的家具上（counter / fuse_box / security_safe，没有新美术）；label 均 3 字；x = 320/640/960，与各段段顶（110/1010/10010/50010）同一套摆放。
- 配电箱里的保险丝与电线正是 `core_key` 的配方成本（`recipes.ts`：保险丝 1 + 电线 2 + 废金属 1）——终局层的箱子里还锁着造你这把钥匙的材料。
- `name: '统治核心'`，description 点出三张表（Q6 目标 `pen` 的现场）。

## 3. `DEV_FLOOR_ALIAS` 的处置：删除

全库 grep（源码、测试、e2e、文档）确认 `DEV_FLOOR_ALIAS` 的消费方只有两处：`floorTemplates.ts` 自己的 `templateFor()`，与 `src/tests/floorTemplates.test.ts`（本分支已按新语义更新）。删除它、`templateFor` 内联进 `getFloorTemplate`，`generateFloor` 改调 `getFloorTemplate`。

**为什么必须删而不是留**：`templateFor` 的解析顺序是「先查别名再查真表」。留着 `{ 100000: 1 }`，新模板会被别名**遮蔽**——`getFloorTemplate(100000)` / `generateFloor(100000)` 继续返回玩家宿舍，而 `hasFloorContent(100000)` 却说真（它本来就绕过别名），电梯从 50010 接通后，玩家会落在宿舍布局上而 HUD 写着 100000。那正是别名存在期 `hasFloorContent` 的注释所警告的事故。别名只在「终局层借第 1 层充数」的借用期有意义；终局创作后它是 bug，不是快捷入口。

`?devfloor=` 开发入口本身保留（`DEV_TEST_FLOORS = [100000]`，`devMode.ts` 未动）：它现在直达统治核心真内容，语义从「打开弃用的 v0.1 宿舍夹具」变成「直达终局」——这是内容创作带来的自然变化，已在测试注释与 FINALE.md 记录，不是 silent 改动。

## 4. 终局遭遇（`src/systems/encounters.ts`）

`FLOOR_WEIGHT_PROFILE` 新增一行，与 `worldgen.ts` 的 `ENCOUNTER_ANCHORS` 末行逐字一致（手写表与曲线在塔顶会师）：

```
100000: { loot: 2, note: 1, trader: 6, cache: 22, ambush: 110 }
```

- **ambush 110 是全塔最高的一档**，压过 50010 守段者的 boss 108——把着终点的是整套安保体系，不是一只看门狗。巡逻队是「停电、配给、处决」之外第四张面孔的现场版。
- **没有 boss**。boss 在 50010 已经打完了（生物兵器守段者）；终局等的是一个终端和四个选择（Q6），不是一场战斗。「统治者」在这款游戏里是对话与抉择，不是血量条。`encounterTableCoverage` 的 `BOSS_FLOORS = {5, 110, 50010}` 因此不变。
- loot 2 是全塔最低（终局层不是来搜刮的）；cache 22 维持高位（核心的封存库是最后一站补给）；note 1——纸条 T6-1/2/3 由终端直接交付（Q6 目标），问号点里只留一丝传闻的余地。

物资池 `FLOOR_LOOT_POOLS[100000] = ['medkit', 'filter', 'fuse', 'battery', 'wire', 'crowbar']`：全塔最后一档，也是唯一带回撬棍的一档（把着终点的东西是有装备的），与 `worldgen.ts` 的 `MATERIAL_POOLS[6]` 逐件一致；仍然没有面包与水——那两样由楼层容器保底。

## 5. 环境条目（`src/core/constants.ts`）

`SEGMENT_ENVIRONMENT` 新增 `100000: { label: '统治核心', cold: 3.4, humidity: 0.35, danger: 1, hostile: true }`：

- **cold 3.4**（> 富人区 3.0）：塔里最高的可玩段，暖气停得最早。
- **humidity 0.35**（< 富人区 0.4）：全塔最干燥——渗水的管道和中央空调都在下面，核心里只有服务器室的循环风。
- **danger 1.0 封顶**：整套安保体系把着这里；夜间在走廊里游荡的是巡逻，不是流浪者。
- 数值与 `worldgen.ts` 的 `ENVIRONMENT_ANCHORS` 末档（90000 外推）逐字一致，两条读数在塔顶会师。

## 6. 电梯语义

`liftOutcome(全凭证, 50010)` 由 `'not-connected'` 变为 `'ok'`——`hasFloorContent(100000)` 变真后自动达成，`segments.ts`（冻结）一行未动。GameScene 的 `takeLift()` 通用逻辑随之打通：持 `core_key` 在 50010 按 E，穿过 49989 层未探索区抵达统治核心；100000 的向下电梯回 50010（`prevSegment` + `hasFloorContent(50010)` 均已就绪）。

## 7. 测试更新（本分支）

`src/tests/floorTemplates.test.ts`：
- 「dev-only floor alias」describe 按新语义改写为「dev-only floor entry」：别名已删除，dev 楼层解析到**自己的**模板（楼层号对上、不再是宿舍名）；「authors exactly one template per playable floor」升级为与 `PLAYABLE_SEGMENTS` 全六段对齐（终局创作后无例外）。
- `hasFloorContent` 的「does not treat the dev alias 100000 as authored content」改为「treats the authored summit 100000 as content, not an alias」（false → true，理由写在注释里）。
- 新增 `describe('the ruling core (100000)')`：段 6 恰好一层、有模板、恰好 1 份 guaranteed 水 + 1 份 guaranteed 口粮（且全层只有一条水）、2-3 个容器、贴图全部存在、label ≤3 字、id/x 不重不越界、同 seed 可复现、三个 QA seed 都有水有食。

`src/tests/segments.test.ts`：
- 「refuses a pass-holder when the target segment has no floors yet」改写为「rides the last lift once the summit is authored」：50010 持全凭证 → `'ok'`（任务书点名的断言）；保留两条不减压力的路——只有 vip_card 没有 core_key → `'need-pass'`；目标层无内容（stub）→ `'not-connected'`。
- 「matches the authored floors」升级为 all six segments，`hasFloorContent(100000)` → true，并补 `99999` → false（50010 与 100000 之间的空洞）。

## 8. 跨文件影响（不在本分支文件清单内，需要属主处理）

本改动让 `hasFloorContent(100000)` 变真并删除 `DEV_FLOOR_ALIAS`，以下文件的断言按新语义失效。**本分支未动它们**（属主边界），逐条给出位置与新语义：

1. `config/game-balance.json` — `world.playableFloorsV01` 需要加入 `100000`（54 → 55 层）。这是**数据层必需**，不只是测试问题：`ENCOUNTER_TABLE` 只能为表内楼层建行，漏掉 100000 会让终局的问号点回落到 `DEEPEST_FLOOR`（50010）的配置——那一行带着 boss 108，终局会刷出已经打败过的守段者。加入后 `config.test.ts`（authored 段派生）与 `survivalBalance.test.ts`（每层一瓶水的额度与总量同向 +30）无需改动即可通过。
2. `src/tests/worldgen.test.ts` — 四处：`:229` 与 `:252`（`summarizeFloor(100000).authored` false → true）；`:330`（`hasFloorContent(100000)` false → true）；`:332`（`generateFloorContent` 现在委托给真模板，与 `generateFloor(100000)` 同名同内容，`not.toBe` 应改为 `toBe`，`not.toBe('玩家宿舍')` 保留）。
3. `src/tests/floorSystem.test.ts` — 两处：`:301`（false → true）；`:353-360`（`top = max(playable)` 变成 100000 后 `hasDownExit(top)` 为假——段 6 是单层段，楼下是电梯不是楼梯，断言需按「塔顶没有下行楼梯」改写）。
4. `src/tests/encounterTableCoverage.test.ts` — `:101-103`（VIP 段 `toEqual([50000..50010])` 会因 100000 进入可玩表而多出一项，需把终局层排除或单开一段断言；100000 无 boss，`BOSS_FLOORS` 不变）。
5. `src/tests/encounterSpots.test.ts` — `:51-54`（`top` 变成 100000，且终局无 boss，`ENCOUNTER_TABLE[top]` 不再含 boss）。
6. `src/tests/renderPerf.test.ts` — `:539`（`bounds.highest` 50010 → 100000；100000 的上下邻居都在空洞里，`stackNeighbours` 断言不受影响）。
7. `e2e/tower.spec.ts` — `?devfloor=100000` 的前提从「打开弃用的 v0.1 宿舍」变为「直达统治核心」；该测试只断言 `currentFloor`，预计仍可通过，但名字与意图已过期（e2e 不在 vitest 基线内）。

## 9. 没处理干净的地方

- 上述第 8 节全部：本分支按属主边界没有动，需要 team-lead 分派或授权后更新；在这些更新落地前，全量 vitest 在集成分支上会因它们变红（本分支自己的两个测试文件全绿）。
- `?devfloor=` 的 e2e 名义过期（第 8 节第 7 条）。
- Q6 的 `core_terminal` NPC 实体与终局演出不在本任务范围（STORY.md §7 分派给 NPC/场景侧）；本层只提供它发生的楼层。
