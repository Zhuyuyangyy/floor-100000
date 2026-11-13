# TECH SPEC — 工程架构与关键约束

## 1. 技术栈

- Phaser：2D 渲染、场景、键盘输入、相机、碰撞范围。
- TypeScript（strict）：核心状态和行为系统。
- Vite：本地开发/生产构建；使用 Phaser 官方原生 Vite + TypeScript 模板，不引入 React/Vue，除非有明确必要。
- Vitest：逻辑测试。Playwright：浏览器可玩性 Smoke/E2E。GitHub Actions：PR CI（环境允许时）。
- 存档：LocalStorage（首版数据很小）；未来数据增长后评估 IndexedDB。
- 不使用服务器、实时后端、数据库、外部 AI/模型 API。

  > 边界（2026-11-11 ADR-001）：唯一例外是**本项目自有的 DGX Spark 局域网推理**（Ollama HTTP，无云服务、无账号、无付费、无联机依赖），且仅在 `feat/ai-npc-spark-integration` 分支内生效。推理不可达时游戏必须完全可玩。云 API 依旧禁止。

依赖版本以项目建立时兼容、稳定、可安装的版本为准，生成并提交 lockfile。禁止随意使用尚未稳定的主版本。Phaser 官方模板参考：`npm create @phaserjs/game@latest`（交互选择 Web Bundler + Vite + TypeScript）。

## 2. 建议文件结构（可微调，不改职责）

```
src/
  main.ts
  scenes/BootScene.ts, MenuScene.ts, GameScene.ts, UIScene.ts, EndScene.ts
  core/gameState.ts, gameTypes.ts, constants.ts, rng.ts
  systems/ClockSystem.ts, SurvivalSystem.ts, InventorySystem.ts
  systems/FloorSystem.ts, LootSystem.ts, InteractionSystem.ts
  systems/CraftingSystem.ts, NPCSystem.ts, EventSystem.ts, SaveSystem.ts
  data/items.ts, recipes.ts, floorTemplates.ts, dialogue.ts
  render/PixelPlaceholderFactory.ts
  input/keyboard.ts
  tests/
public/assets/        # 仅放拥有使用权或原创素材
e2e/                  # Playwright browser smoke
config/game-balance.json
```

## 3. 逻辑与渲染隔离

- `GameState` 为单一真相来源；所有背包交易、资源消耗、HP 变化、睡眠、日期推进都使用显式逻辑函数。
- Phaser 的 update 只能推进时间并同步画面；游戏核心规则不能依赖直接操作 Phaser Sprite 才能生效。
- 操作设计为明确指令，如 `movePlayer`, `interact`, `useItem`, `craftItem`, `trade`, `sleep`；失败应有明确原因，不能无声吞掉。
- 不得让帧率影响饥饿、事件触发或存档结果；时间推进使用 delta，并设置单帧最大时间跨度防止切后台后数值突然归零。
- 使用统一 seeded PRNG（xorshift32 或等价确定性算法），世界生成 key 包含 `worldSeed + floorNumber + containerId`。禁止不可复现的 Math.random。

## 4. 世界数据结构

```
GameState:
  schemaVersion: number
  runSeed: number
  day: number
  gameMinuteOfDay: number
  currentFloor: number
  player: {x, hp, hunger, thirst, energy, inventory, equipped, homeUpgrades}
  npcStates: map<npcId, state>
  visitedFloors: map<floorId, {openedContainers, lootedItems, unlockedDoors, localEvents}>
  worldEvents: {history, activeEvent}
  status: 'playing' | 'won' | 'lost'
```

- 只加载当前楼层和邻近资源，不要生成全部十万层。按楼层号可复现地生成基础布局，再覆盖 `visitedFloors` 中玩家造成的变化。
- 首版 5 层可使用固定模板；场景拼接必须显式分离渲染对象和持久状态。
- 若系统时钟/刷新导致场景中断，重新加载存档必须恢复玩家、背包、任务状态、已开箱子和楼层。

## 5. UI 与渲染

- 16:9，内部逻辑分辨率 640x360，像素整数缩放到合适的浏览器大小；pixelArt/nearest-neighbor，禁止模糊抗锯齿导致画面失焦。
- 角色单张占位尺寸约 16x24 像素，房间 tile 16x16；人物在宿舍地面左右移动，不做重力跳台。
- HUD 显示 HP、饥饿、口渴、精力、日期、楼层、当前互动提示；一屏内可辨认。
- 菜单：开始/继续、新游戏、暂停、背包、交易/对话、制作、结局。
- 必须支持无外部资源情况下本地离线加载，所有可见 UI 使用明确中文短文本。

## 6. 存档协议

- key: `floor100000.save.v1`，结构有 schemaVersion，保存时严格验证数值范围和字段。
- 触发点：睡觉过天、换楼层、关键建造/交易后；可加手动保存。
- 遇到坏档：显示“存档损坏，无法继续”，保留新游戏入口，不得直接白屏或无限加载。
- 新游戏一律从第 100000 层与指定固定初始物品开始。重开产生新种子，也支持 `?seed=42` 用于 QA 复现。

## 7. 事件与经济

- 资源、配方、NPC 交易应数据驱动；所有掉落配置含概率/保底，关键推进物资不能纯随机。
- 交易必须是原子操作：检查资源 -> 双方背包增减 -> 记录结果，失败时不能半扣除。
- 每个随机事件有明确前置条件与回退条件；关键门不可被随机事件永久锁死。
- 暂无实时 LLM NPC、外部内容加载和网络环境依赖。

## 8. 自动化与质量

要求 package scripts：

```
npm run dev
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

浏览器 E2E 至少验证：打开能渲染、键盘控制人物、E 交互、切楼层、物品入背包、关闭/重开能读取存档、HP=0 进入失败画面、达到 Day 8 进入胜利画面。测试可使用开发专用入口构造状态，但生产构建不能暴露可任意作弊的 Debug 面板。

- 修改 UI 的 PR：附 Playwright 截图或帧截图；测试不应只检查 DOM 按钮，还要实际验证 canvas 首屏像素非空/游戏状态变化。
- CI：typecheck + Vitest + build + Playwright smoke。运行环境若不能启动浏览器，应明确标为未测试，不得以构建成功替代视觉验收。
- 单次场景帧率目标：常见笔记本 60 FPS 作为优化目标，不作为阻塞首版可玩性的绝对门槛。

## 9. 部署

P0 只要求本地可运行；后续经人工允许可发布到 GitHub Pages / Cloudflare Pages 等静态托管。部署前确认 Vite base path、缓存与存档行为，且不要自动覆盖已有线上站点。
