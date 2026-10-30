# 美术交接说明（ART_BRIEF）

**为什么有这份文件**：这个项目的图全部是代码画出来的（程序化像素图），能做到结构正确、能跑、能测，
但**到不了"好看"**。项目负责人提出自己出图，这份文件就是交接规格——按这里的尺寸和格式出的图，
**丢进对应文件夹就直接生效，不用改代码**。

---

## 一、投放位置（放进去就生效）

| 素材 | 放到 | 尺寸 | 说明 |
|---|---|---|---|
| 角色精灵表 | `src/assets/characters/player.png` | **960×96** | 15 帧 × 64×96，横向一条，透明背景 |
| 同上 | `npc_alin.png` / `npc_xiaozhou.png` / `wanderer.png` | 960×96 | 同上 |
| 墙面 | `src/assets/env/wall.png` | **1280×288** | 横向无缝平铺 |
| 地板 | `src/assets/env/floor.png` | **1280×64** | 横向无缝平铺 |

> **高度必须精确，不是建议。** 代码把墙面贴在 `y=8`、地板贴在 `y=296`（`FLOOR_HEIGHT 360 − FLOOR_BAND 64`）。
> 所以墙面**必须正好 288 高**（296 − 8），地板**必须正好 64 高**。
> 少 1px 就是一道露出背景色的缝，多 1px 就盖住地板。
> （这份简报之前写的是 220/80，那是错的——照那个做会留 76px 的空洞。）

Vite 在构建时用 glob 扫描这两个文件夹（`BootScene.ts` 的 `CUSTOM_CHARACTER_SHEETS` / `CUSTOM_ENV`）。
**文件不存在 = 用程序化图**，不会报错、不会 404。放了新图，刷新页面就换。

### 角色表的帧顺序（从左到右，必须是这 15 帧）

| 列 | 0-5 | 6-7 | 8-10 | 11-12 | 13-14 |
|---|---|---|---|---|---|
| 动作 | 行走循环 | 待机呼吸 | 攻击 | 受击 | 搜刮 |

- 每帧 **64×96**。靴底最低的那个像素必须落在**最后一行的位置**（0 起的第 95 行），
  这样角色才正好站在地面线上。引擎把精灵原点定在帧底（origin 0.5, 1）并对齐 `PLAYER_FEET_Y`，
  **帧底以上留 1px 空白，角色就浮空 1px**。
  （`FOOT_GROUND = 94` 是**脚踝**行，靴子还占一行——所以是 95，不是 94。）
- 每一帧的空白高度必须一致，不要有的帧高一点
- 透明背景，**不要**画地面或阴影（阴影由引擎加）
- 角色朝**右**；引擎会自动翻转
- 用**纯色块 + 1px 描边**（不要抗锯齿渐变），否则与场景像素风冲突

---

## 二、生成提示词（直接复制）

下面按"画面主体 + 风格 + 技术约束"三段写。**英文版对多数模型效果更好**，中文版给通义/即梦等国产模型用。

### 1. 墙面（1280×288，横向无缝）

**English**
```
Seamless horizontally tileable pixel art wall texture, side-view interior corridor
of an abandoned post-apocalyptic dormitory building. Weathered painted concrete,
peeling paint patches, damp stains running down, thin service pipes and electrical
conduit, cracked plaster, one faded wall-mounted lamp bracket. Muted cold palette:
desaturated blue-grey #354650, deep shadow #18242c, faint warm rust accents #6a4a2a.
Dramatic side lighting from the left, strong contrast between lit and shadowed
areas. Pixel art, 1-pixel dark outlines, no anti-aliasing, no text, no watermark.
Aspect ratio 1280:288 (wide strip) - exactly 288 pixels tall, this is load-bearing. Left and right edges must tile seamlessly.
```

**中文**
```
横版像素风墙面贴图，可左右无缝平铺。末日废弃宿舍楼的走廊内墙，做旧涂漆混凝土、
剥落的漆皮、往下淌的水渍、细的走线管和电气线槽、开裂的抹灰、一个褪色的壁灯支架。
低饱和冷色：蓝灰 #354650、阴影 #18242c、少量暖锈色 #6a4a2a。左侧打光，
明暗对比强。像素画，1 像素深色描边，不要抗锯齿，不要文字，不要水印。
比例 1280:288 的横条，**高度必须正好 288 像素**（这是硬约束不是建议），左右两边必须能无缝接上。
```

