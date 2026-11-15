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

## 10. 第二轮：静态批次烘纹理——实测不可行，已回退（AG-22）

第 9.1 条留的题，本轮**做完了实现、测完了、然后回退**。结论先说：在 SwiftShader
下把静态 Graphics 烘成 RenderTexture 会让稳态帧时间**慢 16-31ms（约 2 倍）**，
与预期相反。原因是本场景的稳态成本是**填充率**（每像素的纹理取样 + alpha 混合），
不是 commandBuffer 重放；烘焙把廉价的纯色 fillRect 换成昂贵的大块 alpha 纹理，
还顺带为透明包围盒付费。全部实测数据与诊断在下面，方案本身（含为什么不用固定
key）也完整记录，留给将来上真实 GPU 时参考。

### 10.0 测量方法（本轮的两处加强，建议后续沿用）

- **无降频测量必须加 `--disable-frame-rate-limit --disable-gpu-vsync`**。不加时
  headless Chromium 的 rAF 被 vsync 钉在 16.7ms，中位数完全不可用（实测 floor 3：
  median 16.70 而 mean 24.05——上半尾被吃掉，中位数失去意义）。加上后分布恢复
  真实（同代码 floor 3：p10 24.6 / median 26.4 / p90 28.3）。第 1 节那些 21-31ms
  的数字应该也是这样测出来的。
- **A/B 交错，不是先后**。本轮开发机上全程有 4-6 个 Agent 的测试/e2e 在跑，同一
  份代码相隔几分钟重测，floor 3 能从 31.5 漂到 62.0ms。所以每轮先在旧代码测、立刻
  切回新代码再测，3 轮取配对差；**单轮绝对数字不可信，配对差才可信**。代码切换用
  `git show <rev>:<file> > <file>`；不要用 `git checkout`——重负载下它会挂死
  （本轮挂过 25 分钟，疑与行尾/索引竞争有关），且会动 index。

### 10.1 基线复测（旧代码 = AG-09 合入态，配对测量）

| 楼层 | 显示对象 | 其中 Graphics | Graphics commandBuffer 条目* | 中位帧时间（3 轮各自） |
|---|---|---|---|---|
| 1 | 484 | 33 | 7005 | 30.9 / 45.6 / 40.0 |
| 3 | 511 | 37 | 9678 | 31.2 / 46.4 / 34.2 |
| 5 | 501 | 37 | 9142 | 31.0 / 45.9 / 32.4 |
| 100 | 413 | 31 | 2257 | 21.4 / 31.0 / 24.5 |
| 10000 | ~400 | ~30 | ~2300 | 21.4 / 31.1 / 23.8 |

\* commandBuffer.length 把参数也数了进去（fillStyle 3 格、fillRect 4 格），
9678 条目 ≈ 1380 个 fillRect 当量/帧。

复现结论：**AG-09 的数字在本机成立**（floor 3 旧代码 31-46ms vs AG-09 的 28.3ms，
本机负载更重）；"稳态持平"也成立——AG-09 合入前后稳态确实没有可测差异，本轮
10.3 的配对差进一步量化了这一点。

### 10.2 实现方案（完整记录，代码已回退但设计可复用）

`bakeStaticLayer(scene, g, depth, bounds)`（render/lighting.ts，roomDepth.ts 的
RectBatcher 与灯光层共用）：把画完的 Graphics 按**内容包围盒**大小烘进一个
RenderTexture——命令在楼层建造时重放一次进帧缓冲，之后每帧一个 quad。
RectBatcher 边画边记每个深度的包围盒，纹理不大于内容。

**为什么不是 `generateTexture` + 固定 key**（第 9.1 条点名的互覆，本轮给了完整
答案）：keyed 纹理住在全局 TextureManager，第二个 bake 同一 key 的楼层会覆盖第一个，
而**活地板与它的上下邻居就在同一帧里画**——站在 3 层时 2/4/5 与 3 同框，共用
`room-static-3` 就会互相显示对方的内容。按楼层区分 key 能免互覆，但纹理随访问过的
楼层无限累积（54 个可玩楼层 × 每层约 12MB 全宽 RGBA），且楼层切换不清理——
clearFloor 在 GameScene 里，render 模块钩不到。RenderTexture 每实例自持帧缓冲：
`RenderTexture.preDestroy` 销毁它的 DynamicTexture，楼层对象表（floorObjects /
邻居 layer 容器）就是生命周期管理器——没有 key 可撞、无需逐出、不会跨楼层复用
陈旧内容。代价是每次换层重烘一次。

