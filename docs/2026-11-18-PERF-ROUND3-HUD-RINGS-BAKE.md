# 2026-11-18 性能轮 3：HUD depth=103 四联圆环预烘焙（AG-102 / hud-rings）

> 分支 `perf/2026-11-18-hud-rings-bake`，tip `5cd8189`（AG-100 合并点）。
> 本轮候选来自 AG-100 报告 §4 的立据：「真正的成本大头在 HUD 的 depth=103
> 圆环组（4 个 Graphics / 1222 缓冲区值，成本 0.68ms ≈ 整个世界陈设的
> 1.1 倍）……把圆环预烘焙成贴图，预计可省 ~0.7ms ≈ 帧时间 25%」。
>
> **结论先说：候选成立，落地。四联圆环从每帧重三角化的 Graphics 换成一张
> RenderTexture（WebGL 同路径烘焙，只在数值变化时重画），floor1 p95 相邻
> 配对中位改善 -23.5%（门槛 ≥15%），devfloor -35.3%；像素级无损三证
> （默认态 devfloor 全图 0 差异、floor1 圆环区 0 差异、危险红态 0 差异）。
> 中途 generateTexture 路线（Canvas 2D 光栅化）被冻结 diff 证伪并记录。**

---

## 1. 定性：圆环组是什么（任务第 1 步）

- **位置与构成**：`GameScene.buildHud`（src/scenes/GameScene.ts，本版 4804
  行附近）原来创建一个 `barsGfx`（name `hud-stat-rings`，depth 103，
  scrollFactor 0）；`refreshStats`（每帧被 `update()` 调用）绘制四个环。
  每个环 = 1 条深色整圆 track + `Math.round(frac×12)` 个点亮 pip 弧 +
  ≤20% 时整体换危险红（`drawStatRing`，src/render/hudSkin.ts）。
- **静态/动态判定：部分动态**。track 与几何静态；pip 数量与颜色随
  hp/hunger/thirst/energy 变（取整值，`refreshStats` 的 `lastStats` key
  守卫，约 1/s——饥饿干渴按游戏分钟衰减）。
- **每帧重建与否：几何不是每帧重建（key 守卫），但 Phaser 4 的
  GraphicsWebGLRenderer 无 dirty 缓存——commandBuffer 每帧全量重放、
  42 条 ARC 每帧重新拍平+三角化**。这才是实测 0.68ms/帧的来源
  （AG-98 §2.1、AG-100 §4 已诊断；本轮复查
  node_modules/phaser/src/gameobjects/graphics/GraphicsWebGLRenderer.js
  确认无缓存分支）。
- **布局契约**：环组在顶板 row1（statX 292..916，ringCY 25，ringR 23，
  ringStroke 5， painted 外缘 25.5 → y 顶缘 -0.5 由画布顶裁掉）；环心
  数值 Text 在井内（e2e ag54 钉宽度/居中）；AG-77 toast 车道顶缘 112 =
  contextBottom(102)+10px，不压圆环；底部导航条 672..720 不相干。
  全部坐标来自 `HUD_LAYOUT`，换实现不动坐标即保持契约。

## 2. 路线选择与理由

**落地路线：整体烘焙 + 变化时整张重烘，烘焙后端用 RenderTexture。**

- **为什么整体烘而不是静态/动态拆分**：动态部分（pip 弧）恰是成本大头
  （588/1222 缓冲值、42 条 ARC）。拆成「烘焙 track + 实时 pip Graphics」
  会把最贵的部分留在每帧重放里，收益归零。四环总包围盒只有 628×51 px，
  一张贴图全覆盖，1 个显示对象替 1 个 Graphics，显示树对象数不变。
- **为什么重绘频率不是问题**：`refreshStats` 的 key 守卫下重画只在取整
  数值变化时发生（~1/s），整张重烘的摊销成本 ~0.01ms/帧。
- **烘焙后端 A/B（本轮实测裁决）**：
  - **A：`Graphics.generateTexture`（项目 canonical 模式，P8 教训后的
    默认路线）——证伪**。Phaser 4.2.1 的 generateTexture 走 Canvas 2D
    渲染器（`renderCanvas` + `ctx.arc`/`ctx.stroke`），与线上 WebGL
    三角化的边缘光栅化对不上：冻结 diff 1312 px（0.128%）、maxDelta 123、
    圆环描边全线差异（diff 密度图四带精确落在四环 x 列），是 0.007%
    噪声底的 18 倍——**不过像素级硬约束，弃用**。
  - **B：RenderTexture（`rt.draw(离屏Graphics)`，WebGL 同路径）——采用**。
    同一渲染器、同一批三角形、`antialias:false` 无 MSAA、`pixelArt:true`
    NEAREST 采样、整数位置——冻结 diff 回到 0（见 §4）。
