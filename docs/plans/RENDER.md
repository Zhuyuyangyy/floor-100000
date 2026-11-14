# RENDER — 场景渲染与性能（AG-09）

测量环境：Windows 11 + Playwright 捆绑 Chromium（headless，SwiftShader 软件 GL），
1280x800 视口，`?seed=42` 新开局，探针 teleport 到目标层后测 150 帧 rAF 帧间隔，
并跑一轮 CDP 4 倍 CPU 降频（`Emulation.setCPUThrottlingRate: 4`）放大渲染成本差。
对象数 = Game 场景显示树的深度遍历（含邻居楼层容器内的子对象）。

修前/修后两次测量都在同一台机器、相隔几分钟的窗口内完成（`git stash` 切换代码后
重测，消除其他 Agent 并行跑测试带来的负载漂移）。像素对比前先把画面冻结
（动画 timeScale=0、灯光层 update 打桩、HUD 文本钉住、精灵钉到第 0 帧），
并以"同一份代码跑两遍"的噪声底线为参照。

## 1. 性能基线（修前，原始代码）

| 楼层 | 显示对象总数 | 其中 Rectangle | 平均帧时间 | 4x 降频平均 | 楼层重建耗时* |
|---|---|---|---|---|---|
| 1 | 1453 | 1199 | 23.7 ms (46.9→实测 42 fps) | 46.5 ms | 11.4 ms |
| 2 | 1774 | 1509 | 27.9 ms | 52.2 ms | 20.3 ms |
| 3 | 2112 | 1825 | 28.3 ms | 60.7 ms | 24.1 ms |
| 5 | 2091 | 1812 | 28.7 ms | 60.5 ms | 21.6 ms |
| 100 | 1408 | 1184 | 21.6 ms | 60.3 ms | 14.6 ms |
| 10000 | 1436 | 1208 | 21.6 ms | 76.4 ms | 17.9 ms |

\* 楼层重建耗时 = `clearFloor() + drawFloor()` 的墙钟时间，即爬楼梯/坐电梯时玩家
能感觉到的那一下卡顿的源头。3/5 层有四个邻居楼层（上下各两层都有内容），所以最重。

静止时每帧 create 的对象数 = 0（所有楼层）：没有每帧泄漏，创建全部集中在地图绘制。

## 2. 优化内容

**静态图形合并（roomDepth.ts 新增 RectBatcher）**。一层地板 + 邻居楼层共有 2100+
个显示对象，其中 1800+ 是 Rectangle，而它们全是静态的：墙裙、污渍、导线槽、前景
剪影、接触阴影——画完之后一帧都不会再动。RectBatcher 把同一深度的一批矩形烘进
同一个 Graphics：

- 覆盖 buildRoomDepth / buildForeground / buildSurfaceDetail / buildCeilingLights
  （外壳与吊杆）/ addContactShadow / buildWallDressing / buildFloorClutter /
  buildAerialHaze；
- lighting.ts 的 ambient 两带、vignette 十六条合并成两张 Graphics；
- 保持独立对象的只有三类：会动的（尘埃 mote、火焰）、需要被调用方按类型识别的
  （天花灯管：邻居楼层靠 `instanceof Rectangle` 换暗它的 fill，见
  GameScene.dimObject）、ADD 混合的贴图光晕（Image）。

**视觉语义不变的三条保证**（改前改后逐一核对）：

1. 同一深度一批矩形 → 一个 Graphics，命令顺序 = 原插入顺序；不同深度仍是不同的
   Graphics 按原顺序返回。Phaser 以 depth 为主排序键、相等 depth 按插入序，所以
   跨深度、跨 builder 的遮挡关系完全保持；
2. `fillStyle(color, alpha)` 逐形状携带 alpha，`fillRect(x, y, w, h)` 与
   `setOrigin(0,0)` 的 Rectangle 是同一个四边形；`setOrigin(0.5)` 的（水洼、接触
   阴影）换算成左上角坐标；
3. 斜靠的木板（唯一旋转形状）用 save/translateCanvas/rotateCanvas 画进同一个
   Graphics，对应 setOrigin(0,0) + setAngle(8) 的旋转中心。

**wallKeyFor 阶层 4/5 分支（corridors.ts）**。见第 4 节。

## 3. 实测收益（修后）

