# 第100000层：末日宿舍

> 2D 横版像素生存游戏。在一座看不见底的十万层末日宿舍塔里，你从最底层的一张床醒来，靠探索楼层、搜刮物资、与邻居交易活下去，然后一路向上——直到有机会决定整座塔的命运。

技术栈：**Phaser 4.2.1** + **TypeScript（strict）** + **Vite**；单测 **Vitest**，浏览器 E2E **Playwright**，桌面版 **Electron**。核心规则是可测试的纯 TypeScript，Phaser 只负责渲染与输入。

---

## 游戏画面

![标题界面](docs/img/title.png)

![宿舍（白天）](docs/img/dorm.png)

<details>
<summary>更多截图：选人、二楼邻居、食堂火盆、漏水、搜刮、背包</summary>

| 选人 | 二楼：三个角色同屏 |
| --- | --- |
| ![选人](docs/img/select.png) | ![二楼](docs/img/floor2.png) |

| 食堂：火盆在烧 | 漏水：天花板在滴水 |
| --- | --- |
| ![食堂](docs/img/canteen.png) | ![漏水](docs/img/leak.png) |

| 搜刮容器 | 背包 |
| --- | --- |
| ![搜刮](docs/img/search.png) | ![背包](docs/img/inventory.png) |
</details>

## 这个游戏是什么

不是「宿舍版横版冒险」，也不是模拟经营。它是**巨型塔楼探索 × 近景生存 × 宿舍基地建设 × 阶级与权力**。

一昼夜的循环：

```
06:00 醒来 → 看补给与状态 → 决定今天上到第几层
      → 走路 / 搜刮容器 / 开问号点 / 打遭遇战 / 和邻居做交易
      → 东西装不下就得取舍，天黑前赶回宿舍
      → 喝水、吃饭、在工作台制作、升级家具
      → 20:00 后睡觉 → 新一天，资源更紧，目标重 roll
```

- **起点**：第 1 层，最底层的贫民宿舍。
- **终点**：第 100000 层，统治核心。正式版本的胜利条件是**抵达塔顶**，不是熬到某一天。
- **失败**：生命归零。死因可解释（脱水 / 饥饿 / 伤势）。
- **当前可玩范围**：第 1–5 层，构成第一个完整生存章节。

## 角色与动画

四个可操作角色全部由**代码骨架（rig）驱动**，不是逐帧手绘：一份 SVG 骨架定义骨骼与配色，一份 `rig_anim.v1` JSON 定义关键帧与两骨 IK，工具负责渲染、落地检查与打包。所以脚步不会打滑——着地那只脚在世界坐标里恒定，接触报告量出 **0.0px 漂移**。

![走路循环](docs/img/walk-strip.png)

![四个角色](docs/img/cast.png)

每个角色 20 帧、7 段动画：行走（6）· 待机（2）· 攻击（3）· 受击（2）· 搜刮（2）· 死亡（3）· 拾取（2）。骨架文件在 [`art-src/rigs/`](art-src/rigs/)，装配工具是 [`tools/assemble-rig-sheet.py`](tools/assemble-rig-sheet.py)。

| 角色 | 识别特征 |
| --- | --- |
| **幸存者** | 青绿连帽衫，大帆布背包（铺盖卷 + 压缩带） |
| **阿林** | 宽肩、灰白短须、钢蓝背带裤，腰上挂着扳手 |
| **小周** | 约十二岁：头大身窄，琥珀色大外套长过臀 |
| **流浪者** | 夜里追你的东西：尖顶兜帽、没有脸、窄身长手长腿，5 色暗红黑 |

---

## 现在做到哪了

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M1 可玩原型** | B2 + B3：五层范围内探索、搜集、制作、交易、睡觉、存档，无软锁 | 🔵 机制层已完成，**待人工试玩判定「好不好玩」** |
| **M2 首个完整章节** | B4 + B5 + B6：世界生成、资源经济、NPC 关系 | ⬜ 未开始 |
| **M3 正式游戏** | B7–B10：阶级与权力、多路线终局、内容与发行 | ⬜ 未开始 |

| 阶段 | 一句话 | 状态 |
| --- | --- | --- |
| B2 塔楼世界与导航 | 十万层可查看、可规划、不可乱传 | ✅ 已实现，待验收 |
| B3 首个完整生存章节 | 第 1–5 层能玩完一段完整循环 | 🔵 进行中 |
| B4 十万层世界生成 | 100 个区段可复现、按需生成 | ⬜ |
| B5 资源经济与基地建设 | 同一物资兼具生存价值与经济价值 | ⬜ |
| B6 NPC 与关系网络 | 居民有身份、需求和记忆 | ⬜ |
| B7–B10 | 阶级与权力、多路线终局、内容、发行 | ⬜ |