- 实现细节（src/render/hudSkin.ts 的 `createStatRingsBaker`）：
  - RT 用 `setRenderMode('all')`——默认 `'render'` 模式永不执行命令缓冲，
    圆环会全空（RenderTextureWebGLRenderer 的 redraw/render 分支）。
  - `rt.clear(); rt.draw(gfx)` 只在数值变化时入队；RT 下次渲染时执行一次
    （命令缓冲执行后即清空），之后每帧只剩空检查 + 一个贴图 quad。
  - 离屏 Graphics 复用（`make.graphics(..., false)`，不上显示列表）。
  - 贴图盒 `statRingsBox(hud)` 由 HUD_LAYOUT 推导：x=289、y=0（顶缘与
    画布顶对齐，复刻屏幕对 y=-0.5 的裁剪）、628×51（forceEven 内部补到
    52，多出的一行全透明，像素中性）。
  - 重启安全：`buildHud` 重置块先毁后建（旧 RT 留着会让半透明 AA 边缘
    叠深）；`lastStats` 既有重置保证首帧必重烤。

## 3. 测量（floor-perf-probe 协议，端口 5213，60/120 帧 × 3 轮）

同机背景：本机并行有其他 agent（5212 等）活动，绝对帧时间跨会话漂移
2-4 倍——**只有相邻配对差是信号**（AG-98/AG-100 同款口径）。故采用
**前后交替配对**：B1→A1→A-rt→B2→A-rt2→B3→A-rt3→B4→A-rt4→B5→A-rt5
（B=基线 5cd8189，A=改后；A1 为已证伪的 generateTexture 路线，不参与
判定）。B4/B5 期间负载升高（floor1 avg 4.0-4.3 vs 早前 2.0），B5 复测
确认负载未在 B4→A-rt4 之间退去，该对有效。

### 3.1 floor1（门槛场景）

| 相邻对 | 负载 | B avg | A avg | Δavg | B p95 | A p95 | Δp95 |
|---|---|---|---|---|---|---|---|
| B1→A-rt | 中 | 2.11 | 1.76 | -16.6% | 3.0 | 2.6 | -13.3% |
| B2→A-rt2 | 中 | 2.31 | 1.59 | -31.2% | 3.4 | 2.6 | -23.5% |
| B3→A-rt3 | 低 | 1.99 | 1.80 | -9.5% | 3.1 | 2.7 | -12.9% |
| B4→A-rt4 | 高 | 4.33 | 1.68 | -61.2% | 6.4 | 2.5 | -60.9% |
| B5→A-rt5 | 高 | 4.04 | 1.77 | -56.2% | 5.5 | 2.4 | -56.4% |
| **中位** | | | | **-31.2%** | | | **-23.5%** |

**floor1 p95 相邻配对中位 -23.5% ≥ 15% 门槛 → 达标**（5/5 对全部为改善；
绝对节省 p95 0.4~3.9ms，随负载放大——与 AG-100 §3 记录的「安静 ~+10-15%、
负载 ~+40-70%」放大行为一致）。高负载对改善更大：固定 0.65ms 的 JS 成本
在 CPU 争抢下相对更贵。

### 3.2 devfloor100000

| 相邻对 | B avg | A avg | Δavg | B p95 | A p95 | Δp95 |
|---|---|---|---|---|---|---|
| B1→A-rt | 3.01 | 1.59 | -47.2% | 4.1 | 2.1 | -48.8% |
| B2→A-rt2 | 2.33 | 1.84 | -21.0% | 3.6 | 2.5 | -30.6% |
| B3→A-rt3 | 2.63 | 1.74 | -33.8% | 3.4 | 2.2 | -35.3% |
| B4→A-rt4 | 4.65 | 1.78 | -61.7% | 7.5 | 2.5 | -66.7% |
| B5→A-rt5 | 4.13 | 2.04 | -50.6% | 5.8 | 2.8 | -51.7% |
| **中位** | | | **-47.2%** | | | **-48.8%** |

### 3.3 同会话单集归因（chunk-cost-probe，改后代码，5 轮交错）

把圆环 RT 整对象藏掉（`--sets ringsRT --mode hide --rounds 5`）：

```
base中位    avg 2.3  p50 2.2  p95 3.9  p99 4.6
ringsRT中位 avg 2.39 p50 2.3  p95 3.7  p99 4.0
  avg 同轮配对差中位 -0.2ms；p95 -0.2ms；p99 -0.6ms
```

即**改后圆环组每帧成本 ≤0.2ms**（噪声量级），对比 AG-100 会话 C 用同一
工具同一协议量的旧 Graphics 单集成本 **0.68ms**（p95 -0.7ms、配对 -1.6ms）
——机制侧确认：圆环组成本从 0.68ms 降到 ≤0.2ms，节省 ≥0.48ms
（投影 ~0.65ms），与 §3.1 的帧时间改善方向与量级自洽。

### 3.4 显示树普查（确定性事实）

