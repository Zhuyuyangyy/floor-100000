# AG-09｜RENDER / 场景渲染与性能工程师

**分支：** `agent/2026-11-15/ag-09-render`  
**基线：** `adaec3b27cb16eebd5106d0971a54c79c0af0b1e`  
**优先级：** P1 / 性能与表现

## 使命

针对邻层陈设接入后帧率从软件渲染基线约 60fps 降至约 47–51fps 的历史记录，先剖析，再做安全优化；不能为了帧率牺牲场景内容。

## 任务

1. 复现当前场景性能，固定浏览器、分辨率、缩放、楼层、渲染环境和采样时长。
2. 分析 corridors、roomDepth、furniture、lighting、fx 等渲染 helper 的对象数量、重复创建、纹理生成、粒子和更新成本。
3. 找到至少一个可复现的热点，提出最小优化方案。
4. 实施一个低风险优化，例如缓存纯静态纹理/几何、减少重复对象创建或避免不可见特效更新；必须保持视觉一致。
5. 补充相关单测或性能基准；记录优化前后数据。
6. 不改 GameScene 的场景流程，不导入新素材，不改 UI。

## 文件白名单

- `src/render/corridors.ts`
- `src/render/furniture.ts`
- `src/render/lighting.ts`
- `src/render/roomDepth.ts`
- `src/render/pixelArt.ts`
- `src/render/fx.ts`
- `src/render/walkcycle.ts`
- `src/render/feedback.ts`
- `src/render/audio.ts`
- `src/render/weapon.ts`
- 对应 render 单测

禁止修改 `GameScene.ts` 和 `public/assets/**`。

## 验收

- 提供固定条件下优化前/后 FPS、帧时间、对象数或可测指标。
- 第 1、2、4、5 层截图对比无明显画面退化。
- 动画时序、像素硬边、深度关系保持正确。
- typecheck、相关测试、build 通过。