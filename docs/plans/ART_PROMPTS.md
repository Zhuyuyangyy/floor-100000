# 美术提示词清单（2026-11-17 凌晨，用户生成用）

> 用户原话：「动画 GIF 美术相关的图片，GIF 没有的话全部写提示词给我，我来生成。」
> 本文覆盖所有**缺真实美术**的缺口。每条给：规格（尺寸/帧数/基线/色板）+ 中英双语提示词
> + 接入方式。优先级从 P0 到 P3。

## 全局规格（每条都适用，违反接不上）

| 项 | 要求 |
|---|---|
| 色板 | **16 色**，且必须在本项目板内（`src/render/palette.ts` 的 PALETTE）——接入有门禁，越界直接 FAIL |
| 风格 | 像素风、硬边、无抗锯齿（和现有 `public/assets/artpack/` 同血脉） |
| 角色帧 | **64×96 每帧**，脚底基线在帧底部第 96 行（和 `char-player-sheet.png` 完全一致） |
| 角色 sheet | 横向等距排布，一帧一列，透明背景 PNG |
| 底色 | 末日塔楼：深蓝灰 `#0b0f12` 系、暖白、暗红、琥珀黄——低饱和 |
| 交件 | PNG（GIF 我也会拆帧，但直接给 PNG 序列帧最稳） |

---

## P0-1 跑步循环动画（用户点名要的「跑的 GIF」）

**现状**：AG-55 已用现有 walk 帧派生（frameRate ×1.6 + 起伏）顶着，**等你出真素材替换**。

**规格**：
- 6 帧（和现有 walk 的 6 帧对齐），每帧 64×96，横向排成 384×96
- 脚底基线一致：6 帧的鞋底像素都在各自帧的第 96 行
- 动作要点：跑 = 步幅比走大、身体前倾 5-10°、摆臂过胸、双脚有离地帧（走永远有一只脚着地，跑有双离地）
- 主色：幸存者配色（`PLAYER_COLORS`：深蓝灰外套 + 暖白内衬 + 暗红围巾）

**中文提示词**：
```
像素风游戏角色跑步循环动画，6 帧横向排列，每帧 64x96，末日幸存者主题，
深蓝色磨旧外套，米白色内衬，暗红色围巾，齐耳短发，背影与侧面之间，
身体前倾，步幅大，摆臂过胸，有双脚离地的腾空帧，硬边无抗锯齿，
限制 16 色复古色板（深蓝灰底 #0b0f12、暖白、暗红、琥珀黄），
透明背景 PNG，脚底对齐每帧底部，2D 横版游戏精灵
```

**English**：
```
pixel art character run cycle sprite sheet, 6 frames in a horizontal row,
each frame 64x96, post-apocalyptic survivor theme, dark blue worn jacket,
off-white lining, dark red scarf, short hair, three-quarter back view,
leaning forward, wide stride, arms swinging across chest, one airborne
frame with both feet off the ground, hard edges no anti-aliasing,
limited 16-color retro palette (dark blue-gray #0b0f12, warm white,
dark red, amber yellow), transparent background PNG, feet aligned to
the bottom of every frame, 2D side-scrolling game sprite
```

**接入**：给我 `run-player.png`（384×96，6 帧）→ 我量化过板 → BootScene 加载 → walkcycle 注册 `run-player` anim（列位追加在 20 帧之后，不动现有 0..19）→ AG-50 的双击跑路径播它。

---

## P0-2 圆环 HUD 概念图（AG-54 没找到你说那张，它自设了一套）

**现状**：AG-54 穷尽搜索（素材库全树 / F:/new 交付包 / git 全历史）没找到圆环 HUD 概念图，按现有铆钉板语言**代码绘制**了四联圆环（生命红/饥饿橙/口渴蓝/精力绿，12 段，环心实时数值）。**功能已上线**，但设计方向等你确认。

**规格**（这是概念图，不是接入件——HUD 数值必须代码画，图里不许有数字）：
- 1280×102（顶部状态板的高度），或直接画整屏 1280×720 示意
- 四个圆环排在第 1 行（替代原来的 10 段横条）：生命/饥饿/口渴/精力
- 深色铆钉金属板 + 右侧危险斜纹（和现有语言一致）
- 圆环样式随你定：分段弧（现在的）/ 平滑弧 / 双环（外环底环+内环读数）/ 任何你觉得好看的
- 图里出现的数字（生命 100 这种）只是示意，接入时全部由代码实时绘制

