# 第100000层：末日宿舍

> 2D 横版像素生存游戏。在一栋看不见底的十万层末日宿舍塔里，你从第 100000 层的一张床醒来，靠探索楼层、与邻居交易、搜集与制作资源，熬过 7 天。

技术栈：**Phaser 4.2.1** + **TypeScript（strict）** + **Vite**；单测 **Vitest**，浏览器 E2E **Playwright**。核心规则是可测试的纯 TypeScript，Phaser 只负责渲染与输入。

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

## 操作

- **A / D** 或 **← / →**：左右移动
- **E**：交互（开容器、对话、上下楼、在宿舍床边睡觉）
- **I**：背包（← → 选择，Enter 使用消耗品）
- **C**：制作台（在宿舍工作台旁）
- **ESC**：暂停菜单（继续 / 重新开始 / 返回标题）

目标：从第 1 天 06:00 活到第 8 天 06:00。口渴/饥饿/精力随时间下降，喝水、吃食物、睡觉维持生存；生命归零则失败。

## 存档与种子

- 存档保存在浏览器 LocalStorage（key：`floor100000.save.v1`），睡觉、切楼、制作/交易后自动保存；坏档会提示并可开始新游戏。
- 复现测试：在网址后加 `?seed=42` 可用固定种子开跑（QA 固定种子：1 / 42 / 2026）。

## 目录结构

```
src/
  main.ts            入口
  scenes/            Boot / Menu / Game / End 场景
  core/              GameState、类型、常量、seeded RNG、存档序列化
  systems/           Clock/Survival/Inventory/Crafting/Trade/Loot/Floor/Event/Save
  render/            像素美术生成、行走循环、光照、pixelfx 特效
  data/              物品表、配方、楼层模板、NPC、对话
  tests/             单元测试（含 7 天生存可行性模拟）
config/              平衡参数（game-balance.json）
art-src/rigs/        角色与道具的代码骨架（SVG）+ 动画（JSON）
tools/               美术流水线：骨架装配、素材报表
e2e/                 Playwright 浏览器测试与截图
```

## 部署

`npm run build` 生成纯静态站点（`dist/`），可部署到任意静态托管。**公开部署需项目负责人另行许可**，不得默认推送到线上服务。

## 桌面版（Electron）

打包成 Windows 可执行版本：

```bash
npm run build       # 先构建 dist/
npm run dist:win    # 输出 release/Floor100000-win32-x64/Floor100000.exe
```

以桌面窗口直接运行（需先 `npm run build`）：`npm run electron`。打包使用本机已缓存的 Electron，无需联网下载。

## 素材与法务

首版使用程序化生成的像素占位美术与自制提示音，全部原创；未使用任何第三方视频/图片/音乐素材。

角色与道具的骨架、动画、装配工具均为本项目代码生成（code-drawn，无图像模型参与）；渲染器与素材报表工具来自 `agent-sprite-forge`，其源码按各自许可单独存放，**不进入本仓库**。
