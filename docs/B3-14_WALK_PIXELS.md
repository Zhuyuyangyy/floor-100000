# B3-14 · 行走循环逐像素重制

**里程碑 M1 · B3 收尾 · 2026-10-29**

## 问题

B3-13 的行走循环用「到线段的距离」rasterize 四肢：像素在 halfWidth 内即填充、近边即描边。结果是**胶囊人**——每个关节都是圆的、每段肢体等宽、没有任何一个像素是"被摆放的"，它们全都只是"在距离场里"。64×96 的画布上这读作一件会走路的衣服，而不是像素画。

ASCII dump 审计（`tools/bake-walk.ts --dump`）确认的具體症状：

- 头是一个正圆 + 一块左上发块 + 一颗眼睛像素
- 躯干是上下等宽的对称筒，只有明暗两列
- 四肢等宽管，无收分、无关节形状
- 靴子是 10–12px 宽的胶囊 blob，吞掉小腿
- idle 两腿两臂完全重合（脚在同一点、肩在同一点），读起来只有一条腿、一条臂

## 做法

只换 rasterization 层。**几何/IK/帧结构/动画 API/场景代码零改动**——`walkPose`/`idlePose`/`drawPose` 签名不变，`bakeWalkSheets`、`createCharacterAnimations`、GameScene 一行未动，换图不动代码。

1. **水平硬边 run**：`taperedLimb()` 逐扫描线走骨骼，每行铺一条实心水平 run，宽度在两个整像素值间插值（大腿 7→5、小腿 5→4、上臂 4.5→3.5）。斜骨自然 stair-step——这正是手摆斜肢的样子。
2. **显式靴形**：`boot()` 是脚踝处的方块 + 指向小腿方向的 toe run；落地时鞋底恰好压在 `FOOT_GROUND`，离地时读出脚尖。推离瞬间 toe 朝后，过斯时朝前。
3. ** authored 宽度表**：躯干用 [位置, 半宽] 表（肩台→收腰→下摆外翻 + 前行倾斜 1.5px），头部用 19 行连续 skull 表（带下巴前翘 dx 列），替换圆测试。
4. **整体描边**：`outlinePass()` 最后跑一遍——任何透明像素挨到实体即取 outline 色。一条贯穿全图的剪影边，部件互相遮挡处不再需要各自的边。
5. **遮挡顺序解剖化**：远腿→远臂→颈→躯干→近腿→近臂→头。远臂改挂躯干平面后（shoulder.x−5），idle 不再出现双条条纹，摆到极限才从躯干后露出。
6. **idle 站姿分立**：双脚 ±5（`IDLE_STANCE`），髋高按 `FOOT_GROUND − √(LEG²−stance²)` 由 IK 反推——腿不拉长，膝微弯，像真人站姿。

帧结构借鉴已上线侧面行走循环的通行约定（6 帧 run + 2 帧 idle、contact/mid/pass、非对称 idle 节奏）——借鉴的是结构不是素材。

## 验证证据

- `npx tsc --noEmit` → 0 错误（顺带把 walkcycle.ts 的 Phaser 导入改 type-only，模块现在可在 Node 直跑）
- `npx vitest run` → **341 passed (25 files)**；walkcycle 23 条不变量（落地、周期性、双 dips、包围盒、≤24 色、帧间差分）全绿
- `node tools/bake-walk.ts <who> re/frames --dump` → 四角色逐帧 ASCII dump 人工审阅（contact/mid/pass/idle 结构正确，boot 方向正确，遮挡正确）
- `npx playwright test e2e/art.spec.ts --workers=1` → **1 passed**，五层截图重生于 `e2e/screenshots/`，零 page error

## 已知问题（事实）

- 本环境模型无图像输入，画面判断依据是 ASCII dump（与烘焙进游戏的同一份像素数据）+ e2e 零报错；最终观感仍待人工试玩确认。
- idle 躯干左缘会露出远臂 1–2px 竖线（躯干下行倾斜所致），读作"身后的手臂"，可接受但可见。
- wanderer 暗色系内部对比度低是调色板设计意图（"暗中的形状"），剪影由描边保证。

## 下一步

人工试玩判定 B3-14 观感 → 若通过，B3 章节可提交人工验收；随后决定 B4 是否开始。

## 附：提交范围说明

`src/render/walkcycle.ts` 在上个会话（B3-13）结束时未提交（git status 显示 untracked）。本提交包含该文件全量内容（B3-13 实现 + B3-14 rasterizer 重写）、新增 `tools/bake-walk.ts` 与本文档；上个会话其他未审查改动（GameScene/pixelArt 等）不在本提交内。
