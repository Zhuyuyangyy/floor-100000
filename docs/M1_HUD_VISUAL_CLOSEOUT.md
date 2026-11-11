# M1 HUD 视觉收口（HUD-01）

日期：2026-11-11。基线：`b96e95e`；本地隔离分支：`codex/ui-visual-redesign`。

## 范围与现状

旧云端 `feat/ui-visual-redesign` 的未提交改动无法访问。本轮按负责人“继续本地开发”的指示，在新工作树接续 HUD 收口；没有声称恢复了旧 diff。

原 HUD 楼层号底色窄于文字，四条生存槽没有数值，目标与环境共用一行，短消息与满包警告间距只有 20px。本轮只调整现有 HUD 的显示、缓存和回归定位，不修改楼梯、物品、生存、战斗、交易或存档协议。

## 布局与反馈

- 顶部 64px：楼层 / 日期时钟、生存四条槽、金币 / 分数分组；显示明确中文标签及真实状态数值。
- 64–124px：今日目标与环境各占一行。`体温值` 是原有 0–100 指标，不误标成摄氏度。
- 临时反馈在 y=556 的独立消息区；满包常驻提示从 y=624 开始；底部 40px 保留交互、背包、制作、地图、菜单提示。
- 所有 HUD 保持屏幕坐标，不跟随相机；首层 idle / 行走角色的完整屏幕 bounds 必须处于 HUD 之下。
- 目标、环境可以按实际渲染宽度省略超长尾部；楼层、金币与分数不截断数字。正常字号 20px，极长金额必要时降至 18px。
- 时钟继续使用 `formatClock` 的向下取整：360.99 分钟显示 06:00，不提前显示 06:01；本轮不改真实时间。
- 重建 HUD 时重置目标缓存并销毁旧环境文本；在刷新状态条的缓存提前返回前更新目标 / 金币，面板交易也能即时反映真实金额。

## 实际验证与证据

专项命令：

```text
npm run typecheck
npx vitest run src/tests/hudLayout.test.ts
npx playwright test e2e/hudFeedback.spec.ts e2e/hudLayout.spec.ts e2e/crafting.spec.ts --config playwright.hud.config.ts --workers=1
```

专项浏览器使用独立端口 5175、strictPort、不复用已有服务器，避免测到另一个工作树。反馈测试按 `hud-feedback` 对象的实际 bounds 截取像素差分，仍验证面板打开时消息真的画在 Canvas 上；制作反馈按同一命名对象读取，不再依赖旧 y=86。

四种窗口：1280×720、1280×800、1366×768、1920×1080。每种截图包括新档白天、长消息 / 满包 / 低生命视觉 fixture，以及夜间。测试附件记录 Canvas CSS bounds 和 HUD 渲染 bounds，验证文字不越界、上下消息不重叠、完整角色不被 HUD 盖住。Scale.FIT 的窗口留边属于正常显示。

本地截图目录：`output/playwright/hud/`，文件格式为 `<宽>x<高>-day.png`、`-critical.png`、`-night.png`。视觉 fixture 只用于测试排版，不能当成真实生存旅程或真人试玩的证据。

生产构建 smoke：父 agent 使用独立 preview 端口 5176 完成真实键盘启动、进入游戏、打开背包并使用净水；`pageerror=[]`，生产构建没有暴露 `__PHASER_GAME__` / `__PHASER_SESSION__` 调试句柄。截图为 `output/playwright/hud/production-day-1280x720.png` 与 `output/playwright/hud/production-feedback-1280x720.png`。

完整 Playwright 回归已执行：`49 passed / 23 failed`，总耗时约 9 分钟。失败集中在既有长流程 `e2e/survivalJourney.spec.ts` 的 `page.evaluate: no session`，随后开发服务器退出，后续 22 项统一报 `net::ERR_CONNECTION_REFUSED`；没有证据表明这些失败由 HUD 改动引入。HUD 专项仍为 `11/11 passed`，并已用独立端口 5175 重跑。

测试期间曾发现并修正：主栏 150px 的初版遮住角色头部，已收紧到 124px 并增加 screen-bounds 断言；独立金币 / 地图往返测试的连按可能受单帧去重影响，已改为显式按键时长并等待面板关闭。

最终工程验证：`npm run typecheck` 通过；`npm test -- --run` 为 48 个文件 / 653 个测试通过；`npm run build` 通过（保留既有单 bundle 大于 500 kB 的 Vite 警告）。生产 preview smoke 通过，`pageerror=[]` 且没有暴露调试句柄。完整回归的 23 项失败按上面的服务器退出链记录，不能记成全量通过。

## 遗留边界

`M1_INTEGRATION_REVIEW.md` 中的楼梯端点裁切、E/F 并发、近路报价、既有 CI / 输入等待失败仍是独立问题。本轮没有将它们标为关闭，没有把 M1 标为真人试玩通过，没有推送、合并或发布。

下一步仅验收本屏 HUD；背包、商店、战斗等其它 UI 仍使用现有布局。
