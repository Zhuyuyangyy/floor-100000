# 还缺的美术（可直接拿去生图）

盘点日期 2026-11-15。已经接进运行时的 130 个文件不再列出，这里只写**代码已经留好口、但素材不存在**的三类。

角色动作不缺：walk / idle / attack / hurt / search / die / pickup 七套全部有帧（5 个角色 × 20 帧 × 1280×96）。

---

## 通用约束（三类都适用，贴在每条提示词后面）

```
16-colour palette only:
#05080b #14202c #2c3f4e #47657a #8a95a0 #1e4a44 #2f6b5e #4e9c86 #77c6a4
#6b4630 #a5714c #d9b48f #8a4a1e #d98b3c #f4b66a #ffe4b6
hard pixel edges, no anti-aliasing, no gradient, no glow, no drop shadow,
no text, no letters, no numbers, no watermark, no signature, no border, no frame.
```

不用 16 色也交，我这边会做最近色吸附；但**不要渐变**，渐变吸附后会结块。

---

## A. 墙装小尺寸套装（最缺，墙面现在全是程序化矩形）

**为什么缺**：层内墙装只有 16–26px（通风口 26×14、接线盒 16×12、告示 22×14、竖管 4×128）。现在这些是代码画的纯色矩形，是墙面最"假"的地方。

**画多大**：1024×1024，4×4 网格，每格 256×256，放 12 件。我切出来按目标尺寸降采样。

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
flat pure magenta background #FF00FF filling every empty pixel of the sheet,
no grid lines, no labels, no numbers between cells.
```

负面：`no text, no letters, no numbers, no watermark, no drop shadow, no gradient, no anti-aliasing, no outline, no grid lines.`

---

## B. 两档阶层墙（代码已留口，现在回落到贫民墙）

`corridors.ts` 里已经写好分支和键名，只等两张图：

| 文件 | 层 | 现在 |
|---|---|---|
| `wall-commercial.png` | 10000–10010 | 回落 `wall.png`（贫民区），玩家看不出自己升了阶层 |
| `wall-vip.png` | 50000–50010 | 同上 |

**画多大**：1280×128，RGB 无 alpha，**水平无缝**（左右两端能接上）。

三段布局是硬契约（容器名标签压在 40–80 这段上）：

- y 0–40：管道、灯具、检修板、编号铭牌
- y 40–80：**刻意留平**（这段会被 UI 文字覆盖）
- y 80–128：踢脚轨、通风口、检修面板、线槽

```
A 1280x128 seamless side-view corridor wall texture for the middle-class and
commercial zone of a vertical slum tower, pixel art, horizontally tileable,
three horizontal bands: the top 40 pixels carry pipes, lamps, inspection plates
and blank identity tags; the middle band from y40 to y80 is deliberately plain
flat wall with almost no detail; the bottom 48 pixels carry a base rail, vent
grilles, maintenance panels and cable conduits. Clean painted steel panels with
brass trim, shop-sign brackets without lettering, polished handrails, warm
interior light strips along the top band.
```

第二条把 `middle-class and commercial zone ... Clean painted steel panels with brass trim, shop-sign brackets without lettering, polished handrails, warm interior light strips` 换成：

```
the elite privileged zone of a vertical slum tower ... dark marble inlay panels,
gold edge trim, recessed lighting coves, velvet curtain swags along the top band,
security camera housings at intervals
```

负面（两条都加）：`no furniture, no characters, no floor, no ceiling, no text, no letters, no numbers, no graffiti, no watermark, no perspective, no vignette.`

---

## C. 三套界面框（现在三种面板共用 green / yellow）

**为什么缺**：对话、物品详情、塔楼总览这三块在设定里各有专属框，但 `素材库/.../04-界面/` 里只有 HUD 概念图 10 张，没有这三套。现在全部走通用九宫格。

**画多大**：每套一张 96×96 的完整方框，我切成 4 个 28×28 角 + 4 条 8px 可拉伸边。

```
A 96x96 pixel-art panel frame, a square border only, the inside completely
transparent, designed so the four 28x28 corners carry the detail and the middle
of each edge is a simple repeating stripe that can be stretched horizontally or
vertically without seams.
Material: [THEME].
```

三套的 `[THEME]`：

| 用途 | THEME |
|---|---|
| 对话（NPC 说话） | `warm riveted brass and dark walnut, two brass screws at each corner, soft worn edges` |
| 物品详情 | `cold brushed steel with a thin teal inlay line, clipped corners, industrial` |
| 塔楼总览 | `heavy cast iron with a hazard-striped corner plate on each of the four corners` |

负面：`no text, no icons, no ornament in the centre, no fill, no drop shadow, no glow, no gradient, transparent background.`

---

## 交付与验收

- 格式：PNG。A 类洋红底（`#FF00FF`），B 类无 alpha 的 RGB，C 类透明底。
- 命名：A 类不命名（整张交，我切），B 类 `wall-commercial.png` / `wall-vip.png`，C 类 `frame-dialogue.png` / `frame-item.png` / `frame-tower.png`。
- 我这边会跑：色数统计 → 最近色吸附 → 目标尺寸降采样（nearest）→ 截图对比 → `tools/assets-manifest.mjs` 门禁。
- **不要**做透明羽化、不要加投影、不要加描边光。这个项目的墙和家具都是硬边，柔边贴上去会像贴纸。
