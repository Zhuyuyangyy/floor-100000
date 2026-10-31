# 出图规格（ART_BRIEF）

**给项目负责人**：这份文件是要交给图像模型的提示词。所有提示词都可以直接复制。

---

## 〇、三条铁律（违反任何一条，出来的图进不了游戏）

### 1. 尺寸必须是 512×768 或更小

> 默认出图尺寸（1024×1440 以上）缩到游戏的 64×96 会**损失 16 倍细节**，
> 原图里的布纹、做旧、背包编织全部变成一团色块。
> **512×768 缩到 64×96 只损失 8 倍**，是当前能留住细节的上限。

在提示词里写死：

```
IMAGE SIZE: exactly 512x768 pixels. Do not exceed this size.
```

### 2. 一个角色一张图，一个姿势

> 四角色同图、多姿势同图，模型必然画崩。一张图只画一个人、一个姿势。

### 3. 脚在画面最底边，不留空白

> 工具按"最低不透明行 = 最后一行"对齐脚底。留 1px 空白，角色在游戏里就浮空 1px。

---

## 一、第一步：单张站姿（4 个角色各一张）

**文件命名**（决定它变成哪个角色）：

| 文件名 | 角色 |
|---|---|
| `art-src/characters/player.png` | 幸存者（主角） |
| `art-src/characters/npc_alin.png` | 阿林（老邻居，壮） |
| `art-src/characters/npc_xiaozhou.png` | 小周（孩子，瘦小） |
| `art-src/characters/wanderer.png` | 流浪者（夜里追你的东西） |

**跑一次**（换成对应文件名）：

```bash
node tools/ingest-character.mjs player
```

工具会打印诊断，看到这两行就是对的：

```
value    figure range 24..111 remapped to clear the wall (lum 42) by 34 -> 76..163
feet     lowest opaque row 95 of 0..95  (good)
```

---

## 二、第二步：走路条（6 个姿势，横着拼一张）

同一个角色，只改腿和手臂，横着排 6 个。工具会自己识别出 6 个姿势，
之后**走路用手绘的，其他动作仍用程序化**。

文件放成同一个名字（覆盖站姿那张），再跑一次同样的命令。

---

## 三、提示词

### A. 幸存者（player）—— 站姿

**English**
```
Full-body character illustration, side view profile, facing right, standing
still, centered in frame, isolated on a pure white background.
IMAGE SIZE: exactly 512x768 pixels. Do not exceed this size.

A survivor in an abandoned post-apocalyptic dormitory tower. Worn teal-green
hooded jacket (#4e9c86 base, #77c6a4 highlights, #2f6b5e shadows), dark
grey-brown canvas trousers, heavy scuffed boots, a large canvas backpack with a
bedroll lashed to the top and a compression strap across the middle. Pale
sun-starved skin (#d9b48f), dark hair, dust and grime on the clothing, a small
tear at the elbow. Tired posture, shoulders slightly forward, weight on the
back foot.

STYLE: flat cel-shaded colour fills, NO gradients, NO texture noise, thick
uniform 1-2px dark outline (#05080b) around the entire silhouette, strong
internal contrast so the figure reads against a dark background. Limited
palette of 12-16 colours. Clean vector-like edges. Proportions: roughly 5.5
heads tall, readable silhouette. The feet must touch the very bottom edge of
the image with no empty space below them.

NEGATIVE: no text, no watermark, no background scenery, no ground, no shadow on
the floor, no anti-aliasing, no blur, no 3D rendering, no realistic photo
texture, do not draw multiple poses, do not draw a sprite sheet, do not draw a
grid.
```

**中文**
```
全身角色插画，正侧面，朝右，站姿，画面居中，纯白背景，人物独立。
图片尺寸：正好 512×768 像素，不要超过这个尺寸。

末日废弃宿舍楼里的幸存者。做旧的青绿色连帽夹克（底色 #4e9c86、高光 #77c6a4、
阴影 #2f6b5e）、深灰褐色帆布长裤、磨损的厚靴子、背后一个大帆布背包（顶上捆着
铺盖卷、中间一条压缩带）。长期不见阳光的苍白皮肤（#d9b48f）、深色头发、
衣服上有灰尘和污渍、手肘处破了一道口子。疲惫的体态，肩膀略微前倾，重心在后脚。

风格：平涂赛璐璐色块，不要渐变，不要纹理噪点，整个剪影外围一圈均匀的
1–2 像素深色描边（#05080b），内部明暗对比强，让角色在暗背景上能读出来。
限定 12–16 色。边缘干净利落。比例约 5.5 头身，剪影可辨认。
**脚底必须顶到画面最下边，脚下不留任何空白。**

负面：不要文字、不要水印、不要背景、不要地面、不要地上的影子、不要抗锯齿、
不要模糊、不要 3D 渲染、不要写实照片质感、不要画多个姿势、不要画精灵表、
不要画网格。
```

---

### B. 幸存者（player）—— 6 帧走路条