**保真性验证过**（实现是真跑通的，不是纸上方案）：DynamicTexture 的 FILL 命令跑
的就是 Graphics fillRect 的同一个 FillRect render node（DynamicTextureHandler.js:143），
预乘 alpha 混入透明黑帧缓冲，source-over 可结合；帧缓冲纹理默认 NEAREST
（DrawingContext.js:284，仅 config.antialias 才 LINEAR，本项目 pixelArt:true）；
RenderTexture extends Image，进得了容器、按原深度与返回数组位置落位、邻居的
layer.setAlpha(1-0.09*distance) 照旧乘上去。**邻居不上色语义**：dimObject 对"有
setTint 的对象"上色，而 Graphics 的 Mixin 列表没有 Tint 组件——墙裙/雾气/深度带
从来没被上色过（距离感由 layer alpha 与 detail 的 0.68 fade 承担）；RenderTexture
是 Image 有 setTint，实现里在实例上屏蔽了它（有专项断言钉住）。天花灯管保持
Rectangle（邻居换 fill 的分支原样能动），火焰/ADD 光晕不烘。浏览器实测截图逐层
核对无绿框、无错位、无模糊。

### 10.3 实测收益：负的，而且很大

配对中位帧时间（旧 → 新，每轮 after−before 的差值列在后面；3 轮全部同向）：

| 楼层 | 旧（3 轮中位） | 新（3 轮中位） | 每轮配对差 | 结论 |
|---|---|---|---|---|
| 1 | 40.0 | 57.4 | +15.8 / +16.4 / +17.4 | 慢 ~43% |
| 2 | 42.2 | 64.7 | +31.1 / +30.7 / +22.5 | 慢 ~53% |
| 3 | 34.2 | 62.2 | +31.0 / +31.2 / +23.9 | 慢 ~82% |
| 5 | 32.4 | 61.9 | +30.9 / 30.5 / +24.3 | 慢 ~91% |
| 100 | 24.5 | 47.9 | +25.9 / +31.2 / +23.4 | 慢 ~96% |
| 10000 | 23.8 | 47.1 | +25.7 / +30.6 / +22.6 | 慢 ~98% |

（绝对帧时间受并行负载影响，两列都偏高；**配对差才是信号**：6 层 × 3 轮 18 个
配对全部为正，+16 到 +31ms。）CDP 4 倍降频下同样 18/18 配对为正（+14.4 ~ +40.5ms，
floor 3：44.4 → 72.2ms），没有"降频下反号"的迹象。

**诊断（同一会话内交替显隐、各取 5 次中位，排除漂移）**：

| 量法 | 旧代码 | 新代码 |
|---|---|---|
| 藏掉静态 Graphics（78 个）后省下的每帧成本 | 0.7ms（floor 3）/ 4.2ms（floor 100） | — |
| 藏掉烘焙 RT（41 个）后省下的每帧成本 | — | 25.1ms（floor 3）/ 28.9ms（floor 100） |
| 藏掉 Image（133 个：墙/地板美术+道具+光晕） | 16.7ms（floor 3） | — |
| 按面积验证：只藏 12 个小 RT（depth 3/4，合计 442k px） | — | 0.3ms |
| 再藏 29 个大 RT（depth 0/1/2/8/26，合计 4375k px） | — | 23.3ms（≈5.3ns/px） |

结论三层：

1. **commandBuffer 重放确实存在但很便宜**：3360 个 fillRect 当量/帧的 JS 重放 +
   纯色填充合计只有 0.7-4.2ms。AG-09 "重放抵掉收益"的方向判断对，量级判断偏大
   ——它不足以解释稳态持平，更不值得用纹理去换。
2. **RT 的成本纯粹按填充面积走**（小 RT 12 个 0.3ms vs 大 RT 29 个 23.3ms，与对象
   数无关）：SwiftShader 对**带 alpha 混合的大块纹理 quad** 收 ~5.3ns/px，而纯色
   fillRect 走的是免纹理取样的廉价路径。一层五栋楼的静态内容烘完合计约 480 万像素
   /帧（depth 0/1/2/8/26 那些全宽洗色、雾、墙裙、前景剪影的包围盒），这就值
   25-29ms。**包围盒还为透明区域付费**：墙裙实际只画了约 4 万像素，却要按
   1280×330 的盒子整块取样。
3. **帧时间的大头在别处，且不在本轮可改范围里**：floor 3 约 31ms 的构成 ≈
   Image 16.7ms（墙/地板美术 1280×128 + 1280×232 × 4 层，是不透明贴图填充，
   SwiftShader 下约 17ms，美术不缩就省不掉）+ 静态 Graphics ~1-4ms + 其余
   ~10-13ms（精灵/文本/尘埃/游戏逻辑/相机）。AG-09 把对象数砍掉 3.6-4.6 倍而稳态
   持平，与这个构成完全吻合——省的是 draw call 与 JS，而这两项本来就不是瓶颈。

### 10.4 视觉不变性证明：**不完全成立**（这也是回退的理由之一）