**中文提示词**：
```
像素风游戏 HUD 概念图，1280x720 整屏示意，末日生存塔楼题材，
深色铆钉金属板横贯屏幕顶部，四个圆形进度环排在第一行分别代表
生命（暗红）、饥饿（琥珀橙）、口渴（蓝灰）、精力（青绿），
圆环中心显示数值，环右侧小图标加文字标签，右下角黄黑危险斜纹，
低饱和 16 色复古色板，硬边像素风，界面其余部分留空画游戏画面，
参考赛博朋克 HUD 与废土生存游戏的混合气质，2D 游戏 UI 设计稿
```

**English**：
```
pixel art game HUD concept sheet, 1280x720 full screen mockup,
post-apocalyptic survival tower theme, dark riveted metal plate across
the top, four circular progress rings in the first row representing
health (dark red), hunger (amber), thirst (blue-gray), energy
(teal), numeric value in each ring's center, small icon plus text
label right of each ring, yellow-black hazard chevrons at bottom
right, desaturated 16-color retro palette, hard pixel edges,
rest of the screen shows empty game viewport, mix of cyberpunk HUD
and wasteland survival game aesthetics, 2D game UI design
```

**接入**：图只作设计参考——我按图调 `hudSkin.ts` 的 `drawStatRing`（现在是 12 段弧，改平滑弧/双环都是一处函数的事）。

---

## P1-1 拆解后的床残骸（AG-51 标的缺口）

**现状**：撬棍/消防斧拆床后床直接消失（没有拆解态贴图）。

**规格**：
- 和 `public/assets/artpack/furn-bunk_bed.png` **同尺寸同视角**（先看那张的实际尺寸）
- 内容：木架散架（板条翘起/错位）、床垫翻到一边、一截弹簧或木板露出来
- 仍是「翻过/拆过」的语义，不是垃圾场——一眼能看出"这床被拆了"

**中文提示词**：
```
像素风游戏场景道具，末日塔楼宿舍里被拆解的残破木床，
木架散架错位，板条翘起，床垫翻到一边露出断裂的弹簧和木板，
深棕色旧木头，灰白色脏床垫，暗红色锈弹簧，硬边无抗锯齿，
16 色复古色板，透明背景 PNG，2D 横版游戏家具，俯视 45 度
```

**English**：
```
pixel art game environment prop, dismantled broken wooden bunk bed
in a post-apocalyptic dorm room, frame collapsed and skewed, planks
pried up, mattress flipped aside exposing broken springs and boards,
dark brown weathered wood, gray-white dirty mattress, dark red rusty
springs, hard edges no anti-aliasing, 16-color retro palette,
transparent background PNG, 2D side-view game furniture
```

**接入**：`furn-bunk_ruins.png` 之类命名 → 过 16 色门禁 → LootSystem 拆解后把床对象换成它（现在床直接消失，接入后成残骸）。

---

## P1-2 爬梯动画（角色爬楼梯/梯子的动作帧）

**现状**：爬梯时播 walk 动画沿直线滑上去（你说「滑步走上去非常的难看」）。AG-53 在做 2D 阶梯视觉，但**角色爬梯的动作帧**是另一个缺口——走是横向的，爬是纵向的，用 walk 帧横向摆动很怪。

**规格**：
- 4-6 帧，每帧 64×96，横向排布
- 动作要点：爬楼梯 = 单手扶墙/扶梯、单膝上抬、纵向位移；爬直梯 = 双手抓横档、身体垂直、交替上下
- 两种可以各做一套（阶梯/直梯），也可以只做阶梯那套，直梯复用它

**中文提示词（阶梯）**：
```
像素风游戏角色爬楼梯动作帧，4-6 帧横向排列，每帧 64x96，
末日幸存者，深蓝外套，一只手扶墙一只手撑膝，单膝上高，
身体前倾朝向右上方，硬边无抗锯齿，16 色复古色板，
透明背景 PNG，脚底对齐帧底部，2D 横版游戏精灵
```

**English (stairs)**：
```
pixel art character climbing stairs action frames, 4-6 frames in a
horizontal row, each frame 64x96, post-apocalyptic survivor in a dark
blue jacket, one hand on the wall and one on a raised knee, body
leaning up-right, hard edges no anti-aliasing, 16-color retro
palette, transparent background PNG, feet aligned to frame bottom,
2D side-scrolling game sprite
```

**中文提示词（直梯）**：
```
像素风游戏角色爬直梯动作帧，4-6 帧横向排列，每帧 64x96，
末日幸存者，深蓝外套，双手抓头顶横档，身体垂直悬挂，
双腿交替上收，硬边无抗锯齿，16 色复古色板，
透明背景 PNG，脚底对齐帧底部，2D 横版游戏精灵
```