| 场景 | 对象数 | Graphics 缓冲值 | 去重贴图数 |
|---|---|---|---|
| floor1 基线 | 635 | 6968 | 83 |
| floor1 改后 | 635 | **6380（-588）** | 83 |
| devfloor 基线 | 541 | 14299 | 71 |
| devfloor 改后 | 541 | **13711（-588）** | 71 |

-588 精确等于 AG-100 归因的圆环 Graphics 缓冲值（588，含 42 条 ARC）；
对象数 1:1 不变（Image/RT 替 Graphics）；RT 内部贴图走 RenderTexture 类型
不计入 Image/Sprite 的去重贴图普查。gfxCommands 数字也证明环组已完全
退出每帧 commandBuffer 重放。

## 4. 像素级无损证据（AG-98 冻结协议 + 新增 tools/png-diff.mjs）

| 对比 | 差异像素 | 超阈(8) | maxDelta | 落点 |
|---|---|---|---|---|
| devfloor 默认态 冻结 diff | **0 / 1024000（0.000%）** | 0 | 0 | 全图 |
| floor1 默认态 冻结 diff | 6 / 1024000（0.001%） | 6 | 123 | bbox [0,527]..[13,533]——左下世界角，冻结协议自身噪声类（AG-98 同 seed 两跑基线为 32-75 px / maxDelta 120）；**圆环区 0** |
| 圆环带 危险红态（hp17/hunger15） diff | **0 / 31900（0.000%）** | 0 | 0 | 环带全条 |

前两行用 floor-perf-probe `--freeze --shot` 同 seed 同状态截图；第三行用
e2e ag54 的 critical 截图（改前/改后各跑一次 spec）。三证合计：**圆环
区域零差异**，floor1 全图 6 px 低于协议自身噪声底。布局契约保持是构造性
的：环组坐标全部来自 HUD_LAYOUT，RT 按 `statRingsBox` 推导的同一位置/
同一深度（103）/同一 scrollFactor 挂载；e2e ag54（3 视口）复跑 3/3 通过
（八个环文本、井内居中、低血变红、无 page error）。

## 5. 测试与提交

- `npx tsc --noEmit`：0 错误。
- `VITE_NPC_MODEL= npx vitest run`：113 文件 / 2037 测试全绿
  （基线 112/2021，+1 文件 +16 测试；VITE_NPC_MODEL= 是本仓库既定约定）。
- `npx playwright test e2e/ag54-hud-rings.spec.ts`：3/3 通过（三视口）。
- 新增 `src/tests/hudRingsBake.test.ts`：贴图盒算术/顶缘裁剪/组绘制契约
  （本地坐标、pip 数、≤20% 危险红）/ 烘焙机制（RT 放置与 'all' 模式、
  离屏源、clear+draw 次数、destroy）/ GameScene 接线源码断言。
- 新增 `tools/png-diff.mjs` + `tools/png-diff-map.mjs`：冻结截图逐像素
  diff 与差异密度图（AG-98 同款指标口径）。
- `tools/chunk-cost-probe.mjs`：新增 `ringsRT` 集（按 name 选
  RenderTexture），兼容既有 Graphics 集语义。
- textureKeys.test.ts **零改动**：RT 用内部 UUID 键，无运行时字面量键
  需要登记（P8-CROWBAR 教训不触发）。

## 6. 已知风险 / 遗留

1. **本机结论绑定 SwiftShader + 并行负载**：绝对帧时间跨会话漂移 2-4 倍，
   本报告只用相邻配对差与同会话单集归因下结论。安静机器上的相对改善
   （B3 对 -9.5%/-12.9%）低于负载机器——若将来要安静机口径，需复测。
2. **RT 路线新增的两个 Phaser 面**：`setRenderMode('all')`（否则命令缓冲
   不执行、圆环全空）与 `forceEven`（51→52，多一行全透明，像素中性，
   已核实）。两者都是版本相关行为，升级 Phaser 时需复跑冻结 diff。
3. **hudIcons（depth 103 静态字形 Graphics）仍在每帧重放**：它是纯
   fillRect/fillCircle，单位成本远低于 ARC，且零重绘——本轮未动。若将来
   还要榨这一层，它是同路线候选（烘焙成一张贴图）。
4. **AG-103 干涉事件**：本轮测量后期，lighting agent 的 AG-103 改动
   （lighting.ts + GameScene.ts 的梯口灯池/夜色铺满/顶灯带参数化）
   出现在本 worktree 工作区并覆盖了本轮未提交的改动。已从 object store
   完整恢复（无损失），AG-103 的 patch 保全在
   `output/perf/INCOMING-ag-103-from-other-agent.patch`，**未纳入本提交**，
   已报告 team-lead 与 fix-lighting 处置。全部性能测量均早于该事件，
   数据不受影响。
5. 圆环组成本归因（0.68ms）来自 AG-100 会话 C；本轮同协议复测改后状态
   为 ≤0.2ms，两侧协议一致但分属不同会话，绝对值不可直接相减——
   §3.1 的帧时间配对差才是落地依据。
