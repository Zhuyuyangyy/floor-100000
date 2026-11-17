// AG-70 —— 战斗舞台的敌人剪影、头顶名签与受击演出。
//
// 用户 2026-11-17 原话：「我不是说那个就是打击别人的时候展示战斗然后我们
// 打击吗，不要做那种文本框，我们点击攻击看不见人的操作了」。敌人因此必须是
// 「看得见的东西」：有站位、有剪影、有血条、挨打会闪——而不是面板里的一行字。
//
// 分两块，界线刻意划在「纯数据/纯几何」与「Phaser 装配」之间：
//
//   1. 纯函数部分（Node 可测，不 import Phaser 运行时）：按 MonsterBehavior
//      映射形态，每种形态是一张 64×96 的色块表（16 色板内），附几何查询。
//      combatStage.test.ts 直接钉：块不越框、色不出板、七种行为全覆盖、
//      形态两两不同。
//   2. Phaser 装配部分：createMonsterView 把色块表烧成 Container（暗底剪影
//      + 白色受击层 + 接触阴影 + 头顶名签血条），并自带击退/闪避/前冲/倒地
//      的确定性 tween。只用 `import type Phaser`，与 panels.ts 同一条纪律——
//      值位不出现 Phaser 命名空间，Node 测试才引得动这个模块。
//
// 为什么敌人是程序化剪影而不是贴图：MonsterDef 只有数值没有外观字段
// （id/name/hp/damage/…），作战书也要求「不新画美术贴图」；而 15 只怪按
// 行为聚类后只有 8 种剪影，用 16 色板的色块足以把「这只怎么打」画出来——
// 看见低伏瘦长就知道是蹲人的，看见宽厚就知道刀刀见骨。
import type Phaser from 'phaser';

import { PALETTE, STAT_COLOR, TEXT, hex } from './palette';
import { FONT_FAMILY, TYPE, drawStatBar } from './uiKit';
import { ACTOR_DEPTH } from './lighting';
import type { MonsterBehavior } from '../systems/monsters';

// ── 画布与形态 ────────────────────────────────────────────────────────────

/** 剪影画布：64×96，双脚落在 y=96，朝左（敌人在右、面朝左边的玩家）。 */
export const MONSTER_FRAME = { w: 64, h: 96 } as const;

/** 剪影形态。七种行为 + 守门人（boss 专属）。 */
export type MonsterForm =
  | 'normal' // 白板人形：拾荒者、断电守卫
  | 'ambusher' // 低伏瘦长：楼道潜行者、顶楼疯裔
  | 'brute' // 宽厚巨肩：变异住客、巢穴母体
  | 'fast' // 弓身多足：楼道野猫、通风管蛛
  | 'ranged' // 举臂投弹：弹弓顽童、焚书者
  | 'slow' // 佝偻负重：瞌睡宿管、负重尸
  | 'coward' // 瘦小回头：偷食贼、畏光者
  | 'guardian'; // 高大带盾：守门人（900）

/** 一块剪影：画布坐标 + 16 色板内的颜色。 */
export interface MonsterBlock {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly c: number;
}

// 行为 → 形态。boss（守门人，行为 normal 但 id 900）显式走 guardian——
// 「最终闸」不能和满楼乱走的拾荒者一个剪影。coward/fast/ranged 等各自
// 独占一种形态，保证「看见怪就知道怎么打」。
export function monsterFormFor(behavior: MonsterBehavior, opts?: { isBoss?: boolean }): MonsterForm {
  if (opts?.isBoss) return 'guardian';
  switch (behavior) {
    case 'normal':
      return 'normal';
    case 'ambusher':
      return 'ambusher';
    case 'brute':
      return 'brute';
    case 'fast':
      return 'fast';
    case 'ranged':
      return 'ranged';
    case 'slow':
      return 'slow';
    case 'coward':
      return 'coward';
  }
}

