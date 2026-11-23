# B3-UI-01：角色选择鼠标移动不应意外改选

- 里程碑：B3 首个完整生存章节（M1）
- 目标：首次玩家从角色列表移向“开始生存”时，保持已点击选择，不因经过其他行而改变角色。

## 问题与复现

最近的鼠标支持改动在角色行 `pointerover` 时直接更新选择。玩家点中默认“幸存者”后，将鼠标正常移向下方“开始生存”按钮，路径会经过其他角色行；如果最后选中锁定角色，点击按钮只显示“还未相遇”，不能进入游戏。此前的用例将鼠标直接定位到按钮中心，没有覆盖连续移动。

复现测试：`e2e/menuMouse.spec.ts` 中“moving from the selected survivor to start does not select locked rows on the way”。修复前以真实 Playwright 鼠标移动执行时无法进入 `Game` 场景，失败截图与 trace 留在本地 `test-results/`。

## 修复

移除角色行的 hover 改选，仅在点击行时选择角色；键盘上下移动、点击开始、锁定角色保护和解锁规则保持不变。未修改任何生存、战斗、计分、难度或存档规则，也未新增美术。

## 验收记录

- `npm run typecheck`：通过。
- `VITE_NPC_MODEL= npm test`：58 个测试文件、756 项通过。
- `npm run build`：通过；仍有既有的大型 JavaScript chunk 警告。
- `npx playwright test e2e/menuMouse.spec.ts --workers=1`：4/4 通过，包含新增连续鼠标移动回归。
- 菜单、遭遇、面板、商店、宿舍相关 Playwright 串行回归：14/14 通过（单 worker，2.7 分钟）。
- 新增平滑鼠标移动回归单独重跑：1/1 通过；该用例在鼠标停在“开始生存”按钮时保存了截图：[`output/b3-ui-01-mouse-selection.png`](../output/b3-ui-01-mouse-selection.png)（该目录已被 Git 忽略）。
- `git diff --check`：通过。

## PR 状态

[Draft PR #21](https://github.com/Zhuyuyangyy/floor-100000/pull/21) 保持 OPEN / Draft，head 为 `fix/wanderer-floor5-gate-20261120`，base 为 `feat/tower-zoom-b2`。本轮修复已以提交 `71ce743` 追加到该分支；未合并，也未强推。

## 范围外发现

此前仍能复现的楼梯端点镜头裁切（第 1 层上楼、第 5 层下楼时角色被裁）已由 2026-11-22 的 B3-19 后续修复关闭。本轮角色选择修复与该相机改动保持分开；修复代码、真实键盘路线和 HUD 安全区断言见 [`B3-19_NATURAL_STAIRS.md`](B3-19_NATURAL_STAIRS.md)。
