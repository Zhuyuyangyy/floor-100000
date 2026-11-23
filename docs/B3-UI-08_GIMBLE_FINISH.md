# B3-UI-08：Gimble 暗金属视觉收口

日期：2026-11-23。基线提交：`15bc0cb`；分支：`fix/wanderer-floor5-gate-20261120`。本轮优先以 360×800 与 320×800 手机竖屏评估，桌面保留为兼容布局；继续使用现有 Phaser 与资源，没有新增美术或改变核心玩法。

## 最终视觉选择

手机 HUD 减少了额外仪表底板与目标/环境信息旁的强调竖条，让背景继续可见；状态数值、状态条、标题与必要警示仍然保留。桌面仪表与兼容布局未受影响。弹窗标题条收至 20px、强调边减至 2px，标题仍保持清晰层级。

手机标题菜单不再用整块选项底板和侧边饰条，改以文字颜色和箭头识别焦点；手机角色选择也不铺整行选中底板。桌面焦点底板和角色选中带保留，鼠标悬停不会擅自改变角色选择。

窄屏操作反馈和满包警告扣除了文字内边距后再换行，并启用适合无空格中文的逐字换行。两条提示同时出现时会在底部触控按钮上方纵向避让；文案与提示状态不变。竖屏长提示回归测试覆盖了横向边界、相互遮挡和触控区安全距离。

所有改动仅涉及界面呈现和测试。没有改变题材、背景、核心循环、AI/NPC、数值规则、伤害、评分、物品经济、存档、楼层机制或触控行为。

## 验收

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | 58 个测试文件、762 项测试通过 |
| `npm run build` | 通过；Vite 仍提示单个 JS chunk 大于 500 kB |
| `npx playwright test e2e/hudLayout.spec.ts e2e/portraitTouch.spec.ts --workers=1` | 10/10 通过：桌面 HUD、360×800/320×800 竖屏、触控移动与交互、键盘/桌面兼容、旋转重载及长提示边界 |
| `npx playwright test e2e/menuMouse.spec.ts --grep 'title menu mouse hover|first-time player can finish character selection' --workers=1` | 2/2 通过 |
| `git diff --check` | 通过（推送前再次核验） |

## 截图

竖屏常态与背包界面：`output/portrait-ui-compare/after-mobile-lighten-360x800.png`、`after-mobile-lighten-320x800.png`、`after-mobile-lighten-inventory-360x800.png`。菜单与选人界面：`after-mobile-lighten-menu-360x800.png`、`after-mobile-lighten-select-360x800.png`。

长提示边界夹具：`after-mobile-lighten-critical-360x800.png`、`after-mobile-lighten-critical-320x800.png`。这两张是在暂停的真实游戏场景中注入一条刻意加长的测试反馈，并显示满包警告，用于验证最窄画面排版；并非真实游玩记录，也不改变存档或游戏规则。

本轮只更新既有 PR #21，保持 Open/Draft，不合并，也不重新部署 ModelScope Space。
