# 生图提示词包 · 第100000层

> 拿去喂 GPT / 即梦 / 任何模型。每条都能单独复制，不用改结构，只换 `[变量]`。
> 交付后我做：色数统计 → 最近色吸附 → 目标尺寸 nearest 降采样 → 截图对比 → 门禁。

---

## 0. 先说清楚为什么要"每层不一样"但只画 18 张

游戏有 **55 个可玩层**，分 6 个阶层：

| 阶层 | 名称 | 楼层 | 现在用什么墙 |
|---|---|---|---|
| 1 | 底层贫民区 | 1–10（10 层） | `wall.png` ✅ |
| 2 | 工人宿舍区 | 100–110（11 层） | `wall-dorm.png` ✅ |
| 3 | 工业与交易区 | 1000–1010（11 层） | `wall-industry.png` ✅ |
| 4 | 中产与商业区 | 10000–10010（11 层） | ❌ 回落到贫民墙 |
| 5 | 富人特权区 | 50000–50010（11 层） | ❌ 回落到贫民墙 |
| 6 | 统治核心 | 100000（1 层） | ❌ 回落到贫民墙 |

真画 55 张墙 = 55 × 1280×128，画不完也用不上（玩家在同一阶层里只会待十几分钟）。

**方案：每阶层 3 张变体，按 `floor % 3` 轮换 = 18 张。** 加上 12 件墙装的位置/组合随机，同阶层的相邻两层看起来就不一样了。以后想加到 4–5 个变体，照着模板继续产就行。

---

## 1. 通用规格（每条提示词后面都要贴）

```
Canvas exactly 1280 x 128 pixels, single seamless side-view wall band,
RGB PNG with no alpha channel, horizontally tileable (left edge must continue
into the right edge), zero perspective, flat elevation only.

Strict 16-colour palette, no other colours:
#05080b #14202c #2c3f4e #47657a #8a95a0
#1e4a44 #2f6b5e #4e9c86 #77c6a4
#6b4630 #a5714c #d9b48f
#8a4a1e #d98b3c #f4b66a #ffe4b6

Hard pixel edges, no anti-aliasing, no soft gradients, no glow, no drop shadow.
The image must read as hand-placed pixel art, not as a rendered illustration:
visible 1-2px stair-stepping on diagonals, flat fill areas, dithering only if
it uses palette colours.

Forbidden: text, letters, numbers, logos, watermarks, signatures, furniture,
characters, doors, windows, the floor, the ceiling, perspective, vignette,
lens flare, bokeh, painterly brush strokes.
```

**三段硬布局**（不是审美建议，是代码契约）：

| 高度 | 内容 | 为什么 |
|---|---|---|
| y 0–40 | 管道、线槽、灯具、检修板、空白铭牌 | 玩家抬头看到的那一段 |
| y 40–80 | **刻意留平**，最多两条极淡的焊缝 | 容器名标签压在这一段上，花了字就看不清 |
| y 80–128 | 踢脚轨、通风格栅、检修面板、底部线管 | 玩家脚边，也是墙装的落脚点 |

---

## 2. 墙面：6 个阶层 × 3 个变体

### 主模板（复制这条，把 `[阶层描述]` 和 `[变体修饰]` 换掉）

```
A 1280x128 seamless side-view corridor wall texture for [阶层描述],
pixel art, horizontally tileable.
Top 40 pixels: [顶部细节]. Middle band y40-80: deliberately plain flat wall,
almost no detail, at most two faint weld seams. Bottom 48 pixels: [底部细节].
[变体修饰].
Exact 16-colour palette: #05080b #14202c #2c3f4e #47657a #8a95a0 #1e4a44
#2f6b5e #4e9c86 #77c6a4 #6b4630 #a5714c #d9b48f #8a4a1e #d98b3c #f4b66a #ffe4b6.
Hard pixel edges, no anti-aliasing, no gradient, no glow, no drop shadow.
No text, no letters, no numbers, no furniture, no characters, no floor,
no ceiling, no perspective, no watermark.
```

### 变量表（阶层）

| 阶层 | `[阶层描述]` | `[顶部细节]` | `[底部细节]` |
|---|---|---|---|
| 1 贫民 | the lowest slum zone of a 100000-storey tower, damp concrete and patched repairs | exposed cable bundles, a bare bulb on a wire, rusted conduits, blank tin plates | broken skirting, water stains, a floor drain, chipped plaster |
| 2 宿舍 | a worker dormitory floor, institutional and kept-up | orderly conduits in parallel runs, strip lights, a shift board bracket, numbered plates without digits | steel kick rail, vent grilles, lockable maintenance hatches |
| 3 工业 | an industrial and trade floor, heavy machinery adjacent | thick insulated pipes with flanges, valve stems, hazard-striped brackets, inspection windows | cable trays, grating, oil-stained footing, bolted base plates |
| 4 商业 | a middle-class commercial concourse | polished handrails, brass trim strips, shop-sign hanging brackets (empty), recessed downlights | marble-look skirting, glass panel seams, brass kick plate |
| 5 富人 | an elite privileged residence floor | gold edge trim, recessed lighting coves, velvet curtain swags, small security camera housings | dark marble base, inlaid metal strip, silent ventilation slots |
| 6 核心 | the ruling core at the very top of the tower | thick power busbars, sealed blast shutters, red status lamps, engraved blank plates | armour plating seams, coolant lines, recessed floor bolts |