/** 行为标签：开场飘一次，顶上名签不放（名签只放名字+血条，保持安静）。 */
export const BEHAVIOR_LABELS: Record<MonsterBehavior, string> = {
  normal: '普通',
  fast: '迅捷',
  slow: '笨重',
  ranged: '冷枪',
  ambusher: '伏击',
  coward: '怯战',
  brute: '蛮力',
} as const;

const INK = PALETTE.ink;
const SHADOW = PALETTE.shadow;
const STONE = PALETTE.stone;
const STONE_L = PALETTE.stoneLight;
const DUST = PALETTE.dust;
const CLOTH_D = PALETTE.clothDeep;
const CLOTH = PALETTE.cloth;
const CLOTH_L = PALETTE.clothLight;
const CLOTH_H = PALETTE.clothHigh;
const SKIN_D = PALETTE.skinDeep;
const SKIN = PALETTE.skin;
const LIGHT_D = PALETTE.lightDeep;
const LIGHT = PALETTE.light;
const LIGHT_HOT = PALETTE.lightHot;

const r = (x: number, y: number, w: number, h: number, c: number): MonsterBlock => ({ x, y, w, h, c });

// 每种形态都是「朝左」画：眼睛/面朝左缘，前肢在左侧。玩家在左，敌人面朝
// 玩家，双方才对峙而不是并肩。
const FORM_BLOCKS: Record<MonsterForm, readonly MonsterBlock[]> = {
  // 白板人形：兜衫活人，约 78 高。断电守卫同形（制服的区别交给上层色调，
  // 这里只保证剪影可读）。
  normal: [
    r(18, 12, 16, 8, CLOTH_D), // 兜帽
    r(20, 20, 12, 10, SKIN), // 头
    r(21, 24, 2, 2, LIGHT_HOT), // 左眼
    r(25, 24, 2, 2, LIGHT_HOT), // 右眼
    r(17, 30, 18, 26, CLOTH), // 躯干
    r(19, 33, 8, 12, CLOTH_L), // 胸前亮
    r(17, 56, 18, 4, CLOTH_D), // 腰带
    r(19, 60, 6, 30, CLOTH_D), // 左腿
    r(29, 60, 6, 30, CLOTH_D), // 右腿
    r(17, 90, 9, 6, SHADOW), // 左靴
    r(28, 90, 9, 6, SHADOW), // 右靴
    r(11, 32, 6, 20, CLOTH_D), // 前臂（面朝左）
    r(11, 52, 6, 6, SKIN_D), // 前手
    r(35, 32, 6, 20, CLOTH), // 后臂
    r(35, 52, 6, 6, SKIN), // 后手
  ],
  // 低伏瘦长：头压到 34，背脊三粒刺，前爪探地——「蹲人的」一眼可读。
  ambusher: [
    r(10, 34, 12, 10, SHADOW), // 兜帽（低伏）
    r(12, 40, 10, 8, SKIN_D), // 脸
    r(14, 43, 2, 2, LIGHT_HOT), // 左眼
    r(18, 43, 2, 2, LIGHT_HOT), // 右眼
    r(22, 38, 10, 8, SHADOW), // 肩（斜上前探）
    r(24, 46, 12, 8, STONE), // 背
    r(34, 50, 10, 8, STONE), // 臀
    r(12, 50, 5, 8, STONE_L), // 前肢
    r(12, 58, 5, 4, DUST), // 爪
    r(38, 56, 8, 26, STONE), // 后腿（蹬）
    r(38, 82, 10, 10, SHADOW), // 脚
    r(26, 34, 3, 4, STONE_L), // 背刺 1
    r(30, 36, 3, 4, STONE_L), // 背刺 2
    r(34, 38, 3, 4, STONE_L), // 背刺 3
  ],
  // 宽厚巨肩：肩台 40 宽，头陷在肩里，拳大如锤——「刀刀见骨」的体格。
  brute: [
    r(8, 26, 40, 14, STONE), // 巨肩
    r(10, 28, 36, 6, STONE_L), // 肩上亮
    r(22, 14, 14, 12, SKIN_D), // 小头
    r(24, 19, 3, 3, LIGHT_HOT), // 左眼
    r(30, 19, 3, 3, LIGHT_HOT), // 右眼
    r(12, 40, 32, 26, STONE), // 宽躯干
    r(14, 44, 12, 14, STONE_L), // 胸亮
    r(14, 66, 28, 8, STONE), // 肚
    r(12, 74, 32, 4, SHADOW), // 腰带
    r(14, 78, 12, 14, STONE), // 左腿
    r(30, 78, 12, 14, STONE), // 右腿
    r(12, 90, 15, 6, SHADOW), // 左脚
    r(29, 90, 15, 6, SHADOW), // 右脚
    r(4, 30, 8, 24, STONE), // 左巨臂
    r(4, 54, 8, 8, STONE_L), // 左拳
    r(44, 30, 8, 24, STONE), // 右巨臂
    r(44, 54, 8, 8, STONE_L), // 右拳
  ],
  // 弓身多足：尖耳、高光脊、四根张开的细腿——野猫与通风管蛛共用「快」的读法。
  fast: [
    r(19, 22, 4, 5, CLOTH), // 左尖耳
    r(29, 22, 4, 5, CLOTH), // 右尖耳
    r(20, 26, 12, 10, CLOTH_L), // 头
    r(22, 30, 3, 3, LIGHT_HOT), // 左眼
    r(27, 30, 3, 3, LIGHT_HOT), // 右眼
    r(24, 36, 10, 22, CLOTH_L), // 弓身
    r(26, 40, 6, 14, CLOTH_H), // 高光脊
    r(16, 58, 5, 26, CLOTH), // 腿 1
    r(23, 58, 5, 26, CLOTH), // 腿 2
    r(30, 58, 5, 26, CLOTH), // 腿 3
    r(37, 58, 5, 26, CLOTH), // 腿 4
    r(15, 84, 7, 4, DUST), // 爪 1
    r(22, 84, 7, 4, DUST), // 爪 2
    r(29, 84, 7, 4, DUST), // 爪 3
    r(36, 84, 7, 4, DUST), // 爪 4
    r(34, 30, 4, 4, DUST), // 丝线 1
    r(38, 26, 4, 4, DUST), // 丝线 2
  ],
  // 举臂投弹：Y 形双臂 + 暖色弹丸袋——「隔着一个房间放冷枪」。
  ranged: [
    r(20, 12, 16, 5, CLOTH_D), // 乱发
    r(22, 16, 12, 11, SKIN), // 头
    r(24, 21, 3, 3, LIGHT_HOT), // 左眼
    r(29, 21, 3, 3, LIGHT_HOT), // 右眼
    r(20, 27, 14, 24, CLOTH), // 躯干
    r(22, 30, 6, 10, CLOTH_L), // 胸前亮
    r(20, 51, 14, 4, CLOTH_D), // 腰带
    r(34, 48, 7, 8, LIGHT_D), // 弹丸袋（暖色 = 危险物）
    r(22, 55, 5, 30, CLOTH_D), // 左腿
    r(29, 55, 5, 30, CLOTH_D), // 右腿
    r(20, 85, 8, 6, SHADOW), // 左脚
    r(28, 85, 8, 6, SHADOW), // 右脚
    r(14, 20, 6, 6, CLOTH), // 左臂上举
    r(10, 14, 6, 6, SKIN), // 左手
    r(34, 20, 6, 6, CLOTH), // 右臂上举
    r(40, 14, 6, 6, SKIN), // 右手
    r(8, 10, 3, 14, LIGHT_D), // 弹弓叉 1
    r(14, 12, 3, 12, LIGHT_D), // 弹弓叉 2
  ],
  // 佝偻负重：低垂的头、拖地长臂、背上的重物——「笨，但扛打」。
  slow: [
    r(18, 20, 22, 12, DUST), // 背上重物
    r(20, 22, 18, 3, STONE_L), // 重物高光
    r(14, 22, 14, 12, SKIN_D), // 低垂的头
    r(16, 27, 3, 3, LIGHT_HOT), // 左眼
    r(22, 27, 3, 3, LIGHT_HOT), // 右眼
    r(12, 34, 20, 10, STONE), // 驼背
    r(12, 44, 22, 20, STONE), // 躯干
    r(14, 48, 8, 12, STONE_L), // 背亮
    r(6, 44, 7, 30, STONE), // 拖地左臂
    r(6, 74, 7, 10, SKIN_D), // 左手（拖地）
    r(32, 44, 7, 22, STONE), // 右臂
    r(32, 66, 7, 8, SKIN_D), // 右手
    r(14, 64, 8, 24, STONE), // 左腿
    r(26, 64, 8, 24, STONE), // 右腿
    r(12, 88, 11, 8, SHADOW), // 左脚
    r(25, 88, 11, 8, SHADOW), // 右脚
  ],
  // 瘦小回头：单眼回望、抱胸、角落掉着一点吃的——「欺软怕硬」。
  coward: [
    r(26, 18, 11, 10, SKIN), // 回头的小头
    r(31, 22, 3, 3, LIGHT_HOT), // 单眼（回望）
    r(22, 28, 13, 18, CLOTH), // 佝偻小身
    r(24, 31, 6, 8, CLOTH_L), // 胸前亮
    r(16, 30, 7, 8, CLOTH_D), // 抱胸左臂
    r(34, 30, 7, 8, CLOTH_D), // 抱胸右臂
    r(23, 46, 5, 20, CLOTH_D), // 左腿（缩）
    r(30, 46, 5, 20, CLOTH_D), // 右腿
    r(21, 66, 8, 6, SHADOW), // 左脚
    r(29, 66, 8, 6, SHADOW), // 右脚
    r(12, 60, 6, 4, LIGHT), // 掉落的一口吃的
  ],
  // 高大带盾：盔顶、面甲一道暖光、左侧大盾——「守门人」的体格。
  guardian: [
    r(20, 6, 16, 14, STONE), // 高大头盔
    r(22, 8, 12, 4, STONE_L), // 盔顶亮
    r(20, 16, 16, 3, LIGHT_D), // 面甲缝（暖光）
    r(10, 20, 36, 16, STONE), // 宽肩重甲
    r(12, 22, 32, 5, STONE_L), // 肩上亮
    r(14, 36, 24, 26, STONE), // 躯干甲
    r(16, 40, 8, 16, STONE_L), // 甲叶高光
    r(12, 62, 28, 10, SHADOW), // 裙甲
    r(16, 72, 7, 18, STONE), // 左腿
    r(29, 72, 7, 18, STONE), // 右腿
    r(14, 88, 11, 8, SHADOW), // 左脚
    r(27, 88, 11, 8, SHADOW), // 右脚
    r(2, 26, 10, 34, STONE_L), // 盾缘
    r(3, 28, 8, 30, STONE), // 盾面
    r(6, 30, 3, 24, LIGHT_D), // 盾徽
    r(44, 24, 8, 20, STONE), // 持械右臂
    r(44, 44, 8, 8, STONE_L), // 右拳
  ],
};

