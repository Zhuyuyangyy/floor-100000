# AG-08｜UI-UX / 菜单、导航和界面工程师

**分支：** `agent/2026-11-15/ag-08-ui-ux`  
**基线：** `adaec3b27cb16eebd5106d0971a54c79c0af0b1e`  
**优先级：** P1 / 独立 UI 场景

## 使命

改善菜单、角色选择、塔楼总览和结局界面的信息层级与高级感，同时保留项目的 2D 像素工业废土风和键盘操作。

## 任务

1. 先截取并审计当前 Menu、MetaSelect、TowerOverview、End 四个场景，列出可读性、对齐、留白、焦点、信息优先级问题。
2. 以 Ark Pixel 字体、现有深蓝灰/旧金属/暖橙/青绿体系为基准；避免换成通用网页 UI。
3. 选择最有收益的 1–2 个场景完成视觉收口，不做无目标的全量重写。
4. 统一标题、分区、按钮、选中态、禁用态、提示文字和面板边距。
5. 保证纯键盘导航、焦点状态清楚、长文本不遮挡、不越界。
6. 只改善展示和交互，不改变导航、存档、游戏状态和胜负规则。

## 文件白名单

- `src/scenes/MenuScene.ts`
- `src/scenes/MetaSelectScene.ts`
- `src/scenes/TowerOverviewScene.ts`
- `src/scenes/EndScene.ts`
- `src/render/uiKit.ts`
- `src/render/panels.ts`
- `src/render/hudLayout.ts`
- `src/render/itemIcons.ts`
- 对应 UI 单测

禁止修改 `GameScene.ts`；不要改环境渲染 helper。

## 验收

- 提供四个场景改前/改后截图，至少 1280×720 和项目实际设计分辨率。
- 键盘导航逐项实测。
- 无文字重叠、越界、裁切和控制台异常。
- 相关测试、typecheck、build 通过。
- 不改玩法规则。