# 美术交接说明（ART_BRIEF）

**为什么有这份文件**：这个项目的图全部是代码画出来的（程序化像素图），能做到结构正确、能跑、能测，
但**到不了"好看"**。项目负责人提出自己出图，这份文件就是交接规格。

---

## 〇、先说清楚：什么能做，什么做不出来

**能做到的**：让模型画**一张**干净的角色站姿/侧身像（高分辨率、平涂、粗描边）。
工具会把它缩小、吸附到项目调色板、拼成 15 帧图集。出来就是能进游戏的手绘角色。

**做不到的**：让模型一次画**15 帧对齐的 64×96 精灵表**。任何模型都做不到——
帧间不一致、尺寸不对、脚底不齐。之前的提示词就是要这个，所以出不来。

所以流程是反过来：**你出大图 → 工具帮你变成游戏能用的图集。**

```bash
# 1. 把画好的图放进 art-src/characters/player.png
# 2. 跑一次
node tools/ingest-character.mjs player
# 3. 刷新浏览器
```

它会打印诊断，比如：
```
poses  15
feet   lowest opaque row 95 of 0..95  (good)
wrote  src\assets\characters\player.png  (960x96, 15 frames)
```

如果 `feet` 那行说 `... the sprite will float`，说明脚底下留了空白，裁掉再跑。

---

## 一、投放位置

| 素材 | 先放这里 | 跑完工具后自动出现在 | 尺寸 |
|---|---|---|---|
| 角色原图 | `art-src/characters/<key>.png` | `src/assets/characters/<key>.png` | **任意**，建议高 768–1024 |
| 墙面 | — | `src/assets/env/wall.png` | **必须正好 1280×288** |
| 地板 | — | `src/assets/env/floor.png` | **必须正好 1280×64** |

`<key>` 只能是：`player`（幸存者）、`npc_alin`（阿林）、`npc_xiaozhou`（小周）、`wanderer`（流浪者）。

**墙面和地板不用跑工具，直接放进 `src/assets/env/` 就行**，但尺寸是硬约束：

> 代码把墙面贴在 `y=8`、地板贴在 `y=296`（`FLOOR_HEIGHT 360 − FLOOR_BAND 64`）。
> 所以墙面**必须正好 288 高**，地板**必须正好 64 高**。
> 少 1px 就是一道露出背景色的缝，多 1px 就盖住地板。

---

## 二、画角色的 4 条硬要求

1. **侧面朝右**，全身，站在画面正中
2. **背景透明**（或纯白），工具会抠掉 alpha < 90 的像素
3. **脚在画面最底边**，不留空白
4. **平涂色块 + 1px 深色描边**，不要渐变、不要抗锯齿

比例参考：现在的角色是 **88px 高、头 15px**（约 5.5 头身），躯干宽 16–30px。
你要画得接近这个比例，进游戏才对得上场景。

### 项目的 16 色调色板

工具会把你的图**吸附到这 16 个颜色**，所以直接用它们画效果最好：

| 用途 | 色值 |
|---|---|
| 最深墨色 / 描边 | `#05080b` |
| 深阴影 | `#14202c` |
| 石头（墙、金属暗部） | `#2c3f4e` |
| 石头亮部 | `#47657a` |
| 灰、灰尘 | `#8a95a0` |
| 布深 / 布 / 布亮 / 布高光 | `#1e4a44` `#2f6b5e` `#4e9c86` `#77c6a4` |
| 肤深 / 肤 / 肤亮 | `#6b4630` `#a5714c` `#d9b48f` |
| 灯光深 / 灯 / 灯亮 / 灯最亮 | `#8a4a1e` `#d98b3c` `#f4b66a` `#ffe4b6` |

---

## 三、生成提示词（直接复制）

**通用要点**：用"平涂色块 + 粗描边"的描述，**不要说"pixel art 64x96"**——
那样会出来一团糊。要的是高分辨率的**赛璐璐/平涂插画**，缩小后才干净。

### 1. 幸存者（player）——主角

**English**
```
Full-body character illustration, side view profile, facing right, standing still,
centered in frame, isolated on a pure white background.

A survivor in an abandoned post-apocalyptic dormitory tower. Worn teal-green hooded
jacket (#4e9c86 base, #77c6a4 highlights, #2f6b5e shadows), dark grey-brown canvas
trousers, heavy scuffed boots, a large canvas backpack with a bedroll lashed to the
top and a compression strap across the middle. Pale sun-starved skin (#d9b48f),
dark hair, dust and grime on the clothing, a small tear at the elbow. Tired posture,
shoulders slightly forward, weight on the back foot.

STYLE: flat cel-shaded colour fills, NO gradients, NO texture noise, thick uniform
1-2px dark outline (#05080b) around the entire silhouette, strong internal contrast
so the figure reads against a dark background. Limited palette of 12-16 colours.
Clean vector-like edges. Proportions: roughly 5.5 heads tall, readable silhouette.

NEGATIVE: no text, no watermark, no background scenery, no ground, no shadow on the
floor, no anti-aliasing, no blur, no 3D rendering, no realistic photo texture,
do not draw multiple poses, do not draw a sprite sheet.
```

