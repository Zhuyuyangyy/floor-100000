# STAIRS — 楼梯美术重做（AG-53）

**日期**：2026-11-16
**范围**：`src/render/corridors.ts`（楼梯美术 + 爬梯曲线）、`src/tests/stairsArt.test.ts`（49 例）
**状态**：渲染侧已交付并全绿；GameScene 接入 diff 见第 4 节（归总控/AG-50 应用）

## 1. 用户诉求（2026-11-16 晚反馈）

> 这个楼梯的话改成那种 2D 的，就是阶梯型的那种，然后可以直接走上去……有一种直的梯子，
> 直接直的梯子就相当于一条线一样。直接挂在这两个楼层上面，而不是像你现在坐楼梯这样滑步
> 走上去非常的难看。

拆成两条：

1. **阶梯楼梯（默认）**：看得见一级一级的台阶，角色**走**上去（播 walk 动画、逐级步进），
   不是 1000ms 直线 tween 的「滑步」。
2. **直梯（新样式）**：像一条线挂在两个楼层之间，角色垂直爬。

## 2. 阶梯几何与样式分派

全部几何在 `corridors.ts`（STAIR_RISE = FLOOR_HEIGHT = 200，来自 constants，未改任何常量）：

| 量 | 值 | 理由 |
|---|---|---|
| 台阶数 | 10（每段 5 级，两段） | 200px 楼层高度 ÷ 10 = 每级 20px，在塔的 zoom 下一级是一级 |
| 步高 | 20px | 16px 在纵截面里太碎；25px（8 级）每步起伏过大 |
| 踏步深 | 32px | 64px 宽的角色站得上；5×32 = 160px，正好折返回楼梯口 |
| 梯横档距 | 20px | 与步高一致，梯子连接与阶梯连接同速 |

**形状**：Z 形折返（switchback）。两端的梯口都在楼梯口 x 上（上梯 x=40、下梯 x=1240）——
这是硬约束：`stairMouthZone` 的交互判定和 traversal 的落点 `endX` 都钉在那里，美术乱走
就会和规则脱同步（旧实现的正弦摆动 ±96px 就在试探这条线）。第一段朝楼层中间、第二段回
楼梯口，中间第 5 级是平台（44px 宽，比踏步宽，转身看得见）。

**样式分派**（`stairArtStyleFor(floor, direction)`）：楼梯属于**连接**不属于**方向**——
1→2 往上爬的和 2→1 往下爬的必须是同一条。锚点取这对楼层的较低层：

- **段 1（贫民区 1-10）→ 直梯**：铁梯（锈色边梁 `lightDeep` + 暖色横档 `light`）
- **段 3（工业区 1000-1010）→ 直梯**：竖井钢梯（冷色边梁 `stoneLight` + 淡色横档 `dust`）
- **其余阶层（工人宿舍/中产/富人）→ 阶梯**

**绘制**（`drawStairwell`，一个 Graphics，楼层建造时画一次）：
- 阶梯：10 块实心踏步（每块从踏面垂到下一级踏面，读作楼梯体量不是浮板）+ 交替配色的
  3px 踏面帽 + 平台 + 房间侧扶手（2px、0.7 alpha）+ 双门坎。共 61 条绘制命令。
- 直梯：两根边梁伸出两层地板线各 10px（「直接挂在这两个楼层上面」）+ 每级高一根横档
  （共 11 根）+ 两端支座。共 18 条。
- 旧 `drawStair` 约 86 条命令（18 踏面 + 正弦串串 + 扶手 + 平台）。新画法更少。

**色板**：所有颜色走 `PALETTE` 角色（`STAIR_COLORS` 导出供测试断言），无一个新字面量；
`node tools/assets-manifest.mjs` 接入前后均 `RESULT: clean`。

## 3. 爬梯动画曲线（`stairClimbPose(floor, climb, elapsedMs)`）

阶梯：把 1000ms（`STAIR_TRAVEL_MS` 未改）切成 10 个 100ms 时间片，每片走一级——
**x 线性**（横向匀速），**y ease-out**（`1-(1-t)²`）。选 ease-out 的理由：每一级的上升
前重后轻，角色「踏上」这一级并在踏面上顿住半拍，剪影上是十个清晰的落点；线性会是匀速
滑动（用户否掉的正是这个）；ease-in-out 两头为零速，读作犹豫。平台处 `faceX` 从 +1 翻到
-1（转身），动画节奏 `animTimeScale = 1.25`（沿用原爬梯的 walk 节奏）。

