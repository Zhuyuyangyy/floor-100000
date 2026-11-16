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