### 变量表（变体，每阶层各挑 3 个）

| 代号 | `[变体修饰]` |
|---|---|
| a · 常态 | (留空) |
| b · 失修 | add wear: water streaks running down, one broken fixture, scattered rust patches, a patched weld |
| c · 事故 | add one accident trace: a scorch mark around an outlet, a buckled panel, a taped-over break, dried stain at the base |

### 三条可直接复制的完整示例

**1a 贫民·常态**
```
A 1280x128 seamless side-view corridor wall texture for the lowest slum zone of
a 100000-storey tower, damp concrete and patched repairs, pixel art,
horizontally tileable. Top 40 pixels: exposed cable bundles, a bare bulb on a
wire, rusted conduits, blank tin plates. Middle band y40-80: deliberately plain
flat wall, almost no detail, at most two faint weld seams. Bottom 48 pixels:
broken skirting, water stains, a floor drain, chipped plaster.
Exact 16-colour palette: #05080b #14202c #2c3f4e #47657a #8a95a0 #1e4a44
#2f6b5e #4e9c86 #77c6a4 #6b4630 #a5714c #d9b48f #8a4a1e #d98b3c #f4b66a #ffe4b6.
Hard pixel edges, no anti-aliasing, no gradient, no glow, no drop shadow.
No text, no letters, no numbers, no furniture, no characters, no floor,
no ceiling, no perspective, no watermark.
```

**4a 商业·常态**
```
A 1280x128 seamless side-view corridor wall texture for a middle-class
commercial concourse, pixel art, horizontally tileable. Top 40 pixels: polished
handrails, brass trim strips, empty shop-sign hanging brackets, recessed
downlights. Middle band y40-80: deliberately plain flat wall, almost no detail,
at most two faint weld seams. Bottom 48 pixels: marble-look skirting, glass
panel seams, brass kick plate.
Exact 16-colour palette: #05080b #14202c #2c3f4e #47657a #8a95a0 #1e4a44
#2f6b5e #4e9c86 #77c6a4 #6b4630 #a5714c #d9b48f #8a4a1e #d98b3c #f4b66a #ffe4b6.
Hard pixel edges, no anti-aliasing, no gradient, no glow, no drop shadow.
No text, no letters, no numbers, no furniture, no characters, no floor,
no ceiling, no perspective, no watermark.
```

**6c 核心·事故**
```
A 1280x128 seamless side-view corridor wall texture for the ruling core at the
very top of the tower, pixel art, horizontally tileable. Top 40 pixels: thick
power busbars, sealed blast shutters, red status lamps, engraved blank plates.
Middle band y40-80: deliberately plain flat wall, almost no detail, at most two
faint weld seams. Bottom 48 pixels: armour plating seams, coolant lines,
recessed floor bolts. Add one accident trace: a scorch mark around an outlet,
a buckled panel, dried stain at the base.
Exact 16-colour palette: #05080b #14202c #2c3f4e #47657a #8a95a0 #1e4a44
#2f6b5e #4e9c86 #77c6a4 #6b4630 #a5714c #d9b48f #8a4a1e #d98b3c #f4b66a #ffe4b6.
Hard pixel edges, no anti-aliasing, no gradient, no glow, no drop shadow.
No text, no letters, no numbers, no furniture, no characters, no floor,
no ceiling, no perspective, no watermark.
```

---

## 3. 地板：6 张（现在只有 1 张通用）

规格：1280×64，RGB 无 alpha，水平无缝，**俯视看是走道地面**，接在墙的 y128 下面。

```
A 1280x64 seamless side-view floor band for [阶层描述], pixel art,
horizontally tileable, seen edge-on so the surface reads as a thin horizontal
strip. [地面材质]. Exact 16-colour palette: [同上].
Hard pixel edges, no anti-aliasing, no gradient, no glow, no reflections longer
than 8 pixels, no text, no furniture, no characters, no perspective, no watermark.
```