直梯：x 钉在楼梯口、y 线性（「相当于一条线一样」），`animTimeScale = 1.0`——200px/s 的
垂直速度配 1.25 的走路节奏会像 frantic scrabbling。

端点精确：pose(0) = 梯口，pose(duration) = 邻层梯口，超时/负时间钳制。`StairClimb` 接口
结构上被 FloorSystem 的 `StairTraversal` 满足，场景侧可以原样传人。

## 4. GameScene 接入 diff（归总控/AG-50 应用，我不动 src/scenes/**）

四处，全是替换不是新增逻辑：

**a. 导入**（GameScene.ts:42-46 与 163 行）

```diff
 import {
   completeStairTraversal,
   currentInteractionZone,
   hasDownExit,
   hasUpExit,
   movePlayerX,
-  stairBendFor,
   stairMouthZone,
-  stairPosition,
-  stairStyleFor,
   stairTraversalFor,
   stepHorizontalSpeed,
   tryChangeFloor,
 } from '../systems/FloorSystem';
```
（`stairStyleFor`/`stairBendFor`/`stairPosition` 三者在 GameScene 里不再有使用者；
`noUnusedLocals` 会报未使用，必须一并删。FloorSystem 里的定义不动——floorSystem.test.ts
钉着它们的既有行为。）

```diff
-import { corridorTint, drawCorridorRoom, drawCrowd, floorKeyFor, placeDoor, placeWindow, wallKeyFor } from '../render/corridors';
+import { corridorTint, drawCorridorRoom, drawCrowd, drawStairwell, floorKeyFor, placeDoor, placeWindow, stairClimbPose, wallKeyFor } from '../render/corridors';
```

**b. drawStair 全体替换**（GameScene.ts:2675-2726，`drawStair` 方法整体）

```diff
   private drawStair(x: number, dir: 'up' | 'down', floor: number): void {
-    // Some connections are vertical shafts; the industrial middle connections
-    // use a steep switchback with a small landing. Both shapes share the same
-    // deterministic path as stairPosition(), so the character never leaves the
-    // drawn steps.
-    const y0 = STAIR_START_Y;
-    const y1 = y0 + (dir === 'up' ? -STAIR_RISE : STAIR_RISE);
-    const style = stairStyleFor(floor, dir === 'up' ? 1 : -1);
-    const bendX = stairBendFor(dir === 'up' ? 1 : -1, style);
-
     const g = this.add.graphics();
-    const steps = 18;
-    ...（整段旧绘制：串串、18 踏面、平台、扶手、门坎）
-    g.setDepth(ACTOR_DEPTH - 1);
-    this.floorObjects.push(g);
+    drawStairwell(g, { x, dir, floor });
+    g.setDepth(ACTOR_DEPTH - 1);
+    this.floorObjects.push(g);
   }
```

**c. updateStairClimb 的位置来源**（GameScene.ts:6091-6094）

```diff
-    const pose = stairPosition(climb, climb.elapsedMs);
+    const pose = stairClimbPose(getGame().currentFloor, climb, climb.elapsedMs);
     this.player.setPosition(pose.x, pose.y);
-    this.player.setFlipX(climb.direction < 0);
-    this.player.anims.timeScale = 1.25;
+    this.player.setFlipX(pose.faceX < 0); // 折返处转身
+    this.player.anims.timeScale = pose.animTimeScale; // 阶梯 1.25 / 直梯 1.0
```

**d. changeFloor 的初始朝向与节奏**（GameScene.ts:6080-6082，可留可改；建议改）

```diff
     this.openClimbCameraRoom(direction);
     this.player.setFlipX(direction < 0);
     this.player.play(walkAnimKey(this.metaSelectedCharacter()), true);
-    this.player.anims.timeScale = 1.25;
+    this.player.anims.timeScale = direction === 1 ? 1.25 : 1.25; // 或 stairClimbPose(...,0).animTimeScale
```
（这一处只是首帧节奏，updateStairClimb 每帧都会覆写；留 1.25 也不违合，因为爬梯首帧
必在梯口。严格做法是 `stairClimbPose(getGame().currentFloor, traversal, 0).animTimeScale`。）

