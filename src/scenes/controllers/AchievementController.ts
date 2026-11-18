// AG-77：成就系统（解锁 toast + 跨 run 持久化）——RC-03 拆分第 5 步。
// 从 GameScene 迁出（原 281-300 常量区 + 960-974 字段组 + 5440-5571 方法段），
// 行为零变更：同一构造路径（create 里读独立键）、同一钩子位（十处事发一行
// emit + 战斗受伤记账 + 跨天对账）、同一 toast 几何与节流、同一落盘时刻。
//
// 形态（设计文档 §2，沿用前四步的主机结构面模式）：plain TS 类，**不 import
// Phaser 场景类型**——
//   * 构造拿 host（AchievementHost：add 工厂/tweens/time 三个 Phaser 单子——
//     GameScene 天然满足）与 storage（ AchievementSystem 的 Storage：场景传
//     localStorage，单测传 Map 假件——与 achievements.test.ts 同款）。
//   * 求值与计数全在 systems/AchievementSystem.ts（纯函数，独立存储键
//     floor100000.achievements.v1，28 例单测守着），数据在 data/achievements.ts，
//     皮肤在 render/achievementSkin.ts——**都不随迁**；本类只做编排：事发
//     钩子接线、toast 队列管理、toast UI 呈现、落盘委托。
//   * import 链（systems/AchievementSystem、data/achievements、render/
//     achievementSkin、render/hudSkin、render/audio、render/uiKit、render/
//     palette、render/panels、core/design）均无 Phaser 值导入——Node 下可用
//     记录型假件单测（src/tests/achievementController.test.ts）。
//
// 不变量（迁移中逐字保留）：
//   · 落盘不抛、不阻塞——localStorage 写不进去时内存里的奖杯柜照常显示
//     （saveAchievements best-effort，emit 的返回值与 toast 队列不受影响）；
//   · 跨 run 永久——存储键独立于存档键，重置游戏只清 toast 队列与跨天记账，
//     奖杯柜本身在 init 时从独立键读回；
//   · toast 队列节流——同屏最多 3 枚、两枚之间最少 550ms，连亮读成依次
//     弹出而不是一锅；到期退场后下面的补位，顶部不空一格。

import type Phaser from 'phaser';
import {
  evaluateAchievements,
  freshAchievements,
  loadAchievements,
  saveAchievements,
  type AchievementEvent,
  type AchievementSave,
} from '../../systems/AchievementSystem';
import type { AchievementDef } from '../../data/achievements';
import { ACHIEVEMENT_TIER_COLOR, ACHIEVEMENT_TIER_LABEL } from '../../render/achievementSkin';
import { drawHudIcon } from '../../render/hudSkin';
import { playSfx } from '../../render/audio';
import { FONT_FAMILY, TYPE, UI } from '../../render/uiKit';
import { PALETTE, TEXT, hex } from '../../render/palette';
import { HUD_FEEDBACK_DEPTH } from '../../render/panels';
import { DESIGN_WIDTH } from '../../core/design';

// ── AG-77: 成就解锁 toast 的几何与节奏 ─────────────────────────────────────
// 右上角逐枚堆叠的铆钉小板（与导航条/顶带同一套 drawHudPlate 语言）。两条
// 硬约束来自邻居：
//   * 顶缘 112 = HUD 板（contextBottom 102）之下 10px——不压四联圆环；
//   * 最多同时 3 枚：底边 112 + 3×(64+8) = 328，清开右下状态卡（376..556）。
// 底部导航条占 672..720，本列离它 344px，永远不相交。
const TOAST_W = 384;
const TOAST_H = 64;
/** 右缘内边距：与 HUD 按钮行同一 16px 边际。 */
const TOAST_RIGHT_MARGIN = 16;
const TOAST_TOP = 112;
const TOAST_PITCH = TOAST_H + 8;
/** 同屏上限；超出的进队列排队（多成就连亮时读成依次弹出，不是一锅）。 */
const TOAST_MAX_VISIBLE = 3;
/** 一枚 toast 的存活时长（ms）。 */
const TOAST_LIFE_MS = 3600;
/** 队列里两枚之间的最小间隔（ms）。 */
const TOAST_STAGGER_MS = 550;
/** 一枚 toast 的零件：三种都有 setAlpha/销毁语义（Phaser 4 基类不带这些方法）。 */
type ToastPart = Phaser.GameObjects.Rectangle | Phaser.GameObjects.Graphics | Phaser.GameObjects.Text;

/** 一枚在场 toast 的记录：定义 + 零件组（整组一个寿命）+ 到期时刻 + 当前顶 y。 */
interface ActiveToast {
  def: AchievementDef;
  objects: ToastPart[];
  until: number;
  top: number;
}

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene：本类的可测性靠这层结构面，而不是靠能造真场景。
 */
