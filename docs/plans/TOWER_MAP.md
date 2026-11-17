# 塔楼地图：楼体剖面化重做（AG-62，2026-11-17）

用户原话（试玩反馈）：

> 「地图现在也很难看，可以做一个缩小版本的更好看一点，不要一下子看到 1 万层很奇怪」
> 「可以放大一点地图，因为游戏界面上面下面都是灰色也很奇怪，对了你再做一个地下室啥的
> 也能看见，就是前面 5 层都能看见，因为相当于是我们基础发育的一个地方」

本文记录重做后的地图结构、坐标模型、交互与数据来源。**主游戏场景上下的灰色死区不归本文**
（归总控与 AG-65 几何线）；本地图自己的内容带无死区，见「滚动夹制」。

## 1. 地图是什么

塔楼地图（M 键 / 暂停菜单「塔楼地图」进入，`TowerOverviewScene`）从「一根 3px/区段的
火柴」重做为**一栋纵向摩天楼的剖面图**，三个层级共用一套视觉语言：

| 层级 | 画面 | 作用 |
| --- | --- | --- |
| 总览（overview） | 楼体剖面：地基 + 地下基座（1-5 层）+ 六个等高阶层段 + 段间结构层 | 一眼看全塔的结构与自己在哪里 |
| 区段（sector） | 同一栋楼的放大镜：本区段 1000 层每层一条线的 ribbon | 段内挑层（大阶层段在楼体尺度上永远展不开 40000 条线） |
| 楼层（floor） | ribbon + 详情卡 | 这一层有什么、能不能进 |

段与段之间是**结构层**（16 世界单位：平台/机房窗/双排铆钉），段内楼层是发丝线
（屏距可读时才画——T1 每层约 18px 可数，T4 的 40000 层读作实心体，密度本身就是信息）。

### 视觉结构

- **地下基座 B1–B5**（用户点名的「地下室」）：楼体底部独立加厚的一段（150 单位 / 5 层 =
  30 单位每层，是 T1 楼距的 10 倍），暖色（皮肤ramp 的 skinDeep——调色板里唯一暖色族，
  「暖像素 = 有光」恰好是发育区的语义），带土层纹理与五间房名（宿舍/邻居宿舍/储物层/
  维修层/食堂，读 `environmentFor` 的 label），下面是一圈比楼体宽一截的地基托脚。
- **六个阶层段等高**（各 300 单位）：故意不按楼层数比例——99 层与 40000 层等段，段内
  密度差才是「一栋楼的一段」的读法。颜色按 `TIER_COLOR` 由冷到暖爬升（石头→青→暖光），
  延续旧地图的阶层渐变语义。
- **探索状态**：前沿（`accessOf` 的 highestUnlocked）之下提亮、之上压暗；已访问楼层在
  ribbon 里点亮（`cellStates`）。当前层是横贯楼体的亮带 + 屏幕空间「第 N 层」钉；滚出
  内容带时改用内容带边缘的方向箭头。
- **守段者层**（5/110/50010，经 `encounterSpots` 推导，不另抄表）：右导轨红旗。
- **货梯**（段首/段末，读 `segments.liftDirection`）：左导轨三角；已创作段（PLAYABLE_SEGMENTS）
  在左导轨画亮线。
- 背面是竖向渐变天空（scrollFactor 0，全屏无死区），铆钉板语言来自 hudSkin。

## 2. 两套坐标模型（hudLayout.ts）

纯算术全部住在 `render/hudLayout.ts`（无 Phaser import，Node 可测）：

- **内部模型 y 向上**：地基在 0、塔顶在 `buildingHeight()`——「一栋楼站着」的直觉坐标，
  所有纯函数用它写。
- **公开模型 y 向下**（Phaser 原生）：每个导出函数是内部答案的一次翻转，scene 之后只用
  普通 Phaser 坐标画图，永远不用想翻转这件事。

关键常量在 `TOWER_MAP`：`baseFloors: 5`、`baseH: 150`、`tierH: 300`、`seamH: 16`、
`buildingW: 860`、`topBand: 88`、`bottomBand: 672`、`zoomDefault: 1.15`、`sectorPitch: 8`。
全塔缩放 `towerFitZoom() = 内容带高 / 楼体高 ≈ 0.283`，同时是总览的缩放下限。

**Phaser 相机中心约定（踩过的坑，已写进源码注释）**：相机把视图居中在
`(scrollX + 画布宽/2, scrollY + 画布高/2)` 这个**世界点**上，不是视口左上角。用左上角
约定推屏幕映射，楼体会整体偏移（实测缩放 0.28 时偏 460px）。scene 的 `screenY/screenXOf/
worldYAt/centerScrollFor` 全部走这个中心；楼体居中于世界 x=640，故 `scrollX` 恒为 0。

## 3. 默认视图：聚焦，而不是一整根火柴

- 打开地图即 `zoomDefault`（1.15）：视口约 626 世界单位，当前段全段 + 上下各一段的大部
  分。站在基座里时五间房名全可见（用户「前面 5 层都能看见」）；站在 T1 往下也能看到基座。
- 滚轮以指针为锚缩放（`towerFitZoom()` .. `zoomMax` 6）；`F` / 「看全塔」芯片一键全塔
  （整栋楼正好落进内容带，起点/终点标签归位），再按回到聚焦。拖动平移。
