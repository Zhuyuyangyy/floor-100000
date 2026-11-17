import { PALETTE } from './palette.ts';
import type { AchievementTier } from '../data/achievements';

// AG-77：成就档位的界面语言（toast 与查看面板共用一处定义）。
//
// 三色全部取自 palette——铜=肤色深、银=石灰、金=灯光高光。刻意不用
// 现成的 #cd7f32/#c0c0c0/#ffd700：那三个值不在十六色 palette 里，进来
// 就是「第九种 UI 色」，而这三色在既有色阶里都有远亲（皮肤/石灰/灯），
// 与界面其余部分同族。
//
// 放在 render/ 而不是 data/achievements.ts：依赖方向是 render → data
// （artpack/corridors/walkcycle 都这么走），数据层不 import 表现层。

export const ACHIEVEMENT_TIER_COLOR: Record<AchievementTier, number> = {
  bronze: PALETTE.skinDeep,
  silver: PALETTE.dust,
  gold: PALETTE.lightHigh,
};

export const ACHIEVEMENT_TIER_LABEL: Record<AchievementTier, string> = {
  bronze: '铜',
  silver: '银',
  gold: '金',
};
