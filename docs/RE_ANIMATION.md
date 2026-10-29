# RE_ANIMATION · CENTUM 动画结构逆向（W5 前置）

**工单 W5（美术动画）· 2026-10-29**

## 0. 样本与方法

| 项 | 值 |
|---|---|
| 样本 | `re/centum/main.js`（225,942 B，webpack 单行压缩产物）+ `re/centum/index.html` |
| 引擎 | 自研 Canvas2D（**不是 Phaser**）：`ctx.drawImage` + `setInterval(draw, 15)` |
| 精灵表 | 8 张 base64 内嵌 PNG，用 `re/extract-centum-sprites.mjs` 抽出到 `re/centum/*.png` |
| 网格推导 | `GameCanvas.drawSprite` 里 `ctx.drawImage(e, 16*t%256, 16*Math.floor(16*t/256), 16, 16, …)` |
| 帧序号来源 | `src/tests` 无；全部来自 `main.js` 里的 JSON 数据表 + `animSprite` 累加逻辑 |
| 辅助脚本 | `re/centum-peek.mjs`（单行文件上下文检索）、`re/centum-anim-table.mjs`（JSON 表解析 + PNG 解码逐 cell 统计） |

> 只取**结构与时序**。精灵图一像素都不用——本项目角色由 `src/render/walkcycle.ts` 手摆生成。

---

## 1. 帧网格布局（IHDR 实测宽高 × drawSprite 数学）

cell 固定 **16×16 px**，每行 **16 列**（`256/16`），索引 `t → (x = 16t % 256, y = 16·⌊16t/256⌋)`，即 `row = ⌊t/16⌋, col = t%16`。

| 精灵表 | 宽×高 | 列×行 | cell 数 | 非空 cell（解码 PNG 后统计 alpha） |
|---|---|---|---|---|
| playerSpritesheet | 256×32 | 16×2 | 32 | `0,1,2 · 4,5,6 · 8,9,10 · 12,13,14 · 16,17,18 · 20,21` |
| monsterSpritesheet | 256×256 | 16×16 | 256 | `0–18, 20–89`（19 空） |
| itemSpritesheet | 256×256 | 16×16 | 256 | `0–36` |
| doodadSpritesheet | 256×16 | 16×1 | 16 | `0,1,2,3,4,5` |
| effectSpritesheet | 256×32 | 16×2 | 32 | `0–23` |
| tileSpritesheet | 256×32 | 16×2 | 32 | `0–20` |
| statusSpritesheet | 24×4 | 6×1 | 6 | `0,1`（cell 4×4 px，绘制时 ×3 放大） |
| titleImage | 620×200 | — | — | 非表，整图 |

**player 表的排布规律（4 cell 一块，每块同构）**：

```
块基址 b：  [ b   , b+1 ]  = 2 帧 idle（呼吸）
            [ b+2 , b+3 ]  = 死亡帧 + 空
rogue b=0 / red b=4 / assassin b=8 / zotchampion b=12 / 未登记第5组 b=16
cell 10 被 assassin 的死亡位复用，同时兼任全局 spawn（出生）单帧
cell 20,21 = 未解锁占位（单色 2 帧闪烁）
```

monster 表更简单：**每种怪物 2 个 cell**，base 全为偶数（`0,2,4,6,8,14,20,22,…,88`），共 42 种、40 个不同 base。

---

## 2. 动画表（动画名 → 帧序号 → 帧率 → 循环性）

tick = `setInterval(draw, 15)` ≈ **66.7 fps**；`animSprite += 1/30` 每 tick，`>= 1.9` 归零。
⇒ 一个 2 帧循环 = **57 tick ≈ 855 ms**；帧 0 占 30 tick，帧 1 占 27 tick。

