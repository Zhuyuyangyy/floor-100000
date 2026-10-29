# M1 暴改实录（OVERHAUL）

**日期** 2026-10-29 · **授权** 项目负责人：「整个游戏我现在一点想玩的游戏都没有」+「往你逆向的游戏上面靠」
**配方来源**：[`RE_COMPETITIVE.md`](RE_COMPETITIVE.md)（ALTACIMA 公开设计 + CENTUM 源码级逆向）
**工流** 5 个 agent 并行（W1 遭遇 / W2 威胁 / W3 进展 / W4 反馈 / W5 美术），Lead 集成。作战书：[`OVERHAUL_M1.md`](OVERHAUL_M1.md)。

## 改了什么（对应当初承诺的五句话）

| 承诺 | 落地 | 配方出处 |
|---|---|---|
| 「每层都有东西在等我」 | **问号点遭遇系统**：每层 1–2 个「?」，E 打开面板——遗落物资/伏击/行商/纸条/藏匿点，第 5 层有守门人。打/逃/交易都是真实后果 | ALTACIMA 问号点循环 |
| 「第 5 层有个必须面对的东西」 | **守门人**（boss 遭遇，需撬棍或医疗包，胜得医疗包+肥物资），钉在 5 层上楼口外侧 | ALTACIMA 每 10 层 Boss 的 M1 压缩版 |
| 「昨天最深 3 层，今天破纪录」 | **每日目标**（四类 seeded roll，完成 +80 分+口粮）+ **深度纪录** + `2×深度+宝藏+目标` 计分，HUD 常显 | CENTUM 深度主导计分 |
| 「那东西盯上我的时候我知道」 | **巡游体状态机**：stalking→lunge→cooldown，站 1.5 秒触发 2.2 倍扑击、命中双倍伤害；dwell 表新增 scout 预警档（下次 prowler +0.1） | CENTUM 停留升级 |
| 「没事干就睡，晚上去有好处」 | **随时入睡**（B3-15 已交付，20:00 前按清醒代谢计费）+ 开箱/预警/目标三音效 + 低血量红晕脉冲 + 危急槽标红 + 精力<20 减速 | B3-15 + ALTACIMA 精力预算 |

外加 **W5 美术暴改**：逆向 CENTUM 精灵表（8 张内嵌 PNG 逐 cell 统计，得 16×16 cell 网格与三条时序结论，只取结构未取素材），新增 **attack(3)/hurt(2)/search(2)** 三个手摆姿态并接入场景（开箱→search、受击→hurt、打斗→attack）。审帧中修掉两个真缺陷：远臂镜像把手臂甩出画布左缘；蹲姿导致靴头朝后+落地 0.5px 误差。

## 新增/修改文件

**新系统**：`src/systems/encounters.ts`（24 测）、`encounterSpots.ts`（5 测）、`wandererAI.ts`（15 测）、`dailyGoals.ts`+`progress.ts`（20 测）、`src/render/feedback.ts`（17 测）
**集成**：`GameScene.ts`（问号点渲染/面板/键盘路由、HUD 目标+分数、红晕、精力减速、动画定时器、巡游体 AI、开箱音）、`SaveSystem`（三个新状态块校验）、`gameState`（初始化）、`config`（overhaul 调参块）
**美术**：`walkcycle.ts`（15 帧 sheet）、`audio.ts`（3 音效）、`docs/RE_ANIMATION.md`
**测试**：460 通过（32 文件，暴改前 351）

## 验证

- `npx tsc --noEmit` → 0 错误
- `npx vitest run` → **460 passed (32 files)**
- `npm run build` → 通过（chunk 大小警告为既有情况）
- `npx playwright test --workers=1` 全量 e2e → 见提交说明

## 已知问题（事实）

1. W1 满包时遭遇物品留在地面（result.items 只报实际入包部分）
2. W3 containers 目标按本 run 累计计（FloorVisit 无逐日时间戳，严格「当天」需改 core）
3. W3 宝藏估价是本地保守表（items.ts 无 price 字段）
4. `legTo()` 的 `knee:2a` 是近似，弯膝姿态踝点 ≤0.5px 误差——修它会改变行走渲染，需单独工单
5. hurtPose 受击轻跳 3px/1px 是设计值（靴底行 91/93）
6. 本环境无图像输入，全部画面判断依据 ASCII dump + 量化审计（不透明 px/包围盒/前伸带/靴底行），**最终观感待人工试玩**

## 集成期抓出并修掉的三个真 bug（都是 agent 单测照不到的接缝）

1. **问号点劫持 E 键**：问号点落进容器/NPC/楼梯的交互半径，E 打开的是遭遇面板而不是玩家走向的东西——npc 交易 spec 和两个旅程 spec 全挂。修：`encounterSpots.ts` 纯函数内排除楼梯区+保证点间距，场景侧 `nudgeSpotX` 绕开容器/NPC，回归测试钉死（3 seed × 5 层 × 全部交互物）。
2. **重启后 HUD 崩**（两连击）：① `refreshStats` 在 `buildHud` 里先于 goalText 创建被执行，守卫放行了上一轮残留的字段引用；② Phaser 4 场景重启不重跑字段初始化、shutdown 只把纹理置空，`destroy()` 后字段仍指着死对象，`setText` 抛 `glTexture null`。修：buildHud 开头销毁并置 undefined HUD 独占对象、字段改可选、update 可选链。
3. **测试债两笔**：journey spec 硬编码起始值 79.5 和口粮数 5——B3-16 改起始值、W3 加口粮奖励后假红。均改为读 config / 表达意图。

## 事故记录（给未来的 agent）

PowerShell 5.1 的 `Get-Content`/`Set-Content` 默认按 ANSI 读写，会把 UTF-8 中文文件做成**有损**乱码。本次用它做批量替换把 GameScene.ts 搞坏，靠 `git checkout HEAD --` 恢复后重放编辑救回。**教训：Windows 上改项目文件只用 edit/write 工具，不用 PowerShell 管道处理文本。**