| 楼层 | 显示对象总数 | 其中 Rectangle | 平均帧时间 | 4x 降频平均 | 楼层重建耗时 | 对象数降幅 |
|---|---|---|---|---|---|---|
| 1 | 401 | 120 | 28.9 ms | 56.3 ms | 7.4 ms | 3.6x |
| 2 | 423 | 122 | 31.1 ms | 125.2 ms | 15.4 ms | 4.2x |
| 3 | 462 | 134 | 31.4 ms | 106.4 ms | 12.0 ms | 4.6x |
| 5 | 452 | 132 | 28.7 ms | 113.1 ms | 10.6 ms | 4.6x |
| 100 | 364 | 110 | 23.3 ms | 97.0 ms | 10.9 ms | 3.9x |
| 10000 | 367 | 108 | 22.0 ms | 51.6 ms | 11.2 ms | 3.9x |

- **对象数 3.6-4.6 倍下降**（1453→401、2112→462、1436→367）。剩余 Rectangle 只有
  天花灯管（6）+ 尘埃（14）这两类故意保留的；Graphics 从 24-36 涨到 56-77，但那是
  合并后的批次不是成本。
- **楼层重建耗时 1.4-2.4 倍下降**（3 层 24.1→12.0ms，5 层 21.6→10.6ms，
  10000 层 17.9→11.2ms）——爬楼梯卡顿接近减半，这是对象数下降最直接的玩家可感收益。
- **稳态帧时间基本持平、降频下略差**。诚实记录：Phaser 4 的
  GraphicsWebGLRenderer 没有 dirty 缓存，每帧重放整张 commandBuffer
  （GraphicsWebGLRenderer.js 直接遍历 src.commandBuffer），一层五栋楼的 dressing
  合计约 1650 条 fillRect/帧的矩阵乘法，抵掉了一部分合并收益。软件 GL 下帧时间
  本身噪声很大（同代码两遍跑，降频均值能在 37-76ms 间漂），所以这一项只作记录、
  不作结论：**合并买到的是对象数、内存与重建成本，不是稳态帧率**。

## 4. 视觉不变性证明

- 结构对比：修前 1446-2105 项差异，全部来自"Rectangle → Graphics"这一预期的对象
  形态变化（逐项核对过深度、坐标、尺寸、颜色、alpha 的映射）。
- 像素对比（40x24 细胞均值签名，冻结画面后各楼层一张）：修前 vs 修后每层只有
  1-30/960 个细胞超过阈值 1.5，maxDelta 2.3-21；而**同一份代码跑两遍的噪声底线是
  0-22/960、maxDelta 1.4-24.8**。两次对比的统计量同量级，且 meanLum 差 ≤0.19
  （噪声底线 ±0.2）——超出阈值的细胞全部落在已知动画元素上（呼吸光晕、尘埃、
  冻结在第 0 帧的火焰）。结论：**逐像素不可区分**。

## 5. 墙分支：阶层 4/5（等 AG-07 交图）

`wallKeyFor` 新增阶层 4（中产与商业区，10000-10010）与阶层 5（富人特权区，
50000-50010）两个分支，指向本文件导出的常量：

- `ENV_WALL_COMMERCIAL_KEY = 'env-wall-commercial'`
- `ENV_WALL_VIP_KEY = 'env-wall-vip'`

门禁用 `ENV_FILES`（artpack.ts 的纹理映射表）判断，**不创建假图**：映射不存在时
回落贫民墙 `env-wall`——一堵缺席的墙会渲染成 Phaser 的绿色 __MISSING 占位
（textureKeys.test.ts 就是抓这个的），比一堵旧墙更糟。

AG-07 接线契约（交图后一行不用改本文件）：在 artpack.ts 的 ENV_FILES 里加

```
'env-wall-commercial': 'wall-commercial.png',
'env-wall-vip':        'wall-vip.png',
```

BootScene 会加载 ENV_FILES 的每一条，映射一存在分支自动换新墙；
furniture.test.ts 已断言每个 ENV_FILES 条目都对应真实 PNG，"映射了但没交图"
在测试层就红，不会运行时绿框。renderPerf.test.ts 里有对应的契约测试（含临时
注入映射再清理）。

## 6. 昼夜与光照：54 层全楼层验证

对全部 54 个可玩楼层（1-10、100-110、1000-1010、10000-10010、50000-50010）
逐个 teleport 到 23:00 深夜，断言：

- `night-overlay` 存在且 alpha > 0（实测 0.4-0.6）；
- 灯光层存在，LIGHT_DEPTH(24) 上有 38-58 个对象（灯池光晕 + 尘埃 + 玩家随身光）；
- 画面既不全黑也不全亮：mean luminance 39-48、纯黑像素 1.3-3.8%、纯白 0-0.05%。

