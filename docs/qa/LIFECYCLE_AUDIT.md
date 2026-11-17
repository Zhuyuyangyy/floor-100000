# 生命周期清理审计（LIFECYCLE_AUDIT）

2026-11-17 第十轮质量周。对照 Setback 架构文档与 phaser-vue best-practices
的 restart-safe 标准（「3 连重启，第三局必须与第一局一致」）。

## 对象类型 × 创建点 × 销毁点

| 对象类型 | 创建点 | 销毁点 | 覆盖状态 |
|---|---|---|---|
| floorObjects（楼层道具） | drawFloor | clearFloor | ✅ |
| encounterObjects（战斗面板） | buildCombatPanel | closeCombat | ✅ |
| spotMarkers（问号点） | buildEncounterSpots | clearEncounterSpots | ✅ |
| combatStage（AG-70 舞台） | buildCombatStage | closeCombat→destroyCombatStage | ✅ |
| combatMonsterHit（敌人热区） | buildCombatStage | destroyCombatStage | ✅ |
| tutorialWorldGfx/HudGfx（AG-73 教程框） | initTutorial | initTutorial 先毁+shutdown | ✅ |
| tutorialSkipParts（跳过按钮） | initTutorial | initTutorial 先毁 | ✅ |
| nightChoice 面板 | buildNightChoicePanel | closeNightChoice | ✅ |
| BGM（AG-74 AudioSystem） | startFloorMusic/startMenuBgm | SHUTDOWN→stopBgm | ✅ |
| traderPatrolTimer（行商巡逻） | buildEncounterSpots | clearEncounterSpots+dae028b | ✅ |
| pendingAction delayedCall（AG-66） | beginPendingAction | 身份比对防旧 timer 落地 | ✅ |
| settings 覆盖层（AG-72） | buildSettings | create 重置+setVisible | ✅ |
| help/about 面板（AG-75） | buildHelp/buildAbout | create 重置 | ✅ |
| gesture 解锁监听（音频） | bindGestureUnlock | `{ once: true }` 自动摘 | ✅ |

## AG-82 的 e2e 实测（3 连重启对比，2026-11-17）

方法：开始→玩 30 秒→重新开始 ×3，对比 scene.children / tween 数 /
timer 数（第三局 vs 第一局，±5% 阈值）。实测记录：

- 第一轮扫描（AG-82 报）：BGM 的 context 'cursor'/'ended' 事件在 suspended
  停播路径上未摘——**集成侧复核（AG-74 分支 grep）确认该 listener 在合入
  版本中不存在**（AG-74 的建流只注册 `{ once: true }` 的手势监听，自动摘），
  判定为 AG-82 报告与实物不符，无此泄漏。
- 其余对象类型全部覆盖（见上表），重启契约由 src/tests/restartSafe.test.ts
  的 6 条源码断言钉住防回归。

## 结论

当前无已知跨重启泄漏。新增对象类型时的守则：**create 里建的，要么进某个
clear* 列表，要么在 create 首段先毁再建**——restartSafe.test.ts 的红旗会
逼你在文档里补一行。
