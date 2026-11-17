// AG-73：新手教程的六步文案（TWOM 式前 5 层基础发育区：几何固定，教程因此
// 能按坐标钉死每一步的目标物件）。本文件只放文案与一个共享常量——推进判定、
// 提示出现条件与高亮几何在 systems/TutorialSystem.ts（纯函数，src/tests/
// tutorial.test.ts 单测）。GameScene 只负责显示与喂信号，不在这里。

export type TutorialStepId = 'move' | 'loot' | 'stats' | 'craft' | 'stairs' | 'bed';

export interface TutorialStepCopy {
  id: TutorialStepId;
  /** contextual 槽短提示：接管导航条 contextual 槽（只在世界链无话可说时）。 */
  hint: string;
}

/**
 * 六步，顺序即教程顺序（tick 只推进当前步，做完一步才推下一步）：
 *   0 move   移动过 200px
 *   1 loot   开过第一个容器（visitedFloors[*].openedContainers 非空）
 *   2 stats  圆环高亮 3 秒，无强制等待，到点自动进下一步
 *   3 craft  制作面板开过一次（craftingOpen）
 *   4 stairs 到过第 2 层（currentFloor > STARTING_FLOOR）
 *   5 bed    睡过（shelterPlan 已结算）或入夜
 */
export const TUTORIAL_STEPS: readonly TutorialStepCopy[] = [
  { id: 'move', hint: '按 A/D 或 ←/→ 移动，熟悉这座塔' },
  { id: 'loot', hint: '走近柜子，按 E 搜刮' },
  { id: 'stats', hint: '生命/饥饿/口渴/精力，看屏幕上方四枚圆环' },
  { id: 'craft', hint: '按 C 打开制作面板（工作台旁按 E 同样可以）' },
  { id: 'stairs', hint: '走到楼层左端的梯口，按 E 上楼' },
  { id: 'bed', hint: '入夜后回自己的床，按 E 睡觉' },
] as const;

/** 开局 flash：教程激活时接替原来那行「目标：……」；跳过后仍放原来的话。 */
export const TUTORIAL_OPENING_LINE = '目标：从第 1 层一路爬到第 100000 层。先按 A/D 或 ←/→ 移动，熟悉这座塔。';
/** 六步全过的收尾 flash。 */
export const TUTORIAL_DONE_LINE = '你已掌握基本生存——继续往上，第 100000 层见。';
/** 跳过时的 flash。 */
export const TUTORIAL_SKIP_LINE = '教程已跳过。键位随时可以按 Esc，看暂停菜单里的操作说明';
/** 右上角跳过按钮的标签。 */
export const TUTORIAL_SKIP_LABEL = '跳过教程';

/**
 * 世界链的默认脚注——GameScene 世界链 else 分支的同串（两边都引这一份，
 * 免得改台词时只改一头）。教程的 contextual 分支靠它判断「世界此刻无话说」：
 * 世界只要报了任何具体的「按 E ××」（柜/床/梯口/电梯/问号点……），就让
 * 世界说，教程不覆写交互提示。
 */
export const WORLD_DEFAULT_HINT = 'A/D 或 ←/→ 移动 · E 交互';
