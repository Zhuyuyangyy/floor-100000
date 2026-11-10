# B3-19 — 自然楼梯攀爬

- 里程碑：M1 可玩原型
- 目标：消除普通楼层切换的传送感，让楼层变化成为玩家看得见的空间移动。
- 设计记录：[`plans/2026-11-10-natural-stair-traversal-design.md`](plans/2026-11-10-natural-stair-traversal-design.md)

## 已完成

- 普通楼梯改为同一场景内的连续斜向攀爬，时长 1000ms。
- 上楼从左侧楼梯到上层右侧楼梯；下楼反向落地。
- 攀爬过程中不修改 `currentFloor`、不存档、不触发重复交互。
- 落地后才刷新楼层、访问记录、深度解锁、事件状态和存档。
- 楼梯绘制改为带踏步和扶手的连续斜向连接段，与角色路径一致。

## 技术收尾（TASK 01–03）

- 横向相机边界固定为单层 `0..1280`，楼层完整可见，只有上下楼的塔楼剖面允许纵向滚动。
- 玩家、携带光源和接触阴影统一通过 `syncPlayerWorldObjects()` 同步；落地重绘后光源不会留在旧坐标。
- `STAIR_START_Y` 与 `STAIR_RISE` 成为楼梯几何合同，`FloorSystem.stairPosition()`、`drawStair()` 和邻层落点使用同一组参数。
- 浏览器断言覆盖起点 x=40、中间 x=640、落地 x=1240 的相机位置；落地光源跟随到 x=1240、y=120。

## 验收结果

- `src/tests/floorSystem.test.ts`：自然楼梯纯逻辑通过。
- `e2e/gameplay.spec.ts`：攀爬中楼层号保持不变，落地后到第 2 层对侧楼梯口。
- `e2e/survivalJourney.spec.ts`：真实走楼梯完成第 1–5 层往返、制作、睡眠和存档。
- `npm test -- --run`：47 files / 650 tests PASS。
- `npx playwright test --workers=1`：67/67 PASS（包含 4.1 分钟五层真实旅程）。
- `npm run build`：PASS，只有既有 bundle 体积警告。
- 实机截图：[04-floor-2.png](../e2e/screenshots/04-floor-2.png)。

## 已知边界

本轮没有加入跳跃、逐级碰撞、跌落伤害，也没有改变付费 `F` 近路的专用跳层行为。TASK 04–06（攀爬动画参数、楼梯时间成本、字体与 README 清理）等待这一轮体验验收后再启动。
