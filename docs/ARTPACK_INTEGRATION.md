# 美术包接入报告

- 性质：把用户提供的美术设计图切片、降采样并接入 UI。**不改变核心玩法**，未提前进入 B4。
- 分支 / HEAD：`feat/tower-zoom-b2` / 本报告对应改动见 §6
- 输入：`F:/new/drive-download-20261027T171456Z-1-001.zip`，7 张 1536×1024 设计图
- 新增工具：`tools/png.mjs`、`tools/slice.mjs`、`tools/pick.mjs`、`tools/build-artpack.mjs`

---

## 1. 这批图和上次为什么不一样

上次那 13 张是**设计演示图**：带内嵌中文标注、主视觉插画、动画条，图标是 150–250px 的抗锯齿插画，裁不出来。

这批 7 张是**真正的精灵图表**：透明底（或纯色底）、无内嵌文字、单元格边界清晰。所以这次是真的切出来了。

| 图 | 内容 | 切片数 |
|---|---|---|
| 05_物品图标 | 15 个物品，与游戏 `ITEM_IDS` **一一对应** | 15 |
| 06_UI面板与按钮 | 面板框、槽格、按钮、开关、消息横幅 | 56 |
| 07_HUD地图标记特效 | 状态条、通知条、地图钉、小地图框、图标按钮、特效 | 77 |
| 02_家具与场景物件 | 床、衣柜、工作台、净水设备、水箱、配电箱、木箱… | 47 |
| 03_主角与NPC角色组 | 角色 | 171 |
| 01_建筑基础素材 | 建筑构件 | 62 |
| 04_怪物与夜间事件 | 怪物与事件 | 63 |

合计 **491 个精灵**。

---

## 2. 切片怎么做的

没有图像库、没有 Python，Node 24 自带 zlib，所以自己写了最小 PNG 编解码器（`tools/png.mjs`，约 120 行，支持 8bit RGB/RGBA/调色板）。

`tools/slice.mjs` 按连通域分析切图，不依赖手测网格。三种背景模型：

| 模式 | 用途 |
|---|---|
| `alpha` | 真透明底（01/02/03/07） |
| `key` | 纯色深底（04/05），按颜色距离键控 |
| `checker` | **透明棋盘格被烘焙进了像素**（06 就是：白 250 / 灰 210 交替，跳变 40，任何单色键控和光滑填充都跨不过去） |

三个坑，都在代码注释里记了：

1. **06 的背景不是均匀白色**，是带渐变和噪点的，洪水填充只能覆盖 7%。
2. **棋盘的网格线**在颜色键控后以 1–2px 细线存活，把整张图连成一个连通域（2219 个分量，其中几条发丝线把所有精灵串成一块）。解法是先腐蚀 N 像素再分析，裁切时再把盒子放大 N 补回来。
3. **软光效**（07 上有 6.9% 的像素是中间 alpha）会把相邻精灵连起来。解法是分割用严格阈值（alpha 240），裁切时用 `--pad` 补回软边。

`tools/pick.mjs` 生成带编号的对照表，用来逐个人工确认哪个切片是哪个——切错图标比没有图标更难发现。

---

## 3. 接入了什么

| 资产 | 处理 | 去处 |
|---|---|---|
| 15 个物品图标 | 面积平均降采样到 16×16 | `public/assets/artpack/item-<ItemId>.png`，BootScene 按 `ItemId` 加载 |
| 面板框 | 切成 8 块（4 角原尺寸 + 4 边可拉伸） | `public/assets/ui/frame-<green\|yellow>-<part>.png` |
| 物品槽框 | 降采样到 22×22 | `public/assets/ui/slot.png` |
| 结束横幅 ×2 | 原样 | `public/assets/artpack/banner-win.png` / `banner-lose.png` |

**图标为什么用面积平均而不是最近邻**：源图 ~250px 降到 16px 是 15:1，最近邻等于十五分之一里取一个点，出来是噪点。

**映射为什么显式写死**：图标的排列顺序今天刚好和 `ITEM_IDS` 的键序一致，但 `ITEM_IDS = Object.keys(ITEMS)`，重排就会静默换掉所有图标。所以 `src/render/artpack.ts` 用 `Record<ItemId, string>` 显式列全，漏一个是编译错误；`src/tests/itemIcons.test.ts` 另外校验每个文件真实存在、是 PNG、是 16×16，且没有孤儿文件。

