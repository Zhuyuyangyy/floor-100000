# B3-UI-08：Gimble 暗金属视觉收口

日期：2026-11-23。基线分支：`fix/wanderer-floor5-gate-20261120`。本轮沿用已认可的 Gimble 暗金属方向，打磨现有浏览器界面；没有新增图片素材，也没有改变 Phaser 架构。

## 改动

HUD 的楼层/时钟、四项生存状态、金币/分数现在各有明确仪表区；状态条仍显示原有数值，最紧急状态会同时强调标签和数字。主线目标、每日目标与环境信息继续分行，消息、满包警告与操作提示保持各自职责。

竖屏下楼层和时间并排、四条状态分成两列，金币和分数放进窄面板。闲置时不显示桌面键盘说明；靠近交互点时，提示出现在触控按钮上方。满包警告会优先显示，避免与底部情境提示重叠。

标题菜单的当前选项增加克制的金属底板、强调边和文字高亮；角色选择页为当前行增加细描边。鼠标悬停仍不会擅自改变角色选择。弹窗标题条则略增高度与强调边宽度，字号回归正文层级。

所有改动仅涉及显示组件、场景界面和回归截图。没有改动难度、伤害、评分、物品经济、存档规则、楼层机制或触控行为，也没有生成或加入新的美术图。

## 验收

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | 58 个测试文件、762 项测试通过 |
| `npm run build` | 通过；保留原有单个 JS chunk 大于 500 kB 的 Vite 提示 |
| `npx playwright test e2e/hudLayout.spec.ts e2e/portraitTouch.spec.ts --workers=1` | 9/9 通过：四种桌面窗口、HUD 边界、360×800/320×800 竖屏、触控移动与交互、桌面键盘和旋转后重新载入 |
| `npx playwright test e2e/menuMouse.spec.ts --grep "title menu mouse hover|first-time player can finish character selection" --workers=1` | 2/2 通过；角色选择截图位置调整后，该测试另行复跑 1/1 通过 |

## 截图

回归生成的画面保存在本地 `output` 目录：桌面 HUD 为 `output/playwright/hud/1280x720-day.png`，手机竖屏 HUD 为 `output/playwright/hud/360x800-day.png`；菜单与角色选择焦点态分别为 `output/playwright/ui/title-focus.png` 和 `output/playwright/ui/character-focus.png`。`output/playwright/hud/1280x720-critical.png` 展示低生命、长消息和满包排版夹具，数值仅用于视觉验收，不代表真实游玩记录。

本轮只更新既有 Draft PR #21，保持 Open/Draft，不合并，也不重新发布 ModelScope Space。