54/54 通过，修前修后各跑一遍，结果一致——没有任何楼层漏画 overlay 导致全黑，
也没有哪层灯光层缺失导致全亮。

## 7. 测试：src/tests/renderPerf.test.ts（43 个，全绿）

记录型假场景（无 Phaser，Node 直接跑 render 模块的产出）断言：

- **对象预算**：每个走廊层（2/3/4/5/100/1005/10005/50005）的渲染产出 ≤140，
  邻居楼层 ≤130（实测 46-60 / 36-46，留一倍余量防"每层又多出几百个对象"的回退）；
  对象数不随楼层数字增长；单房间主题装饰 ≤8；dorm 灯光层 ≤60、走廊层 ≤40；
- **邻居门禁**：stackNeighbours（GameScene.ts:618-632 循环的纯函数化）——段内上下
  都画、段间空洞不画（100 层只画 101/102、10 层只画 9/8、110 层只画 109/108）、
  不越可玩边界、距离与方向标注正确、对全部 54 层断言邻居数 ≤ STACK 且有内容；
- **确定性**：同 seed 两次进入同一层，对象记录（类型/深度/坐标/尺寸/颜色/alpha/
  纹理/ Graphics 命令序列）逐项相同；不同楼层号的墙饰必须不同；灯光层 redraw(0)
  初值与 update 轨迹两次一致；销毁会销毁它创建的每个对象；
- **墙分支**：阶层 1/2/3 用对的墙；阶层 4/5 未交图回落贫民墙；临时注入 ENV_FILES
  映射后立即换新墙（AG-07 接线契约）；
- **昼夜契约**：NIGHT_DEPTH < LIGHT_DEPTH 且高于演员；每层都建得起带双灯池的
  灯光层（2 光晕 + 14 尘埃 + ambient/vignette 各一张合并图）；接触阴影合并为
  一张 Graphics。

为使 render 模块可在 Node 里 import，lighting.ts / corridors.ts / roomDepth.ts 的
Phaser 导入改为 `import type`（此前只有 lighting.ts 真正按值用了
`Phaser.BlendModes.ADD`，换成字面量常量并注释说明；值与 Phaser 4.2.1 枚举一致）。
walkcycle.ts 本来就是 type-only 的，这是本仓既定模式。

## 8. 验证数字

- `npx tsc --noEmit`：干净。
- `VITE_NPC_MODEL= npx vitest run`：902 passed / 0 failed（60 文件）。其中
  renderPerf.test.ts 43 个。注：866 的团队基线含 AG-01 成长线（本分支起始时没有，
  已把 ag-01-lead 合入本分支补齐）；902 里还含其他 Agent 正在本 worktree 里改进的
  floorSystem/shortcut 测试增量，**提交只包含 AG-09 的文件**。

## 9. 没处理干净的地方

1. **稳态帧时间没有改善**（见第 3 节）：Graphics 每帧重放 commandBuffer。若要继续
   压，得把静态批次烘成纹理（每帧一个 quad），但纹理 key 的生命周期需要
   GameScene 的配合（活地板与邻居同帧绘制，固定 key 会互相覆盖），本轮不做。
2. **邻居楼层的火把/火焰仍然是"创建后再隐藏"**：drawNeighbourFloor 用 dimObject
   把 torch/candle/brazier 纹理的精灵 setVisible(false)，但对象已创建、动画已
   播放（只是不可见）。属于 GameScene 的调用策略，未动；要省得从
   buildCeilingLights 加参数，需要在报告里向总控报行号的那类改动。
3. **GameScene.ts:618-632 的邻居循环**与 corridors.ts 的 stackNeighbours 是同一
   规则的两份实现（本模块不 import scene，所以规则在本模块侧单测）；如总控愿意，
   可把循环换成调用 stackNeighbours，行号已在本文件第 7 节给出。
4. **楼层重建只测了墙钟时间**，没有拆 GPU 上传/纹理加载部分；dev server 下的
   测量含 Vite 转换开销的暖机差异。
5. 本 worktree 期间有另一个 AG-09 会话并发写入（互相覆盖过文件与探针），最终以
   本次提交的代码与数字为准；早先它的 perf-beforeA.json 是在错误代码树上测的
   （端口被别的 dev server 占用），已弃用不采信。