---

## 4. 接入过程中挖出的两个真 bug

### 4.1 `add.image(x, y, '')` 建出来的对象永远不会渲染

背包每一行的图标原来是 `this.add.image(left + 30, rowY + 10, '')` 建的，之后 `refreshInventory` 里 `setTexture(itemIconKey(id))`。

实测：**这样建出来的对象即使换成真贴图也不渲染**，而且对象属性（贴图键、尺寸、alpha、depth、visible、scrollFactor、origin、renderFlags）和一个能渲染的全新对象**完全一致**。同一位置、同一 depth、同一贴图，新建的能显示，行内的不能。

同样的模式还有两处（制作面板 `:644`、对话交易面板 `:836`）。**这三个图标槽从来就没显示过**，之前没人发现是因为它们只是静静地空着。

修法：加一个 1×1 全透明占位贴图 `blank`，三个槽都用它创建。

### 4.2 Phaser 4 的 NineSlice 会在更晚的通道合成，盖住同场景的 Image

这条更隐蔽。证据链：

- 面板框用 NineSlice，背包行内图标不显示
- 把图标 depth 提到 900 → 还是不显示
- 把面板框 depth 降到 -100 → **图标全部出现**
- 只降填充矩形、保留框 → 不出现；只降框、保留填充 → 出现

结论：NineSlice 与普通 Image 的合成顺序**与 depth 无关**。

第一版修法（把框/填充改成固定负偏移）**是错的**：各面板内容深度不同（背包 200、制作 210、对话 220、暂停 230），偏移 -5 让制作面板的框落在 205，高于背包行内图标的 200——而制作面板当时是关闭的，却把背包的图标全吞了。这正是最初那个 bug 的完整机制。

最终修法：**面板框不用 NineSlice**，改成 4 个原尺寸角 + 4 个可拉伸边，共 8 个普通 Image。它们按普通显示列表顺序合成，与 depth 无关的问题就不存在了。

`src/tests/panels.test.ts` 守住这条不变量：**每个场景内，最深的面板框也必须低于最浅的面板内容**。失败模式是完全静默的——不报错，图标就是没了——所以必须用测试而不是靠眼睛。

---

## 5. 验证

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `npx vitest run` | 22 文件 / **268** 用例（新增 9：图标映射 5 + 面板深度 4） |
| `npx playwright test --workers=1` | **54/54 通过**（8.0 分钟） |
| `npm run build` | 通过（766ms） |

浏览器实拍确认：背包 12 行每行都有金属槽框，前 3 行显示净水/压缩口粮/低电量手电的真实图标；结束画面横幅正常；操作说明、制作、暂停三个面板的框均正常。

**未执行**：真人试玩文案与配色；美术包其余 476 个精灵（角色/建筑/怪物/家具）尚未接入。

---

## 6. 修改文件

| 文件 | 改动 |
|---|---|
| `tools/png.mjs` | **新增** 最小 PNG 编解码器 |
| `tools/slice.mjs` | **新增** 连通域切片器（alpha / key / checker 三种背景模型 + 腐蚀 + 对照表） |
| `tools/pick.mjs` | **新增** 编号对照表生成器 |
| `tools/build-artpack.mjs` | **新增** 从切片生成运行期资产 |
| `src/render/artpack.ts` | **新增** `ITEM_ICON_FILES` 显式映射 + 贴图键常量 |
| `src/render/panels.ts` | 面板框改为 8 块 Image；`PANEL_DEPTH` / 偏移量 / `applyPanelDepth` |
| `src/render/pixelArt.ts` | 删除 15 个死掉的手绘图标抽屉 + 7 个家具抽屉（656→219 行）；新增 `blank` 占位贴图 |
| `src/render/furniture.ts` | 键表从 7 个扩到 9 个（木箱/铁箱分开、新增餐台），不再有 null 缺口 |
| `src/render/corridors.ts` | 旧 `furn_crate` 键改为 `furn_crate_wood`；箱堆间距从贴图取实际高度 |
| `src/tests/furniture.test.ts` | 改为断言全表覆盖 + 每个家具文件真实存在 |
| `src/tests/textureKeys.test.ts` | **新增** 扫源码所有贴图键，防静默绿框 |
| `src/render/itemIcons.ts` | 注释更新（图标改为从美术包加载） |
| `src/scenes/BootScene.ts` | 加载美术包资产 |
| `src/scenes/GameScene.ts` | 三个图标槽改用 `blank`；背包加槽框；面板深度改用常量 |
| `src/scenes/MenuScene.ts` | 面板深度改用常量 |
| `src/scenes/TowerOverviewScene.ts` | 面板深度改用常量 |
| `src/scenes/EndScene.ts` | 用美术包横幅做结束画面 |
| `src/tests/itemIcons.test.ts` | 扩充：映射完整性 + 文件存在性 + 16×16 + 无孤儿 |
| `src/tests/panels.test.ts` | **新增** 面板深度不变量 |
| `e2e/ui.spec.ts` | 面板框断言改为找 `ui-frame-*`（不再是 NineSlice） |

