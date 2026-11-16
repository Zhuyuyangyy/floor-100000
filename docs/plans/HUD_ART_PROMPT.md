# HUD 美术重画 · 提示词与接入规格（2026-11-16）

> 目的：替代 `src/render/hudSkin.ts` 的程序化绘制。**这份文档就是给画图工具的提示词 +
> 接入方的规格书**。画之前先读「三条铁律」——上一版概念包（F:/new/末日宿舍_HUD_UI分件包.zip）
> 就是死在这三条上，导致它至今没能接入游戏。

## 一、三条铁律（违反任何一条，画完也接不上）

1. **图里不许出现任何数字**。生命/饥饿/口渴/精力/金币/分数/时间/楼层/目标/体温/区域/潮湿/夜间——
   这些全是运行时值，必须由代码用 Noto Sans SC 实时绘制。概念包把「生命 100、饥饿 65」烤在图上，
   接进去就等于冻结数值。
2. **按 1280×720 设计画布做，不要按 1656 宽做**。概念包整块板 1656px 宽，而游戏设计画布 1280，
   最近邻缩放进游戏会糊。每个分件的尺寸在下面写死，**整数像素，不要抗锯齿**。
3. **底板必须半透明/开窗，不许用不透明大色块挡世界**。HUD 是盖在游戏画面上的，玩家要通过它看楼层。
   参考实现：深色板用 6 段递增 alpha（0.14→0.74）的垂直渐变带，不是一块实底。

## 二、风格基调

- 像素风、硬边、无抗锯齿（和现有 `public/assets/artpack/` 的角色/场景同一血脉）
- **全部颜色在游戏 16 色板内**（接入有 `tools/assets-manifest.mjs` 门禁，越界直接 FAIL）
- 深色铆钉金属板 + 暖色 accent 边条 + 右下危险斜纹（沿用 2026-11-14 概念图的语言，
  原型在 `素材库/收集素材库/首章待用美术设定集/04-界面/HUD概念图/`）
- 图标是 8×8 网格、2px 一个单位、16px 成品（现有 13 个图标在 `hudSkin.ts` 里是代码画的，
  可以照它的形状画成贴图，也可以重画——但形状语义要对得上）

## 三、分件清单与尺寸（共 4 件）

| 文件 | 尺寸 | 内容 | 透明区域 |
|---|---|---|---|
| `hud-plate.png` | 1280×102 | 顶部状态板：铆钉板 + 分组线 + 行分隔 + 危险条纹 | 条纹以外的板体带 alpha 渐变 |
| `hud-foot.png` | 1280×26 | 底部 hint 栏底板（一条深色带 + 上缘发丝线） | 带内留空 |
| `hud-buttons.png` | 474×26 | 5 个面板按钮的底板座（88×26 一个，间距 6，右对齐到 x=1264） | 按钮面留空，只画座 |
| `hud-icons.png` | 208×16 | 13 个 16×16 图标横排（见下方顺序） | 图标外全透明 |

### `hud-plate.png` 内部坐标（设计画布像素，左上原点）

- 板体：0,0 → 1280×102，六段垂直 alpha 带（0.14→0.74），底色 `#0b0f12`
- 上下缘：1px 发丝线，颜色取板线的浅灰
- 铆钉：四角 + 两条分隔线中点，2×2 px，位置 (8,8) (1271,8) (8,93) (1271,93) (268,50) (1040,50)
- 左缘 accent：3px 宽暖色竖条（0,0 → 3,102）
- 分组竖线：x=268 与 x=1040，y 12..38，1px
- 行分隔横线：y=50 与 y=70，x 16..1264，1px
- 危险斜纹：x 1080..1256, y 74..86，45° 斜条（条宽 4、步进 8），半透明
- **板内不开文字槽、不画数字**——所有文字位置见 `src/render/hudLayout.ts` 的
  `HUD_LAYOUT`（行1 y=2、时钟 y=30、目标 y=52、环境 y=80，四枚 chip 图标在
  x=20/300/620/900），代码按这些坐标往上排

### `hud-icons.png` 图标顺序（13 个，每个 16×16，从左到右）

1. tower（塔楼徽标）2. calendar（日历）3. cross（生命）4. hunger（饥饿）
5. thirst（口渴）6. energy（精力）7. coins（金币）8. star（分数）
9. clipboard（今日目标）10. thermo（体温）11. wind（区域/风）12. drop（潮湿）
13. moon（夜间）