| 动画 | 帧序号 | 帧率（实测） | 循环 | 机制 |
|---|---|---|---|---|
| player idle · rogue | `0, 1` | ≈1.17 Hz（帧0 450ms / 帧1 405ms） | 是 | `sprite + ⌊animSprite⌋` |
| player idle · red | `4, 5` | 同上 | 是 | 同上 |
| player idle · assassin | `8, 9` | 同上 | 是 | 同上 |
| player idle · zotchampion | `12, 13` | 同上 | 是 | 同上 |
| player idle · 未登记第5组 | `16, 17` | 同上 | 是 | `Oe` 皮肤表里没有，sheet 里有 |
| player dead | `2`（及 6/10/14/18） | 静态 | 否 | `isDead → sprite = deadSprite = base+2` |
| player spawn（出生） | `10`（shadow 变体 54） | 静态 | 否 | `isSpawn → sprite = 10` |
| locked 占位闪烁 | `20, 21` | 同上 2 帧 | 是 | 单色 2 帧 |
| monster idle（42 种） | `base, base+1` | 同上 2 帧 | 是 | base 全偶数 0…88 |
| doodad 火把闪烁 | `0,1` / `2,3` / `4,5` | 同上 2 帧 | 是 | 同时 `shadowBlur` 4↔8 联动 |
| trap · smite | `20, 21` | 同上 2 帧 | 是 | effect 表 |
| shrine 赐福 | `7` / `9` / `11` / `13` | 静态 | 否 | 单帧，无 animSprite |
| spellshot / potion 特效 | `7` / `8` | 静态 | 否 | 单帧 |
| 一次性命中特效 | 单帧 | `globalAlpha = effectTime/30` 线性淡出，30 tick≈450ms | 否 | 无帧切换 |
| 移动弹道 | 单帧 | `tileMoveTime=3` 步进 / `effectTime=12` | 否 | 无帧切换 |
| wall tile | `1` / `16` / `17` / `18` | 静态 | — | 按 depth≤25/50/75/100 选 |
| status 图标 | `0,4,8,12,20` | 静态 | — | 4×4 px，无动画 |

**结论：CENTUM 没有行走循环。** 它是格子制 roguelike，移动是瞬移（`move(tile)` 一格），
所以"走"这个动作根本不存在；所有角色动画都是 **2 帧呼吸** + **一次性位移/淡出**。

---

## 3. idle 的非对称节奏（实测，非猜测）

源码里**没有**字面量 `[0,0,0,1,0,0,1,1]` 这样的 8 项节奏表（已用正则全网状检索确认）。
真实的不对称来自阈值 `1.9`：

```js
this.animSprite = !this.isDead && this.animSprite < 1.9 ? this.animSprite + 1/30 : 0
```

- 帧 0：`animSprite ∈ [0,1)` → **30 tick**
- 帧 1：`animSprite ∈ [1,1.9)` → **27 tick**
- 比例 **30 : 27 ≈ 1.11 : 1**——静止帧比位移帧长 11%，不是 50/50。

**像素级实证**（解码 playerSpritesheet，逐 cell 统计 + 相邻差分）：

| cell | 不透明 px | 颜色数 | 与上一 cell 差分 |
|---|---|---|---|
| 0（idle A） | 110 | 6 | — |
| 1（idle B） | 110 | 6 | **16** |
| 2（dead） | 96 | 5 | **115** |
| 4 / 5 | 112 / 110 | 6 / 6 | **26** |
| 6（dead） | 97 | 5 | **116** |
| 8 / 9 | 111 / 110 | 6 / 5 | **29** |
| 10（dead+spawn） | 96 | 4 | **114** |
| 12 / 13 | 109 / 109 | 8 / 9 | **21** |
| 14（dead） | 97 | 6 | **120** |
| 16 / 17 | 116 / 116 | 7 / 7 | **8** |
| 18（dead） | 97 | 5 | **144** |
| 20 / 21 | 31 / 34 | 1 / 1 | 11 |

两条硬规律：

1. **idle 两帧像素量几乎相同**（109–116），差分只有 8–29 px（≈15–25%）。
   ⇒ idle 是**整体微位移/呼吸**，不是换姿势。
2. **死亡帧差分 114–144 px，是 idle 帧间差分的 5–7 倍**。
   ⇒ 一次性姿态（受击/死亡）必须做大差分，否则读作"没反应"。

---

## 4. 一次性动画的回调模式（attack / operate）

CENTUM 没有 Phaser 的 `onComplete`。一次性动画的"播完自动回去"靠**状态位 + 计数衰减自动清位**：