**e. 交互区不用改**。`stairMouthZone`/`currentInteractionZone` 是纯位置判定，两种美术的
梯脚都钉在同一个口上（stairsArt.test.ts 有断言）。Z 形折返最远只到楼层中间 160px 处
（旧 steep 摆动 ±96px，量级相同），`openClimbCameraRoom` 的爬梯相机房不用加宽。

**f. e2e 既有断言不受影响**：`stairNavigation.spec.ts` 的「全程可见」看的是相机与角色
bounds（y 范围不变：160→-40 / 160→360）；`gameplay.spec.ts` 的 `player.y < 160` 与落点
`x=40` 不变；时长仍 1000ms。接入后建议跑这两个 spec 复核。

## 5. 卡顿排查与帧时间实测

**渲染侧结论先行：爬梯动画本身不重画楼梯。** 楼梯是楼层建造时（drawFloor →
drawExits → drawStair）画进一个 Graphics 的静态命令，爬梯的每一帧只动玩家
精灵/影子/武器/灯光，`stairClimbPose` 是纯函数（无分配、无场景访问）。绘制
命令数：旧 drawStair ≈ 86 条 → 新阶梯 61 条 / 新直梯 18 条（Node 假
Graphics 实测，stairsArt.test.ts 有断言）。

Playwright 实测（端口 5453、--workers=1、Chrome + SwiftShader、1280x800，
配对测量：同一层 101 先跑旧代码再装新美术跑，中途不切页面）：

| 测量（爬梯全程 ~1000ms） | 修前（旧美术 + 旧 stairPosition） | 修后（新美术 + 新 stairClimbPose） |
|---|---|---|
| 采样帧数 | 60 | 60 |
| 中位帧时间 | 16.6 ms | 16.9 ms |
| p95 帧时间 | 18.1 ms | 19.8 ms |
| 最大帧时间（落地重建那一帧） | 37.5 ms | 31.6 ms |
| 显示对象数 | 471 | 477 |

**结论：帧时间无回归**（中位/p95 在软件 GL 的噪声带内，RENDER.md 实测同代码
两遍跑降频均值能在 37-76ms 间漂；最大帧即落地时 clearFloor+drawFloor 的重建成
本——AG-09 实测过 3 层 24.1→12.0ms，那是「卡的会卡一下」的来源，与楼梯美术
无关，归 AG-09/AG-52 的只画本层工作）。一个楼梯口自始至终只有一个 Graphics
对象，爬梯期间每帧 create 的对象数 = 0。

「走上去不是滑上去」的实测签名（游戏时间斜率 dy/dt，不受帧抖动影响）：

| 探针 | 数据 | 读法 |
|---|---|---|
| 上楼 101（60 帧采样） | gameSlope=[-0.033, -0.366] px/ms；xRange=[42.5, 199.0] | 踩上一级瞬间 -0.366（比线性滑行的 -0.200 陡 83%），踏面上收敛到 -0.033（停顿）；x 先进到 199 再回 40（Z 折返）；160→-40 真实落地 102 |
| 下楼 102 | gameSlope=[0.034, 0.362]；xRange=[1081.7, 1239.1] | 镜像；360 落回 101 |
| 直梯 1→2 | xSpread=0.000；gameSlope 恒 -0.200（最大偏离 0.0000） | x 钉死、严格线性垂直爬升；落地 2 |

线性滑行（旧曲线）的斜率会恒为 -0.200；阶梯曲线在 -0.033 ~ -0.366 之间波动，
这就是「一级一级踩上去」和「滑上去」的数学差别。途中截帧（每方向 3 张，等角色
y 过阈值后暂停游戏循环再抓屏，见 output/ag53-shots/）+ 隔离画布 2 倍放大单拍
（iso-stairs-up/down、iso-ladder-slum/industry）为美术证据。

## 6. 测试与门禁

- `npx tsc --noEmit`：干净。
- `VITE_NPC_MODEL= npx vitest run`：**1601 通过 / 86 文件**（基线 1552 + 本次
  新增 49，无既有测试变红）。