| 阶层 | `[地面材质]` |
|---|---|
| 1 贫民 | wet cracked concrete, standing water in the low spots, scattered grit |
| 2 宿舍 | worn linoleum with a repeating seam, scuffed but swept |
| 3 工业 | steel grating over a dark void, oil film, bolt heads at the joints |
| 4 商业 | polished terrazzo with brass divider strips, clean |
| 5 富人 | dark marble with a thin gold inlay line, mirror-clean |
| 6 核心 | seamless armour plate with recessed seams, faint coolant channels |

---

## 4. 墙装套装（12 件，一张精灵表）

这是墙面现在最"假"的地方——目前全是代码画的纯色矩形。

```
A 1024x1024 pixel-art sprite sheet, 4x4 grid of 256x256 cells, 12 industrial
wall fixtures for a derelict dormitory tower, each object centred in its own
cell and occupying 70-90% of the cell width, flat side-on elevation only
(no perspective, no three-quarter view):
1 vent grille with horizontal slats
2 electrical junction box with a short conduit stub going down
3 torn paper notice board pinned at two corners
4 brass pipe valve with a spoked handwheel
5 steel pipe bracket clamping a vertical pipe
6 coat hook rail with two hooks
7 wall-mounted fire extinguisher
8 fuse cabinet with the door ajar
9 round pressure gauge dial
10 coiled cable hanging on a hook
11 small triangular hazard warning plate
12 blank nameplate with four rivets
Flat pure magenta background #FF00FF filling every empty pixel of the sheet,
no grid lines, no labels, no numbers between cells.
Exact 16-colour palette: [同上].
Hard pixel edges, no anti-aliasing, no gradient, no glow, no drop shadow.
No text, no letters, no numbers, no watermark.
```

> 这批我切完会降到 16–26px 用，所以**每件都要够简洁**——细节太多缩下去就是一团。

---

## 5. 界面框：3 套

每套一张 96×96，内部全透明，我切 28px 角 + 8px 可拉伸边。

```
A 96x96 pixel-art panel frame, a square border only, the inside completely
transparent, designed so the four 28x28 corners carry the detail and the middle
of each edge is a simple repeating stripe that can be stretched horizontally or
vertically without seams. Material: [THEME].
Exact 16-colour palette: [同上].
Hard pixel edges, no text, no icons, no ornament in the centre, no fill,
no glow, no gradient, transparent background.
```

| 用途 | `[THEME]` |
|---|---|
| 对话 | warm riveted brass and dark walnut, two brass screws at each corner, worn edges |
| 物品详情 | cold brushed steel with a thin teal inlay line, clipped corners |
| 塔楼总览 | heavy cast iron with a hazard-striped corner plate on each of the four corners |

---

## 6. 可选（有更好，没有也能跑）

- **门窗 tile**：3 张 × 3 阶层（贫民铁皮门 / 宿舍防火门 / 商业玻璃门），64×96，洋红底。
- **容器变体**：木箱 ×3（完好 / 破损 / 被撬开），48×40，洋红底。
- **墙上的"事故痕迹"贴片**：6 张 64×64（水渍 / 焦痕 / 裂缝 / 弹孔 / 涂鸦划痕 / 血手印），透明底，叠在任意墙上。

---

## 7. 交付清单与命名

| 类 | 张数 | 尺寸 | 底 | 命名 |
|---|---|---|---|---|
| 阶层墙 | 18 | 1280×128 | RGB 无 alpha | `wall-<slum\|dorm\|industry\|commercial\|vip\|core>-<a\|b\|c>.png` |
| 地板 | 6 | 1280×64 | RGB 无 alpha | `floor-<阶层>.png` |
| 墙装 | 1 张表 | 1024×1024 | 洋红 #FF00FF | `wall-fixtures.png`（我自己切） |
| 界面框 | 3 | 96×96 | 透明 | `frame-dialogue.png` / `frame-item.png` / `frame-tower.png` |
| 门窗（可选） | 9 | 64×96 | 洋红 | `tile-door-<阶层>.png` / `tile-window-<阶层>.png` |
| 容器（可选） | 3 | 48×40 | 洋红 | `crate-<intact\|broken\|forced>.png` |
| 痕迹（可选） | 6 | 64×64 | 透明 | `stain-<water\|scorch\|crack\|hole\|scratch\|hand>.png` |

**不要做的**：羽化透明边、外发光、投影、抗锯齿、任何文字。这个项目所有贴图都是硬边，柔边贴上去会像贴纸。

---

## 8. 我这边收到图会做什么

1. 量色数、量占位率、查洋红残留
2. 最近色吸附到 16 色（**不做面积平均**，那会把硬边糊掉）
3. nearest 降采样到目标尺寸
4. 接进 `ENV_FILES` / `FURNITURE_FILES`，跑 `tools/assets-manifest.mjs` 门禁
5. 截图对比前后，不达标就退回重画（会告到具体是哪一项不过）