```js
// 攻击触发（Creature.tryMove 里撞上有怪的格子）
this.offsetX = (e.x - this.tile.x) / 2;   // 朝目标冲半格
this.offsetY = (e.y - this.tile.y) / 2;
this.hasAttacked = true;
this.isAttackAnimation = true;
this.attackTarget(e.monster);

// 每 tick 衰减（Creature.draw）
this.offsetX -= Math.sign(this.offsetX) * (this.isAttackAnimation ? 1/16 : 1/8);
this.offsetY -= Math.sign(this.offsetY) * (this.isAttackAnimation ? 1/16 : 1/8);
if (this.offsetX === 0 && this.offsetY === 0) this.isAttackAnimation = false;
```

四个可借鉴点：

1. **攻击是"位移"不是"换帧"**：`animSprite` 在攻击期间照常跑，呼吸不被打断——
   两层动画**叠加**而非互相替换。
2. **攻击位移衰减速率是普通移动的一半**（`1/16` vs `1/8`）⇒ 一次出手时长是普通移动的 2 倍
   （32 tick ≈ 1.07 s vs 16 tick ≈ 0.27 s）。**打击感来自"慢收手"**。
3. **回调 = 计数器归零**：`offset === 0 → isAttackAnimation = false`，
   不需要事件系统，也不需要外部在 N 帧后手动切回 idle。
4. **特效一次性同理但用透明度**：`effectTime = 30`，`globalAlpha = effectTime/30` 线性淡出，
   `effectTime--` 到 0 即消失；移动弹道用 `tileMoveTime = 3` 步进 + `effectTime = 12`。

---

## 5. 可借鉴的结构结论（本项目已落地）

1. **idle 呼吸不要 50/50 均分。** 静止帧比位移帧长约 11%（30:27 tick），
   读起来是"呼吸"而不是"闪烁"；本项目 `idlePose` 的 2 帧即按此调参（lift 0 / 2 px）。
2. **一次性动画不需要回调。** 用"状态位 + 每帧衰减，衰减到 0 自动清位"，
   Phaser 侧 `repeat: 0` 播完停在最后一帧，GameScene 用 `animcomplete`/计时切回 idle 即可，
   与 CENTUM 的 `offset === 0 → isAttackAnimation = false` 同构。
3. **攻击 = 前摇 + 出手两段，且出手的前伸量必须严格大于前摇。**
   CENTUM 用"半格冲刺"表达出手；本项目角色不能真位移（会穿墙/脱离碰撞盒），
   所以翻译成**手臂前伸量 + 躯干前倾量**的峰值差——这正是 W5 测试断言的指标。
4. **一次性姿态的帧间差分要做到 idle 帧间差分的 5 倍以上。**
   CENTUM 死亡帧差分 114–144 vs idle 8–29。⇒ `hurtPose` 两帧、`attackPose` 三帧
   都必须有大幅姿态差，不能只是 1–2 px 的呼吸。
5. **同角色多姿态连续排布，索引 = 行×16 + 列，一个 `generateFrameNumbers(start,end)` 就是一段动画。**
   本项目沿用：sheet 排布为 `walk(6) + idle(2) + attack(3) + hurt(2) + search(2) = 15 列`，
   `bakeWalkSheets` 一次烘完，`createCharacterAnimations` 按段注册。

---

## 6. 已知问题（事实）

- CENTUM 源码无 sourcemap 可读变量名（webpack 压缩后单字母），本文所有命名均为按行为反推。
- `getWallDoodadSprite()` 写作 `[0,2,4][2*randomRange(0,2)]`，`randomRange` 可能返回 2 ⇒ 索引 4 越界得
  `undefined`，是原作者的 bug，与动画结构无关，仅记录。
- `playerSpritesheet` 的 cell 16/17/18 是一组完整的 idle+dead，但皮肤表 `Oe` 里没有对应项——
  推测是未发布皮肤或调试残留；本文按实测记录，未采用其素材。
- item 表的 `isAnimated` 字段在代码里被读取，但 35 条物品数据**没有一条**置位——
  即物品实际全是静态单帧。