已知的两个待解问题（不是 bug，是内容量问题）：**一天里仍有约 8 小时无事可做**；**五层内容是一次性的**，回取一趟之后再无上楼理由。详见 [`docs/M1_PLAYTEST.md`](docs/M1_PLAYTEST.md)。

## 玩法系统

23 个纯逻辑模块都在 `src/systems/`，一行 Phaser 代码都没有——所以能毫秒级跑测试。

| 系统 | 玩家看到什么 | 模块 |
| --- | --- | --- |
| **生存** | 饥饿 / 口渴 / 精力三条槽随时间下降，归零掉血 | `SurvivalSystem` |
| **时间** | 时钟 1 真实秒 = 3 游戏分钟；搜刮、制作、交易各花 20/30/15 游戏分钟 | `SurvivalSystem` |
| **背包** | 12 格，装满会常驻警告，可合并的堆才能进包 | `InventorySystem` |
| **搜刮** | 容器与地面物品，掉落按种子决定，关键道具保底 | `LootSystem`、`data/floorTemplates` |
| **制作** | 在宿舍工作台旁按配方造物品、升级家具 | `CraftingSystem` |
| **交易** | 跟邻居以物易物，守价守恒 | `TradeSystem` |
| **遭遇** | 问号点：战利品 / 伏击 / 商人 / 便条 / 补给箱 / 守门人 | `encounters`、`encounterSpots` |
| **战斗** | 回合制，攻击 / 防御 / 逃跑；15 种怪 7 种行为 | `combat`、`monsters` |
| **每日目标** | 每天 06:00 roll 一个（补水 / 搜刮 / 建造 / 爬楼），完成给分和口粮 | `dailyGoals` |
| **停留压力** | 在同一层待越久，出现的客人越不友好 | `dwellPressure` |
| **遗物与模式** | 5 件按深度解锁的遗物；3 档难度（快速跑 / 冒险 / 简单） | `relics`、`modes` |
| **存档** | 自动存到 LocalStorage，坏档可恢复 | `SaveSystem` |
| **世界标记** | 「这事发生过吗」统一走一张 flag 表 | `WorldFlags` |

## 技术架构

四层，越往下越不认识 Phaser：

| 层 | 职责 | 体量 |
| --- | --- | ---: |
| `scenes/` | 场景、输入、面板、动画调度 | 4,984 行 |
| `systems/` | 游戏规则，纯函数，只吃 `GameState` | 3,147 行 |
| `core/` | 状态结构、时钟、常量、seeded RNG、开发夹具 | 894 行 |
| `data/` + `config/` | 物品、配方、楼层模板、平衡数值 | 365 行 |
| `tests/` | 单元测试，**比场景代码还多** | 6,730 行 |

三条刻意的技术决定：

1. **规则与渲染彻底分开**：`systems/` 不 import Phaser，所以 587 个用例能在 1 秒内跑完。
2. **随机必须可复现**：全项目禁用 `Math.random()`，一律用 `deriveSeed(seed, day, 用途)` 派生。同种子必然同结果。
3. **不用物理引擎**：连 Phaser 自带的 Arcade Physics 都没开。移动是手写的速度斜坡（`stepHorizontalSpeed`），2D 横版不需要刚体。

## 质量与测试

| 关卡 | 规模 | 命令 |
| --- | --- | --- |
| 类型检查 | TypeScript strict，零 `any` 滥用 | `npm run typecheck` |
| 单元测试 | 42 个文件 / **587 个用例**，约 1 秒 | `npm run test` |
| 浏览器测试 | 20 个 Playwright spec，用真键盘跑真游戏 | `npm run test:e2e` |
| CI | 任何分支 push 都跑 typecheck + 单测 | `.github/workflows/ci.yml` |

浏览器测试能读到真实的游戏状态，靠的是 `src/main.ts` 里一个只在开发模式挂载的 `window.__PHASER_GAME__`——生产构建里没有。

## 本地运行（干净环境）

需要 Node.js 20+。

```bash
npm install
npm run dev
```

然后按终端提示打开浏览器（默认 http://localhost:5173）。

## 可用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run typecheck` | TypeScript 严格类型检查（`tsc --noEmit`） |
| `npm run test` | Vitest 单元测试（纯逻辑：生存、制作、交易、存档、RNG 等） |
| `npm run build` | 类型检查 + 生产构建，输出到 `dist/` |
| `npm run preview` | 本地预览生产构建 |
| `npm run test:e2e` | Playwright 浏览器端到端测试（Chromium） |
| `npm run electron` | 以桌面窗口运行（需先 `build`） |
| `npm run dist:win` | 打包 Windows 可执行版 |