**English (ladder)**：
```
pixel art character climbing a vertical ladder action frames, 4-6
frames in a horizontal row, each frame 64x96, post-apocalyptic
survivor in a dark blue jacket, both hands gripping overhead rungs,
body hanging vertically, legs pulling up alternately, hard edges no
anti-aliasing, 16-color retro palette, transparent background PNG,
2D side-scrolling game sprite
```

**接入**：`climb-player.png`（384×96 或 512×96）→ 量化过板 → walkcycle 注册 `climb-player` → 爬梯动画播它（AG-53 做动画曲线，我接 anim）。

---

## P2-1 翻箱倒柜搜刮动画（床/柜子搜刮时播）

**现状**：搜刮播的是现有 search clip（站着弯腰翻），能表达"翻箱倒柜"但比较素。

**规格**：3-4 帧，每帧 64×96——蹲下 → 伸手进柜/床垫下 → 掏出东西 → 起身一半

**中文提示词**：
```
像素风游戏角色搜刮柜子动作帧，3-4 帧横向排列，每帧 64x96，
末日幸存者，深蓝外套，从站立到蹲下、伸手进柜子深处、
掏出一个东西、半起身，动作连贯，硬边无抗锯齿，
16 色复古色板，透明背景 PNG，脚底对齐帧底部
```

**English**：
```
pixel art character looting a cabinet action frames, 3-4 frames in a
horizontal row, each frame 64x96, post-apocalyptic survivor in a dark
blue jacket, standing to crouching, reaching deep into the cabinet,
pulling out an item, half rising, fluid motion, hard edges no
anti-aliasing, 16-color retro palette, transparent background PNG
```

---

## P2-2 楼层间 2D 阶梯 + 直梯场景件（AG-53 在代码画，你出图可替换）

**现状**：AG-53 正在 corridors.ts 里程序化绘制阶梯和直梯——**功能立即可用**，但程序绘制的阶梯比较素。你出图的话质感能上一层。

**规格**：
- 阶梯：一段 6-8 级的像素楼梯，从层地板延伸到上一层，宽约 200px，高约 120px（一级 16px）
- 直梯：两条边绳/边轨 + 6-8 根横档，垂直挂在楼层间，宽约 48px，高约 200px
- 材质：阶梯 = 水泥/木板（贫民区木梯、工业区铁梯可以分款式）；直梯 = 铁梯（工业段）/绳梯（贫民段）
- 这两张是**接入件**（不是概念图），要过 16 色门禁

**中文提示词**：
```
像素风游戏场景楼梯，末日塔楼楼层之间的木制楼梯，6-8 级台阶，
深棕色旧木板，灰色水泥侧帮，硬边无抗锯齿，16 色复古色板，
透明背景 PNG，2D 横版游戏场景件，阶梯从左下角伸向右上角
```

**English**：
```
pixel art game environment staircase, weathered wooden stairs
between floors of an apocalyptic tower, 6-8 steps, dark brown old
planks, gray concrete side supports, hard edges no anti-aliasing,
16-color retro palette, transparent background PNG, 2D side-view
game environment piece, stairs rising from lower-left to upper-right
```

**直梯版**：把上面提示词里的 `staircase/stairs/steps` 换成 `vertical ladder / two vertical rails with 6-8 rungs / hanging ladder`，木梯换铁梯或绳梯。

---

## P3 其它（不急，想要再说）

- 武器挥砍特效已经有了（武器分支带的 heavy-cleave）——**不需要**
- 五层楼墙/家具：阶层 4/5 还是贫民区复用——要换就按 `02-场景/` 里既有的提示词套路出
- 四件武器的持握姿态（现在武器贴图是 46×18 的小图，角色手持的角度 AG-28 调的）——要更细的持握帧可以出，但优先级低

---

## 交付与接入流程（你给我图之后我做什么）

1. 你按上面规格出图，丢到 `D:/ZYY_Inovation/game/素材库/` 或直接告诉我路径
2. 我跑 `tools/quantize-sheet.mjs` 量化过 16 色板（越界我会告诉你差哪几个色）
3. 门禁 `node tools/assets-manifest.mjs` clean 后进 `public/assets/artpack/`
4. walkcycle/BootScene 注册 anim（角色动作）或 floorTemplates/LootSystem 换贴图（场景件）
5. Playwright 实测 + 全量测试，提交推送

**哪张先出？我的建议：P0-1 跑步（你点名的，现在顶着衍生的）→ P0-2 圆环 HUD 概念图（设计方向定了我才好调）→ P1-1/P1-2（残骸和爬梯帧）。**
