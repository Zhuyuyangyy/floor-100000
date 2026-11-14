# AG-07｜ASSETS / 美术资产管线工程师

**分支：** `agent/2026-11-15/ag-07-assets`  
**基线：** `adaec3b27cb16eebd5106d0971a54c79c0af0b1e`  
**优先级：** P1 / 首章美术接入准备

## 使命

把现有首章美术库变成机器可读、可验证的资产清单，找出哪些已经进入运行时、哪些仍是候选素材、哪些缺少导入说明。

## 任务

1. 审计 `素材库/收集素材库/首章待用美术设定集/`，覆盖角色、五层场景、物件家具、动画、UI、特效。
2. 编写无需新增依赖的 Node 资产审计脚本，读取 PNG/GIF/JSON 的基本元信息。
3. 输出机器清单：相对路径、类型、文件尺寸、图片宽高、透明通道、GIF 帧数（可可靠解析时）、所属角色/楼层、当前状态、对应运行时资源（若已知）。
4. 校验五层固定背景是否为 2880×200、九块 320×200；动画帧尺寸/帧数是否与 README 一致。
5. 对比 `public/assets/**` 和现有 artpack loader，列出“已接入 / 候选未接入 / 缺失 / 来源或授权待确认”。
6. 不复制、不移动、不覆盖、不删除原始美术文件；来源不明只标记为参考。

## 文件白名单

- 新增 `tools/first-chapter-asset-audit.mjs`
- 新增 `docs/assets/FIRST_CHAPTER_ASSET_AUDIT.md`
- 新增 `docs/assets/first-chapter-asset-manifest.json`

只读素材库、`public/assets/**`、`src/render/artpack.ts`、`tools/build-artpack.mjs`。

## 验收

- 脚本可从仓库根目录运行，输出稳定排序结果。
- 文件数和异常文件数可核对；失败文件不得静默跳过。
- 报告列出每层资产数量、角色动画覆盖、UI/特效覆盖和运行时接入差距。
- 不修改任何 PNG/GIF，不修改运行时 loader。