## 操作

- **A / D** 或 **← / →**：左右移动
- **E**：交互（开容器、对话、上下楼、在宿舍床边睡觉）
- **I**：背包（← → 选择，Enter 使用消耗品）
- **C**：制作台（在宿舍工作台旁）
- **ESC**：暂停菜单（继续 / 重新开始 / 返回标题）

生存的关键节奏：口渴掉得比饥饿快（每小时 3 点 vs 2 点），睡一觉也会消耗（按静息代谢减半计）。所以**天黑前回家**不只是躲巡游体，也是在省第二天的水。

## 存档与种子

- 存档保存在浏览器 LocalStorage（key：`floor100000.save.v1`），睡觉、切楼、制作/交易后自动保存；坏档会提示并可开始新游戏。
- 复现测试：在网址后加 `?seed=42` 可用固定种子开跑（QA 固定种子：1 / 42 / 2026）。
- 开发夹具：`?devfloor=` 直达指定楼层，`?devwin=1` 打开已废弃的旧胜利条件。两者都只在开发模式生效。

## 目录结构

```
src/
  main.ts            入口（含开发模式下的 E2E 状态钩子）
  scenes/            Boot / Menu / MetaSelect / Game / TowerOverview / End
  core/              GameState、类型、常量、seeded RNG、塔楼模型、存档序列化
  systems/           23 个纯逻辑模块（生存、战斗、遭遇、交易、flag…）
  render/            像素美术生成、行走循环、光照、音效合成、UI 组件
  data/              物品表、配方、楼层模板、NPC、对话
  tests/             单元测试（含多日生存可行性模拟）
config/              平衡参数（game-balance.json）
art-src/rigs/        角色与道具的代码骨架（SVG）+ 动画关键帧（JSON）
tools/               美术流水线：骨架装配、切片、素材报表
e2e/                 Playwright 浏览器测试与截图
素材库/              美术设定集 + 收集素材库（见该目录 README）
docs/                设计、路线图、任务、验收与各阶段报告
```

## 文档索引

入口是这三份，顺序不能反：

| 文档 | 作用 |
| --- | --- |
| [`docs/GAME_DESIGN_LOCK.md`](docs/GAME_DESIGN_LOCK.md) | **核心玩法设计冻结，最高权威**。与其它文档冲突时以它为准 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 里程碑、阶段拆解、验收标准 |
| [`docs/03_TASKS.md`](docs/03_TASKS.md) | 任务编号与完成状态 |

其他常看的：

| 文档 | 内容 |
| --- | --- |
| [`docs/01_GDD.md`](docs/01_GDD.md) | 早期设计基线（部分已被冻结文档取代，保留作历史） |
| [`docs/02_TECH_SPEC.md`](docs/02_TECH_SPEC.md) | 技术规格 |
| [`docs/M1_PLAYTEST.md`](docs/M1_PLAYTEST.md) | 自动试玩实测：时间预算、背包压力、空闲窗口 |
| [`docs/OVERNIGHT_FINAL.md`](docs/OVERNIGHT_FINAL.md) | 一个通宵把战斗/遗物/经济补齐的作战与结果 |
| [`CLAUDE.md`](CLAUDE.md) | 开发 Agent 的长期约束（流程、质量门槛、范围边界） |

## 素材与授权

- **美术设定集**：[`素材库/`](素材库/README.md) —— 已做进游戏的美术、待做方向的参考、素材从哪来、以及现在的缺口清单。**它不是运行目录**，游戏读的是 `public/assets/`。
- **授权台账**：[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。目前含两笔：Kenney 的 CC0 选择箭头（`public/assets/ui/marker.png`），以及项目负责人提供的美术包（`public/assets/artpack/`，物品图标 / 角色立绘 / 家具 / 横幅）。
- 其余美术为**程序化生成或代码绘制**；音效全部由 Web Audio 在运行时合成，**构建产物里没有任何音频文件**。
- 角色骨架、动画与装配工具均为本项目代码生成（code-drawn，无图像模型参与）。渲染器与素材报表工具来自 `agent-sprite-forge`，其源码按各自许可单独存放，**不进入本仓库**。

## 部署

`npm run build` 生成纯静态站点（`dist/`），可部署到任意静态托管。**公开部署需项目负责人另行许可**，不得默认推送到线上服务。

## 桌面版（Electron）

打包成 Windows 可执行版本：

```bash
npm run build       # 先构建 dist/
npm run dist:win    # 输出 release/Floor100000-win32-x64/Floor100000.exe
```

以桌面窗口直接运行（需先 `npm run build`）：`npm run electron`。打包使用本机已缓存的 Electron，无需联网下载。
