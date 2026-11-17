# 2026-11-18 性能轮：QA-02 满陈设场景帧率调查（AG-98 / perf-atlas）

> 分支 `perf/2026-11-18-atlas-batching`，tip `df86a8c`。本轮落地调研报告的
> P3（帧时间测量协议）+ P4（陈设图集化）+ P5（RenderTexture A/B 裁决），
> 针对 QA-02「满陈设场景（?devfloor=100000）帧率显著低于常规楼层」。
>
> **结论先说：QA-02 的方向性信号真实存在且每轮复测都复现，但「根因是
> draw call / 贴图 bind 多」的假设被测量推翻。图集化（P4）的理论上限
> ~0.1ms（p95 的 ~4%），远低于 15% 收益门槛，因此不实施、不回滚任何代码
> （本轮零渲染改动）。真正的成本大头是宽度缩放的 Graphics 命令重放，
> 下一轮候选是「按房间分块 + 相机剔除」，本文给出实测依据。**

---

## 1. P3 测量协议（新增工具 `tools/floor-perf-probe.mjs`）

沿用 docs/plans/RENDER.md §10.0 两条既有方法（AG-22 立、AG-80 继承），
按 2026-11-17 调研 P3 补齐为完整协议：

1. **读帧时间不读 FPS**：rAF 原始间隔（不是 Phaser 平滑后的 loop.delta），
   输出 avg / p50 / p95 / p99 / max（毫秒）。p95 > 16.67ms（60fps 预算）
   判 FAIL。
2. **解 VSync/帧帽**：Chromium 启动带 `--disable-frame-rate-limit
   --disable-gpu-vsync`（不加则 rAF 被钉在 16.7ms，p95/p99 失去意义），
   `--no-proxy-server` 直连 `http://[::1]:5209/`。
3. **固定 seed 42，同场景 3 复测取中位**；两场景对比走**交错协议**
   （每轮依次测两个场景、顺序逐轮反转）并报逐轮配对差中位——顺序测会让
   先测场景系统性赶上/错开负载 burst（实测顺序测时 p95 中位差被放大到
   +42%，交错后回到配对差口径）。
4. **场景**：`floor1`（1 层宿舍，4 房间 1280px，常规对照）vs
   `devfloor`（?devfloor=100000，9 房间 2880px 满陈设，QA-02 报的最差
   场景）。站立稳态采样（无面板/无输入）。
5. **附带显示树普查**（每轮一次）：对象数、按类型计数、**去重贴图数**
   （WebGL 里 texture bind 的直接代理量）、Graphics commandBuffer
   条目数（RENDER.md §10.1 量法）、当前楼层与层宽。
6. **冻结截图**（`--freeze --shot dir`）：改前/改后像素 diff 的取证手段。
   协议见 §5。
7. 探针默认经 localStorage 关闭教程层（`floor100000.tutorial.skipped`）：
   教程高亮是每帧重画的 Graphics 且随真实教程进度推进，是帧时间与截图
   的双重噪声源；教程层只有几个对象，不影响力级结论。

用法：

```
npx vite --port 5209 --strictPort --force   # dev server（netstat 预检端口）
node tools/floor-perf-probe.mjs --label baseline --json output/perf/x.json
node tools/floor-perf-probe.mjs --label after --freeze --shot output/perf/shots
```

### 1.1 改动前基线（seed 42，60 帧 × 3 轮，无头 Chrome）

机器状态说明：本机同时有 QA agent（ag-97-qa-r2）的 e2e 在跑，绝对帧时间
随时间波动 2-4 倍——**绝对值跨轮不可比，同轮同会话的配对差才是信号**
（任务书与 RENDER.md §10.0 同款口径）。记录到的对比：

| 运行 | 机器状态 | floor1 avg / p95 | devfloor avg / p95 | 同会话差 |
|---|---|---|---|---|
| A（顺序协议） | 安静 | 1.47 / 2.2 ms | 1.70 / 2.4 ms | avg +15.6%，p95 +9.1% |
| B（归因配对） | 较安静 | p50 1.5 ms | p50 1.9 ms | p50 +27% |
| C（交错协议） | QA 负载中 | 1.72 / 2.6 ms | 2.89 / 3.7 ms | 配对差 avg +1.17ms / p95 +1.1ms（+68% / +42%） |

**方向 100% 一致：devfloor 慢于 floor1；幅度随 CPU 争抢放大**
（安静 ~+10-15%，负载 ~+40-70%）——这与 QA 第 0 轮（负载下 49.3→30.6
FPS）定性吻合：差距是 JS 侧成本，争抢时放大。