/** 某形态的色块表（只读副本，调用方不得改写）。 */
export function monsterBlocks(form: MonsterForm): readonly MonsterBlock[] {
  return FORM_BLOCKS[form];
}

/** 形态的像素高度（块表的最大下沿）——头顶名签据此抬升。 */
export function monsterFormHeight(form: MonsterForm): number {
  let bottom = 0;
  for (const blk of FORM_BLOCKS[form]) bottom = Math.max(bottom, blk.y + blk.h);
  return bottom;
}

/** 形态的像素宽度——测试与站位间距用。 */
export function monsterFormWidth(form: MonsterForm): number {
  let right = 0;
  for (const blk of FORM_BLOCKS[form]) right = Math.max(right, blk.x + blk.w);
  return right;
}

// ── 纯几何绘制（Node 可测） ────────────────────────────────────────────────

/** drawMonsterSilhouette / drawMonsterShadow 需要的「画布」最小接口。
 *  Phaser 的 Graphics 结构上就满足它；测试里用一个计数假实现即可。 */
export interface BlockCanvas {
  fillStyle(color: number, alpha?: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** 单色剪影：受击闪白层与暗底下沉层都用它（同形不同色）。 */
export function drawMonsterSilhouette(target: BlockCanvas, blocks: readonly MonsterBlock[], color: number): void {
  for (const blk of blocks) {
    target.fillStyle(color, 1);
    target.fillRect(blk.x, blk.y, blk.w, blk.h);
  }
}

/** 暗底下沉层：整块剪影沉 2px、ink 45%——把敌人从墙面上「抠」出来，
 *  和 addContactShadow 同一动机，只是贴着形体而不是只贴地。 */
export function drawMonsterShadow(target: BlockCanvas, blocks: readonly MonsterBlock[]): void {
  for (const blk of blocks) {
    target.fillStyle(INK, 0.45);
    target.fillRect(blk.x, blk.y + 2, blk.w, blk.h);
  }
}

// ── Phaser 装配 ───────────────────────────────────────────────────────────

/** 头顶名签：名字（暗底板上一行小字）+ 一小段分段血条。 */
export interface HeadTag {
  root: Phaser.GameObjects.Container;
  /** 血条立即到位。 */
  setHp(frac: number): void;
  /** 血条缓动到位——掉血看得见（受击链的一环）。 */
  tweenHpTo(frac: number, ms?: number): void;
  /** 停掉血条 tween——拆舞台时必须先停，否则 onUpdate 画已销毁的 Graphics。 */
  stop(): void;
}

/** 名签血条的几何：56 宽、5 高、10 段， drawStatBar 的同一语言。 */
const TAG_BAR_W = 56;
const TAG_BAR_H = 5;
const TAG_BAR_SEGMENTS = 10;

export interface HeadTagOptions {
  name: string;
  barColor: number;
  /** 名签底板（墙面上可读）。默认开。 */
  plate?: boolean;
}

export function createHeadTag(scene: Phaser.Scene, opts: HeadTagOptions): HeadTag {
  const nameText = scene.add
    .text(0, 0, opts.name, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
    .setOrigin(0.5, 1);
  const plateW = nameText.width + 10;
  const plate = scene.add.rectangle(0, -13, plateW, 24, PALETTE.ink, opts.plate === false ? 0 : 0.55).setOrigin(0.5, 0.5);
  const bar = scene.add.graphics();
  const root = scene.add.container(0, 0, [plate, nameText, bar]);
  const drawBar = (frac: number): void => {
    bar.clear();
    drawStatBar(bar, -TAG_BAR_W / 2, 6, TAG_BAR_W, TAG_BAR_H, frac, opts.barColor, TAG_BAR_SEGMENTS);
  };
  drawBar(1);
  let hpProxy = { v: 1 };
  return {
    root,
    setHp(frac: number): void {
      scene.tweens.killTweensOf(hpProxy);
      hpProxy.v = frac;
      drawBar(frac);
    },
    stop(): void {
      scene.tweens.killTweensOf(hpProxy);
    },
    tweenHpTo(frac: number, ms = 260): void {
      scene.tweens.killTweensOf(hpProxy);
      const from = hpProxy.v;
      if (Math.abs(from - frac) < 0.001) {
        drawBar(frac);
        return;
      }
      hpProxy = { v: from };
      scene.tweens.add({
        targets: hpProxy,
        v: frac,
        duration: ms,
        ease: 'Quad.easeOut',
        onUpdate: () => drawBar(hpProxy.v),
      });
    },
  };
}

export interface MonsterViewOptions {
  /** 世界 x：敌人的站位（双脚之间）。 */
  x: number;
  /** 世界 y：双脚落点。 */
  y: number;
  form: MonsterForm;
  name: string;
  hpFrac: number;
  /** 血条颜色：boss 用 UI.danger，其余用暖 accent。 */
  barColor: number;
  depth?: number;
}

export interface MonsterView {
  root: Phaser.GameObjects.Container;
  /** 站位（世界 x）——击退/闪避/前冲都以它为基准回归。 */
  spotX: number;
  /** 剪影像素高（头顶名签/点击热区据此量）。 */
  formH: number;
  /** 受击：闪白 150ms + 击退（后撤再弹回）。 */
  hit(knockback?: number): void;
  /** 未命中：朝玩家侧向闪避一小步（与击退方向相反，读法不同）。 */
  dodge(): void;
  /** 反击：朝玩家前冲再归位。 */
  lunge(): void;
  /** 阵亡：闪白、倒地、淡出。 */
  die(): void;
  /** 战退：滑出战场并淡出。 */
  fleeAway(): void;
  /**
   * AG-80：待机呼吸开关。降级机（帧预算守卫生效）时 GameScene 调
   * setBreathing(false) 停掉 2s yoyo 呼吸 tween——一个每帧都在写的
   * Container transform 在低端机上不是零成本；恢复时调 true 重启。
   * 停帧时 scale 复位到 1，不会有停在 1.03 的「半口气」。
   */
  setBreathing(on: boolean): void;
  /** 拆舞台：摘 tween 再毁容器（血条 tween 的 onUpdate 会画已销毁对象）。 */
  destroy(): void;
  setHp(frac: number): void;
  tweenHpTo(frac: number, ms?: number): void;
  /** 胸口飘字锚点（世界坐标，绝对 y）。 */
  chestY: number;
}

/**
 * 装配一只敌人。root 是击退/前冲的承载（x 归 spotX），body 只承担待机呼吸
 * （scale 1↔1.03，2s yoyo）——呼吸不传染血条与名签，它们挂在 root 上。
 */
export function createMonsterView(scene: Phaser.Scene, opts: MonsterViewOptions): MonsterView {
  const formH = monsterFormHeight(opts.form);
  const depth = opts.depth ?? ACTOR_DEPTH;
  const root = scene.add.container(opts.x, opts.y).setDepth(depth);

  // 接触阴影：三叠椭圆（roomDepth.addContactShadow 的同款语言），画在 root
  // 里随敌人移动—— knocked back 30px 时影子跟着走。
  const shadow = scene.add.graphics();
  for (const [scale, a] of [
    [1, 0.22],
    [0.72, 0.38],
    [0.45, 0.55],
  ] as ReadonlyArray<readonly [number, number]>) {
    shadow.fillStyle(INK, a);
    shadow.fillEllipse(0, 0, 44 * scale, 10 * scale);
  }

  // 身体：暗底下沉 + 彩色剪影（画布坐标 → 世界坐标：双脚对齐原点）。
  const body = scene.add.container(0, 0);
  const art = scene.add.graphics();
  const flash = scene.add.graphics().setAlpha(0);
  const blocks = monsterBlocks(opts.form);
  for (const blk of blocks) {
    // 剪影本体：色块表原色；下沉层同形沉 2px、ink 45%，把敌人从墙上抠出来。
    art.fillStyle(blk.c, 1);
    art.fillRect(blk.x - MONSTER_FRAME.w / 2, blk.y - formH, blk.w, blk.h);
    art.fillStyle(INK, 0.45);
    art.fillRect(blk.x - MONSTER_FRAME.w / 2, blk.y - formH + 2, blk.w, blk.h);
    // 受击闪白层：同形纯白，初始透明，hit() 时点亮 150ms。
    flash.fillStyle(0xffffff, 1);
    flash.fillRect(blk.x - MONSTER_FRAME.w / 2, blk.y - formH, blk.w, blk.h);
  }
  body.add([art, flash]);

  // 待机呼吸：确定性 tween（无随机），2s yoyo——「活着」的最低成本信号。
  // AG-80：提成函数，setBreathing 停帧/重启都走它（停帧时先 killTweensOf
  // 并把 scale 复位，恢复时从 1 重新起播，不续半口气）。
  let breathing = true;
  const playBreathe = (): void => {
    scene.tweens.killTweensOf(body);
    body.setScale(1);
    scene.tweens.add({
      targets: body,
      scaleX: 1.03,
      scaleY: 1.03,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  };
  playBreathe();

  const tag = createHeadTag(scene, { name: opts.name, barColor: opts.barColor });
  tag.root.setPosition(0, -formH - 14);
  tag.setHp(opts.hpFrac);

  root.add([shadow, body, tag.root]);

  const moveTo = (x: number, ms: number, ease: string): void => {
    scene.tweens.killTweensOf(root);
    scene.tweens.add({ targets: root, x, duration: ms, ease });
  };

  return {
    root,
    spotX: opts.x,
    formH,
    chestY: opts.y - formH * 0.55,
    hit(knockback = 26): void {
      // 闪白 150ms 回
      scene.tweens.killTweensOf(flash);
      flash.setAlpha(0.9);
      scene.tweens.add({ targets: flash, alpha: 0, duration: 150 });
      // 击退：后撤 knockback px 再弹回（先快后慢，读作「被打得退了一步」）
      moveTo(opts.x + knockback, 90, 'Quad.easeOut');
      scene.time.delayedCall(90, () => {
        if (!root.active) return;
        moveTo(opts.x, 170, 'Sine.easeInOut');
      });
    },
    dodge(): void {
      // 未命中：朝玩家（左）侧移一小步再归位——和击退反向，读作闪避
      moveTo(opts.x - 14, 70, 'Quad.easeOut');
      scene.time.delayedCall(70, () => {
        if (!root.active) return;
        moveTo(opts.x, 120, 'Sine.easeInOut');
      });
    },
    lunge(): void {
      // 反击：朝玩家前冲 38px 再归位
      moveTo(opts.x - 38, 130, 'Quad.easeIn');
      scene.time.delayedCall(130, () => {
        if (!root.active) return;
        moveTo(opts.x, 200, 'Quad.easeOut');
      });
    },
    die(): void {
      scene.tweens.killTweensOf(root);
      flash.setAlpha(0.9);
      scene.tweens.add({ targets: flash, alpha: 0, duration: 150 });
      scene.tweens.add({
        targets: root,
        angle: 9,
        y: opts.y + 10,
        alpha: 0,
        duration: 460,
        delay: 120,
        ease: 'Quad.easeIn',
      });
    },
    fleeAway(): void {
      scene.tweens.killTweensOf(root);
      scene.tweens.add({
        targets: root,
        x: opts.x + 240,
        alpha: 0,
        duration: 520,
        ease: 'Quad.easeIn',
      });
    },
    setBreathing(on: boolean): void {
      if (on === breathing) return;
      breathing = on;
      if (on) playBreathe();
      else {
        scene.tweens.killTweensOf(body);
        body.setScale(1);
      }
    },
    destroy(): void {
      scene.tweens.killTweensOf(root);
      scene.tweens.killTweensOf(body);
      scene.tweens.killTweensOf(flash);
      tag.stop();
      root.destroy();
    },
    setHp(frac: number): void {
      tag.setHp(frac);
    },
    tweenHpTo(frac: number, ms?: number): void {
      tag.tweenHpTo(frac, ms);
    },
  };
}

// ACTOR_DEPTH（ lighting.ts 的纯常量）已在文件头部 import；16 色板内的
// boss 血条色与常规怪分开——守门人要一眼认出来。
export const MONSTER_BAR_COLORS = {
  normal: STAT_COLOR.hp,
  boss: PALETTE.lightHigh,
} as const;
