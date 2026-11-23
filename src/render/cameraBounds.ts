// 世界相机横向 bounds 的取法，一处定义。
//
// 2026-11-23 界面巡检：缩到 50% 时世界只占屏幕左边一条，右边一大片纯色。
//
// 机制（读 Phaser BaseCamera.clampX + Camera.preRender 得出，非猜测）：
//   displayWidth dw = 画布宽 / zoom          —— 视口的**世界**宽
//   clampX 把 scrollX 钉在 bounds.x + (dw - 画布宽)/2（bounds 比视口窄时）
//   worldView.x = scrollX - (dw - 画布宽)/2 = bounds.x
// 也就是说：**bounds 比视口窄时，Phaser 把 bounds 左沿对齐到视口左沿**，
// 多出来的视口宽度全部落在 bounds 右侧。
//
// 实测 F2：楼层宽 1600、bounds.x=0、zoom 0.5 → dw=2560，worldView=[0,2560]。
// 楼层 [0,1600] 只占屏幕左 62.5%，右边 960 世界像素（屏幕右 480px）是空的。
// 楼层越窄越明显：1 层 1280 宽时右半屏全空。
//
// 修法：bounds 至少和视口一样宽，并把楼层摆在正中 —— 起点取负值。
// 这样 worldView.x = (floorW - dw)/2，楼层在屏幕上左右留白相等。
// 不是关掉 bounds（那会让虚空随便滚进来，破 AG-52 契约），并集之后可滚动
// 区间恰好为 0：视口被楼层框住、居中，没有多余的滚动自由度。
//
// **zoom ≥ 1 时 dw ≤ 画布宽 ≤ 楼层宽，并集就是楼层本身，返回值与旧写法逐位
// 相同** —— 存量行为（含全部 e2e 基线）一个像素都不动，只有主动缩小才生效。
//
// 纵向不在这里处理：站立位的 standScrollY 已由 PLAYER_FEET_Y - viewH/2 反推，
// 各 zoom 下都把脚线摆在视口正确高度（家区 45%、其余 50%），本来就是对的。
// 给纵轴也套并集反而会把已经算好的站立位再平移一次。

/** 一个轴上的相机 bounds。 */
export interface BoundsAxis {
  /** bounds 起点（世界像素，可为负）。 */
  start: number;
  /** bounds 长度（世界像素）。 */
  size: number;
}

/**
 * 把「内容区间 [contentStart, contentStart+contentSize]」扩成不窄于视口的
 * bounds，内容居中。viewSize 是该轴的视口世界尺寸（画布尺寸 / zoom）。
 *
 * 内容不小于视口时原样返回 —— 调用方据此保持既有滚动行为。
 */
export function fitBoundsAxis(contentStart: number, contentSize: number, viewSize: number): BoundsAxis {
  if (contentSize >= viewSize) return { start: contentStart, size: contentSize };
  return { start: contentStart + (contentSize - viewSize) / 2, size: viewSize };
}

/**
 * 横轴：楼层永远从世界 x=0 开始（drawFloor / drawNeighbourFloor 同一口径），
 * 所以内容起点固定 0，只有宽度随楼层变。viewW = 画布宽 / 有效 zoom。
 */
export function floorBoundsX(floorW: number, viewW: number): BoundsAxis {
  return fitBoundsAxis(0, floorW, viewW);
}