# B3-15 · 停留压力（dwell pressure）

**里程碑 M1 · B3 收尾 · 2026-10-29**

## 问题（两个已实测的病）

- [`M1_PLAYTEST.md`](M1_PLAYTEST.md)：实测收工 12:00，一昼夜剩 **8.0 小时空窗**——滞留零成本
- [`B3-06_NIGHT_DANGER.md`](B3-06_NIGHT_DANGER.md)：夜间威胁只杀站着不动的人，且**夜里零收益**，最优玩法是躲被子——夜晚与滞留都没有价格

CENTUM 源码级逆向（[`RE_COMPETITIVE.md`](RE_COMPETITIVE.md)）给出的答案：它的风险不来自夜晚，来自**停留**——每层一个回合计时器，归零 roll 刷怪，强度随已刷次数上升。

## 做法

新增 `src/systems/dwellPressure.ts`（纯逻辑 + seeded RNG，项目禁 `Math.random` 规矩不变）：

- 每层停留每 `dwellPressure.rollIntervalGameMinutes`（config，60）游戏分钟 roll 一次；3 游戏分钟/现实秒 → **每 20 现实秒一次**
- 概率表随 roll 次数升级且**单调不降**：75/0 → 50/25 → 35/45 → 25/60（atmosphere/prowler），第 4 行封顶
- atmosphere = 氛围文案（楼板响、远处脚步）；prowler = 复用既有巡游体事件（`source:'dwell'`），**昼夜皆然**——改 `updateWanderer` 的门槛：夜里或 dwell 来源都激活
- **换层重置**：离开即逃脱，pressure 的目的就是让"搜完就走"成为默认
- **宿舍豁免**：家永远是合法逃脱点（设计冻结 §5 无软锁）
- 单事件槽规则不变：已有 activeEvent 时只出氛围不出巡游体；换层时 dwell 来源的事件被清除，不占当天夜事件名额
- 存档：`worldEvents.dwell` 可选字段 + `validateDwell` 校验；旧存档缺字段时 `ensureDwell` 懒重建，**不升 schemaVersion**（加法字段，旧档仍有效）

## 验证证据

- `npx tsc --noEmit` → 0 错误
- `npx vitest run` → **351 passed (26 files)**；新增 10 条 dwell 测试（累计/换层重置/到期时刻/确定性/300 种子统计验证升级单调性/宿舍豁免/旧存档兼容）
- `npm run build` → 通过（chunk 大小警告为既有情况）
- `npx playwright test e2e/dwellPressure.spec.ts --workers=1` → **1 passed (21.8s)**：真实爬到第 2 层，帧循环自行滚出第一次 roll，零 page error，截图 `e2e/screenshots/35-dwell-pressure.png`
- `npx playwright test --workers=1` 全量 → **61 passed / 1 failed**；失败项 `survival.spec.ts` day-8 用例单跑 4.2s 通过、整文件 6/6 通过——长跑负载 flakes（该用例全程在第 1 层，停留系统对宿舍豁免，代码路径零行为变化）

## 调参入口

`config/game-balance.json` → `dwellPressure.rollIntervalGameMinutes`。概率表在 `src/systems/dwellPressure.ts` 的 `TABLE`（改它需要同步改测试里的统计断言）。

## 遗留问题

- 氛围文案目前 5 条，多次 roll 会重复；量产后可进数据模块
- 白天空转也会 roll（不只是夜晚）——这是设计意图（治空窗），但人工试玩需确认密度是否舒服
- 巡游体速度低于玩家，只能追杀站着不动的人（B3-06 实测）；停留压力当前主要制造"该走了"的推力而非致命威胁

## 下一步

人工试玩判定停留密度 → 若通过，B3 章节可交人工验收；随后决定 B4 是否开始（B4 生成器可直接复用本模块的 roll 表模式做楼层事件）。