显示树普查（确定性事实，与负载无关）：

| 场景 | 层宽 | 对象数 | Graphics 命令数 | 去重贴图数 |
|---|---|---|---|---|
| floor1 | 1280px | 635 | 6968 | 83 |
| devfloor | 2880px | 541 | 14299 | 71 |

注意方向：**devfloor 对象更少、贴图更少，却更慢**——「对象多/贴图多所以卡」
的直观假设第一层就过不去。

vsync 帽下的定性检查（不加 disable 旗标）：两场景 p50 均 16.7ms、无 33ms
丢帧——安静机器上两场景都守得住 60fps；QA-02 的体感卡顿来自负载放大后的
相对差距。

## 2. P4 图集化：假设被数据推翻（未实施，零渲染改动）

调研 P4 的假设：「buildFloor 逐房间 add.image 造 tile_window/tile_door/
furn_* + 多个 add.graphics()，每个不同贴图 = 一次 texture bind，混用
family 断批」。四条独立证据逐一否定它：

### 2.1 成本归因（轮内配对差，6 轮中位，交替显隐）

| 藏掉的类别 | devfloor 省下 | floor1 省下 |
|---|---|---|
| Graphics（线work/批次） | **1.05ms** | 0.90ms |
| Image（陈设/光晕） | 0.35ms | 0.20ms |
| Rectangle+Text（HUD/名签） | 0.15ms | 0.15ms |
| Sprite（角色/fx） | 0.05ms | 0.15ms |
| TileSprite（墙/地板带） | 0.00ms | -0.10ms |

帧时间的大头是 **Graphics 命令重放**（~55%），贴图填充合计仅 ~0.35ms
（18%）。devfloor 对 floor1 的劣势（~0.4ms p50）摊在 Graphics（+0.15ms）
与 Image（+0.15ms）上，没有一项是「贴图 bind 爆炸」。

### 2.2 draw call 直接计数（包 gl.drawArrays/drawElements）

| 场景 | 每帧 draw call |
|---|---|
| devfloor | 60 |
| floor1 | 56 |

几乎相同——没有任何「断批」迹象。且 Phaser 4.2.1 的 BatchHandlerQuad
是**多纹理批处理**（`renderer.maxTextures = 16`，实测）：一批可容 16 个
贴图单元，整层 ~20 个世界贴图只需 1-2 个批次项；源码注释明说线性查找
贴图序号「能吃掉 20% 帧预算」，他们已在纹理对象上缓存 unit。**「每个
不同贴图 = 一次 flush」在本渲染器不成立。**

### 2.3 贴图统一诊断（图集化的理论上限，顺序交替 8 轮配对差）

运行时把全部 Image 指到同一张贴图（显示尺寸不变，填充面积不变，只有
bind/flush 归 1）：

| 场景 | 统一贴图后省下（p50 配对差中位） |
|---|---|
| devfloor | 0.10ms |
| floor1 | -0.05ms |

即：**就算图集化完美到「全世界只有一张贴图」，也只能省 ~0.1ms ≈ p95 的
4%**——而 15% 的门槛需要 0.36ms。第一版诊断（顺序测）曾量到 devfloor
省 0.85ms，顺序交替复测证明那是负载漂移假象（floor1 的 Image 更多却省
得更少，自相矛盾）。

### 2.4 贴图数与帧时间不相关

floor1 有 83 个去重贴图（比 devfloor 的 71 更多）却更快。若 bind 是成本，
方向应该相反。

### 判定

**P4 不实施。** 收益门槛 p95 ≥15%（≈0.36ms），实测理论上限 ~0.1ms
（≈4%）。按任务书规则 4（硬塞没收益的改动是过错），不写烘焙脚本、不改
加载与调用点、不同步贴图键测试——本轮零渲染代码改动，故也无从回滚。
烘焙/改图集的活儿留给数据支持它的那一轮。

### devfloor 慢的真正原因（数据指向）

宽度缩放的 Graphics 命令重放：devfloor 层宽 2880px 是 floor1 的 2.25 倍，
buildWallDressing / buildFloorClutter / buildRoomDepth / buildSurfaceDetail /
buildCeilingLights / buildAerialHaze / buildForeground 全部按全宽绘制，
Graphics 命令数 2.07 倍（14299 vs 6968），每帧 commandBuffer 全量重放
（Phaser 4 的 GraphicsWebGLRenderer 无 dirty 缓存，RENDER.md §10.1 已诊断）。
RT 烘焙路线（P5-A）已被 RENDER.md §10.3 同协议测过为大回退（+16~31ms，
RT 填充按包围盒面积计费，全宽洗色/雾/墙裙的盒子巨大）。