- `node tools/assets-manifest.mjs`：`RESULT: clean`（接入前后一致；无新资产
  文件，所有新色值都是 `src/render/palette.ts` 板内角色，stairsArt.test.ts
  对每种形状逐条断言）。
- Playwright 探针（output/playwright.ag53.config.ts + output/ag53-probes/
  stairs.spec.ts，gitignore 不随提交）：**5/5 通过**——上楼/下楼/直梯爬梯 +
  帧时间配对 + 隔离画布美术单拍。截图在 `output/ag53-shots/`。

## 7. 探针暴露的既有 bug（归总控/AG-50，FloorSystem 一行修）

**宽楼层的下楼 traversal 起点与楼梯口不一致。** `stairTraversalFor` 的
startX/endX 用常量 `DOWN_EXIT_X`（=1280-40=1240），而交互区
（`stairMouthZone`/`currentInteractionZone` 用 `downExitXFor`）和美术
（GameScene.drawExits 传 `this.downExit`）都在 `downExitXFor(floor)`。tier 2
的楼层宽 1600（5 个 320 房间），下楼口在 1560：玩家在 1560 按下楼 E，爬梯
却从 1240 开始——角色先横跳 320px 再爬，画出来的楼梯（1560）和爬的楼梯
（1240）也不是同一条。tier 3+ 更宽（6-9 房间），偏差更大。

修法（systems/FloorSystem.ts，floorSystem.test.ts 钉的楼层 1-5 都是 tier 1、
`downExitXFor` 恰好等于 `DOWN_EXIT_X`，所以修完既有测试仍绿）：

```diff
-    startX: direction === 1 ? UP_EXIT_X : DOWN_EXIT_X,
-    endX: direction === 1 ? UP_EXIT_X : DOWN_EXIT_X,
+    startX: direction === 1 ? UP_EXIT_X : downExitXFor(state.currentFloor),
+    endX: direction === 1 ? UP_EXIT_X : downExitXFor(state.currentFloor),
```

（`downExitXFor` 已在该文件导入。）上行不受影响：`UP_EXIT_X` 是左端口，所有
楼层等宽。**这个 bug 也意味着 AG-53 的 GameScene diff 应用时应当连同这一行
一起合入**，否则新美术画在 1560、角色爬在 1240，比旧实现更脱节。

## 8. 没处理干净的地方（交接给总控）

1. **GameScene 未接入**（我的文件权限不含 src/scenes/**）：第 4 节 diff 应用前，
   游戏里跑的仍是旧滑步曲线；探针用运行时遮蔽 drawStair + rAF 驱动
   stairClimbPose 证明了接入后的效果。应用 diff（连同第 7 节的 FloorSystem
   一行）后需重跑 `e2e/stairNavigation.spec.ts` 与 `e2e/gameplay.spec.ts`
   复核（断言分析见 4.f，预期不受影响）。
2. **爬梯专用动画**：阶梯/直梯都复用 walk 循环（timeScale 1.25 / 1.0）。没有
   真正的「攀爬」动作片（四角色行动表里没有 climb clip）——要做的话得排新
   动画，属 AG-09/美术范畴。
3. **平台停留**：折返平台目前不停顿（第 5 级直接接第 6 级）。要停顿的话在
   `stairClimbPose` 的时间片切分上加一个 TURN_DWELL_MS 即可，曲线已留好位置。
4. **直梯的抓握判定**：交互区没为直梯加宽（位置判定不变，梯脚即口）。若希望
   「站在梯正下方一定范围内都能抓」，需改 FloorSystem 的 stairMouthZone
   （systems 归别人），当前行为：与阶梯完全一致。
5. **段 6（核心 100000）没有楼梯**（单层段），样式分派对它无输出；若将来核心
   段长出多层，现行分派会给它阶梯（非 ladder_tiers），符合预期。
6. **页内 renderer.snapshot 在 SwiftShader 下只能抓到黑帧**
   （preserveDrawingBuffer=false），探针的途中截帧改走「等 y 过阈值 →
   loop.pause() → page.screenshot → loop.resume()」；这是探针手法备注，
   不影响交付物。