---

## 7. 家具接入（第二轮）

七个程序化家具贴图全部换成美术包道具，`pixelArt.ts` 因此从 656 行降到 219 行。

| 容器 | 源切片 | 说明 |
|---|---|---|
| `furn_bed` | furn-00 | 床 |
| `furn_cabinet` | furn-03 | 衣柜（储物柜） |
| `furn_crate_wood` | furn-25 | 木箱 |
| `furn_crate_metal` | furn-26 | 铁箱 |
| `furn_workbench` | furn-09 | 工作台 |
| `furn_watertank` | furn-12 | 储水罐 |
| `furn_fusebox` | furn-14 | 配电箱 |
| `furn_shelf` | furn-21 | 货架 |
| `furn_counter` | furn-19 | 餐台（带凳子的食堂长桌） |

**道具统一缩放到 80px 高**，不用原生 100–220px：228px 的衣柜会超出墙面可用高度（走廊代码里壁灯就站在 `floorY-150`），而且一个道具是另一个两倍高会像贴纸。80px 让每个道具都留在那个高度带内，细节也还认得出来。

**木箱和铁箱不再共用一张贴图。** 它们本来共用一个 16×16 的程序化木箱，现在一个用木箱图一个用军用箱图——分清它们是第 3 层读得懂「这是个地方」的一半。

**餐台不再是缺口。** 它原来没有对应贴图，靠一个 Graphics 方块兜底；现在有真图了，所以 `containerTextureKey` 不再返回 null，兜底分支整个删掉。漏一个键的后果从「看起来朴素」变成「完全看不见」，所以 `furniture.test.ts` 改成断言全表覆盖而不是允许缺口。

### 接入时又踩到一个坑，值得一个测试

`corridors.ts` 还在用旧的 `'furn_crate'` 键。键已经不存在了，而 **Phaser 对不存在的贴图键是静默回退成 `__MISSING` 绿色占位框，一声不响**——于是第 3 层货架旁站着两个绿色矩形，跑完全套测试没有一个失败。

`src/tests/textureKeys.test.ts` 守着这条：用 Recording stub 跑一遍 `generateAllPixelArt` 拿到所有烘焙键，加上 BootScene 加载的键，再用正则扫源码里所有 `add.image / add.sprite / add.tileSprite / add.nineslice / setTexture / load.image / textures.get` 调用的贴图参数，两边必须一致。反方向也查：烘焙了但没人用的键是构建里的死重量。

已实测有效：把 `furn_crate_wood` 改回 `furn_crate`，测试立刻报 `furn_crate (render\corridors.ts)`。

顺带修了箱堆的堆叠间距——原来按 16px 瓦片写死，新箱子高 80px，改成从贴图取实际高度。

---

## 8. 验证

家具接入后的全量结果见提交说明。浏览器实拍确认：第 1 层工作台是真工具墙；第 3 层木箱与铁箱分明、箱堆贴合无缝隙、货架旁无绿色占位框。

## 9. 下一步（未做）

角色（171）、建筑（62）、怪物（63）三个切片集还没接入。角色最值得做——玩家和两个 NPC 现在还是 16×24 的程序化剪影，而 `03_主角与NPC角色组` 里 171 个切片应该正好覆盖。建筑和怪物属于世界填充，可以等 B4。