- 区段层级默认 `sectorZoomDefault`（1.0，8px/层），Enter 逐层下钻，ESC/M 逐层/直接返回。

## 4. 滚动夹制：内容带无死区

`viewCenterBounds(contentHeight, zoom)` 把镜头中心夹在
`[（半画布高 - topBand)/zoom, contentHeight - (bottomBand - 半画布高)/zoom]`：
内容必须始终盖住 `[88, 672]` 内容带——既拖不出楼体留下死区，也不把固定 HUD 让给楼体。
内容装得进内容带时（全塔视角）只有一个合法中心（内容居中于带）。`towerMap.test.ts`
在所有缩放 × 所有起止滚动点上钉住这条性质。

楼体的世界空间标签（阶层铭牌/基座房名/起点终点）全部是 **scrollFactor(0) 的屏幕坐标
文本**，每帧按世界→屏幕重定位并按内容带裁切：铭牌浮在所在段上沿上方、自下而上放置且
只允许一块吸顶；起点/终点固定在右缘 `TOWER_TAG_X` 并带引线。因此相机缩放永远不会缩放
文字，标签也永远不会和标题/状态签/页脚相撞（firstChapter/font/ag62 三个 spec 的
15% 重叠阈值守卫）。

## 5. 楼层信息：全部只读

悬停或选中某层时，顶部读出行给：层号 · 段名 · （已创作楼层的）房名 · 寒/潮/暖 ·
容器数 · 问号点数 · NPC 数，外加「守段者 / 夜袭」告警。数据来源：

- `describeFloor` / `environmentFor` / `warmthOf`（纯函数）
- `summarizeFloor(runSeed, floor)`（worldgen 的确定性预览——未探索楼层的容器数/物资档/威胁）
- `encounterSpots(runSeed, floor)`（静态表，问号点与守段者）
- `npcsOnFloor(floor)`（data）
- 详情卡第五行：已创作楼层走 `LootSystem.describeFloorContents`（读**已结算**的世界），
  未探索楼层走 `describeUnexploredFloor`（worldgen 预估，questPanel.test.ts 逐字镜像）

没有任何路径调用生成器写状态；选中≠进入的唯一出口是 `TowerNav.tryEnterSelected`
（前沿之上的楼层一律拒绝，文案照旧）。

## 6. 改了哪些文件

| 文件 | 改动 |
| --- | --- |
| `src/render/hudLayout.ts` | 新增 `TOWER_MAP` 常量块 + 楼体几何纯函数（两套坐标模型）+ `viewCenterBounds` |
| `src/scenes/TowerOverviewScene.ts` | 整文件重写（楼体剖面渲染、三层级交互、标签布局、只读楼层信息、dev 句柄） |
| `src/tests/towerMap.test.ts` | 新增：几何/拾取/ribbon/夹制 19 条守卫 |
| `e2e/ag62-map.spec.ts` + `e2e/playwright.ag62.config.ts` | 新增：5462 端口实测探针（聚焦/全塔/悬停/缩放/进入 + 布局守卫），截图落 `e2e/screenshots/62-*.png` |
| `e2e/tower.spec.ts` | 默认视图断言改为聚焦语义（zoom=zoomDefault、楼体覆盖、F 全塔），钻探/键盘/禁传送测试原样保留 |

未动：`src/core/**`、`src/data/**`、`src/systems/**`（TowerNav 规则一字未改）、GameScene
（地图场景键与入口参数不变）。

## 7. 场景重启的幂等（踩过的坑）

`scene.start()` 复用同一实例，不新建。旧版建造器把标签 push 进字段数组不清空，第二次
进入时旧 Text 的帧数据已被 shutdown 销毁，`setText` 直接抛
（`Frame.updateUVs` 读 null.drawImage），redraw 半途死掉、HUD 停在上一层。现由
`teardownOwned()` 在 create() 开头销毁上一visit 的全部对象并重置所有列表，shutdown 句柄
用 off+once 注册。e2e「打开地图→返回→再进入」的往返测试钉住这一点。

## 8. 实测与验证

- `npx tsc --noEmit` 干净；`VITE_NPC_MODEL= npx vitest run` 92 文件 1685 全绿
  （基线 1666 + 新增 19）。
- Playwright（端口 5462，`--workers=1`）：ag62-map 5/5、tower.spec 10/10、
  firstChapter 塔楼面板布局 1/1、font 2/2、hudLayout 5/5。
- 截图证据：`62-map-focus.png`（默认聚焦 + 基座五间）、`62-map-fit.png`（全塔 + 六段铭牌）、
  `62-map-sector.png`（区段放大镜）、`62-map-floor.png`（详情卡）、`62-map-detail.png`（缩到可数）。

## 9. 已知边界 / 未处理

- **主场景灰色死区不归本地图**：用户「游戏界面上面下面都是灰色」是 GameScene 相机收窄后
  本层只占屏幕中段的问题（总控 / AG-65 几何线）。本地图的内容带内无死区，但地图是独立
  scene，关掉地图回到主场景仍会看到那条灰带。
- 区段放大镜默认一屏约 90 层（8px/层），1000 层靠滚动/方向键浏览——楼体尺度上放不下
  整个区段，这是设计取舍（总览看全塔、区段当放大镜）。
- 基座房名只在楼距 ≥30px（缩放 ≥1）时显示；全塔视角下基座读作一条暖色厚边，铭牌
  「地下基座 B1–B5 · 基础发育区」承担说明。