**English**
```
Same character as the reference image, same lighting, same scale, same colours,
same outline weight. A 6-pose walk cycle laid out in ONE horizontal row, equal
spacing between poses, each pose 512x768.

Pose 1: left foot forward, contact, arms swung back.
Pose 2: passing pose, both legs together, weight centred.
Pose 3: right foot forward, contact, arms swung forward.
Pose 4: passing pose, both legs together, weight centred.
Pose 5: left foot forward, lower, mid-stride.
Pose 6: passing pose, both legs together.

The head, torso, backpack and clothing must be IDENTICAL in every pose - only
the legs and arms move. The feet must sit on exactly the same baseline in every
pose. Pure white background. Flat cel shading, thick dark outline, no shadows.

NEGATIVE: no text, no watermark, no background, no ground, no floor shadow,
no anti-aliasing, no blur, no 3D, no realistic texture, no grid lines, no
dividers between poses.
```

**中文**
```
和参考图同一个角色、同一个光照、同一个比例、同一套颜色、同样粗细的描边。
6 个走路姿势，**横着排成一行**，每个姿势之间等距，每个姿势 512×768。

姿势 1：左脚在前，触地，手臂向后摆。
姿势 2：过渡姿势，双腿并拢，重心居中。
姿势 3：右脚在前，触地，手臂向前摆。
姿势 4：过渡姿势，双腿并拢，重心居中。
姿势 5：左脚在前但更低，迈步中。
姿势 6：过渡姿势，双腿并拢。

**头、躯干、背包、衣服在每个姿势里必须完全一样，只有腿和手臂在动。**
脚底在每个姿势里必须落在同一条水平线上。纯白背景。平涂赛璐璐，
深色粗描边，不要影子。

负面：不要文字、不要水印、不要背景、不要地面、不要地上的影子、不要抗锯齿、
不要模糊、不要 3D、不要写实质感、不要网格线、姿势之间不要分隔线。
```

---

### C. 阿林（npc_alin）—— 老邻居，宽

**人物描述替换 B 段，风格段和负面段照抄**：

```
A much older, heavier survivor. Broad shoulders and a thick torso - visibly
wider than a normal person. Steel-blue worker's overalls (#47657a base,
#2c3f4e shadows, #3a5570 highlights) worn over a grey undershirt, a tool belt
with a wrench, rolled-up sleeves showing forearms, work gloves tucked in the
belt. Grey stubble, deep wrinkles, a weathered face, tired but steady eyes.
He stands square and planted, weight even on both feet, hands loose at his
sides. Proportions: about 5 heads tall, torso noticeably broader than average.
```

> **比例要点：约 5 头身，躯干明显比一般人宽** —— 这是他能和主角一眼分开的关键。

---

### D. 小周（npc_xiaozhou）—— 孩子，瘦小

```
A child survivor, roughly twelve years old. Noticeably smaller and slighter
than an adult - narrow torso, thin limbs, oversized hand-me-down jacket in warm
amber and ochre (#d98b3c base, #f4b66a highlights, #8a4a1e shadows) that hangs
past the hips, short trousers, worn sneakers. A small cloth satchel instead of
a backpack. Round face, messy dark hair, alert posture, standing on the balls
of the feet as if ready to bolt. Proportions: about 4.5 heads tall, head
relatively larger and body narrower - this is what makes a child read as a
child.
```

> **比例要点：约 4.5 头身，头相对更大、身体更窄。**

---

### E. 流浪者（wanderer）—— 夜里追你的东西

```
A thin, wrong humanoid figure, almost a silhouette. Very narrow - narrow
shoulders, long thin limbs, elongated proportions. Ragged dark clothing in deep
red-black (#2f0f14 base, #4a2028 folds, #6b3038 faint highlights), a hood or
draped cloth that hides the face entirely, no visible skin. It leans slightly
forward, arms hanging too long. It should read as a person-shaped absence rather
than as a character - unsettling, not detailed. Proportions: about 6 heads tall,
extremely thin, silhouette half the width of a normal person.
```

> **比例要点：约 6 头身，极瘦，剪影比正常人窄一半。只用暗红黑，不要亮色。**

---

## 四、尺寸速查

| 用途 | 尺寸 | 说明 |
|---|---|---|
| 角色站姿 | **512×768** | 一个角色一张 |
| 走路条 | **3072×768** | 6 个 512×768 横排 |
| 墙面 | **1280×288** | 高度必须正好 288，横着无缝平铺 |
| 地板 | **1280×64** | 高度必须正好 64，横着无缝平铺 |

墙面和地板**不用跑工具**，直接放进 `src/assets/env/` 就行。

---

## 五、常见问题

| 现象 | 原因 | 解法 |
|---|---|---|
| 工具报 `feet ... the sprite will float` | 脚底留了空白 | 裁掉底部空白再跑 |
| 角色在墙里看不见 | 画的色调太暗 | 工具已自动重映射明度，若还不够，把 `margin` 从 34 提到 44 |
| 走路还是不动 | 只交了站姿 | 补 6 帧走路条（第二节） |
| 工具报 `no figure found` | 背景不是纯白/透明 | 换成纯白背景 |