### 2. 地板（1280×80，横向无缝，湿的）

**English**
```
Seamless horizontally tileable pixel art floor texture, side-view, wet cracked
concrete floor of an abandoned building at night. Puddles reflecting warm amber
lamp light, dark grout seams, scattered debris and dust, subtle specular
highlights on the wet patches. Same muted cold palette as the wall: #1a2228 base,
#2c3f4e highlights, warm reflections #f4b66a where light hits water.
Pixel art, 1-pixel outlines, no anti-aliasing, no text. Aspect ratio 1280:80.
Left and right edges must tile seamlessly.
```

**中文**
```
横版像素风地板贴图，可左右无缝平铺。夜里废弃建筑的湿裂混凝土地面，水洼映着暖黄灯光、
深色砖缝、散落的碎屑和灰尘、湿处有高光。和墙同一套低饱和冷色：底色 #1a2228、
高光 #2c3f4e、灯光照到水面的暖色 #f4b66a。像素画，1 像素描边，不要抗锯齿，不要文字。
比例 1280:80 的横条，左右两边必须无缝。
```

### 3. 角色精灵表（960×96，15 帧）

**English**
```
Pixel art character sprite sheet, side view facing right, 15 frames in one
horizontal row, each frame 64x96 pixels, transparent background.
Character: a survivor in a worn teal-green hooded jacket (#77c6a4), dark brown
trousers, heavy boots, a canvas backpack on the back, pale skin, dark hair, dust
and grime on the clothes. Chibi-ish proportions: head roughly 1/5 of body height,
readable silhouette.
Frame order: 6-frame walk cycle, 2-frame idle breathing, 3-frame attack (wind-up /
strike / recover), 2-frame hurt (recoil / settle), 2-frame search (bend forward
and reach).
Consistent 1-pixel dark outline (#0e1418) on every frame, no anti-aliasing,
no shadows, no ground, feet aligned to the same baseline in every frame.
Flat colours only, limited palette, high internal contrast so the figure reads
against a dark background.
```

**中文**
```
像素风角色精灵表，侧面朝右，15 帧横向排一行，每帧 64×96 像素，透明背景。
角色：末日的幸存者，穿旧的青绿色连帽夹克 #77c6a4、深棕长裤、厚重靴子，背上有帆布背包，
浅肤色、深色头发，衣服上有灰和污渍。偏卡通比例：头约等于身高的五分之一，剪影要清楚。
帧顺序：6 帧行走循环、2 帧待机呼吸、3 帧攻击（前摇/出手/回收）、2 帧受击（后仰/回收）、
2 帧搜刮（弯腰前伸）。每帧统一 1 像素深色描边 #0e1418，不要抗锯齿、不要阴影、不要地面，
每帧脚底在同一水平线上。只用平涂色，色板要少，内部对比要强，保证在深色背景上能看清。
```

### 4. 可选：另外三个幸存者

把上面第 3 段最后一句"青绿色夹克"换成对应配色，其余全部不变：

| 文件 | 角色 | 替换色 |
|---|---|---|
| `npc_alin.png` | 阿林，老邻居 | 土黄色工装夹克 `#c9a45f` |
| `npc_xiaozhou.png` | 小周，孩子 | 暗红色卫衣 `#b5564e` |
| `wanderer.png` | 流浪者，怪物 | 灰紫色破布 `#6b5a7a`，脸隐在阴影里 |

---

## 三、出图后我要做的事（不用你动手）

1. 放进 `src/assets/characters/` 或 `src/assets/env/`
2. 我跑 `tsc` + 单测 + e2e，确认不崩、不丢帧、不位移
3. 如果尺寸对不上会报错——那时的选择是**我改代码适配你的图**，不是让你重画

## 四、已知约束（很重要，避免白画）

- 画布只有 **640×360**，页面放大 2 倍显示。所以图是**低分辨率像素风**，不是插画
- **不要用平滑渐变**：会被最近邻采样放大成色带
- 墙面/地板的**左右两端必须无缝**，否则每 1280px 出现一条竖缝
- 角色每帧**必须一样大、脚底对齐**，否则走路会上下跳
- 中文在 10px 以下会糊，所以 UI 字号已经提到 10/12/15；不要指望更小的字号