export interface AchievementHost {
  /** Phaser 的 GameObject 工厂——toast 的底板/铆钉板/星章/两行字从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** Tween 管理器——toast 的入场滑入/淡出与退场补位。 */
  tweens: Phaser.Tweens.TweenManager;
  /** 场景时钟——出票节流与寿命都读 now。 */
  time: Phaser.Time.Clock;
}

export class AchievementController {
  // ── 奖杯柜与 toast 队列（字段初始化器不随场景重启重跑，init 显式重置）────
  private save: AchievementSave = freshAchievements();
  private queue: AchievementDef[] = [];
  private activeToasts: ActiveToast[] = [];
  /** 下一枚 toast 最早可出的时刻（队列节流：连亮也不糊成一片）。 */
  private nextToastAt = 0;
  /** 本天内口渴是否见底过（跨天结算 thirstStreak 用；睡觉得天由 update 兜）。 */
  private thirstHitZero = false;
  /** update 上次记账的 day：睡眠跨日不走帧循环的 dayChanged，用对比兜底。 */
  private lastDay = 1;
  /** 本场战斗累计受到的伤害（零伤击败守门人的判据）。 */
  private combatDamageTaken = 0;

  constructor(
    private readonly host: AchievementHost,
    private readonly storage: Storage,
  ) {}

  // ── 生命周期 ─────────────────────────────────────────────────────────────

  /**
   * create() 尾部调用一次：成就档从独立键读入（重置游戏不清空——Steam 成就
   * 的永久性语义），toast 队列与跨天记账随新跑局清空——字段初始化器不重跑，
   * 上一局的排队 toast 会插进新局。
   */
  init(day: number): void {
    this.save = loadAchievements(this.storage);
    this.clear();
    this.thirstHitZero = false;
    this.lastDay = day;
    this.combatDamageTaken = 0;
  }

  // ── 钩子（场景事发处各一行；判定逻辑全在 AchievementSystem）─────────────

  /**
   * 事发一处一行：把事件喂给纯核心，新解锁排队，落独立键的盘。
   * 不抛、不阻塞——localStorage 写不进去时内存里的奖杯柜照常显示。
   * 返回本轮新解锁的 id（e2e dev 句柄用；产品路径忽略返回值）。
   */
  emit(event: AchievementEvent): string[] {
    const { save, unlocked } = evaluateAchievements(this.save, event);
    this.save = save;
    saveAchievements(save, this.storage);
    if (unlocked.length === 0) return [];
    for (const def of unlocked) this.queue.push(def);
    playSfx('goal');
    return unlocked.map((d) => d.id);
  }

  /** 本场战斗受伤计数从零起算——「零伤害击败守门人」只认这一场的账。 */
  resetCombatDamage(): void {
    this.combatDamageTaken = 0;
  }

  /** 受击记账（抢先扑出与敌人反击都进这本账；AG-81 的 bumpStat 是另一本）。 */
  noteCombatDamage(dmg: number): void {
    this.combatDamageTaken += dmg;
  }

  /** 本场累计受伤（boss_won 事件的 damageTaken 判据读数）。 */
  get combatDamage(): number {
    return this.combatDamageTaken;
  }

  /** 当天口渴见底过（thirstStreak 的「当天缺水」判据）。零也要算——归零那一帧就是见底。 */
  noteThirstZero(): void {
    this.thirstHitZero = true;
  }

  /**
   * 跨天结算「连续不缺水」。不走 tick.dayChanged 而对比入参 day——睡觉
   * （ShelterSystem.finishNight）也跨天，那条路不经过帧循环的 tick。flag 记
   * 的是刚过去这一天有没有见底，随后清零。
   */
  noteDay(day: number): void {
    if (day === this.lastDay) return;
    this.emit({ type: 'day_end', dehydrated: this.thirstHitZero });
    this.thirstHitZero = false;
    this.lastDay = day;
  }

  // ── toast 队列 ───────────────────────────────────────────────────────────

