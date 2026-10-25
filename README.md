# 第100000层：末日宿舍

> 2D 横版像素生存游戏。在一栋看不见底的十万层末日宿舍塔里，你从第 100000 层的一张床醒来，靠探索楼层、与邻居交易、搜集与制作资源，熬过 7 天。

技术栈：**Phaser 4.2.1** + **TypeScript（strict）** + **Vite**；单测 **Vitest**，浏览器 E2E **Playwright**。核心规则是可测试的纯 TypeScript，Phaser 只负责渲染与输入。

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
- **E**：交互（开箱、对话、上下楼、在宿舍床边睡觉）
- **I**：背包（↑/↓ 选择，Enter 使用消耗品）
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
  data/              物品表、配方、楼层模板、NPC、对话
  tests/             单元测试（含 7 天生存可行性模拟）
config/              平衡参数（game-balance.json）
e2e/                 Playwright 浏览器测试与截图
```

## 部署

`npm run build` 生成纯静态站点（`dist/`），可部署到任意静态托管。**公开部署需项目负责人另行许可**，不得默认推送到线上服务。

## 素材与法务

首版使用程序化生成的像素占位美术与自制提示音，全部原创；未使用任何第三方视频/图片/音乐素材。