**中文**
```
全身角色插画，正侧面，朝右，站姿，画面居中，纯白背景，人物独立。

末日废弃宿舍楼里的幸存者。做旧的青绿色连帽夹克（底色 #4e9c86、高光 #77c6a4、
阴影 #2f6b5e）、深灰褐色帆布长裤、磨损的厚靴子、背后一个大帆布背包（顶上捆着铺盖卷、
中间一条压缩带）。长期不见阳光的苍白皮肤（#d9b48f）、深色头发、衣服上有灰尘和污渍、
手肘处破了一道口子。疲惫的体态，肩膀略微前倾，重心在后脚。

风格：平涂赛璐璐色块，**不要渐变**，不要纹理噪点，整个剪影外围一圈均匀的
1–2 像素深色描边（#05080b），内部明暗对比强，让角色在暗背景上能读出来。
**限定 12–16 色**。边缘干净利落。比例约 5.5 头身，剪影可辨认。

负面：不要文字、不要水印、不要背景、不要地面、不要地上的影子、不要抗锯齿、
不要模糊、不要 3D 渲染、不要写实照片质感、**不要画多个姿势**、**不要画精灵表**。
```

### 2. 阿林（npc_alin）——老邻居，比主角壮

把上面第 1 条的**人物描述**换成这段，风格段和负面段完全照抄：

```
A much older, heavier survivor. Broad shoulders and a thick torso - visibly wider
than a normal person. Steel-blue worker's overalls (#47657a base, #2c3f4e shadows,
#3a5570 highlights) worn over a grey undershirt, a tool belt with a wrench, rolled
up sleeves showing forearms, work gloves tucked in the belt. Grey stubble, deep
wrinkles, a weathered face, tired but steady eyes. He stands square and planted,
weight even on both feet, hands loose at his sides.

比例：约 5 头身，**躯干明显比一般人宽**，让他一眼就能和主角区分开。
```

### 3. 小周（npc_xiaozhou）——孩子，瘦小

```
A child survivor, roughly twelve years old. Noticeably smaller and slighter than an
adult - narrow torso, thin limbs, oversized hand-me-down jacket in warm amber and
ochre (#d98b3c base, #f4b66a highlights, #8a4a1e shadows) that hangs past the hips,
short trousers, worn sneakers. A small cloth satchel instead of a backpack. Round
face, messy dark hair, alert posture, standing on the balls of the feet as if ready
to bolt.

比例：约 4.5 头身，**头相对更大，身体更窄**，这是让孩子读起来像孩子的关键。
```

### 4. 流浪者（wanderer）——夜里追你的东西

```
A thin, wrong humanoid figure, almost a silhouette. Very narrow - narrow shoulders,
long thin limbs, elongated proportions. Ragged dark clothing in deep red-black
(#2f0f14 base, #4a2028 folds, #6b3038 faint highlights), a hood or draped cloth
that hides the face entirely, no visible skin. It leans slightly forward, arms
hanging too long. It should read as a person-shaped absence rather than as a
character - unsettling, not detailed.

比例：约 6 头身，**极瘦**，剪影比正常人窄一半。
颜色只用暗红黑系，不要亮色——它在夜里是靠一团暗红的光池被发现的。
```

---

## 四、如果想要真正的动画（可选，做不到也别勉强）

先交**单张站姿**，游戏会用程序化的腿走路——看着是手绘的，动起来是程序化的。
这对"人物难看"这件事基本够用。

真想做动画，最现实的是**一排 6 张走循环**（同一角色、同一背景、只改腿和手臂），
横着拼成一张，工具会自动识别 6 个姿势：

```
Same character, same lighting, same scale, walk cycle - 6 poses in one horizontal
row, separated by equal spacing. Pose 1: left foot forward contact. Pose 2: passing.
Pose 3: right foot forward contact. Pose 4: passing. Pose 5: left foot forward,
lower. Pose 6: passing, arms swung. Feet must sit on exactly the same baseline in
every pose. Pure white background, flat cel shading, thick dark outline, no shadows.
```

工具会打印 `poses 6`，然后走路用手绘的 6 帧、其他动作仍用程序化。

---

## 五、投进去之后

```bash
node tools/ingest-character.mjs player
```

再做一次全量验证，确认画面没退化：

```bash
npx tsc --noEmit
npx vitest run
node tools/art-audit.mjs       # 五道门：主色/亮部/分散/边缘密度/角色对比度
node tools/silhouette-audit.mjs
```