冻结画面像素对比（协议：钉世界时间到 360 分钟（06:00）、四项属性、清世界事件、
灯光层 update(0) 打确定性初值后打桩、GameScene.update 停掉、tweens 全停、所有
精灵钉到动画第 0 帧；40x24 细胞均值签名，自带 PNG 解码；同一份新代码跑两遍作
噪声底线）：

| 楼层 | 旧 vs 新 超阈细胞 | maxDelta | meanLum 差 | 噪声底线（新 vs 新2） |
|---|---|---|---|---|
| 1 | 15/960 | 4.7 | 0.027 | 0/960，maxDelta 0.8 |
| 2 | 38/960 | 22.4 | 0.084 | 8/960，maxDelta 5.7 |
| 3 | 16/960 | 12.1 | 0.095 | 0/960，maxDelta 0.2 |
| 5 | 16/960 | 12.1 | 0.048 | 1/960，maxDelta 4.8 |
| 100 | 11/960 | 7.2 | 0.013 | 0/960，maxDelta 1.3 |
| 10000 | 13/960 | 7.2 | 0.027 | 0/960，maxDelta 1.3 |

冻结协议本身很紧（同代码两遍 meanLum 差 ≤0.005），所以新旧差异**超出噪声底线**。
逐像素查过：绝大部分像素只差 ±1-2（RT 二次量化的预期 rounding），但高对比亮边
（天花板灯管 236,232,216 vs 背景 19,29,40）整体位移了 1 像素——帧缓冲纹理采样
的半像素偏移，把 RT 内容放在了与直接 Graphics 差半格的位置。静态内容本身没错，
但"逐像素不可区分"这个结论**不成立**，如实记录。

### 10.5 测试

实现期间 renderPerf.test.ts 43 → 47 个断言全绿（假场景加 renderTexture 工厂、
对象预算改数"显示树上有的"、新增四条：builder 产出零 Graphics / 纹理=内容包围盒 /
setTint 屏蔽保住邻居不上色 / 两次烘焙逐项相同）。**回退后测试回到 AG-09 的 43 个
原样**，全量 1176 不变。探针与协议留在 output/（gitignore）。

### 10.6 没处理干净的地方 / 给总控的结论

1. **稳态帧时间在 SwiftShader 下已无本轮可摘的果子**：构成见 10.3 第 3 条，大头
   是墙/地板美术的不透明贴图填充（~17ms/帧），要动只能动美术分辨率或渲染缩放，
   超出 render 模块职责。commandBuffer 重放只值 1-4ms，为它引入纹理是负优化。
2. **若将来要上真实 GPU**（那里纹理填充近乎免费、draw call 与 JS 重放才贵）：
   10.2 的方案可直接复用，且建议连走廊房间线work层一起烘——那一层每层约 350-530
   条指令，需要 GameScene 配合两行：drawCorridor（GameScene.ts:2036）与
   drawNeighbourFloor（:2306）把 `detail.setAlpha(0.68)` 的目标从场景自己的
   Graphics 改成 drawCorridorRoom 的返回值（或给 CorridorContext 加 fade 参数），
   corridors.ts 侧即可把 THEMES 的绘制收进 RectBatcher。行号在此报备，本轮未动
   GameScene。
3. **邻居火把"创建后再隐藏"**（AG-09 第 9.2 条）本轮也未动，同上报备。
4. **测量环境提醒**：本仓库的一切性能结论都绑定 SwiftShader；真实 GPU 上的排序
   可能不同（烘焙在 GPU 上大概率是正收益）。建议 CI 保留 SwiftShader 口径不变，
   若哪天要支持 GPU 口径，先把探针的启动参数去掉再比，不要混用。
5. **`git checkout` 在重负载下挂死**过 25 分钟（本机 4-6 个 Agent 并行）；后续
   切换代码用 `git show > 文件`。另注意 `git show > 文件` 写出行尾是 LF，与仓库
   CRLF 不一致，提交前要么 `git add` 让 git 规范化，要么先把文件转回 CRLF，
   否则 diff 会显示整文件改动。

## 11. 复测方法备忘（给下一位）

- 探针脚本在 `output/`（gitignore，不随提交）：perf.mjs（帧时间 + 显示树普查）、
  rebuild.mjs（clearFloor+drawFloor 墙钟）、shots.mjs（冻结截图）、cmp.mjs
  （40x24 细胞均值签名对比，自带 PNG 解码）、diag3-7.mjs（交替显隐的成本归因）、
  ab2.sh（交错 A/B，用法 `bash output/ab2.sh <throttle> <rounds>`）。
- 无降频测量必须带 `--novsync 1`（见 10.0）；4x 降频走 CDP
  `Emulation.setCPUThrottlingRate`，帧时间远超 vsync 上限所以不受影响。
- 归因测量用"同一会话内交替显隐 + 各取 5 次中位"；单次 hide-then-measure 在负载
  漂移下能把 1ms 测成 15ms（本轮踩过）。