  /** 每帧（update 第一段，面板早退之前）：排队出票 + 到期退场。 */
  update(): void {
    const now = this.host.time.now;
    // 到期退场（倒序，splice 安全）。
    let removed = false;
    for (let i = this.activeToasts.length - 1; i >= 0; i--) {
      const toast = this.activeToasts[i];
      if (now < toast.until) continue;
      this.activeToasts.splice(i, 1);
      removed = true;
      const objects = toast.objects;
      this.host.tweens.add({
        targets: objects,
        alpha: 0,
        duration: 240,
        ease: 'Cubic.in',
        onComplete: () => {
          for (const o of objects) o.destroy();
        },
      });
    }
    // 退场后重排：队列中间走了一枚，后面的补上来——不然顶部永远空一格。
    // 每条记着自己的 top，按新索引算差量，任意走法都不会算错。
    if (removed) {
      this.activeToasts.forEach((toast, i) => {
        const top = TOAST_TOP + i * TOAST_PITCH;
        const delta = top - toast.top;
        if (delta === 0) return;
        toast.top = top;
        for (const o of toast.objects) {
          this.host.tweens.add({ targets: o, y: o.y + delta, duration: 200, ease: 'Cubic.out' });
        }
      });
    }
    // 排队出票：同屏不满、队列有货、节流到期，才放下一枚。
    if (this.queue.length > 0 && this.activeToasts.length < TOAST_MAX_VISIBLE && now >= this.nextToastAt) {
      const def = this.queue.shift();
      if (def) {
        this.spawnToast(def);
        this.nextToastAt = now + TOAST_STAGGER_MS;
      }
    }
  }

  /** 场景重启/退出：清掉还在场的 toast（字段初始化器不重跑，见 init 的注释）。 */
  clear(): void {
    for (const toast of this.activeToasts) for (const o of toast.objects) o.destroy();
    this.activeToasts = [];
    this.queue = [];
    this.nextToastAt = 0;
  }

  /** 出一枚 toast：铆钉小板 + tier 色左筋 + 星形章 + 两行字。 */
  private spawnToast(def: AchievementDef): void {
    const color = ACHIEVEMENT_TIER_COLOR[def.tier];
    const left = DESIGN_WIDTH - TOAST_RIGHT_MARGIN - TOAST_W;
    const index = this.activeToasts.length;
    const top = TOAST_TOP + index * TOAST_PITCH;
    const depth = HUD_FEEDBACK_DEPTH;
    const objects: ToastPart[] = [];

    const plate = this.host.add.rectangle(left + 12, top, TOAST_W, TOAST_H, UI.surface).setOrigin(0, 0).setScrollFactor(0).setAlpha(0.92).setDepth(depth).setName('achievement-toast');
    objects.push(plate);
    const g = this.host.add.graphics().setScrollFactor(0).setDepth(depth + 1).setName('achievement-toast-art');
    // 六段渐变板 + 四角铆钉 + 左筋，与导航条同一语言（drawHudPlate 画的是以
    // (0,0) 为原点的板，这里平移到 toast 自己的坐标）。
    const BANDS = 6;
    for (let i = 0; i < BANDS; i++) {
      g.fillStyle(0x0b0f12, 0.14 + 0.12 * (i / (BANDS - 1)));
      g.fillRect(left, top + Math.round((TOAST_H / BANDS) * i), TOAST_W, Math.ceil(TOAST_H / BANDS) + 1);
    }
    g.fillStyle(UI.line, 0.9);
    g.fillRect(left, top, TOAST_W, 1);
    g.fillRect(left, top + TOAST_H - 1, TOAST_W, 1);
    g.fillStyle(PALETTE.stoneLight, 0.85);
    for (const [rx, ry] of [
      [left + 8, top + 8],
      [left + TOAST_W - 9, top + 8],
      [left + 8, top + TOAST_H - 9],
      [left + TOAST_W - 9, top + TOAST_H - 9],
    ] as Array<[number, number]>) {
      g.fillRect(rx, ry, 2, 2);
    }
    g.fillStyle(color, 1);
    g.fillRect(left, top, 3, TOAST_H);
    objects.push(g);
    // 星形章（hudSkin 的 16px 格）——「得了颗星」的那个星。
    const icon = this.host.add.graphics().setScrollFactor(0).setDepth(depth + 2);
    drawHudIcon(icon, 'star', left + 14, top + TOAST_H / 2 - 8, 16, color);
    objects.push(icon);
    const caption = this.host.add
      .text(left + 42, top + 17, '成就解锁', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 2);
    objects.push(caption);
    const name = this.host.add
      .text(left + 42, top + 41, def.name, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary) })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 2)
      .setName('achievement-toast-name');
    objects.push(name);
    const tier = this.host.add
      .text(left + TOAST_W - 12, top + TOAST_H / 2, ACHIEVEMENT_TIER_LABEL[def.tier], { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(color) })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 2);
    objects.push(tier);

    // 入场：从右 12px 滑入 + 淡入；出场：淡出后销毁。整组一个 until 到期即走。
    for (const o of objects) o.setAlpha(0);
    this.host.tweens.add({ targets: objects, alpha: 1, duration: 200, ease: 'Cubic.out' });
    this.host.tweens.add({ targets: plate, x: left, duration: 200, ease: 'Cubic.out' });
    this.activeToasts.push({ def, objects, until: this.host.time.now + TOAST_LIFE_MS, top });
  }
}