每个图标用一个主色画（生命红/饥饿橙/口渴蓝/精力黄/金币金/分数亮黄/其余浅灰或暖白），
背景透明。**形状参考 `src/render/hudSkin.ts` 的 `drawHudIcon`**——那里有每个图标的
8×8 网格定义，比如 thirst 是「尖顶 + 圆底的水滴」，energy 是闪电。重画可以更精细，
但一眼要能认出是什么。

## 四、主提示词（直接复制去画）

### 中文版（即梦/通义万相类）

```
像素风游戏 HUD 界面分件，末日生存塔楼题材，深色铆钉金属板，
暖色 accent 边条，右下角 45 度危险斜纹，硬边无抗锯齿，
颜色限制在 16 色复古色板内（深蓝灰底 #0b0f12、浅灰线、暖白、暗红、
琥珀黄），半透明磨砂质感能隐约透出背后画面，不要画任何数字和文字，
不要画人物，1280x102 横向长条布局，上下缘 1 像素发丝线，
四角 2 像素铆钉，左侧 3 像素暖色竖条，两条垂直分组线和两条水平行分隔线，
右侧末端一组半透明黄黑危险斜纹，复古 CRT 显示器边框的质感，
2D 游戏 UI 素材，透明背景 PNG
```

### English version (Midjourney / SD class)

```
pixel art game HUD panel sprite, post-apocalyptic survival tower theme,
dark riveted metal plate, warm accent edge stripe, diagonal hazard stripes
at the right end, hard edges no anti-aliasing, limited 16-color retro
palette (dark blue-gray #0b0f12 base, light gray hairlines, warm white,
dark red, amber yellow), semi-transparent frosted panel that lets the
game show through, NO text NO numbers NO letters anywhere, no characters,
1280x102 horizontal bar, 1px hairline top and bottom edges, 2x2px rivets
at four corners, 3px warm accent stripe on left edge, two vertical group
dividers and two horizontal row separators, translucent yellow-black
hazard chevrons at the right end, retro CRT bezel texture, 2D game UI asset,
transparent background PNG, crisp nearest-neighbor pixel look
```

### 分件补充提示（在上一句之后追加对应分件）

- 画 `hud-plate.png` 时追加：`wide 1280x102 status plate, rivets at corners, hazard stripes right end`
- 画 `hud-foot.png` 时追加：`1280x26 thin bottom bar, single hairline top edge, empty interior`
- 画 `hud-buttons.png` 时追加：`five 88x26 button slots side by side with 6px gaps, right-aligned, empty faces`
- 画 `hud-icons.png` 时追加：`thirteen 16x16 icons in a row on 208x16 sheet: tower, calendar, red cross, fork, droplet, lightning bolt, coins, star, clipboard, thermometer, wind lines, water drop, crescent moon, each icon single accent color, transparent background`

## 五、画完怎么接（接入方的事，但写清楚免得出错）

1. 四张图进 `public/assets/ui/hud/`，过 16 色门禁（`node tools/assets-manifest.mjs`）
2. `hudLayout.ts` 已有全部坐标常量（`HUD_LAYOUT` / `TOWER_FOOT_TOP` 等），
   **接入时不许改这些数值来迁就图**——图要按这些坐标画；真要改，先跑
   `src/tests/uiLayout.test.ts` 与 `src/tests/hudLayout.test.ts` 的断言
3. 文字/数字/属性条全部继续用代码画（Noto Sans SC），贴图只替代
   `drawHudPlate` / `drawHazardStripe` / `drawHudIcon` 三处
4. 接入后 Playwright 实测：1280×720 下 `getBounds()` 量所有 HUD 文本不出板、
   不互相压（15% 阈值）、不出画布；三视口（900×600 / 1280×800 / 1920×1080）复核

## 六、验收标准

- [ ] 四张图全部在 16 色板内（门禁 clean）
- [ ] 图内零数字零文字（拿去找不出一处「100」「65」这类）
- [ ] 1280×102 板在 1280 画布下不用缩放
- [ ] 底板半透明，能透出游戏画面
- [ ] 13 个图标一眼可辨，和现有形状语义一致
- [ ] 接入后属性条/时钟/目标/四枚 chip 全部正常显示，布局测试全绿
