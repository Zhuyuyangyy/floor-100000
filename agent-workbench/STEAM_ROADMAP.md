# 上架 Steam 路线图（2026-11-17，第十轮质量周）

状态基线：`8e2d56d`（99 测试文件 / 1811 全绿，Spark NPC 在线）。
本文档分三块：本轮代码质量（进行中）、Steam 技术打包（下一轮）、商务流程（用户侧）。

## 一、本轮代码质量（5 Agent 并行中）

| 项 | 状态 | 说明 |
|---|---|---|
| 战斗表现重做（AG-70） | 进行中 | 中央文本框→双方站位+动作链+飘字 |
| 设置面板（AG-72） | 进行中 | SFX/BGM 音量/震屏/文本速度/语言框架 |
| 新手指引（AG-73） | 进行中 | 前 5 层六步引导，可跳过 |
| BGM 音乐层（AG-74） | 进行中 | WebAudio 程序化芯片音三套+收音机 |
| 门面打磨（AG-75） | 进行中 | 主菜单视觉/白屏防护/坏存档兜底/数值 sanity |

## 二、Steam 技术打包（下轮，代码侧可完成）

技术栈现状：Phaser 3 + Vite 网页游戏。最短上架路径：

1. **Electron 壳**（保留全部游戏代码）
   - 窗口管理（1280×720 基准，可 resize，记住窗口状态）
   - 离线运行（所有资源本地，无 CDN 依赖——已验证：Spark 走隧道是开发态，发布版 NPC 用降级脑或本地模型）
   - 存档位置迁移：localStorage → Electron userData 目录（Steam 云存档同步用）
   - 开发/生产模式切换（devfloor 等 dev 工具发布版禁用）
2. **Steamworks SDK 接入**（steamworks.js 或 greenworks）
   - 成就（爬塔里程碑：10/110/1010/10010/50010/100000 层；搜刮 N 次；制作全武器；守夜成功 N 次）
   - 云存档（Steam Cloud）
   - 富存在（Rich Presence：「第 N 层 · 宿舍区」）
   - Steam  overlay 兼容（网页游戏在 Electron 里默认兼容）
3. **打包分发**
   - electron-builder → win/mac（Linux 可选）
   - App ID（用户 Steamworks 账号创建，$100 押金/游戏——商务流程）
   - 商店页资源：Capsule 图（横向 460×215 + 纵向 372×654 + 主 616×353）、截图、预告片、描述——美术+商务

## 三、商务/合规流程（用户侧，代码无法代劳）

- Steamworks 账号 + Direct Fee $100（Steam 收，每游戏）
- 商店页：名称/描述/标签（生存、塔楼、像素、末日）/定价（建议区间 $4.99-9.99 同类 indie）/年龄分级问卷
- 审核：Steam 审核 1-5 工作日，build 过审后设上架日期
- 版号（如需国内同步发行）：国内独立游戏版号流程（可选，先上海外）

## 四、明确不做（本轮范围外）

- 多语言翻译（语言框架 AG-72 做，翻译是后续轮）
- Steam 创意工坊/排行榜/交易卡（复杂，二创价值低）
- 手游移植（触屏适配是独立工程）

## 五、质量门禁（每轮合并前必过）

1. `npx tsc --noEmit` 干净
2. `VITE_NPC_MODEL= npx vitest run` 全量绿（基线 1811，每轮只增不减）
3. Playwright 冒烟：stairNavigation / firstChapter / survival / crafting / gameplay
4. `node tools/assets-manifest.mjs` RESULT: clean
5. 磁盘 ≥10G 可用（Agent 并行环境教训）