**下一轮候选（本文档立据，未实施）**：把这些宽度缩放 builder 的产出按
房间（320px）分块，相机滚动时隐藏视口外分块。可见比例平均 ~58%
（1280/2880 相机在 2880 层宽上滚动），预期省 Graphics 成本的 ~40% ≈
0.4ms ≈ devfloor 帧时间的 15-25%。需要评估：renderPerf.test.ts 的对象
预算（LIVE_BOUND 140，分块后 Graphics 对象数上升）、邻居楼层与深度序。

## 3. P5 RenderTexture A/B：未触发（条件不满足 + 已有判决）

触发条件是「P4 后仍不达 60fps 线」。P3 协议下两场景 p95 均 ≤4.8ms、
vsync 帽下 p50 均 16.7ms——**60fps 线是达的**（安静机器）。且 A 路线
（整层静态陈设画进 RT）在 RENDER.md §10.3 已有同协议同机判决：6 层 × 3 轮
18/18 配对为正，慢 43-98%，根因是 RT 填充按包围盒面积计费（~5.3ns/px，
一层静态内容约 480 万像素/帧）而纯色 fillRect 走免纹理取样路径。B 路线
（图集化）被 §2 推翻。任务书「别反复试错」——**结论：两条都不采用，
结论写在这里，勿再试错。**

## 4. 画质无损证据

本轮**零渲染代码改动**（git status 只有新增的 tools/floor-perf-probe.mjs），
画质无损是构造性成立的：没有一个贴图、一个调用点、一个 family 被碰过。

冻结截图协议本身经过确定性验证（为将来的 A/B 轮准备）：同 seed 同位置
两次运行的逐像素 diff——

| 场景 | 差异像素 | 超阈(8) | maxDelta | meanLum 差 |
|---|---|---|---|---|
| devfloor | 75/1024000（0.007%） | 38 | 51 | 0.000 |
| floor1 | 32/1024000（0.003%） | 32 | 120 | 0.000 |

达到 RENDER.md §10.4 的噪声底量级（其新vs新2 基线 meanLum 差 ≤0.005）。
冻结协议钉住的不变量（每一步都是实测过不钉就 diff 不过的）：世界时间
06:00、世界状态回滚楼层落定快照（生存衰减随负载漂移）、商贩归出生点
（巡逻 tween 冻结时停在真实进度上）、HUD 按回滚状态重画、NPC 散步相位
（this.time.now 真实时钟）、清循环 Clock 事件（traderPatrolTimer 等）、
tween 全停、精灵钉第 0 帧、宿舍呼吸钉中点、灯光层 update(0)、尘埃位置
从快照恢复（y 每帧累加、update(0) 不归零）、scene update 事件摘除。
截图目检：商贩归位、门/水箱/墙饰/火把/玩家/HUD 完整、无绿框无错位。

## 5. 测试与提交

- `npx tsc --noEmit`：0 错误。
- `VITE_NPC_MODEL= npx vitest run`：112 文件 / 2021 测试全绿
  （VITE_NPC_MODEL= 前缀是本仓库既定约定，非环境绕行）。
- 提交内容：`tools/floor-perf-probe.mjs`（P3 协议工具）+ 本文档。
  无渲染改动，因此没有「改后数字」——基线即现状。

## 6. 已知风险 / 遗留

1. **本机一切性能结论绑定 SwiftShader + 当前负载**。QA-02 的体感幅度
   （负载下 30 vs 49 FPS）无法在安静机器上复现绝对値；跨轮绝对值不可比，
   只有同会话配对差有效。若将来要 GPU 口径，先去掉探针的 disable 旗标
   再比，不要混用（RENDER.md §10.6 第 4 条同款提醒）。
2. **下一轮候选未验证**：§2 的按房间分块 + 相机剔除只有成本侧实测
   （Graphics 占 55%、可见比例 ~58%），没有实现级 A/B；对象预算测试
   （renderPerf.test.ts LIVE_BOUND 140）可能需要调整，需先小范围试点。
3. 探针的冻结截图协议对**未来改动**的像素 diff 有效；本轮无改动可比，
   协议的正确性由「同 seed 两跑 diff ≤0.007%」间接证明。
4. tools/floor-perf-probe.mjs 依赖 dev server 预先起在 5209（netstat
   预检端口）；浏览器走 channel 'chrome'，与既有探针一致。
